import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONNECTOR_SETTINGS,
  GMAIL_SCOPE_COMPOSE,
  GMAIL_SCOPE_READ,
  gmailMissingScopes,
} from "@murmur/shared";
import { connectOptionsFor } from "./connect-options";

const settings = (gmail: Partial<(typeof DEFAULT_CONNECTOR_SETTINGS)["gmail"]>) => ({
  ...DEFAULT_CONNECTOR_SETTINGS,
  gmail: { ...DEFAULT_CONNECTOR_SETTINGS.gmail, ...gmail },
});

describe("sign-in options (CN-04)", () => {
  it("asks Gmail for no mail scope while every feature is off", () => {
    expect(connectOptionsFor("gmail", settings({})).scopes).toEqual(["openid", "email"]);
  });

  it("asks for the compose scope only when drafting is on", () => {
    const scopes = connectOptionsFor("gmail", settings({ draftEnabled: true })).scopes;
    expect(scopes).toContain(GMAIL_SCOPE_COMPOSE);
    expect(scopes).not.toContain(GMAIL_SCOPE_READ);
  });

  it("asks for the read scope only when brief context is on", () => {
    const scopes = connectOptionsFor("gmail", settings({ briefContext: true })).scopes;
    expect(scopes).toContain(GMAIL_SCOPE_READ);
    expect(scopes).not.toContain(GMAIL_SCOPE_COMPOSE);
  });

  it("leaves other providers on their usual scopes and passes the login hint on", () => {
    expect(connectOptionsFor("googleCalendar", settings({ draftEnabled: true }))).toEqual({});
    expect(connectOptionsFor("gmail", settings({}), "me@example.com").loginHint).toBe(
      "me@example.com",
    );
  });

  it("finds the permission a turned-on feature still lacks", () => {
    const on = settings({ draftEnabled: true, briefContext: true }).gmail;
    expect(gmailMissingScopes(on, ["openid", "email", GMAIL_SCOPE_READ])).toEqual([
      GMAIL_SCOPE_COMPOSE,
    ]);
    expect(gmailMissingScopes(DEFAULT_CONNECTOR_SETTINGS.gmail, ["openid", "email"])).toEqual([]);
  });
});
