import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  PROFILE_MILESTONES,
  PROFILE_MIN_SESSIONS,
  PROFILE_PASSAGES,
  PROFILE_PROMPT_DAYS,
  PROFILE_SAMPLE_DAYS,
  STYLE_CATEGORIES,
  type ProfileMeasure,
  type StyleCategory,
  type VoiceProfileView,
} from "@murmur/shared";

// The Voice Profile (PZ-15 to PZ-17). Learns from the final text of each dictation; keeps
// numbers per dictation for 30 days and phrase counts of two to four words, never sentences.

const DAY_MS = 24 * 60 * 60_000;
/** Recent raw and final text per category, for the My Voice page (PZ-17). */
export function recentExamples(
  db: DatabaseSync,
  now: number,
  perCategory = 3,
): VoiceProfileView["examples"] {
  const rows = db
    .prepare(
      `SELECT raw_text, final_text, created_at, style_id FROM history
       WHERE created_at >= ? AND insert_status = 'inserted' AND raw_text IS NOT NULL
         AND final_text IS NOT NULL AND final_text != '' AND style_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 300`,
    )
    .all(now - PROFILE_SAMPLE_DAYS * DAY_MS) as {
    raw_text: string;
    final_text: string;
    created_at: number;
    style_id: string;
  }[];
  const examples = Object.fromEntries(
    STYLE_CATEGORIES.map((category) => [
      category,
      [] as VoiceProfileView["examples"][StyleCategory],
    ]),
  ) as VoiceProfileView["examples"];
  for (const row of rows) {
    const category = row.style_id.replace(/^style-/, "") as StyleCategory;
    const list = examples[category];
    if (list && list.length < perCategory) {
      list.push({ raw: row.raw_text, final: row.final_text, at: row.created_at });
    }
  }
  return examples;
}

/** Phrases kept; trimmed back to this when the list grows to twice its size. */
const MAX_PHRASES = 200;
const FILLERS = /\b(um+|uh+|er+m?|hmm+|you know|i mean|sort of|kind of)\b/gi;
const STOP = new Set(
  "a an and are as at be but by for from had has have he her his i if in is it its me my of on or our she so that the their them then there they this to was we were what when which who will with you your".split(
    " ",
  ),
);

export interface SampleCounts {
  words: number;
  sentences: number;
  commas: number;
  fullStops: number;
  exclamations: number;
  questions: number;
  capitalStarts: number;
  fillers: number;
}

/** The numbers kept for one dictation. */
export function measure(finalText: string, rawText: string): SampleCounts {
  const words = finalText.split(/\s+/).filter(Boolean);
  const sentences = finalText
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => /\p{L}/u.test(part));
  return {
    words: words.length,
    sentences: sentences.length,
    commas: (finalText.match(/,/g) ?? []).length,
    fullStops: (finalText.match(/(?<![.])\.(?![.\d])/g) ?? []).length,
    exclamations: (finalText.match(/!/g) ?? []).length,
    questions: (finalText.match(/\?/g) ?? []).length,
    capitalStarts: sentences.filter((sentence) => /^\p{Lu}/u.test(sentence)).length,
    fillers: (rawText.match(FILLERS) ?? []).length,
  };
}

/** Phrases of two to four words, lower case, not made only of common words. */
export function phrasesOf(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.toLowerCase().split(/[.!?,;:\n]+/)) {
    const words = sentence.match(/[\p{L}\p{N}'’]+/gu) ?? [];
    for (let size = 2; size <= 4; size++) {
      for (let start = 0; start + size <= words.length; start++) {
        const phrase = words.slice(start, start + size);
        if (phrase.every((word) => STOP.has(word))) continue;
        if (STOP.has(phrase[0]!) && STOP.has(phrase.at(-1)!)) continue;
        out.push(phrase.join(" "));
      }
    }
  }
  return out;
}

interface Stored {
  totalWords: number;
  phrases: Record<string, number>;
  milestones: { words: number; at: number }[];
  lastPromptAt: number | null;
}

const EMPTY: Stored = { totalWords: 0, phrases: {}, milestones: [], lastPromptAt: null };

export interface LearnInput {
  historyId: string | null;
  createdAt: number;
  category: StyleCategory;
  rawText: string;
  finalText: string;
}

export interface VoiceProfile {
  /** Learns from one inserted dictation; returns a milestone reached by it, if any. */
  learn(input: LearnInput): number | null;
  /** What the cleanup model is told, or null below the minimum or with nothing to say. */
  summary(now: number): string | null;
  view(now: number, examples: VoiceProfileView["examples"]): VoiceProfileView;
  /** True when a weekly passage prompt is due; marks it as shown. */
  takePrompt(now: number): boolean;
  reset(): void;
}

interface Totals {
  sessions: number;
  words: number;
  sentences: number;
  commas: number;
  exclamations: number;
  capitalStarts: number;
  fillers: number;
}

export function createVoiceProfile(
  db: DatabaseSync,
  newId: () => string = randomUUID,
): VoiceProfile {
  const read = db.prepare("SELECT profile_json FROM voice_profiles WHERE id = 'me'");
  const write = db.prepare(
    `INSERT INTO voice_profiles (id, profile_json, updated_at) VALUES ('me', ?, ?)
     ON CONFLICT (id) DO UPDATE SET profile_json = excluded.profile_json, updated_at = excluded.updated_at`,
  );
  const addSample = db.prepare(
    `INSERT INTO voice_samples (id, history_id, created_at, category, words, sentences, commas,
       full_stops, exclamations, questions, capital_starts, fillers)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const prune = db.prepare("DELETE FROM voice_samples WHERE created_at < ?");
  const totals = db.prepare(
    `SELECT count(*) AS sessions, coalesce(sum(words), 0) AS words,
       coalesce(sum(sentences), 0) AS sentences, coalesce(sum(commas), 0) AS commas,
       coalesce(sum(exclamations), 0) AS exclamations,
       coalesce(sum(capital_starts), 0) AS capitalStarts, coalesce(sum(fillers), 0) AS fillers
     FROM voice_samples WHERE created_at >= ?`,
  );

  const load = (): Stored => {
    const row = read.get() as { profile_json: string } | undefined;
    return row ? { ...EMPTY, ...(JSON.parse(row.profile_json) as Partial<Stored>) } : { ...EMPTY };
  };
  const save = (stored: Stored, at: number) => write.run(JSON.stringify(stored), at);
  const recent = (now: number) =>
    totals.get(now - PROFILE_SAMPLE_DAYS * DAY_MS) as unknown as Totals;

  function measures(t: Totals): ProfileMeasure[] {
    const enough = t.sessions >= PROFILE_MIN_SESSIONS && t.words > 0;
    const per100 = (count: number) => (count / t.words) * 100;
    const show = (value: string) => (enough ? value : null);
    return [
      {
        id: "sentence-length",
        label: "Words per sentence",
        value: show(t.sentences > 0 ? (t.words / t.sentences).toFixed(1) : "0"),
      },
      { id: "commas", label: "Commas per 100 words", value: show(per100(t.commas).toFixed(1)) },
      {
        id: "exclamations",
        label: "Exclamation marks per 100 words",
        value: show(per100(t.exclamations).toFixed(1)),
      },
      {
        id: "capitals",
        label: "Sentences starting with a capital",
        value: show(`${Math.round((t.capitalStarts / Math.max(1, t.sentences)) * 100)}%`),
      },
      {
        id: "fillers",
        label: "Fillers per 100 words said",
        value: show(per100(t.fillers).toFixed(1)),
      },
    ];
  }

  const topPhrases = (stored: Stored, count: number) =>
    Object.entries(stored.phrases)
      .filter(([, seen]) => seen >= 3)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, count)
      .map(([phrase]) => phrase);

  function summary(now: number): string | null {
    const t = recent(now);
    if (t.sessions < PROFILE_MIN_SESSIONS || t.words === 0) return null;
    const notes: string[] = [];
    const length = t.sentences > 0 ? t.words / t.sentences : 0;
    if (length > 0) {
      notes.push(
        length < 10
          ? `Writes short sentences (about ${Math.round(length)} words).`
          : length > 20
            ? `Writes long sentences (about ${Math.round(length)} words).`
            : `Writes sentences of about ${Math.round(length)} words.`,
      );
    }
    const commas = (t.commas / t.words) * 100;
    if (commas < 2) notes.push("Rarely uses commas.");
    else if (commas > 7) notes.push("Uses many commas.");
    if ((t.exclamations / t.words) * 100 > 1) notes.push("Often uses exclamation marks.");
    const phrases = topPhrases(load(), 5);
    if (phrases.length > 0) notes.push(`Often says: ${phrases.map((p) => `"${p}"`).join(", ")}.`);
    return notes.length > 0 ? notes.join(" ") : null;
  }

  return {
    learn(input) {
      if (input.finalText.trim() === "") return null;
      const counts = measure(input.finalText, input.rawText);
      addSample.run(
        newId(),
        input.historyId,
        input.createdAt,
        input.category,
        counts.words,
        counts.sentences,
        counts.commas,
        counts.fullStops,
        counts.exclamations,
        counts.questions,
        counts.capitalStarts,
        counts.fillers,
      );
      prune.run(input.createdAt - PROFILE_SAMPLE_DAYS * DAY_MS);
      const stored = load();
      const before = stored.totalWords;
      stored.totalWords += counts.words;
      for (const phrase of phrasesOf(input.finalText)) {
        stored.phrases[phrase] = (stored.phrases[phrase] ?? 0) + 1;
      }
      // Kept small: the most used phrases only.
      if (Object.keys(stored.phrases).length > MAX_PHRASES * 2) {
        stored.phrases = Object.fromEntries(
          Object.entries(stored.phrases)
            .sort((a, b) => b[1] - a[1])
            .slice(0, MAX_PHRASES),
        );
      }
      const reached =
        PROFILE_MILESTONES.find((mark) => before < mark && stored.totalWords >= mark) ?? null;
      if (reached !== null) stored.milestones.push({ words: reached, at: input.createdAt });
      save(stored, input.createdAt);
      return reached;
    },

    summary,

    view(now, examples) {
      const stored = load();
      const t = recent(now);
      return {
        sessions: t.sessions,
        totalWords: stored.totalWords,
        measures: measures(t),
        topPhrases: topPhrases(stored, 10),
        summary: summary(now),
        milestones: stored.milestones,
        examples,
        passage:
          PROFILE_PASSAGES[
            Math.floor(now / (PROFILE_PROMPT_DAYS * DAY_MS)) % PROFILE_PASSAGES.length
          ]!,
      };
    },

    takePrompt(now) {
      const stored = load();
      if (recent(now).sessions < 5) return false;
      if (
        stored.lastPromptAt !== null &&
        now - stored.lastPromptAt < PROFILE_PROMPT_DAYS * DAY_MS
      ) {
        return false;
      }
      stored.lastPromptAt = now;
      save(stored, now);
      return true;
    },

    reset() {
      db.exec("DELETE FROM voice_samples; DELETE FROM voice_profiles;");
    },
  };
}
