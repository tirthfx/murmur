import type { DictationBlocker } from "@murmur/shared";
import type { RecorderEvent } from "./recorder";

// The end-to-end smoke run (`npm run smoke`, see docs/smoke-test.md). It only exists when
// the app is started with MURMUR_SMOKE=1: it presses the dictation key for the app, lets a
// fixture clip play as the microphone, and reports what reached a test text box.

export interface SmokeResult {
  ok: boolean;
  /** Why the run failed; null when it passed. */
  reason: string | null;
  /** What the test box holds at the end. */
  fieldText: string;
  /** The dictation steps seen, in order. */
  events: string[];
  /** From key release to text in the box; null when no text arrived. */
  releaseToTextMs: number | null;
}

export interface SmokeDeps {
  sleep(ms: number): Promise<void>;
  /** What still blocks dictation. */
  blockers(): DictationBlocker[];
  /** Brings the test box to the front and puts the caret in it. */
  focusField(): Promise<void>;
  isFieldFocused(): boolean;
  readField(): Promise<string>;
  /** Push-to-talk key down and up, as the hotkey listener would report them. */
  keyDown(): void;
  keyUp(): void;
  /** Resolves when recording, transcription, insertion and the history row are done. */
  settled(): Promise<void>;
  /** How long to hold the key: the length of the clip plus a margin. */
  holdMs: number;
  readyTimeoutMs?: number;
  log(message: string): void;
  /** Wall-clock milliseconds; tests pass a fake. */
  now?: () => number;
}

export interface SmokeRun {
  handleRecorderEvent(event: RecorderEvent): void;
  /** Throws unless the test box has the focus, so text is never pasted anywhere else. */
  assertFieldFocused(): void;
  run(): Promise<SmokeResult>;
}

const POLL_MS = 50;
const START_TIMEOUT_MS = 15_000;
const FIELD_TIMEOUT_MS = 10_000;

export function createSmokeRun(deps: SmokeDeps): SmokeRun {
  const events: RecorderEvent[] = [];
  const now = deps.now ?? Date.now;
  let releaseToTextMs: number | null = null;
  const seen = (type: RecorderEvent["type"]) => events.some((event) => event.type === type);

  async function waitFor(done: () => boolean, timeoutMs: number): Promise<boolean> {
    for (let waited = 0; waited <= timeoutMs; waited += POLL_MS) {
      if (done()) return true;
      await deps.sleep(POLL_MS);
    }
    return done();
  }

  async function steps(): Promise<string | null> {
    const ready = await waitFor(() => deps.blockers().length === 0, deps.readyTimeoutMs ?? 180_000);
    if (!ready) return `dictation is not ready: ${deps.blockers().join(", ")}`;

    await deps.focusField();
    if (!deps.isFieldFocused()) return "the test window is not in front, so nothing was dictated";

    deps.log("key down");
    deps.keyDown();
    await waitFor(() => seen("started") || seen("start-failed"), START_TIMEOUT_MS);
    if (!seen("started")) {
      deps.keyUp();
      const failed = events.find((event) => event.type === "start-failed");
      return `recording did not start${failed && "message" in failed ? `: ${failed.message}` : ""}`;
    }
    await deps.sleep(deps.holdMs);
    deps.log("key up");
    deps.keyUp();
    const released = now();
    // The time the user waits: until the text is in the box, not until bookkeeping ends.
    let arrived = false;
    await waitFor(() => {
      if (arrived) return true;
      void deps.readField().then((value) => {
        if (!arrived && value.trim() !== "") {
          arrived = true;
          releaseToTextMs = now() - released;
        }
      });
      return arrived;
    }, FIELD_TIMEOUT_MS * 3);
    await deps.settled();

    if (!seen("transcribed")) return "no transcript was produced";
    if (seen("insert-failed")) return "the text could not be inserted";
    if (seen("copied-instead")) return "the text was copied, not pasted (Accessibility is missing)";
    let text = "";
    await waitFor(() => {
      void deps.readField().then((value) => {
        text = value;
      });
      return text.trim() !== "";
    }, FIELD_TIMEOUT_MS);
    return text.trim() === "" ? "the test box is empty" : null;
  }

  return {
    handleRecorderEvent(event) {
      events.push(event);
    },
    assertFieldFocused() {
      if (!deps.isFieldFocused()) {
        throw new Error("The smoke test window lost the focus; the text was not pasted");
      }
    },
    async run() {
      let reason: string | null;
      try {
        reason = await steps();
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      }
      const fieldText = await deps.readField().catch(() => "");
      return {
        ok: reason === null,
        reason,
        fieldText,
        events: events.map((event) => event.type),
        releaseToTextMs,
      };
    },
  };
}

/** The page of the test window: one text box that takes the focus. */
export const SMOKE_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(
  '<!doctype html><meta charset="utf-8"><title>Murmur smoke test</title>' +
    '<body style="margin:16px;font:14px system-ui">' +
    "<p>Murmur smoke test. Leave this window in front.</p>" +
    '<textarea id="field" rows="5" style="width:100%;box-sizing:border-box" autofocus></textarea>',
)}`;
