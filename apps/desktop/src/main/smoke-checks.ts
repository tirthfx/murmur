import type { BarView, Settings, SoundName } from "@murmur/shared";
import type { RecorderEvent } from "./recorder";
import type { TrayAction } from "./tray/tray-menu";

// The extra checks of `npm run smoke -- --full` (see docs/smoke-test.md). They run after the
// main smoke dictation, on the same fixture clip, and cover what the owner would otherwise
// test by hand: the Bar, sounds and output mute, the tray menu and a silent microphone.

export interface CheckResult {
  name: string;
  /** null when the check could not run on this Mac (for example, no mute switch). */
  ok: boolean | null;
  detail: string;
}

export interface SmokeChecksDeps {
  sleep(ms: number): Promise<void>;
  log(message: string): void;
  /** How long to hold the key: the length of the clip plus a margin. */
  holdMs: number;
  focusField(): Promise<void>;
  isFieldFocused(): boolean;
  clearField(): Promise<void>;
  readField(): Promise<string>;
  keyDown(): void;
  keyUp(): void;
  /** Resolves when the recorder has nothing left to do. */
  settled(): Promise<void>;
  barView(): BarView;
  barPosition(): [number, number] | null;
  dragBar(dx: number, dy: number): Promise<void>;
  /** Closes the Bar window and opens it again, as a restart would. */
  reopenBar(): Promise<void>;
  settings(): Settings;
  updateSettings(patch: Partial<Settings>): void;
  outputMuted(): Promise<boolean | null>;
  setOutputMuted(muted: boolean): Promise<void>;
  tray(action: TrayAction): void;
  lastTranscript(): string | null;
  /** Saves everything on the clipboard and returns a function that puts it back. */
  saveClipboard(): Promise<() => Promise<void>>;
  readClipboardText(): Promise<string>;
  /** Makes the helper read a silent clip (true) or the speech clip (false) from now on. */
  useSilentClip(silent: boolean): void;
}

export interface SmokeChecks {
  handleRecorderEvent(event: RecorderEvent): void;
  handleBarView(view: BarView): void;
  handleSound(name: SoundName): void;
  run(): Promise<CheckResult[]>;
}

const POLL_MS = 50;
const START_TIMEOUT_MS = 15_000;
const TEXT_TIMEOUT_MS = 30_000;
/** The helper reports a silent input after about three seconds. */
const SILENT_TIMEOUT_MS = 8_000;

interface Dictation {
  text: string;
  events: string[];
  states: string[];
  sounds: string[];
  /** The output mute read while recording. */
  mutedDuring: boolean | null;
  stillFocused: boolean;
}

/** Whether `wanted` appears in `seen` in this order (other entries may sit between). */
export function inOrder(seen: string[], wanted: string[]): boolean {
  let next = 0;
  for (const item of seen) if (item === wanted[next]) next += 1;
  return next === wanted.length;
}

export function createSmokeChecks(deps: SmokeChecksDeps): SmokeChecks {
  let events: string[] = [];
  let states: string[] = [];
  let sounds: string[] = [];
  let lastMessage: string | null = null;

  async function waitFor(done: () => boolean, timeoutMs: number): Promise<boolean> {
    for (let waited = 0; waited <= timeoutMs; waited += POLL_MS) {
      if (done()) return true;
      await deps.sleep(POLL_MS);
    }
    return done();
  }

  function reset(): void {
    events = [];
    states = [];
    sounds = [];
    lastMessage = null;
  }

  async function readText(timeoutMs: number): Promise<string> {
    let text = "";
    for (let waited = 0; waited <= timeoutMs; waited += POLL_MS) {
      text = await deps.readField();
      if (text.trim() !== "") break;
      await deps.sleep(POLL_MS);
    }
    return text;
  }

  /** One dictation into the cleared test box, started and stopped by the given calls. */
  async function dictate(start: () => void, stop: () => void): Promise<Dictation> {
    reset();
    await deps.clearField();
    await deps.focusField();
    start();
    await waitFor(
      () => events.includes("started") || events.includes("start-failed"),
      START_TIMEOUT_MS,
    );
    let mutedDuring: boolean | null = null;
    if (events.includes("started")) {
      // Muting comes after the start sound; ask once it has had time to happen.
      await deps.sleep(Math.min(1000, deps.holdMs));
      mutedDuring = await deps.outputMuted();
      await deps.sleep(Math.max(0, deps.holdMs - 1000));
    }
    stop();
    const text = events.includes("started") ? await readText(TEXT_TIMEOUT_MS) : "";
    await deps.settled();
    return {
      text,
      events: [...events],
      states: [...states],
      sounds: [...sounds],
      mutedDuring,
      stillFocused: deps.isFieldFocused(),
    };
  }

  const pass = (name: string, detail: string): CheckResult => ({ name, ok: true, detail });
  const fail = (name: string, detail: string): CheckResult => ({ name, ok: false, detail });
  const skip = (name: string, detail: string): CheckResult => ({ name, ok: null, detail });
  const check = (name: string, ok: boolean, good: string, bad: string): CheckResult =>
    ok ? pass(name, good) : fail(name, bad);

  async function barPosition(): Promise<CheckResult> {
    const name = "Bar position is saved and restored";
    const before = deps.barPosition();
    if (!before) return fail(name, "the Bar window is not open");
    await deps.dragBar(-120, -80);
    const moved = deps.barPosition();
    await deps.reopenBar();
    const after = deps.barPosition();
    const same = (a: [number, number] | null, b: [number, number] | null) =>
      a !== null && b !== null && a[0] === b[0] && a[1] === b[1];
    if (same(before, moved)) return fail(name, `the Bar did not move from ${before.join(",")}`);
    return check(
      name,
      same(moved, after),
      `moved to ${moved!.join(",")} and came back there after reopening`,
      `moved to ${moved?.join(",")} but reopened at ${after?.join(",")}`,
    );
  }

  function traySettings(): CheckResult[] {
    const results: CheckResult[] = [];
    deps.tray({ type: "device", id: "murmur.fixture" });
    const chosen = deps.settings().inputDevice;
    deps.tray({ type: "device", id: "auto" });
    results.push(
      check(
        "Tray: choosing a microphone",
        chosen === "murmur.fixture" && deps.settings().inputDevice === "auto",
        "the setting followed the menu, and back to Auto",
        `the setting read "${chosen}", then "${deps.settings().inputDevice}"`,
      ),
    );
    deps.tray({ type: "language", code: "en" });
    const languages = deps.settings().languages.join(",");
    deps.tray({ type: "language", code: "auto" });
    results.push(
      check(
        "Tray: choosing a language",
        languages === "en" && deps.settings().languages.length === 0,
        "English, then back to detect automatically",
        `the setting read "${languages}", then "${deps.settings().languages.join(",")}"`,
      ),
    );
    return results;
  }

  /** Pushes each result as it is known, so an error later keeps the earlier ones. */
  async function dictations(results: CheckResult[]): Promise<void> {
    deps.updateSettings({
      muteWhileDictating: true,
      sounds: { ...deps.settings().sounds, start: true, success: true },
    });
    const initial = await deps.outputMuted();

    const held = await dictate(deps.keyDown, deps.keyUp);
    results.push(
      check(
        "Bar shows listening, processing, done",
        inOrder(held.states, ["listening", "processing", "done"]),
        held.states.join(" → "),
        `saw ${held.states.join(" → ") || "nothing"}`,
      ),
      check(
        "Text arrives while the test box keeps the focus",
        held.text.trim() !== "" && held.stillFocused,
        JSON.stringify(held.text.trim()),
        held.text.trim() === "" ? "no text arrived" : "the test box lost the focus",
      ),
      check(
        "Start and success sounds play",
        inOrder(held.sounds, ["start", "success"]),
        held.sounds.join(", "),
        `played ${held.sounds.join(", ") || "nothing"}`,
      ),
    );
    if (initial === null) {
      results.push(skip("Output muted while dictating", "this output has no mute switch"));
    } else if (initial) {
      results.push(skip("Output muted while dictating", "the Mac was already muted"));
    } else {
      const after = await deps.outputMuted();
      results.push(
        check(
          "Output muted while dictating, restored after",
          held.mutedDuring === true && after === false,
          "muted during the recording, sound back after",
          `during: ${String(held.mutedDuring)}, after: ${String(after)}`,
        ),
      );
    }

    // The second dictation goes through the tray, with the Mac muted beforehand.
    if (initial === false) await deps.setOutputMuted(true);
    const viaTray = await dictate(
      () => deps.tray({ type: "toggle" }),
      () => deps.tray({ type: "toggle" }),
    );
    const afterTray = await deps.outputMuted();
    if (initial === false) await deps.setOutputMuted(false);
    results.push(
      check(
        "Tray: Start and Stop dictation",
        viaTray.text.trim() !== "",
        JSON.stringify(viaTray.text.trim()),
        `no text arrived (steps: ${viaTray.events.join(", ")})`,
      ),
    );
    if (initial !== null) {
      results.push(
        check(
          "An output that was already muted stays muted",
          afterTray === true,
          "still muted afterwards",
          `read ${String(afterTray)} afterwards`,
        ),
      );
    }

    const restore = await deps.saveClipboard();
    let copied: string;
    try {
      deps.tray({ type: "copy-last" });
      // The tray writes without waiting; give it a moment.
      await deps.sleep(200);
      copied = await deps.readClipboardText();
    } finally {
      await restore();
    }
    const last = deps.lastTranscript();
    results.push(
      check(
        "Tray: Copy last transcript",
        copied !== "" && copied === last,
        `${JSON.stringify(copied)}; the clipboard was put back`,
        `copied ${JSON.stringify(copied)}, last transcript ${JSON.stringify(last)}`,
      ),
    );
  }

  async function silentMic(): Promise<CheckResult> {
    const name = "Silent microphone warns";
    reset();
    deps.useSilentClip(true);
    try {
      await deps.clearField();
      await deps.focusField();
      deps.keyDown();
      await waitFor(() => events.includes("silent-mic"), SILENT_TIMEOUT_MS);
      const message = lastMessage;
      deps.keyUp();
      await deps.settled();
      const text = await deps.readField();
      return check(
        name,
        events.includes("silent-mic") && (message ?? "").startsWith("No sound") && text === "",
        `the Bar said "${message}" and nothing was typed`,
        `steps: ${events.join(", ")}; Bar message: ${String(message)}; box: ${JSON.stringify(text)}`,
      );
    } finally {
      deps.useSilentClip(false);
    }
  }

  return {
    handleRecorderEvent(event) {
      events.push(event.type);
    },
    handleBarView(view) {
      if (states.at(-1) !== view.state) states.push(view.state);
      if (view.message) lastMessage = view.message;
    },
    handleSound(name) {
      sounds.push(name);
    },
    async run() {
      const results: CheckResult[] = [];
      const steps: Array<() => Promise<void>> = [
        async () => void results.push(await barPosition()),
        async () => void results.push(...traySettings()),
        () => dictations(results),
        async () => void results.push(await silentMic()),
      ];
      for (const step of steps) {
        try {
          await step();
        } catch (error) {
          results.push(
            fail("unexpected error", error instanceof Error ? error.message : String(error)),
          );
        }
      }
      for (const result of results) {
        const mark = result.ok === null ? "SKIP" : result.ok ? "ok" : "FAIL";
        deps.log(`check ${mark}: ${result.name} (${result.detail})`);
      }
      return results;
    },
  };
}
