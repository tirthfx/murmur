import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** TM-01: at least 12 characters, and none of the last five passwords again. */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;
export const PASSWORD_HISTORY = 5;

const COST = { N: 16384, r: 8, p: 1 } as const;
const KEY_BYTES = 64;

/** `scrypt$N$r$p$salt$hash`, with the salt and the hash in base64. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_BYTES, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64"), hash.toString("base64")].join(
    "$",
  );
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  try {
    const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Why a password cannot be used, or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH)
    return `A password needs at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH)
    return `A password can have at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (password.trim() === "") return "A password cannot be only spaces.";
  return null;
}

/** A hash to check against when no account has the address, so the answer takes as long. */
export const DUMMY_HASH = hashPassword("not-a-real-password");
