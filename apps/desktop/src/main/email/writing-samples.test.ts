import { describe, expect, it } from "vitest";
import { EMAIL_LIMITS } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createWritingSampleStore } from "./writing-samples";

function setup() {
  let clock = 1;
  let id = 0;
  return createWritingSampleStore(
    openDatabase(":memory:"),
    () => clock++,
    () => `w${++id}`,
  );
}

describe("writing samples", () => {
  it("keeps a labelled sample and lists samples oldest first", () => {
    const store = setup();
    const first = store.save({ label: " Work email ", text: "Hi team,\r\nThanks.\n" });
    expect(first).toEqual({
      ok: true,
      sample: { id: "w1", label: "Work email", text: "Hi team,\nThanks.", bytes: 16, createdAt: 1 },
    });
    store.save({ label: "Newsletter", text: "Dear readers" });
    expect(store.list().map((sample) => sample.label)).toEqual(["Work email", "Newsletter"]);
    store.remove("w1");
    expect(store.list().map((sample) => sample.id)).toEqual(["w2"]);
  });

  it("refuses a 25 KB sample and shows the limit", () => {
    const store = setup();
    const result = store.save({ label: "Long", text: "a".repeat(25 * 1024) });
    expect(result).toEqual({
      ok: false,
      reason: "too-large",
      message: "The sample is 25 KB; samples can be up to 20 KB.",
    });
    // Multi-byte text is measured in bytes, not characters.
    const wide = store.save({ label: "Hindi", text: "न".repeat(7_000) });
    expect(wide.ok).toBe(false);
    expect(store.save({ label: "Edge", text: "a".repeat(EMAIL_LIMITS.sampleBytes) }).ok).toBe(true);
  });

  it("needs a label and some text, and keeps at most ten", () => {
    const store = setup();
    expect(store.save({ label: " ", text: "x" })).toMatchObject({ ok: false, reason: "no-label" });
    expect(store.save({ label: "x".repeat(81), text: "x" })).toMatchObject({ reason: "no-label" });
    expect(store.save({ label: "Empty", text: " \n " })).toMatchObject({ reason: "empty" });
    for (let index = 0; index < EMAIL_LIMITS.samples; index++) {
      expect(store.save({ label: `S${index}`, text: "text" }).ok).toBe(true);
    }
    expect(store.save({ label: "Eleventh", text: "text" })).toMatchObject({
      ok: false,
      reason: "full",
    });
  });
});
