/**
 * Parsers for transcript files (NT-21): WebVTT, SubRip, plain text with `Speaker: text` lines
 * (also Zoom's text export) and JSON with a `segments` list. Each gives the same shape, which
 * one writer turns into a meeting. A file that is none of these is refused with the list of
 * formats; nothing is half-read.
 */

import { TRANSCRIPT_IMPORT_FORMATS, type TranscriptImportFormat } from "@murmur/shared";

export const IMPORT_FORMATS = TRANSCRIPT_IMPORT_FORMATS;
export type ImportFormat = TranscriptImportFormat;

export const IMPORT_FORMAT_TEXT: Record<ImportFormat, string> = {
  vtt: "WebVTT (.vtt, also from Zoom)",
  srt: "SubRip (.srt)",
  text: "Plain text with “Speaker: text” lines (.txt, also from Zoom)",
  json: "JSON with a segments list (.json)",
};

export interface ImportedSegment {
  startMs: number;
  endMs: number;
  /** The speaker's name as written in the file, or null when it has none. */
  speaker: string | null;
  text: string;
}

export interface ParsedTranscript {
  format: ImportFormat;
  /** A title the file names, if it does (JSON). */
  title: string | null;
  /** When the meeting started, if the file says (JSON). */
  startedAt: number | null;
  segments: ImportedSegment[];
  /** True when the file has no times and they were made up from the length of each line. */
  timesEstimated: boolean;
}

export type ParseResult =
  { ok: true; transcript: ParsedTranscript } | { ok: false; message: string };

/** The most lines a file can have and still be read. */
export const MAX_SEGMENTS = 50_000;
const MAX_TEXT = 4_000;

export const unsupported = (): { ok: false; message: string } => ({
  ok: false,
  message: `That file is not a transcript Murmur can read. Supported files: ${IMPORT_FORMATS.map((f) => IMPORT_FORMAT_TEXT[f]).join("; ")}.`,
});

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};
const decode = (text: string) =>
  text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m);

const clean = (text: string) => decode(text).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);

/** "Dana Lee: text": a name of up to five words, then a colon and a space. */
const SPEAKER_PREFIX = /^([^\s:][^:\n]{0,44}?):\s+(\S.*)$/;
export function splitSpeaker(text: string): { speaker: string | null; text: string } {
  const match = SPEAKER_PREFIX.exec(text);
  if (!match) return { speaker: null, text };
  const name = match[1]!.trim();
  // A sentence with a colon in it is not a speaker label: a name has at most five words, no
  // sentence punctuation, and (when it has several words) each starts with a capital or a
  // digit, apart from the little words of a name like "de" and "van".
  const bare = name.replace(/\([^)]*\)/g, "").trim();
  const words = bare.split(/\s+/);
  const little = /^(?:de|da|di|du|dos|van|von|der|den|la|le|el|al|bin|ibn)$/;
  const looksLikeName =
    words.length <= 5 &&
    !/[.?!,;]/.test(bare) &&
    (words.length === 1 ||
      words.every((word) => /^[\p{Lu}\p{N}@_]/u.test(word) || little.test(word)));
  return looksLikeName ? { speaker: name, text: match[2]! } : { speaker: null, text };
}

/** `HH:MM:SS.mmm`, `MM:SS.mmm` or with a comma, in milliseconds; null when it is not a time. */
export function parseClock(text: string): number | null {
  const match = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(text.trim());
  if (!match) return null;
  const [, h, m, s, ms] = match;
  if (Number(m) > 59 || Number(s) > 59) return null;
  return (
    ((Number(h ?? 0) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number((ms ?? "0").padEnd(3, "0"))
  );
}

const CUE_TIME =
  /^\s*((?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d{1,3})/;

/** The cues of a WebVTT or SubRip file; both are blocks of a time line and text. */
function parseCues(text: string, format: "vtt" | "srt"): ParseResult {
  const blocks = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/);
  const segments: ImportedSegment[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    if (lines.length === 0) continue;
    const at = lines.findIndex((line) => CUE_TIME.test(line));
    if (at === -1) continue; // WEBVTT header, NOTE, STYLE, REGION or a stray line
    const times = CUE_TIME.exec(lines[at]!)!;
    const start = parseClock(times[1]!);
    const end = parseClock(times[2]!);
    if (start === null || end === null || end < start) return unsupported();
    let body = lines.slice(at + 1).join(" ");
    // A voice tag names the speaker: <v Dana Lee>Hello</v>.
    let speaker: string | null = null;
    const voice = /<v(?:\.[^\s>]*)?\s+([^>]+)>/.exec(body);
    if (voice) speaker = decode(voice[1]!).trim();
    body = body.replace(/<[^>]*>/g, "");
    const words = clean(body);
    if (words === "") continue;
    if (!speaker) {
      const split = splitSpeaker(words);
      segments.push({ startMs: start, endMs: end, speaker: split.speaker, text: split.text });
    } else segments.push({ startMs: start, endMs: end, speaker, text: words });
    if (segments.length > MAX_SEGMENTS) return unsupported();
  }
  if (segments.length === 0) return unsupported();
  return {
    ok: true,
    transcript: { format, title: null, startedAt: null, segments, timesEstimated: false },
  };
}

export const parseVtt = (text: string) => parseCues(text, "vtt");
export const parseSrt = (text: string) => parseCues(text, "srt");

/** About how long a line takes to say, for a file with no times. */
const estimateMs = (text: string) => Math.max(1_500, text.trim().split(/\s+/).length * 400);

/**
 * Lines of `Speaker: text`, with a time before or after the name or on a line of its own:
 *   `[Dana Lee] 00:00:05` then the words (Zoom's text export)
 *   `00:00:05 Dana Lee: words`, `[00:00:05] Dana Lee: words`, `Dana Lee (00:00:05): words`
 *   `Dana Lee: words` (no times: they are estimated)
 * A line with no speaker and no time goes on the line before it.
 */
export function parseText(raw: string): ParseResult {
  const lines = raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const entries: { start: number | null; speaker: string | null; text: string }[] = [];
  let found = 0;
  const push = (start: number | null, speaker: string | null, text: string) => {
    entries.push({ start, speaker, text });
    if (speaker) found++;
  };
  const clock = "((?:\\d{1,3}:)?\\d{1,2}:\\d{2}(?:[.,]\\d{1,3})?)";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") continue;
    // [Speaker] 00:00:05, the words on the next lines.
    const zoom = new RegExp(`^\\[([^\\]]{1,45})\\]\\s+${clock}$`).exec(line);
    if (zoom) {
      const body: string[] = [];
      while (i + 1 < lines.length && lines[i + 1]!.trim() !== "") body.push(lines[++i]!.trim());
      if (body.length > 0) push(parseClock(zoom[2]!), zoom[1]!.trim(), clean(body.join(" ")));
      continue;
    }
    const timeFirst = new RegExp(`^[\\[(]?${clock}[\\])]?\\s+(.+)$`).exec(line);
    const named = new RegExp(`^(.{1,45}?)\\s*[\\[(]${clock}[\\])]\\s*:\\s*(.+)$`).exec(line);
    if (named) {
      push(parseClock(named[2]!), named[1]!.trim(), clean(named[3]!));
      continue;
    }
    if (timeFirst && parseClock(timeFirst[1]!) !== null) {
      const split = splitSpeaker(timeFirst[2]!);
      push(parseClock(timeFirst[1]!), split.speaker, clean(split.text));
      continue;
    }
    const split = splitSpeaker(line);
    if (split.speaker) {
      push(null, split.speaker, clean(split.text));
      continue;
    }
    // A line of more words for the one before.
    const last = entries.at(-1);
    if (last) last.text = clean(`${last.text} ${line}`);
    else return unsupported();
  }
  if (found === 0 || entries.length === 0 || entries.length > MAX_SEGMENTS) return unsupported();
  const timed = entries.filter((entry) => entry.start !== null).length;
  // Some times and some not: the file is not what this reads.
  if (timed !== 0 && timed !== entries.length) return unsupported();
  const estimated = timed === 0;
  let at = 0;
  const segments: ImportedSegment[] = entries.map((entry, i) => {
    const start = entry.start ?? at;
    const next = entries[i + 1]?.start;
    const end = estimated
      ? start + estimateMs(entry.text)
      : Math.max(start + 1, next ?? start + estimateMs(entry.text));
    at = end;
    return { startMs: start, endMs: end, speaker: entry.speaker, text: entry.text };
  });
  return {
    ok: true,
    transcript: {
      format: "text",
      title: null,
      startedAt: null,
      segments,
      timesEstimated: estimated,
    },
  };
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

function jsonTime(entry: Record<string, unknown>, keys: [string, string]): number | null {
  const [plain, ms] = keys;
  const inMs = num(entry[ms]) ?? num(entry[ms.replace(/Ms$/, "_ms")]);
  if (inMs !== null) return Math.round(inMs);
  const seconds = num(entry[plain]);
  return seconds === null ? null : Math.round(seconds * 1000);
}

/** `{"segments":[{"start":0,"end":3.2,"speaker":"Dana","text":"..."}]}`, or the list alone. Times are seconds, or milliseconds in `startMs` and `endMs`. */
export function parseJson(raw: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return unsupported();
  }
  const root = value as Record<string, unknown> | unknown[] | null;
  const list = Array.isArray(root)
    ? root
    : Array.isArray(root?.segments)
      ? (root.segments as unknown[])
      : null;
  if (!list || list.length === 0 || list.length > MAX_SEGMENTS) return unsupported();
  const segments: ImportedSegment[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) return unsupported();
    const entry = item as Record<string, unknown>;
    const start = jsonTime(entry, ["start", "startMs"]);
    const end = jsonTime(entry, ["end", "endMs"]);
    const textValue = entry.text ?? entry.content;
    if (start === null || typeof textValue !== "string") return unsupported();
    const words = clean(textValue);
    if (words === "") continue;
    const who = entry.speaker ?? entry.speaker_name ?? entry.speakerName ?? entry.name;
    segments.push({
      startMs: start,
      endMs: Math.max(start + 1, end ?? start + estimateMs(words)),
      speaker: typeof who === "string" && who.trim() !== "" ? clean(who) : null,
      text: words,
    });
  }
  if (segments.length === 0) return unsupported();
  const top = Array.isArray(root) ? null : root;
  const title =
    typeof top?.title === "string" && top.title.trim() !== ""
      ? clean(top.title).slice(0, 200)
      : null;
  const when = top?.startedAt ?? top?.started_at ?? top?.date;
  const at =
    typeof when === "string" ? Date.parse(when) : typeof when === "number" ? when : Number.NaN;
  return {
    ok: true,
    transcript: {
      format: "json",
      title,
      startedAt: Number.isFinite(at) ? at : null,
      segments,
      timesEstimated: false,
    },
  };
}

/** Which parser to use: the file's start and its name. */
export function parseTranscriptFile(raw: string, fileName: string): ParseResult {
  const head = raw.replace(/^\uFEFF/, "").trimStart();
  const lower = fileName.toLowerCase();
  if (/^WEBVTT/.test(head) || lower.endsWith(".vtt")) return parseVtt(raw);
  if (head.startsWith("{") || head.startsWith("[{") || lower.endsWith(".json"))
    return parseJson(raw);
  if (
    lower.endsWith(".srt") ||
    /^\d+\s*\n\s*(?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->/.test(head)
  )
    return parseSrt(raw);
  return parseText(raw);
}

/** A date in the file name, as the apps that export transcripts write it: `GMT20261121-100000`, `2026-11-21 10.00`. */
export function dateFromFileName(fileName: string): number | null {
  const zoom = /GMT(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(fileName);
  if (zoom) return Date.UTC(+zoom[1]!, +zoom[2]! - 1, +zoom[3]!, +zoom[4]!, +zoom[5]!, +zoom[6]!);
  const iso = /(\d{4})-(\d{2})-(\d{2})(?:[ T_](\d{2})[.:-](\d{2}))?/.exec(fileName);
  if (iso) {
    const at = new Date(+iso[1]!, +iso[2]! - 1, +iso[3]!, +(iso[4] ?? 0), +(iso[5] ?? 0)).getTime();
    return Number.isFinite(at) ? at : null;
  }
  return null;
}
