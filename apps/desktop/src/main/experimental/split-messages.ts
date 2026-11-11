import type { Transcript } from "@murmur/shared";

/** A pause at least this long starts a new message (DC-37). */
export const SPLIT_PAUSE_MS = 2000;
/** A part shorter than this joins the one before it. */
export const SPLIT_MIN_WORDS = 5;

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * Splits a dictation into chat messages at long pauses, using the speech model's segment
 * times. Returns one part when there is nothing to split.
 */
export function splitMessages(
  transcript: Pick<Transcript, "text" | "segments">,
  pauseMs = SPLIT_PAUSE_MS,
  minWords = SPLIT_MIN_WORDS,
): string[] {
  const segments = transcript.segments.filter((segment) => segment.text.trim() !== "");
  if (segments.length < 2) return [transcript.text.trim()].filter(Boolean);
  const parts: string[][] = [[segments[0]!.text.trim()]];
  for (let index = 1; index < segments.length; index++) {
    const gap = segments[index]!.startMs - segments[index - 1]!.endMs;
    const text = segments[index]!.text.trim();
    if (gap >= pauseMs) parts.push([text]);
    else parts.at(-1)!.push(text);
  }
  const joined = parts.map((part) => part.join(" "));
  // Short parts join the previous one; a short first part joins the next.
  const merged: string[] = [];
  for (const part of joined) {
    if (merged.length > 0 && wordCount(part) < minWords) merged[merged.length - 1] += ` ${part}`;
    else merged.push(part);
  }
  if (merged.length > 1 && wordCount(merged[0]!) < minWords) {
    merged.splice(0, 2, `${merged[0]} ${merged[1]}`);
  }
  return merged;
}
