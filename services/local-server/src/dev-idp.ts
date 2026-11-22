import { generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { canonicalJson } from "./audit.ts";
import { DEV_IDP_CERTIFICATE } from "./dev-idp-cert.ts";

/**
 * The development identity provider (TM-18), a SIMULATION. It exists only when the server is
 * started with `MURMUR_DEV_IDP=1`. It signs "SAML-like" assertions (JSON, not XML) with a key made
 * when the server starts, so the flow (redirect, assertion, session) can be tried on one machine.
 * It is not SAML and it does not check anything with a real provider.
 */
export const DEV_IDP_ENTITY_ID = "urn:murmur:dev-idp";
export const ASSERTION_FORMAT = "simulated-saml/1";
const LIFETIME_MS = 5 * 60_000;
const SKEW_MS = 60_000;

export interface Assertion {
  id: string;
  issuer: string;
  /** The service provider this is for: Murmur's team entity id. */
  audience: string;
  /** The sign-in the assertion answers. */
  inResponseTo: string;
  email: string;
  name: string;
  notBefore: number;
  notOnOrAfter: number;
}

export interface DevIdp {
  entityId: string;
  /** Metadata with the shape of a real provider's, for "Test connection". */
  metadataXml(ssoUrl: string): string;
  issue(input: { audience: string; inResponseTo: string; email: string; name: string }): string;
  /** Checks an assertion's signature and time window. */
  open(response: string): { ok: true; assertion: Assertion } | { ok: false; message: string };
}

export function createDevIdp(now: () => number, newId: () => string): DevIdp {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key: KeyObject = publicKey;

  return {
    entityId: DEV_IDP_ENTITY_ID,

    metadataXml: (ssoUrl) => `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${DEV_IDP_ENTITY_ID}">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data><ds:X509Certificate>${DEV_IDP_CERTIFICATE}</ds:X509Certificate></ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${ssoUrl}"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>
`,

    issue({ audience, inResponseTo, email, name }) {
      const issuedAt = now();
      const assertion: Assertion = {
        id: newId(),
        issuer: DEV_IDP_ENTITY_ID,
        audience,
        inResponseTo,
        email,
        name,
        notBefore: issuedAt,
        notOnOrAfter: issuedAt + LIFETIME_MS,
      };
      const signature = sign(null, Buffer.from(canonicalJson(assertion)), privateKey).toString(
        "base64",
      );
      return Buffer.from(
        JSON.stringify({ format: ASSERTION_FORMAT, assertion, signature }),
      ).toString("base64url");
    },

    open(response) {
      let parsed: { format?: unknown; assertion?: unknown; signature?: unknown };
      try {
        parsed = JSON.parse(Buffer.from(response, "base64url").toString("utf8")) as typeof parsed;
      } catch {
        return { ok: false, message: "The sign-in response cannot be read." };
      }
      const a = parsed.assertion as Partial<Assertion> | undefined;
      if (
        parsed.format !== ASSERTION_FORMAT ||
        typeof parsed.signature !== "string" ||
        !a ||
        typeof a.id !== "string" ||
        typeof a.issuer !== "string" ||
        typeof a.audience !== "string" ||
        typeof a.inResponseTo !== "string" ||
        typeof a.email !== "string" ||
        typeof a.name !== "string" ||
        typeof a.notBefore !== "number" ||
        typeof a.notOnOrAfter !== "number"
      )
        return { ok: false, message: "The sign-in response is not in the simulation's format." };
      const assertion = a as Assertion;
      const valid = (() => {
        try {
          return verify(
            null,
            Buffer.from(canonicalJson(assertion)),
            key,
            Buffer.from(parsed.signature as string, "base64"),
          );
        } catch {
          return false;
        }
      })();
      if (!valid)
        return { ok: false, message: "The signature on the sign-in response is not valid." };
      const at = now();
      if (at + SKEW_MS < assertion.notBefore || at >= assertion.notOnOrAfter + SKEW_MS)
        return { ok: false, message: "The sign-in response is not valid at this time." };
      return { ok: true, assertion };
    },
  };
}
