import { describe, expect, it } from "vitest";
import {
  CALENDAR_WRITE_SCOPES,
  calendarEventInputSchema,
  calendarScopesFor,
  hasScope,
} from "./calendar";
import { DEFAULT_NOTETAKER, notetakerSettingsSchema } from "./meetings";

const READ = ["https://www.googleapis.com/auth/calendar.readonly", "openid", "email"];

describe("calendar write scopes (NT-28)", () => {
  it("asks for the read scopes only while the calendar is read only", () => {
    expect(calendarScopesFor("googleCalendar", READ, true)).toEqual(READ);
  });

  it("adds the write scope once, only when read only is off", () => {
    const scopes = calendarScopesFor("googleCalendar", READ, false);
    expect(scopes).toEqual([...READ, CALENDAR_WRITE_SCOPES.googleCalendar]);
    expect(calendarScopesFor("googleCalendar", scopes, false)).toEqual(scopes);
    expect(calendarScopesFor("outlookCalendar", ["Calendars.Read"], false)).toEqual([
      "Calendars.Read",
      "Calendars.ReadWrite",
    ]);
  });

  it("knows no write scope for a connector that is not a calendar", () => {
    expect(calendarScopesFor("gmail", ["openid"], false)).toEqual(["openid"]);
  });

  it("finds a scope however it is written", () => {
    expect(
      hasScope(["https://graph.microsoft.com/Calendars.ReadWrite"], "Calendars.ReadWrite"),
    ).toBe(true);
    expect(hasScope(["calendars.readwrite"], "Calendars.ReadWrite")).toBe(true);
    expect(hasScope(["Calendars.Read"], "Calendars.ReadWrite")).toBe(false);
  });
});

describe("calendar event input", () => {
  const input = {
    source: { kind: "task", id: "t1" },
    accountId: "c1",
    title: "Review",
    startMs: 1_800_000_000_000,
    durationMinutes: 30,
    attendees: ["dana@example.com"],
    description: "",
    sendInvites: false,
  };

  it("accepts a normal event and refuses what is outside the limits or extra", () => {
    expect(calendarEventInputSchema.safeParse(input).success).toBe(true);
    for (const bad of [
      { ...input, durationMinutes: 4 },
      { ...input, durationMinutes: 1441 },
      { ...input, title: " " },
      { ...input, attendees: Array.from({ length: 21 }, () => "a@example.com") },
      { ...input, source: { kind: "thread", id: "x" } },
      { ...input, notify: true },
    ])
      expect(calendarEventInputSchema.safeParse(bad).success).toBe(false);
  });
});

describe("notetaker automation settings", () => {
  it("default to 30 minutes with invitations off, and an older profile still loads", () => {
    expect(DEFAULT_NOTETAKER.automations).toEqual({
      createEvent: { defaultDuration: 30, sendInvites: false },
    });
    const older: Partial<typeof DEFAULT_NOTETAKER> = { ...DEFAULT_NOTETAKER };
    delete older.automations;
    expect(notetakerSettingsSchema.parse(older).automations).toEqual(DEFAULT_NOTETAKER.automations);
  });
});
