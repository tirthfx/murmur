import type { AskSource } from "@murmur/shared";
import { excerpt, type AskHit } from "./ask-index";
import { estimateTokens } from "./summarizer";

/** What the model is given of the meetings: about this many tokens, so the prompt fits the smallest context. */
export const SOURCE_TOKENS = 2_300;
export const ANSWER_TOKENS = 500;

export interface NumberedSource {
  n: number;
  hit: AskHit;
}

const SOURCE_LABEL: Record<AskSource, string> = {
  transcript: "transcript",
  summary: "summary",
  notes: "the owner's notes",
  task: "task",
};

const dateOf = (at: number) =>
  new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const clock = (ms: number) => {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

/** The best hits, in order, numbered from 1, as many as fit the budget. */
export function numberSources(hits: readonly AskHit[], budget = SOURCE_TOKENS): NumberedSource[] {
  const out: NumberedSource[] = [];
  let used = 0;
  for (const hit of hits) {
    const cost = estimateTokens(hit.text) + 30;
    if (out.length > 0 && used + cost > budget) continue;
    used += cost;
    out.push({ n: out.length + 1, hit });
  }
  return out;
}

export const SYSTEM = [
  "You answer a question about the owner's meetings using only the numbered sources you are given.",
  "Each source is marked [1], [2] and so on, with the meeting it is from. Use only what the sources say. Never guess and never add what you know from elsewhere.",
  "End every sentence of the answer with the number or numbers of the sources it comes from, like [2] or [1][3]. Owner lines are the person who owns these notes and Remote lines are everyone else.",
  "If the sources do not answer the question, reply with exactly NOT_SUPPORTED and nothing else.",
  "Keep the answer short: at most 120 words. Write in the language of the question.",
].join("\n");

/** `askPrompt` says today's date so "last Tuesday" can be matched with a meeting's date. */
export function askPrompt(
  question: string,
  sources: readonly NumberedSource[],
  today: number = Date.now(),
  /** The days the question asked about ("17 Nov 2026"): the sources were already limited to them. */
  period: string | null = null,
): string {
  const blocks = sources.map(({ n, hit }) => {
    const where = `${hit.meetingTitle}, ${dateOf(hit.meetingStartedAt)}, ${SOURCE_LABEL[hit.source]}${
      hit.startMs !== null ? ` at ${clock(hit.startMs)}` : ""
    }`;
    return `[${n}] (${where})\n${hit.text}`;
  });
  const day = new Date(today).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const limited = period
    ? ` The sources were already limited to meetings from ${period}, as the question asked: do not look for that date in the text.`
    : "";
  return `Today is ${day}.${limited}\n\nSources:\n\n${blocks.join("\n\n")}\n\nQuestion: ${question}`;
}

export type ParsedAnswer =
  | { kind: "unsupported"; reason: "model" | "uncited" }
  | { kind: "answer"; text: string; cited: number[]; dropped: number[] };

/** `[2]`, or `[1, 3]` the way the model sometimes writes several. */
const MARK = /\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\]/g;

/**
 * Turns what the model wrote into the answer that is kept. A citation number that is not one of
 * the sources is removed (and reported in `dropped`). An answer with no valid citation left is
 * not accepted: it rests on nothing, so it counts as "not supported".
 */
export function parseAnswer(output: string, sourceCount: number): ParsedAnswer {
  const text = output.trim();
  if (/^["'`*]*NOT_SUPPORTED\b/i.test(text) || text === "")
    return { kind: "unsupported", reason: "model" };
  const cited = new Set<number>();
  const dropped: number[] = [];
  const body = text
    .replace(MARK, (_match, list: string) => {
      const numbers = list.split(/[,;]/).map((part) => Number(part.trim()));
      const valid = numbers.filter((n) => n >= 1 && n <= sourceCount);
      for (const n of numbers) if (!valid.includes(n)) dropped.push(n);
      for (const n of valid) cited.add(n);
      return [...new Set(valid)].map((n) => `[${n}]`).join("");
    })
    // A mark that went with a dropped number leaves a space before punctuation.
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (cited.size === 0 || body === "") return { kind: "unsupported", reason: "uncited" };
  return { kind: "answer", text: body, cited: [...cited].sort((a, b) => a - b), dropped };
}

export const UNSUPPORTED_WITH_CLOSEST =
  "I could not find an answer to that in your meetings. These are the closest ones I checked.";
export const UNSUPPORTED_NOTHING = "I found nothing about that in the meetings I looked in.";

export const sourceExcerpt = (hit: AskHit) => excerpt(hit.text);
