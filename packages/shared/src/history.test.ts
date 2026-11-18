import { describe, expect, it } from "vitest";
import { historyMatchQuery, historyQuerySchema } from "./history";

describe("historyMatchQuery", () => {
  it("makes each word a required prefix", () => {
    expect(historyMatchQuery("quick brown")).toBe('"quick"* "brown"*');
  });

  it("keeps FTS syntax out", () => {
    expect(historyMatchQuery('a" OR b NEAR(c)')).toBe('"a"* "OR"* "b"* "NEARc"*');
    expect(historyMatchQuery('  "" * ')).toBeNull();
  });

  it("keeps letters from other scripts and apostrophes", () => {
    expect(historyMatchQuery("don't नमस्ते")).toBe('"don\'t"* "नमस्ते"*');
  });
});

describe("historyQuerySchema", () => {
  it("fills in the defaults", () => {
    expect(historyQuerySchema.parse({})).toEqual({
      text: "",
      from: null,
      to: null,
      app: null,
      status: null,
      language: null,
      archived: false,
      offset: 0,
    });
  });
});
