import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { createDictionaryStore } from "./dictionary-store";
import { createCorrectionLearner, judgeCorrection } from "./learn";

const inserted = "Deploy it to Kube net is today, then tell the github team.";

describe("judging a correction", () => {
  it("takes one to three changed words", () => {
    expect(judgeCorrection({ before: "Kube net is", after: "Kubernetes" }, inserted)).toEqual({
      kind: "replacement",
      spoken: "Kube net is",
      written: "Kubernetes",
    });
    expect(judgeCorrection({ before: "github", after: "GitHub" }, inserted)).toEqual({
      kind: "spelling",
      term: "GitHub",
    });
  });

  it("ignores deletions, rewrites, punctuation and big replacements", () => {
    expect(judgeCorrection({ before: "today,", after: "" }, inserted)).toBeNull();
    expect(judgeCorrection({ before: "today,", after: "today." }, inserted)).toBeNull();
    expect(
      judgeCorrection({ before: "then tell the github team", after: "and ping them" }, inserted),
    ).toBeNull();
    expect(judgeCorrection({ before: "Send it now", after: "Ship it" }, "Send it now.")).toBeNull();
  });
});

describe("learning", () => {
  function setup() {
    const db = openDatabase(":memory:");
    const dictionary = createDictionaryStore(db);
    return { dictionary, learner: createCorrectionLearner(db, dictionary) };
  }

  it("adds a replacement the second time, and a spelling at once, marked as learned", () => {
    const { dictionary, learner } = setup();
    const change = { before: "Kube net is", after: "Kubernetes" };
    expect(learner.learn(change, inserted)).toBeNull();
    expect(dictionary.list()).toEqual([]);
    expect(learner.learn(change, inserted)).toMatchObject({ kind: "replacement" });
    expect(learner.learn({ before: "github", after: "GitHub" }, inserted)).toMatchObject({
      kind: "spelling",
    });
    expect(dictionary.list().map((entry) => [entry.term, entry.replacement, entry.source])).toEqual(
      [
        ["GitHub", null, "auto"],
        ["Kube net is", "Kubernetes", "auto"],
      ],
    );
  });
});
