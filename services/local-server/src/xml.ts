import { X509Certificate } from "node:crypto";

/**
 * A reader for the parts of SAML identity provider metadata that the simulation looks at
 * (TM-18). It checks structure only: that the file names an identity provider, a sign-on address
 * and a signing certificate that can be read and has not run out. It does not follow references,
 * refuses a DOCTYPE, and does not check a signature.
 */
export interface IdpMetadata {
  entityId: string;
  ssoUrl: string;
  certificate: {
    subject: string;
    fingerprint: string;
    /** Milliseconds; when the certificate stops being valid. */
    notAfter: number;
  };
}

const TAG = "(?:[\\w.-]+:)?";
const attr = (attrs: string, name: string): string | null => {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs);
  return match ? (match[2] ?? match[3] ?? "") : null;
};

export function parseIdpMetadata(
  xml: string,
  now: number,
): { ok: true; metadata: IdpMetadata } | { ok: false; message: string } {
  const text = xml.trim();
  if (text === "")
    return { ok: false, message: "Paste or upload the identity provider's metadata." };
  if (text.length > 64 * 1024) return { ok: false, message: "That metadata file is too large." };
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    return { ok: false, message: "The metadata cannot contain a DOCTYPE or entities." };
  if (!text.startsWith("<")) return { ok: false, message: "That is not an XML file." };

  const entity = new RegExp(`<${TAG}EntityDescriptor\\b([^>]*)>`).exec(text);
  if (!entity) return { ok: false, message: "The metadata has no EntityDescriptor." };
  const entityId = attr(entity[1] ?? "", "entityID");
  if (!entityId) return { ok: false, message: "The EntityDescriptor has no entityID." };
  if (!new RegExp(`<${TAG}IDPSSODescriptor\\b`).test(text))
    return {
      ok: false,
      message: "The metadata does not describe an identity provider (no IDPSSODescriptor).",
    };

  let ssoUrl = "";
  for (const match of text.matchAll(new RegExp(`<${TAG}SingleSignOnService\\b([^>]*)>`, "g"))) {
    const location = attr(match[1] ?? "", "Location");
    if (location && /^https?:\/\//i.test(location)) {
      ssoUrl = location;
      break;
    }
  }
  if (ssoUrl === "")
    return { ok: false, message: "The metadata has no sign-on address (SingleSignOnService)." };

  const encoded: string[] = [];
  for (const block of text.matchAll(
    new RegExp(`<${TAG}KeyDescriptor\\b([^>]*)>([\\s\\S]*?)</${TAG}KeyDescriptor>`, "g"),
  )) {
    const use = attr(block[1] ?? "", "use");
    if (use !== null && use !== "signing") continue;
    const cert = new RegExp(`<${TAG}X509Certificate>([\\s\\S]*?)</${TAG}X509Certificate>`).exec(
      block[2] ?? "",
    );
    if (cert?.[1]) encoded.push(cert[1].replace(/\s+/g, ""));
  }
  if (encoded.length === 0)
    return {
      ok: false,
      message: "The metadata has no signing certificate. Without one, no sign-in could be checked.",
    };

  let last = "The signing certificate cannot be read.";
  for (const der of encoded) {
    try {
      const certificate = new X509Certificate(Buffer.from(der, "base64"));
      const notAfter = Date.parse(certificate.validTo);
      if (Number.isNaN(notAfter) || notAfter <= now) {
        last = "The signing certificate has expired.";
        continue;
      }
      return {
        ok: true,
        metadata: {
          entityId,
          ssoUrl,
          certificate: {
            subject: certificate.subject.replace(/\n/g, ", "),
            fingerprint: certificate.fingerprint256,
            notAfter,
          },
        },
      };
    } catch {
      last = "The signing certificate cannot be read.";
    }
  }
  return { ok: false, message: last };
}
