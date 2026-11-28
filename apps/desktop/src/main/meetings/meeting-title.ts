import { MEETING_TITLE_MAX } from "./meetings-store";
import type { ModelRequest } from "./model-ask";

/** How much of a summary the model reads to name the meeting. */
const SUMMARY_CHARS = 4_000;
/** A longer answer is a sentence about the meeting, not a name for it. */
const MAX_WORDS = 12;

const SYSTEM =
  "You name a meeting from its summary. Answer with the title only: at most eight words, " +
  "in the language of the summary, with no quotes and no full stop.";

/** The model's answer as a title, or null when it is not one. */
export function cleanTitle(answer: string): string | null {
  const first = answer.trim().split("\n")[0] ?? "";
  const title = first
    .replace(/^[#*\s]+/, "")
    .replace(/^title\s*:\s*/i, "")
    .replace(/^["'“‘]+|["'”’.\s*]+$/g, "")
    .trim();
  if (title === "" || title.length > MEETING_TITLE_MAX) return null;
  return title.split(/\s+/).length > MAX_WORDS ? null : title;
}

/** NT-05: a short name for a meeting, read from its summary. Null when the model gives none. */
export async function titleFromSummary(
  ask: (request: ModelRequest) => Promise<string>,
  markdown: string,
): Promise<string | null> {
  const answer = await ask({
    system: SYSTEM,
    prompt: markdown.slice(0, SUMMARY_CHARS),
    maxTokens: 32,
  });
  return cleanTitle(answer);
}
