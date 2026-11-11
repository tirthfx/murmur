import { describe, expect, it } from "vitest";
import { MEMORY_LIMITS } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createMemoryStore, hasKeyword, pickKeywords, rememberedFact } from "./memory-store";

function setup() {
  let clock = 1;
  let id = 0;
  return createMemoryStore(
    openDatabase(":memory:"),
    () => clock++,
    () => `m${++id}`,
  );
}

describe("memory", () => {
  it("picks keywords from the text, or keeps the ones typed", () => {
    expect(pickKeywords("Sign emails as Tirth, and the office is in Pune")).toEqual([
      "sign",
      "emails",
      "tirth",
      "office",
      "pune",
    ]);
    const store = setup();
    const typed = store.save({
      text: "Use metric units.",
      keywords: ["Sign off", " "],
      enabled: true,
    });
    expect(typed).toMatchObject({
      ok: true,
      item: { keywords: ["sign off"], autoKeywords: false },
    });
  });

  it("matches keywords as whole words, several words in a row", () => {
    expect(hasKeyword("please sign  off for me", "sign off")).toBe(true);
    expect(hasKeyword("signoff", "sign off")).toBe(false);
    expect(hasKeyword("Pune office", "pune")).toBe(true);
    expect(hasKeyword("Punes", "pune")).toBe(false);
  });

  it("gives only enabled, relevant items, best match first", () => {
    const store = setup();
    store.save({ text: "Sign emails as Tirth.", keywords: ["sign off", "email"], enabled: true });
    store.save({ text: "Office is in Pune.", keywords: null, enabled: true });
    store.save({ text: "Hidden fact about email.", keywords: ["email"], enabled: false });
    expect(store.relevant("time to sign off this email").map((item) => item.text)).toEqual([
      "Sign emails as Tirth.",
    ]);
    expect(store.relevant("nothing here")).toEqual([]);
  });

  it("keeps to the per-dictation budget", () => {
    const store = setup();
    for (let index = 0; index < MEMORY_LIMITS.perDictation + 5; index++) {
      store.save({ text: `Fact ${index} about budget.`, keywords: ["budget"], enabled: true });
    }
    expect(store.relevant("the budget")).toHaveLength(MEMORY_LIMITS.perDictation);
  });

  it("refuses empty, long and too many facts, and deletes", () => {
    const store = setup();
    expect(store.save({ text: " ", keywords: null, enabled: true })).toMatchObject({
      ok: false,
      reason: "empty",
    });
    expect(
      store.save({ text: "x".repeat(MEMORY_LIMITS.textLength + 1), keywords: null, enabled: true }),
    ).toMatchObject({ ok: false, reason: "too-long" });
    const saved = store.save({ text: "A fact.", keywords: null, enabled: true }, "dictation");
    expect(saved).toMatchObject({ ok: true, item: { source: "dictation" } });
    store.remove(saved.ok ? saved.item.id : "");
    expect(store.list()).toEqual([]);
  });

  it("turns 'remember that' into a fact, and nothing else", () => {
    expect(rememberedFact("Remember that I prefer metric units")).toBe("I prefer metric units.");
    expect(rememberedFact("remember that, the office is in Pune.")).toBe("The office is in Pune.");
    expect(rememberedFact("I remember that day")).toBeNull();
    expect(rememberedFact("Remember that")).toBeNull();
  });
});
