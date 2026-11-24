import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * SW-13: a packaged helper is checked by hash before it is launched. The build writes
 * `<helper>.sha256` beside the binary (the hash, as hex, optionally followed by the file's
 * name). A binary that does not match its manifest is not started. A build that has no manifest
 * (a development build) is not checked, because there is nothing to compare it with.
 */
export type IntegrityResult = { ok: true; checked: boolean } | { ok: false; message: string };

export interface IntegrityDeps {
  /** The file's bytes, or null when it does not exist. */
  read?: (file: string) => Uint8Array | null;
}

function readOrNull(file: string): Uint8Array | null {
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The hash a manifest holds, or null when it is not a hash. */
export function parseManifest(text: string): string | null {
  const first = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return /^[0-9a-f]{64}$/.test(first) ? first : null;
}

export function checkHelperBinary(binaryPath: string, deps: IntegrityDeps = {}): IntegrityResult {
  const read = deps.read ?? readOrNull;
  const manifest = read(`${binaryPath}.sha256`);
  if (manifest === null) return { ok: true, checked: false };
  const expected = parseManifest(new TextDecoder().decode(manifest));
  if (expected === null) {
    return { ok: false, message: "The helper's hash file is not a SHA-256 hash." };
  }
  const bytes = read(binaryPath);
  if (bytes === null) return { ok: true, checked: false };
  if (sha256Hex(bytes) !== expected) {
    return {
      ok: false,
      message: "The helper does not match its hash, so it was not started. Reinstall the app.",
    };
  }
  return { ok: true, checked: true };
}
