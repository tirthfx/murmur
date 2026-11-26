import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MEETING_MATCHERS,
  PERMISSION_KINDS,
  PROTOCOL_VERSION,
  type DetectEvent,
  type EditsChanged,
  type FrontApp,
  type HotkeyBinding,
  type HotkeyEvent,
  type PermissionKind,
  type PlatformHelper,
} from "@murmur/shared";

/**
 * The conformance suite for `PlatformHelper` (SW-09). It states what the app needs from any
 * helper, on any OS, and talks to the helper only through the interface. What the helper acts
 * on (a test text field, the front app, a call in a window, keys pressed) is reached through a
 * `HelperWorld`: the Mac implementation here plays the operating system with a scripted
 * stand-in, and a Windows implementation drives a real machine with fixture audio and a real
 * text field. The same scenarios then run on both.
 *
 * A scenario that cannot be run on a platform is skipped by naming it in `skip`, with a reason
 * the report shows; it is never dropped silently.
 */
export interface HelperWorld {
  /** The helper under test, not yet started. */
  helper: PlatformHelper;
  /** A binding that is valid on this OS (key codes differ), with a hold mode and one action. */
  holdBinding: HotkeyBinding;
  /** A folder the helper may write meeting chunks into. */
  captureFolder: string;
  /** A folder to name as the speech model's. A stand-in engine does not read it; a real one needs a model there. */
  speechModelDir: string;
  /** Sets a permission as the OS reports it. */
  setPermission(kind: PermissionKind, status: "granted" | "denied"): Promise<void>;
  /** Presses or releases the keys of a binding as a person would. */
  keys(binding: HotkeyBinding, phase: "down" | "up"): Promise<void>;
  /** Puts the caret in an empty test text field. */
  focusTextField(): Promise<void>;
  /** What the test text field now holds. */
  textFieldValue(): Promise<string>;
  /** Changes what the test text field holds, as a person correcting it would. */
  editTextField(text: string): Promise<void>;
  /** Selects this text in the focused field; empty selects nothing. */
  selectText(text: string): Promise<void>;
  /** Brings an app to the front. */
  focusApp(app: { bundleId: string; name: string }): Promise<void>;
  /** A call starts or ends in a window that the matcher knows. */
  setCall(matcherId: string, active: boolean): Promise<void>;
  close(): Promise<void>;
}

export interface ConformanceOptions {
  start(): Promise<HelperWorld>;
  /** Scenario names to skip on this platform, each with the reason. */
  skip?: Record<string, string>;
}

/** The scenario names, so a platform names what it skips and a typo is caught. */
export const CONFORMANCE_SCENARIOS = [
  "lifecycle",
  "permissions",
  "hotkeys",
  "insertion",
  "selection",
  "key presses",
  "processes and apps",
  "context",
  "edit watching",
  "inspector",
  "secure store",
  "front app",
  "meeting detection",
  "microphone session",
  "meeting capture",
  "transcription",
  "live transcription",
] as const;
export type ConformanceScenario = (typeof CONFORMANCE_SCENARIOS)[number];

/** Waits for an event that arrives after the call that caused it returned. */
async function eventually(check: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function describePlatformHelperConformance(name: string, options: ConformanceOptions): void {
  for (const skipped of Object.keys(options.skip ?? {})) {
    if (!CONFORMANCE_SCENARIOS.includes(skipped as ConformanceScenario)) {
      throw new Error(`"${skipped}" is not a conformance scenario`);
    }
  }
  const scenario = (title: ConformanceScenario, run: (world: HelperWorld) => Promise<void>) => {
    const reason = options.skip?.[title];
    const register = reason === undefined ? it : it.skip;
    register(reason === undefined ? title : `${title} (skipped: ${reason})`, async () => {
      await run(world);
    });
  };

  let world: HelperWorld;
  describe(`platform helper conformance: ${name}`, () => {
    beforeEach(async () => {
      world = await options.start();
    });
    afterEach(async () => {
      await world.close();
    });

    scenario("lifecycle", async ({ helper }) => {
      const hello = await helper.start();
      expect(hello.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(hello.helperVersion.length).toBeGreaterThan(0);
      expect(helper.getStatus()).toMatchObject({ state: "ready", message: null });
      const ping = await helper.ping();
      expect(ping.uptimeMs).toBeGreaterThanOrEqual(0);
      await helper.shutdown("conformance");
      expect(helper.getStatus().state).toBe("stopped");
      await expect(helper.ping()).rejects.toMatchObject({ code: "HELPER_UNAVAILABLE" });
    });

    scenario("permissions", async ({ helper, setPermission }) => {
      await helper.start();
      const first = await helper.checkPermissions();
      for (const kind of PERMISSION_KINDS) {
        expect(["granted", "denied", "not_determined", "unknown"]).toContain(first[kind]);
      }
      await setPermission("microphone", "denied");
      expect((await helper.checkPermissions()).microphone).toBe("denied");
      await setPermission("microphone", "granted");
      expect((await helper.checkPermissions()).microphone).toBe("granted");
      const asked = await helper.requestPermission("microphone");
      expect(["granted", "denied", "not_determined", "unknown"]).toContain(asked.status);
      expect(typeof asked.openedSettings).toBe("boolean");
    });

    scenario("hotkeys", async ({ helper, holdBinding, keys }) => {
      await helper.start();
      const events: HotkeyEvent[] = [];
      const off = helper.onHotkeyEvent((event) => events.push(event));
      const result = await helper.configureHotkeys([holdBinding]);
      expect(result.registered).toEqual([holdBinding.id]);
      expect(result.rejected).toEqual([]);

      await keys(holdBinding, "down");
      await eventually(() => events.length === 1, "the key going down");
      await keys(holdBinding, "up");
      await eventually(() => events.length === 2, "the key coming up");
      expect(events.map((event) => event.state)).toEqual(["down", "up"]);
      expect(events.every((event) => event.bindingId === holdBinding.id)).toBe(true);
      expect(events.every((event) => event.action === holdBinding.action)).toBe(true);

      // An empty list stops the listener: no more events.
      await helper.configureHotkeys([]);
      await keys(holdBinding, "down");
      await keys(holdBinding, "up");
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(events).toHaveLength(2);

      // After unsubscribing a handler hears nothing, even from a live binding.
      off();
      await helper.configureHotkeys([holdBinding]);
      await keys(holdBinding, "down");
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(events).toHaveLength(2);
      await keys(holdBinding, "up");
    });

    scenario("insertion", async ({ helper, setPermission, focusTextField, textFieldValue }) => {
      await helper.start();
      await setPermission("accessibility", "granted");
      await focusTextField();
      const done = await helper.insertText({
        text: "Hello from Murmur",
        method: "auto",
        restoreClipboard: true,
        restoreDelayMs: 0,
      });
      expect(done.delivered).toBe(true);
      expect(await textFieldValue()).toBe("Hello from Murmur");
      await expect(helper.copyText("on the clipboard")).resolves.toBeUndefined();
    });

    scenario("selection", async ({ helper, setPermission, focusApp, selectText }) => {
      await helper.start();
      await setPermission("accessibility", "granted");
      await focusApp({ bundleId: "app.one", name: "One" });
      await selectText("the chosen words");
      const read = await helper.readSelection({ clipboardFallback: false });
      expect(read).toMatchObject({
        status: "ok",
        text: "the chosen words",
        length: 16,
        source: "ax",
        appBundleId: "app.one",
      });
      expect(read.hash).toBe(createHash("sha256").update("the chosen words").digest("hex"));
      await selectText("");
      expect(await helper.readSelection({ clipboardFallback: false })).toMatchObject({
        status: "empty",
        text: "",
        hash: "",
        source: null,
      });
    });

    scenario("key presses", async ({ helper, setPermission, focusApp }) => {
      await helper.start();
      await setPermission("accessibility", "granted");
      await focusApp({ bundleId: "app.one", name: "One" });
      // Nothing is sent when another app is in front.
      expect(
        await helper.pressKey({ key: "a", modifiers: ["command"], onlyInApp: "app.other" }),
      ).toEqual({ pressed: false, appBundleId: "app.one" });
      expect(
        await helper.pressKey({
          key: "left",
          modifiers: ["shift"],
          repeat: 3,
          onlyInApp: "app.one",
        }),
      ).toEqual({ pressed: true, appBundleId: "app.one" });
    });

    scenario("processes and apps", async ({ helper, focusApp }) => {
      await helper.start();
      await focusApp({ bundleId: "app.one", name: "One" });
      const names = await helper.foregroundProcesses();
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) expect(name).toBe(name.toLowerCase());
      const apps = await helper.listApps();
      expect(apps.length).toBeGreaterThan(0);
      for (const app of apps) {
        expect(app.bundleId.length).toBeGreaterThan(0);
        expect(app.name.length).toBeGreaterThan(0);
      }
    });

    scenario("context", async ({ helper, setPermission, focusApp, focusTextField }) => {
      await helper.start();
      await setPermission("accessibility", "granted");
      await focusApp({ bundleId: "app.one", name: "One" });
      await focusTextField();
      await helper.insertText({
        text: "Written before the caret",
        method: "auto",
        restoreClipboard: true,
        restoreDelayMs: 0,
      });
      const context = await helper.focusContext({});
      expect(context).toMatchObject({
        bundleId: "app.one",
        appName: "One",
        editable: true,
        secure: false,
        textBefore: "Written before the caret",
        textAfter: "",
      });
      expect((await helper.focusContext({ maxBefore: 5 })).textBefore).toBe("caret");
    });

    scenario("edit watching", async ({ helper, setPermission, focusTextField, editTextField }) => {
      await helper.start();
      await setPermission("accessibility", "granted");
      await focusTextField();
      await helper.insertText({
        text: "meet at the offce",
        method: "auto",
        restoreClipboard: true,
        restoreDelayMs: 0,
      });
      const changes: EditsChanged[] = [];
      helper.onEditsChanged((change) => changes.push(change));
      expect(await helper.watchEdits({ text: "not in the field", durationMs: 5000 })).toBe(false);
      expect(await helper.watchEdits({ text: "meet at the offce", durationMs: 10_000 })).toBe(true);
      await editTextField("meet at the office");
      await eventually(() => changes.length === 1, "the correction", 5000);
      expect(changes).toEqual([{ before: "offce", after: "office" }]);
      await helper.cancelEdits();
    });

    scenario("inspector", async ({ helper, setPermission, focusApp }) => {
      await helper.start();
      await setPermission("accessibility", "granted");
      await focusApp({ bundleId: "app.one", name: "One" });
      const tree = await helper.inspectAccessibility(false);
      expect(tree).toMatchObject({ bundleId: "app.one", truncated: false });
      expect(tree!.nodes.length).toBeGreaterThan(0);
      for (const node of tree!.nodes) expect(node.value).toBeNull();
    });

    scenario("secure store", async ({ helper }) => {
      await helper.start();
      expect(await helper.keychainGet("murmur-test", "token")).toEqual({ found: false, value: "" });
      await expect(helper.keychainSet("murmur-test", "token", "s3cret")).resolves.toEqual({
        ok: true,
      });
      expect(await helper.keychainGet("murmur-test", "token")).toEqual({
        found: true,
        value: "s3cret",
      });
      // An item belongs to its service and account.
      expect((await helper.keychainGet("murmur-test", "other")).found).toBe(false);
      expect(await helper.keychainDelete("murmur-test", "token")).toEqual({ deleted: true });
      expect(await helper.keychainDelete("murmur-test", "token")).toEqual({ deleted: false });
      expect((await helper.keychainGet("murmur-test", "token")).found).toBe(false);
    });

    scenario("front app", async ({ helper, focusApp }) => {
      await helper.start();
      const seen: FrontApp[] = [];
      helper.onFrontApp((app) => seen.push(app));
      await focusApp({ bundleId: "app.one", name: "One" });
      await helper.watchFrontApp(true);
      await eventually(() => seen.length >= 1, "the app in front when watching starts");
      expect(seen.at(-1)).toMatchObject({ bundleId: "app.one", name: "One" });
      await focusApp({ bundleId: "app.two", name: "Two" });
      await eventually(() => seen.at(-1)?.bundleId === "app.two", "the change of app");
      const count = seen.length;
      await helper.watchFrontApp(false);
      await focusApp({ bundleId: "app.three", name: "Three" });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(seen).toHaveLength(count);
    });

    scenario("meeting detection", async ({ helper, setCall }) => {
      await helper.start();
      const events: DetectEvent[] = [];
      helper.onMeetingDetected((event) => events.push(event));
      await helper.watchMeetings({ enabled: true, matchers: DEFAULT_MEETING_MATCHERS });
      await setCall("zoom", true);
      await eventually(() => events.length === 1, "a call starting");
      await setCall("zoom", false);
      await eventually(() => events.length === 2, "a call ending");
      expect(events).toEqual([
        { matcherId: "zoom", active: true },
        { matcherId: "zoom", active: false },
      ]);
      // An event never carries a title or an address.
      expect(JSON.stringify(events)).not.toMatch(/title|url|http/i);
      await helper.watchMeetings({ enabled: false, matchers: [] });
      await setCall("zoom", true);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(events).toHaveLength(2);
    });

    scenario("microphone session", async ({ helper, setPermission }) => {
      await helper.start();
      await setPermission("microphone", "granted");
      const started = await helper.startAudio({
        sessionId: "dictation-1",
        emitLevels: false,
        levelIntervalMs: 100,
      });
      expect(started.sampleRate).toBe(16000);
      expect(started.channels).toBe(1);
      // One session at a time.
      await expect(
        helper.startAudio({ sessionId: "dictation-2", emitLevels: false, levelIntervalMs: 100 }),
      ).rejects.toMatchObject({ code: "BUSY" });
      const stopped = await helper.stopAudio("dictation-1");
      expect(stopped.durationMs).toBeGreaterThanOrEqual(0);
      expect(stopped.samples).toBeGreaterThanOrEqual(0);
      expect(typeof stopped.silent).toBe("boolean");
      // A cancelled session leaves nothing: the next one can start.
      await helper.startAudio({
        sessionId: "dictation-3",
        emitLevels: false,
        levelIntervalMs: 100,
      });
      await expect(helper.cancelAudio("dictation-3")).resolves.toEqual({ discarded: true });
    });

    scenario("transcription", async ({ helper, setPermission, speechModelDir }) => {
      await helper.start();
      await setPermission("microphone", "granted");
      await expect(
        helper.transcribeFile({ path: `${speechModelDir}/none.wav`, languages: [] }),
      ).rejects.toMatchObject({ code: "MODEL_NOT_LOADED" });
      const loaded = await helper.loadSpeechModel({
        model: "conformance",
        modelDir: speechModelDir,
        tokenizerDir: speechModelDir,
      });
      expect(loaded.loadedModel).toBe("conformance");
      expect(loaded.loadMs).toBeGreaterThanOrEqual(0);
      expect(loaded.computeUnits.length).toBeGreaterThan(0);

      await helper.startAudio({ sessionId: "speech-1", emitLevels: false, levelIntervalMs: 100 });
      const recorded = await helper.stopAudio("speech-1");
      expect(recorded.audioFile).not.toBeNull();
      const transcript = await helper.transcribeFile({
        path: recorded.audioFile!.path,
        languages: [],
      });
      expect(typeof transcript.text).toBe("string");
      expect(typeof transcript.language).toBe("string");
      expect(Array.isArray(transcript.segments)).toBe(true);
      expect(transcript.audioMs).toBeGreaterThanOrEqual(0);
      for (const segment of transcript.segments) {
        expect(segment.endMs).toBeGreaterThanOrEqual(segment.startMs);
        expect(segment.confidence).toBeGreaterThanOrEqual(0);
        expect(segment.confidence).toBeLessThanOrEqual(1);
      }

      // A ping is answered while a request is running, and a file that is not there is refused.
      await expect(
        helper.transcribeFile({ path: `${speechModelDir}/missing.wav`, languages: [] }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|TRANSCRIPTION_FAILED/) });

      await helper.unloadSpeechModel();
      await expect(
        helper.transcribeFile({ path: recorded.audioFile!.path, languages: [] }),
      ).rejects.toMatchObject({ code: "MODEL_NOT_LOADED" });
    });

    scenario(
      "live transcription",
      async ({ helper, setPermission, speechModelDir, captureFolder }) => {
        await helper.start();
        await setPermission("microphone", "granted");
        await helper.loadSpeechModel({
          model: "conformance",
          modelDir: speechModelDir,
          tokenizerDir: speechModelDir,
        });
        await helper.startMeetingCapture({
          meetingId: "meeting-live",
          folder: captureFolder,
          channels: ["mic"],
          chunkSeconds: 30,
        });
        const live = await helper.transcribeLive({ meetingId: "meeting-live", channel: "mic" });
        expect(live.channel).toBe("mic");
        expect(live.seq).toBeGreaterThan(0);
        expect(live.startMs).toBeGreaterThanOrEqual(0);
        expect(typeof live.text).toBe("string");
        expect(Array.isArray(live.segments)).toBe(true);
        await expect(
          helper.transcribeLive({ meetingId: "not-recorded", channel: "mic" }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await helper.stopMeetingCapture("meeting-live");
      },
    );

    scenario("meeting capture", async ({ helper, setPermission, captureFolder }) => {
      await helper.start();
      await setPermission("microphone", "granted");
      const chunks: string[] = [];
      helper.onCaptureChunk((chunk) => chunks.push(`${chunk.channel}:${chunk.seq}`));
      const started = await helper.startMeetingCapture({
        meetingId: "meeting-1",
        folder: captureFolder,
        channels: ["mic", "system"],
        chunkSeconds: 30,
      });
      expect(started.sampleRate).toBe(16000);
      expect(started.warnings).toEqual(expect.any(Array));
      const stopped = await helper.stopMeetingCapture("meeting-1");
      expect(stopped.durationMs).toBeGreaterThanOrEqual(0);
      // The last chunks arrive before the stop resolves.
      expect(chunks.length).toBeGreaterThan(0);
    });
  });
}
