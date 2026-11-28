import { describe, expect, it } from "vitest";
import {
  CALENDAR_WRITE_SCOPES,
  DEFAULT_CONNECTOR_SETTINGS,
  type CalendarEvent,
  type ConnectorAccount,
} from "@murmur/shared";
import { createEventResponder } from "./event-respond";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "ev 1",
  accountId: "a1",
  connector: "googleCalendar",
  title: "Budget sync",
  startMs: 1,
  endMs: 2,
  allDay: false,
  location: null,
  attendees: [
    { name: "Dana", email: "dana@example.com", self: false, organizer: true, response: "accepted" },
    { name: "Me", email: "me@example.com", self: true, organizer: false, response: "none" },
  ],
  joinUrl: null,
  response: "none",
  isPrivate: false,
  ...over,
});

function setup(
  options: {
    connector?: "googleCalendar" | "outlookCalendar";
    readOnly?: boolean;
    scoped?: boolean;
    fetch?: (url: string, init?: RequestInit) => Response;
  } = {},
) {
  const connector = options.connector ?? "googleCalendar";
  const account = {
    id: "a1",
    connector,
    email: "me@example.com",
    status: "connected",
    scopes: options.scoped === false ? [] : [CALENDAR_WRITE_SCOPES[connector]!],
  } as unknown as ConnectorAccount;
  const calls: { url: string; method: string; body: unknown }[] = [];
  const answered: string[] = [];
  const responder = createEventResponder({
    connectors: {
      list: () => [account],
      authorizedFetch: async (_id, url, init) => {
        calls.push({
          url,
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(init.body as string) : null,
        });
        return options.fetch?.(url, init) ?? json({});
      },
    },
    settings: () => ({
      ...DEFAULT_CONNECTOR_SETTINGS,
      choices: { [connector]: { syncIntervalMinutes: 15, readOnly: options.readOnly ?? false } },
    }),
    onAnswered: (id) => answered.push(id),
  });
  return { responder, calls, answered };
}

describe("answering an invitation (NT-02)", () => {
  it("is offered only for an unaccepted invitation on a calendar that can be written to", () => {
    expect(setup().responder.canRespond(event())).toBe(true);
    expect(setup().responder.canRespond(event({ response: "accepted" }))).toBe(false);
    expect(setup().responder.canRespond(event({ attendees: [] }))).toBe(false);
    expect(setup({ readOnly: true }).responder.canRespond(event())).toBe(false);
    expect(setup({ scoped: false }).responder.canRespond(event())).toBe(false);
  });

  it("changes only the owner's own answer on Google, and the organiser is told", async () => {
    const people = [
      { email: "dana@example.com", responseStatus: "accepted", organizer: true },
      { email: "me@example.com", responseStatus: "needsAction", self: true },
    ];
    const t = setup({ fetch: () => json({ attendees: people }) });
    await expect(t.responder.respond(event(), "tentative")).resolves.toEqual({ ok: true });
    expect(t.calls.map((call) => call.method)).toEqual(["GET", "PATCH"]);
    expect(t.calls[1]!.url).toContain("/events/ev%201?sendUpdates=all");
    expect(t.calls[1]!.body).toEqual({
      attendees: [people[0], { ...people[1], responseStatus: "tentative" }],
    });
    expect(t.answered).toEqual(["a1"]);
  });

  it("says so when Google's event does not list the owner, and writes nothing", async () => {
    const t = setup({ fetch: () => json({ attendees: [] }) });
    await expect(t.responder.respond(event(), "accepted")).resolves.toMatchObject({ ok: false });
    expect(t.calls).toHaveLength(1);
  });

  it("uses Outlook's own answers", async () => {
    const t = setup({
      connector: "outlookCalendar",
      fetch: () => new Response(null, { status: 202 }),
    });
    await expect(
      t.responder.respond(event({ connector: "outlookCalendar" }), "declined"),
    ).resolves.toEqual({ ok: true });
    expect(t.calls[0]).toMatchObject({ method: "POST", body: { sendResponse: true } });
    expect(t.calls[0]!.url).toContain("/me/events/ev%201/decline");
  });

  it("reports a refusal and sends nothing for a calendar that cannot be written to", async () => {
    const refused = setup({ connector: "outlookCalendar", fetch: () => json({}, 403) });
    await expect(refused.responder.respond(event(), "accepted")).resolves.toMatchObject({
      ok: false,
    });
    const readOnly = setup({ readOnly: true });
    await expect(readOnly.responder.respond(event(), "accepted")).resolves.toMatchObject({
      ok: false,
    });
    expect(readOnly.calls).toEqual([]);
  });
});
