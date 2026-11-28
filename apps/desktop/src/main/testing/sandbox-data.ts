import type { DictationRecord } from "../recorder";

/** Started with this, Murmur runs on demo data in its own folder (HB-55). */
export const SANDBOX_SWITCH = "--murmur-sandbox";

/** The arguments to start again with, in the sandbox or out of it. */
export function restartArgs(argv: readonly string[], sandbox: boolean): string[] {
  const args = argv.slice(1).filter((arg) => arg !== SANDBOX_SWITCH);
  return sandbox ? [...args, SANDBOX_SWITCH] : args;
}

const SENTENCES = [
  "Let us move the review to Thursday afternoon.",
  "The first draft is ready, and the numbers are in the second tab.",
  "Remind the team that the office closes early on Friday.",
  "I agree with the plan, with one change to the last step.",
  "Please send the notes from this morning when you have them.",
];
const APPS = [
  { bundleId: "com.apple.mail", name: "Mail" },
  { bundleId: "com.apple.Notes", name: "Notes" },
  { bundleId: "com.apple.TextEdit", name: "TextEdit" },
];
/** Days of demo history, ending today. */
const DAYS = 21;

/** Made-up dictations over the last three weeks, so Home, History and Insights have content. */
export function demoDictations(now: number): DictationRecord[] {
  const records: DictationRecord[] = [];
  for (let back = DAYS - 1; back >= 0; back--) {
    // Fewer at weekends, so the charts have a shape.
    const count = back % 7 < 2 ? 1 : 2 + (back % 3);
    for (let n = 0; n < count; n++) {
      const text = SENTENCES[(back + n) % SENTENCES.length]!;
      const app = APPS[(back + n * 2) % APPS.length]!;
      const words = text.split(/\s+/).length;
      records.push({
        sessionId: `demo-${back}-${n}`,
        source: "hold",
        createdAt: now - back * 86_400_000 - n * 3_600_000,
        durationMs: words * 380,
        language: "en",
        rawText: text,
        finalText: text,
        wordCount: words,
        cleanup: null,
        insertStatus: "inserted",
        insertMethod: "paste_cmd_v",
        errorCode: null,
        audio: null,
        retryOf: null,
        appBundleId: app.bundleId,
        appName: app.name,
      });
    }
  }
  return records;
}
