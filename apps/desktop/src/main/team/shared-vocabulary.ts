import { DICTIONARY_LIMITS, markdownToRich, richToPlain, type Snippet } from "@murmur/shared";
import type { ReplacementRule, SpellingRule } from "../dictionary/apply";
import type { DictionaryRules } from "../dictionary/dictionary-store";

/**
 * The team's shared dictionary and snippets, laid over a person's own (TM-06). Nothing is written
 * to the personal tables: the shared entries are held here, read-only, and combined when
 * dictation asks. A personal entry always wins over a shared one for the same term or trigger.
 */
export interface SharedEntry {
  id: string;
  term: string;
  replacement: string | null;
  pronunciation: string;
}
export interface SharedSnippet {
  id: string;
  trigger: string;
  expansion: string;
  format: "plain" | "markdown";
  locked: boolean;
}
/** What one team's `merged` answer holds. */
export interface SharedSet {
  teamName: string;
  me: string;
  dictionary: SharedEntry[];
  snippets: SharedSnippet[];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Lower case, letters and digits only, single spaces: how triggers are compared. */
const triggerKey = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const pad = (n: number) => String(n).padStart(2, "0");

/** `{{date}}`, `{{me}}` and `{{team}}` are the only variables a shared snippet may hold. */
export function expandVariables(
  text: string,
  values: { date: string; me: string; team: string },
): string {
  return text.replace(/\{\{\s*(date|me|team)\s*\}\}/gi, (_m, name: string) => {
    const key = name.toLowerCase() as "date" | "me" | "team";
    return values[key];
  });
}

export function createSharedVocabulary(now: () => number = Date.now) {
  let sets: SharedSet[] = [];

  /** The first set that has a term or trigger wins, so an earlier team comes before a later one. */
  const dictionary = (): { entry: SharedEntry }[] => {
    const seen = new Set<string>();
    const out: { entry: SharedEntry }[] = [];
    for (const set of sets)
      for (const entry of set.dictionary) {
        const key = entry.term.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ entry });
      }
    return out;
  };

  return {
    set(next: readonly SharedSet[]): void {
      sets = [...next];
    },
    clear(): void {
      sets = [];
    },
    counts(): { dictionary: number; snippets: number } {
      const triggers = new Set(
        sets.flatMap((set) => set.snippets.map((s) => triggerKey(s.trigger))),
      );
      return { dictionary: dictionary().length, snippets: triggers.size };
    },

    /** The personal rules with the shared ones added after them. */
    rules(personal: DictionaryRules): DictionaryRules {
      if (sets.length === 0) return personal;
      const mine = [
        ...personal.spellings.map((rule) => rule.term),
        ...personal.replacements.map((rule) => rule.term),
      ];
      const spellings: SpellingRule[] = [...personal.spellings];
      const replacements: ReplacementRule[] = [...personal.replacements];
      const promptTerms = [...personal.promptTerms];
      for (const { entry } of dictionary()) {
        if (mine.some((term) => same(term, entry.term))) continue;
        if (entry.replacement === null) {
          spellings.push({ id: `team:${entry.id}`, term: entry.term });
          promptTerms.push(entry.term);
        } else
          replacements.push({
            id: `team:${entry.id}`,
            term: entry.term,
            replacement: entry.replacement,
            caseSensitive: false,
          });
      }
      return {
        ...personal,
        promptTerms: promptTerms.slice(0, DICTIONARY_LIMITS.promptTerms + personal.starredCount),
        spellings,
        replacements,
      };
    },

    /** The personal snippets with the shared ones added, their variables filled in for today. */
    snippets(personal: readonly Snippet[]): Snippet[] {
      if (sets.length === 0) return [...personal];
      const taken = new Set(personal.map((snippet) => triggerKey(snippet.trigger)));
      const date = new Date(now());
      const today = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      const out = [...personal];
      for (const set of sets)
        for (const shared of set.snippets) {
          const key = triggerKey(shared.trigger);
          if (key === "" || taken.has(key)) continue;
          taken.add(key);
          const text = expandVariables(shared.expansion, {
            date: today,
            me: set.me,
            team: set.teamName,
          });
          const rich = shared.format === "markdown" ? markdownToRich(text) : null;
          out.push({
            id: `team:${shared.id}`,
            trigger: shared.trigger,
            format: rich ? "rich_json" : "plain",
            plain: rich ? richToPlain(rich) : text,
            rich,
            useCount: 0,
            createdAt: 0,
            updatedAt: 0,
          });
        }
      return out;
    },
  };
}

export type SharedVocabulary = ReturnType<typeof createSharedVocabulary>;
