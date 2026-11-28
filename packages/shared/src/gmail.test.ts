import { describe, expect, it } from "vitest";
import {
  DEFAULT_GMAIL_SETTINGS,
  GMAIL_SCOPE_COMPOSE,
  GMAIL_SCOPE_READ,
  emailDraftInputSchema,
  emailDraftSourceSchema,
  gmailMissingScopes,
  gmailScopesFor,
  gmailSettingsSchema,
  isEmailAddress,
} from "./gmail";
import { connectorSettingsSchema } from "./connectors";

describe("Gmail scopes (CN-04)", () => {
  it("asks for no mail scope while every feature is off", () => {
    expect(gmailScopesFor(DEFAULT_GMAIL_SETTINGS)).toEqual(["openid", "email"]);
  });

  it("adds the read scope for brief context and the compose scope for drafting, each on its own", () => {
    expect(gmailScopesFor({ ...DEFAULT_GMAIL_SETTINGS, briefContext: true })).toEqual([
      "openid",
      "email",
      GMAIL_SCOPE_READ,
    ]);
    expect(gmailScopesFor({ ...DEFAULT_GMAIL_SETTINGS, draftEnabled: true })).toEqual([
      "openid",
      "email",
      GMAIL_SCOPE_COMPOSE,
    ]);
  });

  it("never asks for a scope that sends mail", () => {
    const all = gmailScopesFor({
      ...DEFAULT_GMAIL_SETTINGS,
      briefContext: true,
      draftEnabled: true,
      maxThreadsPerBrief: 5,
    });
    expect(all.join(" ")).not.toMatch(/gmail\.send|mail\.google\.com\/$|gmail\.modify/);
  });

  it("asks to read for a reply thread, contacts or writing style", () => {
    for (const on of ["replyContext", "contactsFromMail", "learnStyle"] as const)
      expect(gmailScopesFor({ ...DEFAULT_GMAIL_SETTINGS, [on]: true })).toContain(GMAIL_SCOPE_READ);
  });

  it("reports what a turned-on feature still lacks", () => {
    const on = { ...DEFAULT_GMAIL_SETTINGS, draftEnabled: true };
    expect(gmailMissingScopes(on, ["openid", "email"])).toEqual([GMAIL_SCOPE_COMPOSE]);
    expect(gmailMissingScopes(on, ["openid", "email", GMAIL_SCOPE_COMPOSE])).toEqual([]);
  });
});

describe("Gmail settings", () => {
  it("are off by default, with five threads per brief", () => {
    expect(DEFAULT_GMAIL_SETTINGS).toEqual({
      briefContext: false,
      draftEnabled: false,
      maxThreadsPerBrief: 5,
      replyContext: false,
      contactsFromMail: false,
      learnStyle: false,
      style: null,
    });
  });

  it("are checked, and profiles saved before they existed still load", () => {
    expect(
      gmailSettingsSchema.safeParse({ ...DEFAULT_GMAIL_SETTINGS, maxThreadsPerBrief: 11 }).success,
    ).toBe(false);
    expect(gmailSettingsSchema.safeParse({ ...DEFAULT_GMAIL_SETTINGS, extra: true }).success).toBe(
      false,
    );
    const old = connectorSettingsSchema.parse({ cacheTtlMinutes: 15, choices: {} });
    expect(old.gmail).toEqual(DEFAULT_GMAIL_SETTINGS);
  });
});

describe("email drafts", () => {
  it("accepts a draft of a task or a meeting and nothing else", () => {
    const input = {
      source: { kind: "task", id: "t1" },
      accountId: "a1",
      to: " dana@example.com ",
      subject: "Hello",
      body: "Text",
    };
    expect(emailDraftInputSchema.parse(input).to).toBe("dana@example.com");
    expect(emailDraftSourceSchema.safeParse({ kind: "thread", id: "x" }).success).toBe(false);
    expect(emailDraftInputSchema.safeParse({ ...input, send: true }).success).toBe(false);
    expect(emailDraftInputSchema.safeParse({ ...input, subject: " " }).success).toBe(false);
    expect(emailDraftInputSchema.safeParse({ ...input, body: "" }).success).toBe(false);
  });

  it("recognises one plain address", () => {
    expect(isEmailAddress("dana@example.com")).toBe(true);
    for (const bad of [
      "dana",
      "dana@example",
      "a@example.com, b@example.com",
      "Dana <a@example.com>",
      "a@example.com\nBcc: b@example.com",
      "",
    ])
      expect(isEmailAddress(bad)).toBe(false);
  });
});
