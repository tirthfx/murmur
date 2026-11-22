import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONNECTOR_SETTINGS,
  CALENDAR_WRITE_SCOPES,
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

  describe("calendars (NT-28)", () => {
    const READ = ["https://www.googleapis.com/auth/calendar.readonly", "openid", "email"];
    const choices = (readOnly: boolean) => ({
      ...DEFAULT_CONNECTOR_SETTINGS,
      choices: { googleCalendar: { syncIntervalMinutes: 15, readOnly } },
    });

    it("asks for read scopes only while the calendar is read only, which is the default", () => {
      expect(
        connectOptionsFor("googleCalendar", DEFAULT_CONNECTOR_SETTINGS, undefined, READ).scopes,
      ).toEqual(READ);
      expect(connectOptionsFor("googleCalendar", choices(true), undefined, READ).scopes).toEqual(
        READ,
      );
    });

    it("adds the write scope only when read only is turned off", () => {
      const scopes = connectOptionsFor("googleCalendar", choices(false), undefined, READ).scopes;
      expect(scopes).toEqual([...READ, CALENDAR_WRITE_SCOPES.googleCalendar]);
    });

    it("leaves the provider's own scopes when it does not know them", () => {
      expect(connectOptionsFor("googleCalendar", choices(false)).scopes).toBeUndefined();
    });
  });
});
