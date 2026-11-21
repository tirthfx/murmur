import { describe, expect, it, vi } from "vitest";
import type {
  CaptureChunk,
  CaptureError,
  CaptureStartInput,
  CaptureStartResult,
  RecordingState,
} from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createTestLogger } from "../helper/fakes";
import { createMeetingRecorder } from "./meeting-recorder";
import { createMeetingsStore } from "./meetings-store";

function setup(
  options: { captureSystem?: boolean; startResult?: Partial<CaptureStartResult> } = {},
) {
  let clock = 1_000_000;
  let chunkHandler: (chunk: CaptureChunk) => void = () => {};
  let errorHandler: (error: CaptureError) => void = () => {};
  const helper = {
    startMeetingCapture: vi.fn(async (input: CaptureStartInput): Promise<CaptureStartResult> => ({
      startedAt: clock,
      channels: Object.fromEntries((input.channels ?? []).map((name) => [name, "Device"])),
      sampleRate: 16000,
      warnings: [],
      ...options.startResult,
    })),
    stopMeetingCapture: vi.fn(async () => ({ durationMs: 0, channels: {} })),
    onCaptureChunk: (handler: (chunk: CaptureChunk) => void) => {
      chunkHandler = handler;
      return () => {};
    },
    onCaptureError: (handler: (error: CaptureError) => void) => {
      errorHandler = handler;
      return () => {};
    },
  };
  const store = createMeetingsStore(openDatabase(":memory:"));
  const states: RecordingState[] = [];
  const finished: string[] = [];
  const removed: string[] = [];
  const recorder = createMeetingRecorder({
    helper,
    store,
    meetingsDir: "/profile/meetings",
    now: () => clock,
    newId: () => "mtg-1",
    options: () => ({
      captureSystem: options.captureSystem ?? true,
      chunkSeconds: 30,
      micDeviceId: null,
    }),
    onState: (state) => states.push(state),
    onFinished: (meeting) => finished.push(meeting.id),
    removePartials: (folder) => removed.push(folder),
    logger: createTestLogger(),
  });
  const chunk = (channel: "mic" | "system", seq: number, durationMs = 30_000): void =>
    chunkHandler({
      meetingId: "mtg-1",
      channel,
      seq,
      path: `/profile/meetings/mtg-1/${channel}-${seq}.m4a`,
      sha256: "a".repeat(64),
      bytes: 100,
      startMs: (seq - 1) * 30_000,
      durationMs,
    });
  return {
    recorder,
    store,
    helper,
    states,
    finished,
    removed,
    chunk,
    error: (error: CaptureError) => errorHandler(error),
    advance: (ms: number) => (clock += ms),
  };
}

describe("meeting recorder", () => {
  it("records both channels into the meeting folder and stores each chunk", async () => {
    const t = setup();
    const result = await t.recorder.start();
    expect(result).toEqual({ ok: true, meetingId: "mtg-1" });
    expect(t.helper.startMeetingCapture).toHaveBeenCalledWith({
      meetingId: "mtg-1",
      folder: "/profile/meetings/mtg-1",
      channels: ["mic", "system"],
      chunkSeconds: 30,
      micDeviceId: null,
    });
    expect(t.recorder.state()).toMatchObject({ status: "recording", channels: ["mic", "system"] });
    expect(t.store.get("mtg-1")).toMatchObject({ status: "recording", source: "ad_hoc" });
    expect(t.store.get("mtg-1")!.title).toMatch(/^Meeting, /);
    t.chunk("mic", 1);
    t.chunk("system", 1);
    t.advance(45_000);
    t.chunk("mic", 2, 15_000);
    t.chunk("system", 2, 14_900);
    const meeting = await t.recorder.stop();
    expect(t.helper.stopMeetingCapture).toHaveBeenCalledWith("mtg-1");
    expect(meeting).toMatchObject({ status: "queued", durationMs: 45_000 });
    expect(t.store.chunks("mtg-1")).toHaveLength(4);
    expect(t.finished).toEqual(["mtg-1"]);
    expect(t.states.map((state) => state.status)).toEqual([
      "starting",
      "recording",
      "stopping",
      "idle",
    ]);
  });

  it("records the microphone only when system sound is off", async () => {
    const t = setup({ captureSystem: false });
    await t.recorder.start();
    expect(t.helper.startMeetingCapture.mock.calls[0]![0].channels).toEqual(["mic"]);
  });

  it("keeps the warnings the helper reports", async () => {
    const t = setup({ startResult: { channels: { mic: "Mic" }, warnings: ["system_permission"] } });
    await t.recorder.start();
    expect(t.recorder.state()).toMatchObject({
      channels: ["mic"],
      warnings: ["system_permission"],
    });
    t.error({ meetingId: "mtg-1", channel: "mic", code: "device_lost" });
    expect(t.recorder.state()).toMatchObject({ warnings: ["system_permission", "device_lost"] });
    expect(t.store.get("mtg-1")!.warnings).toEqual(["system_permission", "device_lost"]);
  });

  it("removes the meeting when capture cannot start", async () => {
    const t = setup();
    t.helper.startMeetingCapture.mockRejectedValueOnce(
      Object.assign(new Error("no"), { code: "PERMISSION_DENIED" }),
    );
    const result = await t.recorder.start();
    expect(result).toEqual({ ok: false, message: expect.stringContaining("microphone access") });
    expect(t.store.list()).toEqual([]);
    expect(t.recorder.state()).toEqual({ status: "idle" });
  });

  it("refuses a second recording", async () => {
    const t = setup();
    await t.recorder.start();
    expect((await t.recorder.start()).ok).toBe(false);
  });

  it("drops a meeting that saved no audio", async () => {
    const t = setup();
    await t.recorder.start();
    expect(await t.recorder.stop()).toBeNull();
    expect(t.store.list()).toEqual([]);
  });

  it("ends the meeting with what was saved when the helper goes away", async () => {
    const t = setup();
    await t.recorder.start();
    t.chunk("mic", 1);
    t.recorder.helperDown();
    expect(t.store.get("mtg-1")).toMatchObject({ status: "queued", warnings: ["interrupted"] });
    expect(t.recorder.state()).toEqual({ status: "idle" });
  });

  it("recovers a meeting a crash left recording, from its chunks", async () => {
    const t = setup();
    await t.recorder.start();
    t.chunk("mic", 1);
    t.chunk("mic", 2, 10_000);
    // A new run of the app: a fresh recorder over the same database.
    expect(t.recorder.recover()).toBe(1);
    expect(t.removed).toEqual(["/profile/meetings/mtg-1"]);
    expect(t.store.get("mtg-1")).toMatchObject({
      status: "queued",
      durationMs: 40_000,
      warnings: ["interrupted"],
    });
  });
});
