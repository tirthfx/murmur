import { createHash, randomBytes } from "node:crypto";

/** Base64 without padding, with `-` and `_`, as PKCE and URLs need. */
const base64url = (bytes: Buffer) => bytes.toString("base64url");

export interface Pkce {
  /** Kept in memory until the code is exchanged. 43 characters. */
  verifier: string;
  /** SHA-256 of the verifier, sent with the sign-in request (method S256). */
  challenge: string;
  method: "S256";
}

/** PKCE (RFC 7636): a fresh random verifier and its S256 challenge. */
export function createPkce(random: (size: number) => Buffer = randomBytes): Pkce {
  const verifier = base64url(random(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge, method: "S256" };
}

/** A random value that ties the answer to the request, checked when the browser comes back. */
export function createState(random: (size: number) => Buffer = randomBytes): string {
  return base64url(random(24));
}
