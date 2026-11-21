import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPkce, createState } from "./pkce";

describe("PKCE (CN-01)", () => {
  it("matches the example in RFC 7636", () => {
    // Appendix B: this verifier has the challenge below.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const pkce = createPkce(() => Buffer.from(verifier, "base64url"));
    expect(pkce).toEqual({
      verifier,
      challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      method: "S256",
    });
  });

  it("makes a new URL-safe verifier of 43 characters each time, and its S256 challenge", () => {
    const a = createPkce();
    const b = createPkce();
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).toBe(createHash("sha256").update(a.verifier).digest("base64url"));
  });

  it("makes an unguessable state", () => {
    const state = createState();
    expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(createState()).not.toBe(state);
  });
});
