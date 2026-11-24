import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AuditInput } from "./audit.ts";

/**
 * A second step for the admin console (TM-11, `team.admin.requireMfa`): a time-based one-time
 * password as RFC 6238 writes it (HMAC-SHA1, six digits, thirty seconds), which any authenticator
 * app understands, and eight one-use recovery codes for a lost phone.
 *
 * Honest limits: the secret is kept as it is, because a code cannot be checked from a hash, and
 * the database is not encrypted at rest. This guards the console against a stolen password; it is
 * not a defence against someone who can read the server's files.
 */
export const MFA = {
  digits: 6,
  stepSeconds: 30,
  /** Steps either side of now that are accepted, for a clock that is a little off. */
  window: 1,
  recoveryCodes: 8,
  /** Wrong codes in a row, as for passwords, before a wait. */
  failures: 5,
  delayMs: 30_000,
  issuer: "Murmur",
} as const;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Not a base32 secret.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code for one time step (RFC 4226 with the step as the counter). */
export function totpAt(secret: Buffer, step: number, digits: number = MFA.digits): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export const stepOf = (ms: number): number => Math.floor(ms / 1000 / MFA.stepSeconds);

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const hashRecovery = (code: string): string =>
  createHash("sha256").update(code.replace(/[\s-]/g, "").toLowerCase()).digest("hex");

export type MfaCheck =
  | { ok: true; via: "code" | "recovery" }
  | { ok: false; code: "mfa_invalid" | "delayed"; retryAfterSeconds?: number };

export interface MfaDeps {
  db: DatabaseSync;
  now(): number;
  audit(input: AuditInput): void;
}

export function createMfa(deps: MfaDeps) {
  const { db } = deps;

  const row = (userId: string) =>
    db
      .prepare("SELECT secret, confirmed_at, last_step FROM account_mfa WHERE user_id = ?")
      .get(userId) as
      { secret: string; confirmed_at: number | null; last_step: number } | undefined;

  const throttleKey = (userId: string) => `mfa:${userId}`;

  return {
    /** Whether the account has finished setting up a second step. */
    enrolled: (userId: string): boolean => row(userId)?.confirmed_at != null,

    /** Starts setting up: a new secret (replacing an unfinished one), shown once to the person. */
    begin(userId: string, email: string): { secret: string; uri: string } {
      if (row(userId)?.confirmed_at != null) throw new Error("already enrolled");
      const secret = base32Encode(randomBytes(20));
      db.prepare(
        `INSERT INTO account_mfa (user_id, secret, confirmed_at, last_step, created_at) VALUES (?, ?, NULL, 0, ?)
         ON CONFLICT (user_id) DO UPDATE SET secret = excluded.secret, confirmed_at = NULL, last_step = 0, created_at = excluded.created_at`,
      ).run(userId, secret, deps.now());
      const label = encodeURIComponent(`${MFA.issuer}:${email}`);
      const uri =
        `otpauth://totp/${label}?secret=${secret}&issuer=${MFA.issuer}` +
        `&algorithm=SHA1&digits=${MFA.digits}&period=${MFA.stepSeconds}`;
      return { secret, uri };
    },

    /** Finishes setting up when the code is right; returns the recovery codes, once. */
    confirm(userId: string, code: string): { ok: true; recovery: string[] } | { ok: false } {
      const current = row(userId);
      if (!current || current.confirmed_at != null) return { ok: false };
      const step = this.matchStep(current.secret, code, 0);
      if (step === null) return { ok: false };
      const recovery = Array.from({ length: MFA.recoveryCodes }, () => {
        const raw = randomBytes(6).toString("hex");
        return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
      });
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE account_mfa SET confirmed_at = ?, last_step = ? WHERE user_id = ?").run(
          deps.now(),
          step,
          userId,
        );
        db.prepare("DELETE FROM mfa_recovery WHERE user_id = ?").run(userId);
        const insert = db.prepare("INSERT INTO mfa_recovery (user_id, code_hash) VALUES (?, ?)");
        for (const code of recovery) insert.run(userId, hashRecovery(code));
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return { ok: true, recovery };
    },

    /** The step a code belongs to within the window and after `after`, or null. */
    matchStep(secret: string, code: string, after: number): number | null {
      if (!/^\d{6}$/.test(code.trim())) return null;
      const key = base32Decode(secret);
      const now = stepOf(deps.now());
      let found: number | null = null;
      // Every step in the window is compared, so the time taken does not say which matched.
      for (let step = now - MFA.window; step <= now + MFA.window; step++) {
        const ok = same(totpAt(key, step), code.trim());
        if (ok && step > after && (found === null || step > found)) found = step;
      }
      return found;
    },

    /**
     * Checks a code from the app, or a recovery code. A code works once (its step is remembered)
     * and a recovery code works once. Five wrong tries in a row make the person wait.
     */
    check(userId: string, input: string): MfaCheck {
      const now = deps.now();
      const key = throttleKey(userId);
      const throttle = db
        .prepare("SELECT failures, locked_until FROM sign_in_throttle WHERE email = ?")
        .get(key) as { failures: number; locked_until: number } | undefined;
      if (throttle && throttle.locked_until > now)
        return {
          ok: false,
          code: "delayed",
          retryAfterSeconds: Math.ceil((throttle.locked_until - now) / 1000),
        };

      const current = row(userId);
      let via: "code" | "recovery" | null = null;
      if (current?.confirmed_at != null) {
        const step = this.matchStep(current.secret, input, current.last_step);
        if (step !== null) {
          db.prepare("UPDATE account_mfa SET last_step = ? WHERE user_id = ?").run(step, userId);
          via = "code";
        } else {
          const used = db
            .prepare(
              "UPDATE mfa_recovery SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL",
            )
            .run(now, userId, hashRecovery(input));
          if (Number(used.changes) === 1) via = "recovery";
        }
      }
      if (via) {
        db.prepare("DELETE FROM sign_in_throttle WHERE email = ?").run(key);
        if (via === "recovery")
          deps.audit({
            actorId: userId,
            action: "mfa.recovery_used",
            targetType: "user",
            targetId: userId,
            detail: { left: this.recoveryLeft(userId) },
          });
        return { ok: true, via };
      }
      const failures = (throttle?.failures ?? 0) + 1;
      const lock = failures % MFA.failures === 0 ? now + MFA.delayMs : 0;
      db.prepare(
        `INSERT INTO sign_in_throttle (email, failures, locked_until) VALUES (?, ?, ?)
         ON CONFLICT (email) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until`,
      ).run(key, failures, lock);
      if (failures === 1 || lock > 0)
        deps.audit({
          actorId: userId,
          action: "mfa.failed",
          targetType: "user",
          targetId: userId,
          detail: { failures, locked: lock > 0 },
        });
      return { ok: false, code: "mfa_invalid" };
    },

    recoveryLeft(userId: string): number {
      return Number(
        (
          db
            .prepare("SELECT COUNT(*) AS n FROM mfa_recovery WHERE user_id = ? AND used_at IS NULL")
            .get(userId) as { n: number }
        ).n,
      );
    },

    /** Turns the second step off (the person with a code, or the server owner who resets it). */
    remove(userId: string): void {
      db.prepare("DELETE FROM account_mfa WHERE user_id = ?").run(userId);
      db.prepare("DELETE FROM mfa_recovery WHERE user_id = ?").run(userId);
      db.prepare("DELETE FROM sign_in_throttle WHERE email = ?").run(throttleKey(userId));
    },
  };
}

export type Mfa = ReturnType<typeof createMfa>;
