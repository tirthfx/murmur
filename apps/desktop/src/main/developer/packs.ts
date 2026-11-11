import { z } from "zod";
import { JARGON_LIMITS, JARGON_PACKS, type JargonPackId, type JargonPacks } from "@murmur/shared";
import type { ReplacementRule, SpellingRule } from "../dictionary/apply";
import cloud from "./packs/cloud.json";
import databases from "./packs/databases.json";
import git from "./packs/git.json";
import packages from "./packs/packages.json";
import web from "./packs/web.json";

// Jargon packs (PZ-27): Murmur's own term lists, shipped as plain JSON. Each term is kept as
// written; "heard" lists what speech recognition often makes of it.

const packSchema = z.strictObject({
  id: z.enum(JARGON_PACKS.map((pack) => pack.id) as [JargonPackId, ...JargonPackId[]]),
  terms: z.array(z.string().min(1).max(60)).max(JARGON_LIMITS.termsPerPack),
  heard: z.record(z.string(), z.array(z.string().min(1).max(60))),
});
export type JargonPack = z.infer<typeof packSchema>;

/** Every bundled pack, checked once when main loads. A bad file fails loudly in tests. */
export const BUNDLED_PACKS: JargonPack[] = [git, packages, web, cloud, databases].map((file) =>
  packSchema.parse(file),
);

/** What the enabled packs add to a dictation in a Developer app. */
export interface DeveloperVocabulary {
  packs: JargonPackId[];
  /** For the speech prompt, taken in turn from each pack so every pack gets a share. */
  promptTerms: string[];
  /** Written exactly as in the pack ("github" becomes "GitHub"). */
  spellings: SpellingRule[];
  /** Misheard forms to the term ("cube control" becomes "kubectl"). */
  replacements: ReplacementRule[];
}

export function developerVocabulary(
  enabled: JargonPacks,
  packs: readonly JargonPack[] = BUNDLED_PACKS,
): DeveloperVocabulary {
  const on = packs.filter((pack) => enabled[pack.id]);
  const promptTerms: string[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...on.map((pack) => pack.terms.length));
  for (let index = 0; index < longest; index++) {
    for (const pack of on) {
      const term = pack.terms[index];
      if (term === undefined || seen.has(term.toLowerCase())) continue;
      seen.add(term.toLowerCase());
      promptTerms.push(term);
    }
  }
  return {
    packs: on.map((pack) => pack.id),
    promptTerms,
    spellings: promptTerms.map((term) => ({ id: `pack:${term}`, term })),
    // Longer forms first, so "cube c t l" wins over a shorter form inside it.
    replacements: on
      .flatMap((pack) =>
        Object.entries(pack.heard).flatMap(([term, forms]) =>
          forms.map((form) => ({
            id: `pack:${term}`,
            term: form,
            replacement: term,
            caseSensitive: false,
          })),
        ),
      )
      .sort((a, b) => b.term.length - a.term.length),
  };
}
