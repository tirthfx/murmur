import { formatElapsed } from "@murmur/shared";
import { citedTimes, resolve, stripTimes, type SummarySegment } from "./summarizer";

/** A line of the live transcript as the recap sees it. `id` is null for a line still grey. */
export interface RecapLine {
  id: string | null;
  startMs: number;
  speaker: string;
  text: string;
}

export const MAX_BULLETS = 6;
export const MAX_TOKENS = 500;
/** A cited time may be this far (seconds) outside the window and still count. */
const WINDOW_SLACK_S = 5;
/** A cited time may be this far from the nearest line (seconds) and still count. */
const LINE_SLACK_S = 10;

export const SYSTEM = (brief: boolean) =>
  [
    "You write a catch-up for someone who just came back to a meeting.",
    `Write ${brief ? "3 or 4" : "3 to 6"} short bullets, each starting with "- ". Say who said or asked or agreed what: use the names of the speakers (You is the person reading). Keep decisions, actions, numbers and open questions.`,
    "End every bullet with the time in square brackets of the line it comes from, like [12:34]. Use only the lines you are given and never invent. No heading and no introduction.",
    "Write in the language of the transcript.",
  ].join("\n");

export function recapPrompt(lines: readonly RecapLine[]): string {
  return `The last minutes of the meeting:\n${lines
    .map((line) => `[${formatElapsed(line.startMs)}] ${line.speaker}: ${line.text}`)
    .join("\n")}`;
}

/**
 * The recap that is kept (NT-13): bullets only, each with a time that lies inside the window.
 * A time the model gave that is outside the window, or near no line, is dropped, and a bullet with
 * no time left is dropped with it. A time near a line that has a segment becomes a link to it.
 * At most six bullets.
 */
export function groundRecap(
  output: string,
  lines: readonly RecapLine[],
  window: { startMs: number; endMs: number },
): string {
  const real: SummarySegment[] = lines
    .filter((line): line is RecapLine & { id: string } => line.id !== null)
    .map((line) => ({
      id: line.id,
      channel: "system" as const,
      startMs: line.startMs,
      text: line.text,
    }));
  const bullets: string[] = [];
  const seen = new Set<string>();
  for (const raw of output.split("\n")) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(raw);
    if (!bullet) continue;
    const text = stripTimes(bullet[1]!);
    if (text === "" || seen.has(text.toLowerCase())) continue;
    const links: string[] = [];
    const used = new Set<number>();
    for (const seconds of citedTimes(bullet[1]!)) {
      if (seconds * 1000 < window.startMs - WINDOW_SLACK_S * 1000) continue;
      if (seconds * 1000 > window.endMs + WINDOW_SLACK_S * 1000) continue;
      // The nearest line, among all lines (final or not).
      let best: RecapLine | null = null;
      let distance = Infinity;
      for (const line of lines) {
        const gap = Math.abs(Math.floor(line.startMs / 1000) - seconds);
        if (gap < distance) {
          best = line;
          distance = gap;
        }
      }
      if (!best || distance > LINE_SLACK_S) continue;
      const at = Math.floor(best.startMs / 1000);
      if (used.has(at)) continue;
      used.add(at);
      const segment = best.id ? resolve(at, real) : null;
      links.push(
        segment && segment.id === best.id
          ? `[${formatElapsed(best.startMs)}](seg:${best.id})`
          : `[${formatElapsed(best.startMs)}]`,
      );
      if (links.length === 3) break;
    }
    if (links.length === 0) continue;
    seen.add(text.toLowerCase());
    bullets.push(`- ${text} ${links.join(" ")}`);
    if (bullets.length === MAX_BULLETS) break;
  }
  return bullets.join("\n");
}
