import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { createDictionaryStore } from "./dictionary-store";
import { candidatePhrases, createPhraseLearner, PHRASE_LIMITS } from "./phrases";

const DAY = 24 * 60 * 60_000;

function setup() {
  const db = openDatabase(":memory:");
  let time = 1_000;
  let id = 0;
  const dictionary = createDictionaryStore(
    db,
    () => time,
    () => `d${++id}`,
  );
  const learner = createPhraseLearner(db, dictionary, () => time);
  return {
    db,
    dictionary,
    learner,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("phrase learning", () => {
  it("counts capitalised runs of two to four words, not sentence starts or common words", () => {
    expect(candidatePhrases("The plan for Harbour Lights Migration is ready.")).toEqual([
      "Harbour Lights",
      "Harbour Lights Migration",
      "Lights Migration",
    ]);
    expect(candidatePhrases("Harbour Lights is late. Thanks Priya Shah")).toEqual(["Priya Shah"]);
    expect(candidatePhrases("we met Sam on Friday at Blue Door Cafe And More Things")).toEqual([
      "Blue Door",
      "Blue Door Cafe",
      "Door Cafe",
      "Door Cafe And More",
      "Cafe And More",
      "Cafe And More Things",
      "More Things",
    ]);
    expect(candidatePhrases("see you next week")).toEqual([]);
  });

  it("learns a phrase said three times in 14 days, longest form only", () => {
    const { learner, dictionary, advance } = setup();
    const said = "Status of Harbour Lights Migration today.";
    expect(learner.learn(said)).toEqual([]);
    advance(DAY);
    expect(learner.learn(said)).toEqual([]);
    advance(DAY);
    expect(learner.learn(said)).toEqual(["Harbour Lights Migration"]);
    const entry = dictionary.list().find((item) => item.term === "Harbour Lights Migration");
    expect(entry).toMatchObject({ kind: "phrase", source: "auto" });
    expect(dictionary.list()).toHaveLength(1);
  });

  it("starts again after 14 days and stores no phrase longer than four words", () => {
    const { learner, db, advance } = setup();
    learner.learn("Notes on Alpha Beta Gamma Delta Epsilon.");
    advance(15 * DAY);
    learner.learn("Notes on Alpha Beta Gamma Delta Epsilon.");
    advance(DAY);
    expect(learner.learn("Notes on Alpha Beta Gamma Delta Epsilon.")).toEqual([]);
    const stored = db.prepare("SELECT phrase, seen FROM phrase_counts").all() as {
      phrase: string;
      seen: number;
    }[];
    expect(stored.every((row) => row.phrase.split(" ").length <= PHRASE_LIMITS.maxWords)).toBe(
      true,
    );
    expect(stored.find((row) => row.phrase === "Alpha Beta")?.seen).toBe(2);
  });
});
