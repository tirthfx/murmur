import {
  MEETING_LANGUAGES,
  NOT_DISCUSSED,
  NO_SOURCE,
  formatElapsed,
  type Skill,
  type SkillLength,
  readableMentions,
} from "@murmur/shared";

/** A transcript segment as the summary sees it. */
export interface SummarySegment {
  id: string;
  channel: "mic" | "system";
  startMs: number;
  text: string;
}

export interface SummarizerDeps {
  /** One call of the local model. May wait for a dictation; rejects when it cannot answer. */
  generate(request: { system: string; prompt: string; maxTokens: number }): Promise<string>;
  /** Called after each model call: `done` of `total` steps. */
  onProgress?(done: number, total: number): void;
}

export interface SummaryRequest {
  segments: SummarySegment[];
  /** The owner's own notes for the meeting. */
  notes: string;
  skill: Skill;
  length: SkillLength;
  /** NT-20: "meeting" writes in the language of the transcript; a code writes in that language. */
  language?: string;
}

/** A rough size: about 3.5 characters to a token, so the count errs on the large side. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);

/** Parts of a long transcript are about this big, with a little overlap (NT-09). */
export const CHUNK_TOKENS = 2_500;
export const OVERLAP_TOKENS = 200;
/** A meeting no bigger than this is summarised in one go. */
export const SINGLE_PASS_TOKENS = 3_000;
/** The owner's notes are cut to this many characters in a prompt. */
export const NOTES_CHARS = 6_000;
const MAP_MAX_TOKENS = 600;
const FINAL_MAX_TOKENS: Record<SkillLength, number> = { short: 500, medium: 900, long: 1_500 };
const BULLETS: Record<SkillLength, number> = { short: 5, medium: 8, long: 12 };
/** A cited time may be this far (in seconds) from the nearest line and still count. */
const CITATION_SLACK_S = 10;
const MAX_CITATIONS = 3;

const who = (channel: "mic" | "system") => (channel === "mic" ? "Owner" : "Remote");

/** "[12:34] You: text", one per segment, in time order. */
export function transcriptLines(segments: readonly SummarySegment[]): string[] {
  return [...segments]
    .sort((a, b) => a.startMs - b.startMs)
    .map(
      (segment) => `[${formatElapsed(segment.startMs)}] ${who(segment.channel)}: ${segment.text}`,
    );
}

/** Groups of whole lines of about `maxTokens`, each starting with the last lines of the one before. */
export function chunkLines(
  lines: readonly string[],
  maxTokens: number,
  overlapTokens: number,
): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of lines) {
    const tokens = estimateTokens(line) + 1;
    if (current.length > 0 && size + tokens > maxTokens) {
      chunks.push(current);
      const carry: string[] = [];
      let carried = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        const t = estimateTokens(current[i]!) + 1;
        if (carried + t > overlapTokens) break;
        carry.unshift(current[i]!);
        carried += t;
      }
      current = carry;
      size = carried;
    }
    current.push(line);
    size += tokens;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** The line that says what language to write in (NT-20). */
export function languageLine(language: string | undefined): string {
  const named = MEETING_LANGUAGES.find((candidate) => candidate.code === language);
  return named
    ? `Write in ${named.label}, whatever language the transcript is in.`
    : "Write in the language the transcript is in.";
}
const GROUND =
  'Use only what is in the text. Never invent names, numbers, dates or decisions. Lines of the transcript are marked with the time they were said, like [12:34]. Owner lines are the person who owns these notes and Remote lines are everyone else: name people when a name was said, otherwise say "the owner" or "someone", never "you".';

function mapSystem(language?: string): string {
  return [
    "You take notes on one part of a meeting, for a summary that will be written later.",
    GROUND,
    'Write short bullets, each starting with "- " and ending with the time or times in square brackets of the lines it comes from, like [12:34] or [12:34] [12:51].',
    "Keep decisions, actions with their owner, numbers, names and open questions. No headings and no introduction. At most 12 bullets.",
    languageLine(language),
  ].join("\n");
}

function finalSystem(skill: Skill, length: SkillLength, brief = false, language?: string): string {
  const most = brief ? Math.max(2, Math.floor(BULLETS[length] / 2)) : BULLETS[length];
  return [
    "You write meeting notes.",
    GROUND,
    `Write Markdown with exactly these section headings, in this order, each on its own line as "## Heading": ${skill.sections.join(", ")}.`,
    `Under each heading write short bullets starting with "- ", at most ${most} per section. End every bullet with ${brief ? "one time" : "the time or times"} in square brackets of the lines it comes from, like [12:34]. A section that was not discussed has only the words "${NOT_DISCUSSED}" under its heading.`,
    languageLine(language),
    `What to write: ${skill.prompt}`,
  ].join("\n");
}

function finalPrompt(body: string, notes: string, bodyLabel: string): string {
  const own = notes.trim().slice(0, NOTES_CHARS);
  return `${own ? `The owner's own notes:\n${own}\n\n` : ""}${bodyLabel}:\n${body}`;
}

// ------------------------------------------------------------- the checking

/** A bracket of one or more times: [12:34], or [12:34, 13:02] the way the model often writes it. */
const CLOCK = /\[(\d{1,2}(?::\d{2}){1,2}(?:\s*[,;–-]\s*\d{1,2}(?::\d{2}){1,2})*)\]/g;
/** A bracket the answer was cut in the middle of. */
const UNFINISHED = /\s*\[[^\]]*$/;

export function clockSeconds(text: string): number {
  const parts = text.split(":").map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export const citedTimes = (text: string): number[] =>
  [...text.matchAll(CLOCK)].flatMap((match) =>
    (match[1]!.match(/\d{1,2}(?::\d{2}){1,2}/g) ?? []).map(clockSeconds),
  );

/** The text without its time brackets, and without the space they leave before punctuation. */
export const stripTimes = (text: string): string =>
  text
    .replace(UNFINISHED, "")
    .replace(CLOCK, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

/** Said under a section the answer never reached. */
export const NOT_WRITTEN = "Not written: the summary ran out of room. Write a new version.";

function sectionName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*_:#]/g, "")
    .trim();
}

/** The segment a cited time points at: the one said at that second, else the nearest. */
export function resolve(
  seconds: number,
  segments: readonly SummarySegment[],
): SummarySegment | null {
  let best: SummarySegment | null = null;
  let distance = Infinity;
  for (const segment of segments) {
    const gap = Math.abs(Math.floor(segment.startMs / 1000) - seconds);
    if (gap < distance) {
      best = segment;
      distance = gap;
    }
  }
  return best && distance <= CITATION_SLACK_S ? best : null;
}

/**
 * Turns what the model wrote into the summary that is kept (NT-09): the Skill's sections in
 * order, a section with nothing in it says "Not discussed", and every bullet either links to
 * real transcript segments or ends in "(No source)". Times the model cited that match no
 * segment are dropped, so a link always opens something. Other text is dropped.
 */
export function groundSummary(
  output: string,
  skill: Skill,
  segments: readonly SummarySegment[],
  /** The answer was cut off by the token limit: sections it never reached are not "Not discussed". */
  cut = false,
): string {
  const bySection = new Map<string, string[]>();
  let current: string[] | null = null;
  const wanted = new Map(skill.sections.map((name) => [sectionName(name), name]));
  for (const raw of output.split("\n")) {
    const line = raw.trimEnd();
    const heading = /^#{1,4}\s+(.+)$/.exec(line.trim());
    if (heading) {
      const key = sectionName(heading[1]!);
      current = wanted.has(key) ? (bySection.get(key) ?? []) : null;
      if (current) bySection.set(key, current);
      continue;
    }
    if (current && line.trim() !== "") current.push(line.trim());
  }
  const parts: string[] = [];
  // The last section the answer wrote anything under: the ones after it were never reached.
  const lastReached = skill.sections.reduce(
    (last, section, i) => ((bySection.get(sectionName(section)) ?? []).length > 0 ? i : last),
    -1,
  );
  for (const name of skill.sections) {
    const lines = bySection.get(sectionName(name)) ?? [];
    const body: string[] = [];
    for (const line of lines) {
      if (
        sectionName(line.replace(/^[-*•]\s+/, "")).replace(/\./g, "") === sectionName(NOT_DISCUSSED)
      )
        continue;
      const bullet = /^[-*•]\s+(.*)$/.exec(line);
      if (!bullet) {
        body.push(stripTimes(line));
        continue;
      }
      const cited = citedTimes(bullet[1]!);
      const text = stripTimes(bullet[1]!);
      if (text === "") continue;
      const links: string[] = [];
      const seen = new Set<string>();
      for (const seconds of cited) {
        const segment = resolve(seconds, segments);
        if (!segment || seen.has(segment.id)) continue;
        seen.add(segment.id);
        links.push(`[${formatElapsed(segment.startMs)}](seg:${segment.id})`);
        if (links.length === MAX_CITATIONS) break;
      }
      body.push(`- ${text} ${links.length > 0 ? links.join(" ") : `(${NO_SOURCE})`}`);
    }
    const index = skill.sections.indexOf(name);
    const reached = lastReached >= index;
    const empty = cut && !reached ? NOT_WRITTEN : NOT_DISCUSSED;
    parts.push(`## ${name}\n${body.length > 0 ? body.join("\n") : empty}`);
  }
  return parts.join("\n\n");
}

/** An answer that fills the room it was given was probably cut off there. */
const looksCut = (output: string, room: number) => estimateTokens(output) >= room * 0.9;

// ------------------------------------------------------------------ the run

/**
 * Writes a summary of a meeting with a Skill. A short meeting goes to the model once. A long
 * one is cut into parts of about 2,500 tokens with a little overlap; each part is noted on
 * its own (map), and the notes are merged, and merged again while they are still too long
 * (reduce), before the Skill's sections are written. Every prompt stays inside the model's
 * context. The result is checked against the transcript (`groundSummary`).
 */
export async function summarizeMeeting(
  deps: SummarizerDeps,
  request: SummaryRequest,
): Promise<string> {
  const lines = transcriptLines(request.segments);
  const total = lines.join("\n");
  const notes = readableMentions(request.notes).trim().slice(0, NOTES_CHARS);
  let done = 0;
  let steps = 1;
  const call = async (system: string, prompt: string, maxTokens: number) => {
    const text = await deps.generate({ system, prompt, maxTokens });
    deps.onProgress?.(++done, steps);
    return text;
  };

  let body = total;
  let label = "Transcript";
  if (estimateTokens(total) + estimateTokens(notes) > SINGLE_PASS_TOKENS) {
    const parts = chunkLines(lines, CHUNK_TOKENS, OVERLAP_TOKENS);
    steps = parts.length + 2;
    const noted: string[] = [];
    for (const part of parts) {
      noted.push((await call(mapSystem(request.language), part.join("\n"), MAP_MAX_TOKENS)).trim());
    }
    let merged = noted.join("\n");
    // Merge again while the notes alone are too long for one prompt.
    for (let round = 0; round < 4 && estimateTokens(merged) > SINGLE_PASS_TOKENS; round++) {
      const groups = chunkLines(merged.split("\n"), CHUNK_TOKENS, 0);
      steps += groups.length;
      const condensed: string[] = [];
      for (const group of groups)
        condensed.push(
          (await call(mapSystem(request.language), group.join("\n"), MAP_MAX_TOKENS)).trim(),
        );
      merged = condensed.join("\n");
    }
    body = merged;
    label =
      "Notes on the meeting, in order (each ends with the time of the transcript line it comes from)";
  }
  const prompt = finalPrompt(body, notes, label);
  const room = FINAL_MAX_TOKENS[request.length];
  let output = await call(
    finalSystem(request.skill, request.length, false, request.language),
    prompt,
    room,
  );
  let cut = looksCut(output, room);
  if (cut) {
    // Too much for the room: once more, with fewer bullets and one time each.
    steps++;
    output = await call(
      finalSystem(request.skill, request.length, true, request.language),
      prompt,
      room,
    );
    cut = looksCut(output, room);
  }
  return groundSummary(output, request.skill, request.segments, cut);
}
