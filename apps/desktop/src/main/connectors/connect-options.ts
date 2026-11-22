import { gmailScopesFor, type ConnectorSettings } from "@murmur/shared";

/**
 * What a sign-in asks for. Most providers ask for their usual scopes. Gmail asks only for the
 * scopes of the features that are on (CN-04): the read scope when brief context is on and the
 * compose scope when drafting is on, so a feature that is off never gets a permission.
 */
export function connectOptionsFor(
  providerId: string,
  settings: ConnectorSettings,
  loginHint?: string,
): { scopes?: string[]; loginHint?: string } {
  return {
    ...(providerId === "gmail" ? { scopes: gmailScopesFor(settings.gmail) } : {}),
    ...(loginHint ? { loginHint } : {}),
  };
}
