import { describe, expect, it } from "vitest";
import { PROFILE_MIN_SESSIONS } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createVoiceProfile, measure, phrasesOf } from "./voice-profile";

describe("voice profile", () => {
  it("measures a dictation without keeping its text", () => {
    expect(
      measure("Sounds good. See you at five, ok? Great!", "um sounds good uh see you"),
    ).toEqual({
      words: 8,
      sentences: 3,
      commas: 1,
      fullStops: 1,
      exclamations: 1,
      questions: 1,
      capitalStarts: 3,
      fillers: 2,
    });
    expect(phrasesOf("Send the notes tonight.")).toContain("send the notes");
    expect(phrasesOf("Send the notes tonight.").every((p) => p.split(" ").length <= 4)).toBe(true);
  });

  it("summarises after enough dictations, stores no sentences, and resets", () => {
    const db = openDatabase(":memory:");
    const profile = createVoiceProfile(db);
    const now = 1_000_000_000;
    for (let index = 0; index < PROFILE_MIN_SESSIONS - 1; index++) {
      profile.learn({
        historyId: null,
        createdAt: now,
        category: "work",
        rawText: "send the notes tonight",
        finalText: "Send the notes tonight. Thanks a lot.",
      });
    }
    expect(profile.summary(now)).toBeNull();
    profile.learn({
      historyId: null,
      createdAt: now,
      category: "work",
      rawText: "send the notes tonight",
      finalText: "Send the notes tonight. Thanks a lot.",
    });
    expect(profile.summary(now)).toContain("Writes short sentences (about 4 words).");
    expect(profile.summary(now)).toContain('"send the notes"');
    const stored = JSON.stringify(db.prepare("SELECT * FROM voice_profiles").all());
    expect(stored).not.toContain("Send the notes tonight.");
    profile.reset();
    expect(profile.summary(now)).toBeNull();
    expect(profile.view(now, { personal: [], work: [], email: [], other: [] }).totalWords).toBe(0);
  });

  it("marks the 1,000-word milestone once and prompts at most weekly", () => {
    const profile = createVoiceProfile(openDatabase(":memory:"));
    const long = Array.from({ length: 600 }, () => "word").join(" ");
    const learn = (at: number) =>
      profile.learn({
        historyId: null,
        createdAt: at,
        category: "other",
        rawText: long,
        finalText: long,
      });
    expect(learn(1)).toBeNull();
    expect(learn(2)).toBe(1_000);
    expect(learn(3)).toBeNull();
    for (let index = 0; index < 5; index++) learn(4);
    expect(profile.takePrompt(10)).toBe(true);
    expect(profile.takePrompt(11)).toBe(false);
    expect(profile.takePrompt(10 + 7 * 24 * 60 * 60_000)).toBe(true);
  });
});
