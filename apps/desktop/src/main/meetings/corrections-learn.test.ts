import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/database";
import { createCorrectionLearner } from "../dictionary/learn";
import { createDictionaryStore } from "../dictionary/dictionary-store";
import { changedWords, suggestFromCorrection } from "./corrections-learn";

describe("changedWords", () => {
  it.each([
    ["we ship on Thursday", "we ship on Friday", "Thursday", "Friday"],
    [
      "ask Dana about the kube cuddle setup",
      "ask Dana about the kubectl setup",
      "kube cuddle",
      "kubectl",
    ],
    ["same words", "same words", "", ""],
    ["a b c", "a x y b c", "", "x y"],
    ["one two three", "one", "two three", ""],
  ])("finds the change in %s", (before, after, from, to) => {
    expect(changedWords(before, after)).toEqual({ before: from, after: to });
  });
});

describe("suggestFromCorrection", () => {
  it("offers a small change to the learner", () => {
    const learn = vi
      .fn()
      .mockReturnValue({ kind: "replacement", spoken: "kube cuddle", written: "kubectl" });
    expect(
      suggestFromCorrection(
        { learn },
        "run the kube cuddle command now",
        "run the kubectl command now",
      ),
    ).toEqual({
      spoken: "kube cuddle",
      written: "kubectl",
    });
    expect(learn).toHaveBeenCalledWith(
      { before: "kube cuddle", after: "kubectl" },
      "run the kube cuddle command now",
    );
  });

  it("offers nothing for a deletion or an addition, or when nothing was learned", () => {
    const learn = vi.fn().mockReturnValue(null);
    expect(suggestFromCorrection({ learn }, "one two three", "one")).toBeNull();
    expect(suggestFromCorrection({ learn }, "one", "one two three")).toBeNull();
    expect(learn).not.toHaveBeenCalled();
    expect(suggestFromCorrection({ learn }, "say foo now", "say bar now")).toBeNull();
    expect(learn).toHaveBeenCalledOnce();
  });

  it("adds a word to the Dictionary for review the second time it is changed the same way", () => {
    const db = openDatabase(":memory:");
    const dictionary = createDictionaryStore(db);
    const learner = createCorrectionLearner(db, dictionary, () => 1);
    expect(
      suggestFromCorrection(
        learner,
        "please open the kube cuddle docs for the team today",
        "please open the kubectl docs for the team today",
      ),
    ).toBeNull();
    expect(dictionary.list()).toHaveLength(0);
    expect(
      suggestFromCorrection(
        learner,
        "we need the kube cuddle binary on every machine here",
        "we need the kubectl binary on every machine here",
      ),
    ).toEqual({ spoken: "kube cuddle", written: "kubectl" });
    expect(dictionary.list()).toMatchObject([{ term: "kube cuddle", replacement: "kubectl" }]);
  });
});
