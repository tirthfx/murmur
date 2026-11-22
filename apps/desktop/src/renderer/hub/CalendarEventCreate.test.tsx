// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEventProposal, CalendarEventRecord } from "@murmur/shared";
import { CalendarEventCreate, parseStart } from "./CalendarEventCreate";
import { createMockApi } from "./test-api";

const start = new Date(2026, 10, 27, 9, 0).getTime();

const proposal: CalendarEventProposal = {
  title: "Review the budget",
  startMs: start,
  durationMinutes: 30,
  candidates: [{ name: "Dana Lee", email: "dana@example.com" }],
  description: "Bring the numbers.",
  accountId: "c1",
  accountEmail: "me@example.com",
  connector: "googleCalendar",
  invitesAllowed: false,
};

const record: CalendarEventRecord = {
  id: "auto-1",
  sourceKind: "task",
  sourceId: "t1",
  title: "Review the budget",
  startMs: start,
  eventId: "ev1",
  openUrl: "https://www.google.com/calendar/event?eid=abc",
  createdAt: 1,
};

let api: ReturnType<typeof createMockApi>;
const source = { kind: "task" as const, id: "t1" };

beforeEach(() => {
  api = createMockApi();
  api.calendarEventState = vi.fn().mockResolvedValue({ available: true, reason: null });
  api.calendarEventPropose = vi.fn().mockResolvedValue({ ok: true, proposal });
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

describe("parseStart", () => {
  it("reads a real date and time and nothing else", () => {
    expect(parseStart("2026-11-27", "09:00")).toBe(start);
    expect(parseStart(" 2026-11-27 ", "9:05")).toBe(new Date(2026, 10, 27, 9, 5).getTime());
    for (const [day, time] of [
      ["2026-02-31", "09:00"],
      ["2026-11-27", "25:00"],
      ["2026-11-27", "09:61"],
      ["27/11/2026", "09:00"],
      ["2026-11-27", ""],
    ] as const)
      expect(parseStart(day, time)).toBeNull();
  });
});

describe("Create event (NT-28)", () => {
  it("is switched off with the reason next to it", async () => {
    api.calendarEventState = vi.fn().mockResolvedValue({
      available: false,
      reason:
        "Your calendars are set to read only. Turn that off on the Connectors page to create events.",
    });
    render(<CalendarEventCreate source={source} />);
    expect(await screen.findByText(/set to read only/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Create event" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(api.calendarEventPropose).not.toHaveBeenCalled();
  });

  it("shows the form first, and creates the event only on the click, with the owner's edits", async () => {
    api.calendarEventCreate = vi.fn().mockResolvedValue({
      ok: true,
      automationId: "auto-1",
      eventId: "ev1",
      openUrl: record.openUrl,
      invited: false,
    });
    render(<CalendarEventCreate source={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create event" }));
    expect(await screen.findByDisplayValue("Review the budget")).toBeTruthy();
    expect(screen.getByDisplayValue("2026-11-27")).toBeTruthy();
    expect(screen.getByDisplayValue("09:00")).toBeTruthy();
    expect(api.calendarEventCreate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "14:30" } });
    fireEvent.click(screen.getByRole("switch", { name: /Add Dana Lee/ }));
    expect(await screen.findByText(/Nobody is told: invitations are off in Settings/)).toBeTruthy();
    api.calendarEventList = vi.fn().mockResolvedValue([record]);
    fireEvent.click(screen.getByRole("button", { name: "Create the event" }));

    await waitFor(() => expect(api.calendarEventCreate).toHaveBeenCalledTimes(1));
    expect(api.calendarEventCreate).toHaveBeenCalledWith({
      source,
      accountId: "c1",
      title: "Review the budget",
      startMs: new Date(2026, 10, 27, 14, 30).getTime(),
      durationMinutes: 30,
      attendees: ["dana@example.com"],
      description: "Bring the numbers.",
      // Invitations are off in Settings, so the box is not even offered.
      sendInvites: false,
    });
    expect(
      await screen.findByText(/Event “Review the budget” on .* is in your calendar/),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Open “Review the budget” in your calendar" }),
    );
    expect(api.calendarEventOpen).toHaveBeenCalledWith(record.openUrl);
  });

  it("offers to send invitations only when they are allowed, and only once someone is added", async () => {
    api.calendarEventPropose = vi
      .fn()
      .mockResolvedValue({ ok: true, proposal: { ...proposal, invitesAllowed: true } });
    api.calendarEventCreate = vi.fn().mockResolvedValue({
      ok: true,
      automationId: "a",
      eventId: "e",
      openUrl: "https://www.google.com/calendar",
      invited: true,
    });
    render(<CalendarEventCreate source={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create event" }));
    await screen.findByDisplayValue("Review the budget");
    expect(screen.queryByRole("switch", { name: /Send invitations/ })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: /Add Dana Lee/ }));
    const send = await screen.findByRole("switch", {
      name: /Send invitations to the people added/,
    });
    expect((send as HTMLInputElement).checked).toBe(false);
    fireEvent.click(send);
    fireEvent.click(screen.getByRole("button", { name: "Create the event" }));
    await waitFor(() => expect(api.calendarEventCreate).toHaveBeenCalled());
    expect(vi.mocked(api.calendarEventCreate).mock.calls[0]![0]).toMatchObject({
      sendInvites: true,
    });
  });

  it("does not create anything on Cancel, and asks for a real date and time", async () => {
    render(<CalendarEventCreate source={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create event" }));
    await screen.findByDisplayValue("Review the budget");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "tomorrow" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the event" }));
    expect(await screen.findByText(/Write the date as YYYY-MM-DD/)).toBeTruthy();
    expect(api.calendarEventCreate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Do not create an event" }));
    expect(screen.queryByDisplayValue("Review the budget")).toBeNull();
    expect(api.calendarEventCreate).not.toHaveBeenCalled();
  });

  it("shows why an event could not be proposed or created, and keeps the form", async () => {
    api.calendarEventPropose = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "That task is gone." });
    render(<CalendarEventCreate source={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create event" }));
    expect(await screen.findByText("That task is gone.")).toBeTruthy();
    cleanup();

    api.calendarEventPropose = vi.fn().mockResolvedValue({ ok: true, proposal });
    api.calendarEventCreate = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "Google Calendar answered 500." });
    render(<CalendarEventCreate source={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create event" }));
    await screen.findByDisplayValue("Review the budget");
    fireEvent.click(screen.getByRole("button", { name: "Create the event" }));
    expect(await screen.findByText("Google Calendar answered 500.")).toBeTruthy();
    expect(screen.getByDisplayValue("Review the budget")).toBeTruthy();
  });

  it("lists events made before, with a way to open them", async () => {
    api.calendarEventList = vi.fn().mockResolvedValue([record]);
    render(<CalendarEventCreate source={source} label="Create a follow-up event" />);
    expect(await screen.findByText(/Event “Review the budget” on/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create a follow-up event" })).toBeTruthy();
  });
});
