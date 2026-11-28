import {
  CALENDAR_CONNECTOR_IDS,
  CONNECTOR_CATALOGUE,
  calendarScopesFor,
  connectorChoice,
  gmailScopesFor,
  SLACK_ID,
  SLACK_SCOPE_PRIVATE,
  SLACK_SCOPES,
  SLACK_SCOPE_WRITE,
  type ConnectorSettings,
} from "@murmur/shared";

/**
 * What a sign-in asks for. Most providers ask for their usual scopes. Gmail asks only for the
 * scopes of the features that are on (CN-04): the read scope when brief context is on and the
 * compose scope when drafting is on. A calendar asks for its write scope only when the owner has
 * turned its read-only switch off (NT-28). A feature that is off never gets a permission.
 */
export function connectOptionsFor(
  providerId: string,
  settings: ConnectorSettings,
  loginHint?: string,
  providerScopes: readonly string[] = [],
): { scopes?: string[]; loginHint?: string } {
  let scopes: string[] | null = null;
  if (providerId === "gmail") scopes = gmailScopesFor(settings.gmail);
  else if (providerId === SLACK_ID) {
    // Posting as the owner is asked for only when read only is turned off.
    const entry = CONNECTOR_CATALOGUE.find((candidate) => candidate.id === SLACK_ID);
    scopes = [
      ...SLACK_SCOPES,
      ...(settings.slack.privateChannels ? [SLACK_SCOPE_PRIVATE] : []),
      ...(entry && !connectorChoice(settings, entry).readOnly ? [SLACK_SCOPE_WRITE] : []),
    ];
  } else if ((CALENDAR_CONNECTOR_IDS as readonly string[]).includes(providerId)) {
    const entry = CONNECTOR_CATALOGUE.find((candidate) => candidate.id === providerId);
    if (entry && providerScopes.length > 0)
      scopes = calendarScopesFor(
        providerId,
        providerScopes,
        connectorChoice(settings, entry).readOnly,
      );
  }
  return {
    ...(scopes ? { scopes } : {}),
    ...(loginHint ? { loginHint } : {}),
  };
}
