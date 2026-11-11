import { describe, expect, it } from "vitest";
import { DEFAULT_JARGON_PACKS, JARGON_LIMITS, JARGON_PACKS } from "@murmur/shared";
import { applyReplacements, keepSpellings } from "../dictionary/apply";
import { BUNDLED_PACKS, developerVocabulary } from "./packs";

describe("jargon packs", () => {
  it("ships one valid file per pack, within the size limit, with heard forms for its own terms", () => {
    expect(BUNDLED_PACKS.map((pack) => pack.id)).toEqual(JARGON_PACKS.map((pack) => pack.id));
    for (const pack of BUNDLED_PACKS) {
      expect(pack.terms.length).toBeGreaterThan(20);
      expect(pack.terms.length).toBeLessThanOrEqual(JARGON_LIMITS.termsPerPack);
      for (const term of Object.keys(pack.heard)) expect(pack.terms).toContain(term);
    }
  });

  it("uses only the packs that are on, taking prompt terms from each in turn", () => {
    const vocabulary = developerVocabulary(DEFAULT_JARGON_PACKS);
    expect(vocabulary.packs).toEqual(["git", "packages", "web"]);
    expect(vocabulary.promptTerms.slice(0, 3)).toEqual(["git", "npm", "TypeScript"]);
    expect(vocabulary.promptTerms).not.toContain("kubectl");
    const cloud = developerVocabulary({ ...DEFAULT_JARGON_PACKS, cloud: true });
    expect(cloud.promptTerms).toContain("kubectl");
    const none = developerVocabulary({
      git: false,
      packages: false,
      web: false,
      cloud: false,
      databases: false,
    });
    expect(none).toEqual({ packs: [], promptTerms: [], spellings: [], replacements: [] });
  });

  it("writes misheard forms and other cases as the pack spells them", () => {
    const vocabulary = developerVocabulary({ ...DEFAULT_JARGON_PACKS, cloud: true });
    const heard = applyReplacements("run cube control apply", vocabulary.replacements).text;
    expect(heard).toBe("run kubectl apply");
    expect(keepSpellings("Kubectl and github", vocabulary.spellings).text).toBe(
      "kubectl and GitHub",
    );
  });
});
