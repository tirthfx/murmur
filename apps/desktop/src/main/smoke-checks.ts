import type { BarView, FocusContext, MicCheckResult, Settings, SoundName } from "@murmur/shared";
import type { RecorderEvent } from "./recorder";
import type { TrayAction } from "./tray/tray-menu";

// The extra checks of `npm run smoke -- --full` (see docs/smoke-test.md). They run after the
// main smoke dictation, on fixture clips, and cover what the owner would otherwise test by
// hand: the Bar, sounds and output mute, the tray menu, a silent microphone, press enter,
// context, languages, whisper mode, the mic check, retry and the typing reminder.

/** The clips the script makes; each one is copied over the fixture before it is used. */
export type ClipName = "speech" | "silent" | "enter" | "hindi" | "quiet";

export interface CheckResult {
  name: string;
  /** null when the check could not run on this Mac (for example, no mute switch). */
  ok: boolean | null;
  detail: string;
}

export interface SmokeChecksDeps {
  sleep(ms: number): Promise<void>;
  log(message: string): void;
  /** How long to hold the key for a clip: its length plus a margin. */
  clipMs(name: ClipName): number;
  focusField(): Promise<void>;
  isFieldFocused(): boolean;
  /** Replaces the test box's text and puts the caret at its end. */
  setField(text: string): Promise<void>;
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
  /** Makes the helper read this clip from the next recording on. */
  useClip(name: ClipName): void;
  /** Runs the Hub's microphone check for about the length of the speech clip. */
  micCheck(): Promise<MicCheckResult | null>;
  /** Makes the next transcription fail, as a broken model would (smoke runs only). */
  failNextTranscription(): void;
  canRetry(): boolean;
  /** Hands the typing reminder this many typed words, as the helper's counter would. */
  feedTypedWords(words: number): void;
  /** Adds dictionary entries for one check; returns a function that removes them. */
  addDictionary(entries: { term: string; replacement: string | null }[]): () => void;
  /** Adds a rich snippet for one check; returns a function that removes it. */
  addSnippet(trigger: string, lines: string[]): () => void;
}

export interface SmokeChecks {
  handleRecorderEvent(event: RecorderEvent): void;
  handleBarView(view: BarView): void;
  handleSound(name: SoundName): void;
  handleContext(context: FocusContext | null): void;
  run(): Promise<CheckResult[]>;
}

const POLL_MS = 50;
const START_TIMEOUT_MS = 15_000;
const TEXT_TIMEOUT_MS = 30_000;
/** The helper reports a silent input after about three seconds. */
const SILENT_TIMEOUT_MS = 8_000;

interface Dictation {
  /** What the box holds after the dictation, without the text put there before. */
  text: string;
  /** Everything the box holds. */
  field: string;
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
  /** The text before the caret in the context read for the current dictation. */
  let lastContextBefore: string | null = null;

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
    lastContextBefore = null;
  }

  /** Waits until the box holds more than `before`. */
  async function readText(before: string, timeoutMs: number): Promise<string> {
    let text = before;
    for (let waited = 0; waited <= timeoutMs; waited += POLL_MS) {
      text = await deps.readField();
      if (text.trim() !== before.trim()) break;
      await deps.sleep(POLL_MS);
    }
    return text;
  }

  interface DictateOptions {
    clip?: ClipName;
    /** Text in the box before the dictation, with the caret after it. */
    prefill?: string;
    /** False when the dictation is meant to give no text. */
    expectText?: boolean;
  }

  /** One dictation into the test box, started and stopped by the given calls. */
  async function dictate(
    start: () => void,
    stop: () => void,
    options: DictateOptions = {},
  ): Promise<Dictation> {
    const clip = options.clip ?? "speech";
    const prefill = options.prefill ?? "";
    const holdMs = deps.clipMs(clip);
    reset();
    deps.useClip(clip);
    try {
      await deps.setField(prefill);
      await deps.focusField();
      start();
      await waitFor(
        () => events.includes("started") || events.includes("start-failed"),
        START_TIMEOUT_MS,
      );
      let mutedDuring: boolean | null = null;
      if (events.includes("started")) {
        // Muting comes after the start sound; ask once it has had time to happen.
        await deps.sleep(Math.min(1000, holdMs));
        mutedDuring = await deps.outputMuted();
        await deps.sleep(Math.max(0, holdMs - 1000));
      }
      stop();
      if (events.includes("started") && options.expectText !== false) {
        await readText(prefill, TEXT_TIMEOUT_MS);
      }
      await deps.settled();
      // Return is pressed a moment after the text.
      await deps.sleep(300);
      const field = await deps.readField();
      return {
        text: field.startsWith(prefill) ? field.slice(prefill.length) : field,
        field,
        events: [...events],
        states: [...states],
        sounds: [...sounds],
        mutedDuring,
        stillFocused: deps.isFieldFocused(),
      };
    } finally {
      deps.useClip("speech");
    }
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
    deps.useClip("silent");
    try {
      await deps.setField("");
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
      deps.useClip("speech");
    }
  }

  async function pressEnterAndContext(results: CheckResult[]): Promise<void> {
    const prefill = "Hello Priya, about the meeting. ";
    const withContext = await dictate(deps.keyDown, deps.keyUp, { prefill });
    const before = lastContextBefore;
    results.push(
      check(
        "Context: the text before the caret is read",
        (before ?? "").includes("Priya"),
        `read ${JSON.stringify(before)}`,
        `read ${JSON.stringify(before)} (box: ${JSON.stringify(withContext.field)})`,
      ),
    );

    const enter = await dictate(deps.keyDown, deps.keyUp, { clip: "enter" });
    const typed = enter.text.replace(/\n+$/, "");
    results.push(
      check(
        "Press enter: the command is taken off and Return is pressed",
        /\n$/.test(enter.field) && typed.trim() !== "" && !/press enter/i.test(typed),
        `${JSON.stringify(enter.field)}`,
        `box: ${JSON.stringify(enter.field)}`,
      ),
    );
  }

  async function languages(results: CheckResult[]): Promise<void> {
    const devanagari = /[\u0900-\u097F]/;
    try {
      deps.updateSettings({ languages: ["hi"] });
      const hindi = await dictate(deps.keyDown, deps.keyUp, { clip: "hindi" });
      results.push(
        check(
          "Languages: Hindi is written in Devanagari",
          devanagari.test(hindi.text),
          JSON.stringify(hindi.text.trim()),
          `got ${JSON.stringify(hindi.text.trim())}`,
        ),
      );
      deps.updateSettings({ languages: ["hi-Latn"] });
      const latin = await dictate(deps.keyDown, deps.keyUp, { clip: "hindi" });
      results.push(
        check(
          "Languages: Hindi in Latin script",
          /[a-z]/i.test(latin.text) && !devanagari.test(latin.text),
          JSON.stringify(latin.text.trim()),
          `got ${JSON.stringify(latin.text.trim())}`,
        ),
      );
    } finally {
      deps.updateSettings({ languages: [] });
    }
  }

  async function whisper(results: CheckResult[]): Promise<void> {
    try {
      deps.updateSettings({ whisperMode: false });
      const normal = await dictate(deps.keyDown, deps.keyUp, { clip: "quiet", expectText: false });
      deps.updateSettings({ whisperMode: true });
      const whispered = await dictate(deps.keyDown, deps.keyUp, { clip: "quiet" });
      const off =
        normal.text.trim() === ""
          ? "nothing without it"
          : `without it: ${JSON.stringify(normal.text.trim())}`;
      results.push(
        check(
          "Whisper mode: a very quiet voice gives text",
          whispered.text.trim() !== "",
          `${JSON.stringify(whispered.text.trim())}; ${off}`,
          `no text with whisper mode on (steps: ${whispered.events.join(", ")}); ${off}`,
        ),
      );
    } finally {
      deps.updateSettings({ whisperMode: false });
    }
  }

  async function micCheck(): Promise<CheckResult> {
    const result = await deps.micCheck();
    return check(
      "Mic check: measures speech and background, gives advice",
      result !== null &&
        result.speechDb !== null &&
        result.noiseDb !== null &&
        result.adviceText !== "",
      result
        ? `speech ${result.speechDb} dB, background ${result.noiseDb} dB: ${result.adviceText}`
        : "",
      `result: ${JSON.stringify(result)}`,
    );
  }

  async function retry(results: CheckResult[]): Promise<void> {
    deps.failNextTranscription();
    const failed = await dictate(deps.keyDown, deps.keyUp, { expectText: false });
    const offered = deps.canRetry();
    results.push(
      check(
        "Retry: a failed dictation is offered for retry",
        failed.events.includes("transcription-failed") && failed.text.trim() === "" && offered,
        "failed on purpose, nothing typed, Retry offered",
        `steps: ${failed.events.join(", ")}; box: ${JSON.stringify(failed.text)}; retry offered: ${offered}`,
      ),
    );
    if (!offered) return;
    reset();
    await deps.setField("");
    await deps.focusField();
    deps.tray({ type: "retry-last" });
    const text = await readText("", TEXT_TIMEOUT_MS);
    await deps.settled();
    results.push(
      check(
        "Retry: Retry last dictation types the text",
        text.trim() !== "" && !deps.canRetry(),
        `${JSON.stringify(text.trim())}; nothing left to retry`,
        `box: ${JSON.stringify(text)}; still offered: ${deps.canRetry()}`,
      ),
    );
  }

  async function dictionary(): Promise<CheckResult> {
    const remove = deps.addDictionary([
      { term: "FOX", replacement: null },
      { term: "lazy dog", replacement: "sleepy cat" },
    ]);
    try {
      const result = await dictate(deps.keyDown, deps.keyUp);
      const text = result.text.trim();
      return check(
        "Dictionary: a spelling and a replacement apply",
        /\bFOX\b/.test(text) && /sleepy cat/i.test(text) && !/lazy dog/i.test(text),
        JSON.stringify(text),
        `got ${JSON.stringify(text)}`,
      );
    } finally {
      remove();
    }
  }

  async function snippet(): Promise<CheckResult> {
    // The speech clip's whole sentence is the trigger.
    const remove = deps.addSnippet("the quick brown fox jumps over the lazy dog", [
      "Snippet line one",
      "Snippet line two",
    ]);
    try {
      const result = await dictate(deps.keyDown, deps.keyUp);
      return check(
        "Snippets: a trigger said on its own inserts the body",
        result.text.trim() === "Snippet line one\nSnippet line two",
        JSON.stringify(result.text.trim()),
        `got ${JSON.stringify(result.text.trim())}`,
      );
    } finally {
      remove();
    }
  }

  async function typingReminder(): Promise<CheckResult> {
    const name = "Typing reminder: snooze holds it, then it suggests dictating";
    const message = () => deps.barView().message ?? "";
    try {
      deps.tray({ type: "reminder", choice: "hour" });
      deps.feedTypedWords(70);
      await deps.sleep(300);
      const whileSnoozed = message();
      deps.tray({ type: "reminder", choice: "on" });
      deps.feedTypedWords(70);
      await deps.sleep(300);
      const after = message();
      return check(
        name,
        !whileSnoozed.startsWith("Dictate instead") && after.startsWith("Dictate instead"),
        `snoozed: no suggestion; on: "${after}"`,
        `snoozed: "${whileSnoozed}"; on: "${after}"`,
      );
    } finally {
      deps.tray({ type: "reminder", choice: "on" });
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
    handleContext(value) {
      lastContextBefore = value ? value.textBefore : null;
    },
    async run() {
      const results: CheckResult[] = [];
      const steps: Array<() => Promise<void>> = [
        async () => void results.push(await barPosition()),
        async () => void results.push(...traySettings()),
        () => dictations(results),
        async () => void results.push(await silentMic()),
        () => pressEnterAndContext(results),
        () => languages(results),
        () => whisper(results),
        async () => void results.push(await micCheck()),
        () => retry(results),
        async () => void results.push(await typingReminder()),
        async () => void results.push(await dictionary()),
        async () => void results.push(await snippet()),
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
