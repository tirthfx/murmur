import { describe, expect, it } from "vitest";
import { parseAnswer } from "./engine";

const parse = (value: string) => (JSON.parse(value) as { text?: string }).text;

describe("parseAnswer", () => {
  it("returns the text of a complete answer", () => {
    expect(parseAnswer('{"text": "Hello there."}', parse)).toBe("Hello there.");
  });

  it("returns an empty string for an answer cut off by the token limit", () => {
    expect(parseAnswer('{"text": "the sea\\nbreathe in', parse)).toBe("");
  });

  it("returns an empty string when the text field is missing", () => {
    expect(parseAnswer("{}", parse)).toBe("");
  });
});
