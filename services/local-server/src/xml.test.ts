import { describe, expect, it } from "vitest";
import { DEV_IDP_CERTIFICATE } from "./dev-idp-cert.ts";
import { parseIdpMetadata } from "./xml.ts";

const NOW = Date.parse("2026-11-22T00:00:00Z");

const metadata = (
  parts: { entity?: string; sso?: string; keys?: string; descriptor?: boolean } = {},
) => `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" ${parts.entity ?? 'entityID="https://idp.example.com/meta"'}>
  ${parts.descriptor === false ? "" : '<md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">'}
    ${parts.keys ?? `<md:KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="x"><ds:X509Data><ds:X509Certificate>${DEV_IDP_CERTIFICATE}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>`}
    ${parts.sso ?? '<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso"/>'}
  ${parts.descriptor === false ? "" : "</md:IDPSSODescriptor>"}
</md:EntityDescriptor>`;

const message = (xml: string, now = NOW) => {
  const result = parseIdpMetadata(xml, now);
  return result.ok ? "ok" : result.message;
};

describe("identity provider metadata", () => {
  it("is read: the entity, the sign-on address and the signing certificate", () => {
    const result = parseIdpMetadata(metadata(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metadata.entityId).toBe("https://idp.example.com/meta");
    expect(result.metadata.ssoUrl).toBe("https://idp.example.com/sso");
    expect(result.metadata.certificate.subject).toBe("CN=Murmur Test IdP (simulation only)");
    expect(result.metadata.certificate.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(result.metadata.certificate.notAfter).toBeGreaterThan(NOW);
  });

  it("is read without namespace prefixes and with a certificate split over lines", () => {
    const wrapped = DEV_IDP_CERTIFICATE.replace(/(.{64})/g, "$1\n");
    const xml = `<EntityDescriptor entityID='e'><IDPSSODescriptor><KeyDescriptor><KeyInfo><X509Data><X509Certificate>
      ${wrapped}
    </X509Certificate></X509Data></KeyInfo></KeyDescriptor><SingleSignOnService Location="http://idp.local/sso"/></IDPSSODescriptor></EntityDescriptor>`;
    expect(message(xml)).toBe("ok");
  });

  it("is refused when it has no signing certificate, with a clear message", () => {
    expect(message(metadata({ keys: "" }))).toBe(
      "The metadata has no signing certificate. Without one, no sign-in could be checked.",
    );
    // A certificate for encryption only is not a signing certificate.
    const encryptionOnly = `<md:KeyDescriptor use="encryption"><ds:KeyInfo xmlns:ds="x"><ds:X509Data><ds:X509Certificate>${DEV_IDP_CERTIFICATE}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>`;
    expect(message(metadata({ keys: encryptionOnly }))).toContain("no signing certificate");
  });

  it("is refused when the certificate cannot be read or has expired", () => {
    const bad = `<md:KeyDescriptor use="signing"><ds:X509Data xmlns:ds="x"><ds:X509Certificate>bm90IGEgY2VydA==</ds:X509Certificate></ds:X509Data></md:KeyDescriptor>`;
    expect(message(metadata({ keys: bad }))).toBe("The signing certificate cannot be read.");
    expect(message(metadata(), Date.parse("2200-01-01T00:00:00Z"))).toBe(
      "The signing certificate has expired.",
    );
  });

  it("is refused when it is not the right kind of file", () => {
    expect(message("")).toContain("Paste or upload");
    expect(message("not xml")).toBe("That is not an XML file.");
    expect(message("<root/>")).toBe("The metadata has no EntityDescriptor.");
    expect(message(metadata({ entity: "" }))).toBe("The EntityDescriptor has no entityID.");
    expect(message(metadata({ descriptor: false }))).toContain("no IDPSSODescriptor");
    expect(message(metadata({ sso: "" }))).toContain("no sign-on address");
    expect(
      message(metadata({ sso: '<md:SingleSignOnService Location="ftp://idp/sso"/>' })),
    ).toContain("no sign-on address");
    expect(message(`<!DOCTYPE x [<!ENTITY a "b">]>${metadata()}`)).toBe(
      "The metadata cannot contain a DOCTYPE or entities.",
    );
    expect(message(metadata() + "x".repeat(70_000))).toBe("That metadata file is too large.");
  });
});
