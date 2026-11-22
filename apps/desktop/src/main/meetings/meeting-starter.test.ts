import { describe, expect, it, vi } from "vitest";
import type { NotetakerSettings, RecordingState } from "@murmur/shared";
import { CANCELLED_MESSAGE, createMeetingStarter } from "./meeting-starter";

const silent = { info() {}, warn() {}, error() {} };

function setup(consent: NotetakerSettings["consent"], answer = true, refuse?: () => string | null) {
  let state: RecordingState = { status: "idle" };
  let current = { ...consent };
  const order: string[] = [];
  const recorder = {
    state: () => state,
    start: vi.fn(async () => {
      order.push("capture");
      state = {
        status: "recording",
        meetingId: "m-1",
        title: "Meeting",
        startedAt: 0,
        channels: ["mic"],
        warnings: [],
      };
      return { ok: true as const, meetingId: "m-1" };
    }),
    stop: vi.fn(async () => {
      order.push("stop");
      state = { status: "idle" };
      return null;
    }),
  };
  const store = { acknowledgeConsent: vi.fn() };
  const confirmNotice = vi.fn(async () => {
    order.push("notice");
    return answer;
  });
  const starter = createMeetingStarter({
    recorder,
    store,
    consent: () => current,
    markNoticeSeen: () => {
      current = { ...current, seen: true };
    },
    confirmNotice,
    now: () => 99,
    ...(refuse ? { refuse } : {}),
    logger: silent,
  });
  return { starter, recorder, store, confirmNotice, order, consent: () => current };
}

describe("meeting starter", () => {
  it("with the notice off, the hotkey starts capture at once, and the next press stops it", async () => {
    const t = setup({ notice: "off", seen: false });
    expect(await t.starter.toggle()).toEqual({ ok: true, action: "started", meetingId: "m-1" });
    expect(t.confirmNotice).not.toHaveBeenCalled();
    expect(t.recorder.start).toHaveBeenCalledWith({ source: "ad_hoc" });
    expect(await t.starter.toggle()).toEqual({ ok: true, action: "stopped" });
    expect(t.order).toEqual(["capture", "stop"]);
  });

  it("with always, no capture starts before OK, and each recording asks again", async () => {
    const t = setup({ notice: "always", seen: true });
    await t.starter.start();
    expect(t.order).toEqual(["notice", "capture"]);
    expect(t.store.acknowledgeConsent).toHaveBeenCalledWith("m-1", 99);
    await t.starter.toggle();
    await t.starter.start();
    expect(t.confirmNotice).toHaveBeenCalledTimes(2);
  });

  it("with always, declining the notice starts nothing", async () => {
    const t = setup({ notice: "always", seen: false }, false);
    expect(await t.starter.start()).toEqual({ ok: false, message: CANCELLED_MESSAGE });
    expect(t.recorder.start).not.toHaveBeenCalled();
    expect(t.store.acknowledgeConsent).not.toHaveBeenCalled();
    expect(t.consent().seen).toBe(false);
  });

  it("with first, only the first recording shows the notice", async () => {
    const t = setup({ notice: "first", seen: false });
    await t.starter.toggle();
    await t.starter.toggle();
    await t.starter.toggle();
    expect(t.confirmNotice).toHaveBeenCalledTimes(1);
    expect(t.consent().seen).toBe(true);
    expect(t.store.acknowledgeConsent).toHaveBeenCalledTimes(1);
  });

  it("stopping never shows the notice, and a second start while it is open is refused", async () => {
    let release: (ok: boolean) => void = () => {};
    const t = setup({ notice: "always", seen: false });
    t.confirmNotice.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (release = resolve)),
    );
    const first = t.starter.toggle();
    const second = await t.starter.toggle();
    expect(second.ok).toBe(false);
    release(true);
    expect((await first).ok).toBe(true);
    expect(t.confirmNotice).toHaveBeenCalledTimes(1);
  });

  it("started from a calendar event, the recording takes its title, id, people and folder", async () => {
    const t = setup({ notice: "off", seen: false });
    const attendees = [{ name: "Dana", email: "dana@example.com" }];
    expect(
      await t.starter.start("recorded", {
        eventId: "evt-1",
        title: "Design sync",
        attendees,
        folderId: "f1",
      }),
    ).toEqual({ ok: true, meetingId: "m-1" });
    expect(t.recorder.start).toHaveBeenCalledWith({
      source: "calendar",
      title: "Design sync",
      calendar: { eventId: "evt-1", attendees, folderId: "f1" },
    });
  });

  it("still shows the recording notice before an event's recording starts", async () => {
    const t = setup({ notice: "always", seen: true });
    await t.starter.start("ad_hoc", { eventId: "e", title: "T", attendees: [] });
    expect(t.order).toEqual(["notice", "capture"]);
  });
});

describe("a refused start (TM-14, TM-25)", () => {
  it("sends no capture.start and shows no notice, from the hotkey or any other start", async () => {
    const t = setup({ notice: "always", seen: false }, true, () => "Notetaker is off.");
    expect(await t.starter.toggle()).toEqual({ ok: false, message: "Notetaker is off." });
    expect(await t.starter.start("calendar", { eventId: "e", title: "t", attendees: [] })).toEqual({
      ok: false,
      message: "Notetaker is off.",
    });
    expect(t.recorder.start).not.toHaveBeenCalled();
    expect(t.confirmNotice).not.toHaveBeenCalled();
  });

  it("is asked again each time, so a change applies at once", async () => {
    let refusal: string | null = "Free is used up.";
    const t = setup({ notice: "off", seen: false }, true, () => refusal);
    expect((await t.starter.toggle()).ok).toBe(false);
    refusal = null;
    expect((await t.starter.toggle()).ok).toBe(true);
  });

  it("never stops a recording from being stopped", async () => {
    let refusal: string | null = null;
    const t = setup({ notice: "off", seen: false }, true, () => refusal);
    await t.starter.toggle();
    refusal = "Notetaker is off.";
    expect(await t.starter.toggle()).toEqual({ ok: true, action: "stopped" });
  });
});
