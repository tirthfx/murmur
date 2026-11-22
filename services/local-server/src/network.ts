import { isIP } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import type { AuditInput } from "./audit.ts";
import type { Settings } from "./settings.ts";

/**
 * The IP allowlist (TM-22): which addresses may call the server. It is checked from the socket's
 * address (proxy headers are never trusted) before anything else, so a refused address learns
 * nothing. This machine is always allowed. By default the server listens on this machine only, so
 * the list matters once LAN listening is turned on (`MURMUR_SERVER_LAN=1`).
 */
export const DEFAULT_ALLOWLIST = ["127.0.0.1/32", "::1/128"] as const;
export const ALLOWLIST_LIMIT = 100;
const DENIAL_AUDIT_MS = 60_000;

/** An address as 128 bits: an IPv4 address is written as an IPv4-mapped IPv6 address. */
function toBits(address: string): bigint | null {
  let text = address.trim();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  const family = isIP(text);
  if (family === 4) {
    const parts = text.split(".").map(Number);
    return (
      (0xffffn << 32n) |
      BigInt(((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0)
    );
  }
  if (family !== 6) return null;
  // ::ffff:1.2.3.4 carries an IPv4 address in its last 32 bits.
  const v4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    const high = toBits(`${v4[1]}0:0`);
    const low = toBits(v4[2]!);
    if (high === null || low === null) return null;
    return (high & ~0xffffffffn) | (low & 0xffffffffn);
  }
  const [head = "", tail] = text.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const missing = 8 - left.length - right.length;
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array<string>(Math.max(missing, 0)).fill("0"), ...right];
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(parseInt(group, 16));
  return value;
}

export interface Cidr {
  /** `1.2.3.0/24`, with the prefix length, as it is stored. */
  text: string;
  base: bigint;
  /** The prefix length in the 128-bit form. */
  bits: number;
}

/** `10.0.0.0/8`, `192.168.1.5` (a single address), `fd00::/8`. Null when it is neither. */
export function parseCidr(input: string): Cidr | null {
  const text = input.trim();
  const [address = "", lengthText] = text.split("/");
  const family = isIP(address);
  if (family === 0) return null;
  const max = family === 4 ? 32 : 128;
  const length =
    lengthText === undefined ? max : /^\d{1,3}$/.test(lengthText) ? Number(lengthText) : -1;
  if (length < 0 || length > max) return null;
  const value = toBits(address);
  if (value === null) return null;
  const bits = family === 4 ? 96 + length : length;
  const mask = bits === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - bits)) - 1n);
  return { text: `${address}/${length}`, base: value & mask, bits };
}

export function inRange(address: string, ranges: readonly Cidr[]): boolean {
  const value = toBits(address);
  if (value === null) return false;
  return ranges.some((range) => {
    const mask =
      range.bits === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - range.bits)) - 1n);
    return (value & mask) === range.base;
  });
}

const LOOPBACK = [parseCidr("127.0.0.0/8")!, parseCidr("::1/128")!];

export interface NetworkDeps {
  db: DatabaseSync;
  settings: Settings;
  now(): number;
  audit(input: AuditInput): void;
}

export function createNetwork(deps: NetworkDeps) {
  const denied = new Map<string, number>();

  const list = (): string[] =>
    deps.settings.get<string[]>("identity.ipAllowlist", [...DEFAULT_ALLOWLIST]);

  return {
    allowlist: list,

    /**
     * Whether an address may call the server. This machine always may: the Murmur app on it must
     * keep working, and removing the last other entry must not lock the owner out.
     */
    allowed(address: string | undefined): boolean {
      if (!address) return false;
      if (inRange(address, LOOPBACK)) return true;
      const ranges = list()
        .map(parseCidr)
        .filter((range): range is Cidr => range !== null);
      return inRange(address, ranges);
    },

    /** A refusal is written to the audit log at most once a minute for an address. */
    noteDenied(address: string | undefined): void {
      const key = address ?? "unknown";
      const at = deps.now();
      const last = denied.get(key);
      if (last !== undefined && at - last < DENIAL_AUDIT_MS) return;
      if (denied.size >= 500) denied.clear();
      denied.set(key, at);
      deps.audit({
        actorId: null,
        action: "network.denied",
        targetType: "address",
        targetId: key.slice(0, 100),
        detail: { reason: "not_in_allowlist" },
      });
    },

    /** Saves the list: each entry a CIDR range or an address, at most 100, written back normalised. */
    set(
      actorId: string | null,
      ranges: unknown,
    ): { ok: true; ranges: string[] } | { ok: false; message: string } {
      if (!Array.isArray(ranges) || ranges.length > ALLOWLIST_LIMIT)
        return {
          ok: false,
          message: `The allowlist is a list of up to ${ALLOWLIST_LIMIT} address ranges.`,
        };
      const clean: string[] = [];
      for (const entry of ranges) {
        const parsed = typeof entry === "string" ? parseCidr(entry) : null;
        if (!parsed)
          return {
            ok: false,
            message: `"${String(entry)}" is not an address or a range like 10.0.0.0/8.`,
          };
        if (!clean.includes(parsed.text)) clean.push(parsed.text);
      }
      const before = list();
      deps.settings.set("identity.ipAllowlist", clean);
      deps.audit({
        actorId,
        action: "network.allowlist_changed",
        detail: { from: before.length, to: clean.length },
      });
      return { ok: true, ranges: clean };
    },

    /** The owner's way back in: the list goes back to this machine only. Run on the host. */
    reset(): void {
      deps.settings.set("identity.ipAllowlist", [...DEFAULT_ALLOWLIST]);
      deps.audit({
        actorId: null,
        action: "network.allowlist_reset",
        detail: { source: "host_command" },
      });
    },
  };
}

export type Network = ReturnType<typeof createNetwork>;
