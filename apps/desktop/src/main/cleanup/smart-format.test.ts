import { describe, expect, it } from "vitest";
import { readNumber, smartFormat } from "./smart-format";

function expectAll(cases: [string, string][]) {
  for (const [said, written] of cases) expect(smartFormat(said), said).toBe(written);
}

describe("Smart Formatting (DC-29)", () => {
  it("writes the spec's examples", () => {
    expectAll([
      ["two thirty pm", "2:30 PM"],
      ["fifty dollars", "$50"],
      ["john at example dot com", "john@example.com"],
    ]);
  });

  it("writes times", () => {
    expectAll([
      ["Meet at two thirty p.m. tomorrow.", "Meet at 2:30 PM tomorrow."],
      ["Call me at 5 pm.", "Call me at 5 PM."],
      ["It starts at nine oh five am", "It starts at 9:05 AM"],
      ["Lunch is at twelve fifteen PM, then work.", "Lunch is at 12:15 PM, then work."],
    ]);
  });

  it("writes money and percentages", () => {
    expectAll([
      ["It costs twenty five dollars.", "It costs $25."],
      ["three dollars and twenty cents", "$3.20"],
      ["a budget of two hundred and fifty thousand euros", "a budget of €250,000"],
      ["sales rose ten percent", "sales rose 10%"],
      ["only 50 rupees", "only ₹50"],
      ["a deal worth two million dollars", "a deal worth $2 million"],
    ]);
  });

  it("writes dates", () => {
    expectAll([
      ["Due on March fifth.", "Due on March 5."],
      ["the June twenty first release", "the June 21 release"],
      ["on May first", "on May 1"],
    ]);
  });

  it("writes numbers from ten up", () => {
    expectAll([
      ["twenty five people and three dogs", "25 people and three dogs"],
      ["one hundred and five", "105"],
      ["I have one idea", "I have one idea"],
      ["eleven", "11"],
      ["It weighs ten pounds", "It weighs 10 pounds"],
    ]);
  });

  it("writes email addresses and links", () => {
    expectAll([
      ["send it to jane dot doe at example dot co dot uk", "send it to jane.doe@example.co.uk"],
      ["John at example.com is away", "john@example.com is away"],
      ["look at example dot com", "look at example.com"],
      ["go to example dot org slash docs slash start", "go to example.org/docs/start"],
    ]);
  });

  it("leaves what could mean something else", () => {
    for (const text of [
      "I was at home at the weekend.",
      "Meet me at the station.",
      "the dot com bubble",
      "in twenty twenty six",
      "one two three",
      "you may first want to check",
      "we march second only to them",
      "starts in May first thing",
      "a hundred reasons",
      "a hundred and twenty",
      "give me five minutes",
      "first and second place",
    ]) {
      expect(smartFormat(text), text).toBe(text);
    }
  });

  it("keeps lines and punctuation", () => {
    expect(smartFormat("1. Pay fifty dollars\n2. Leave (at five pm).")).toBe(
      "1. Pay $50\n2. Leave (at 5 PM).",
    );
  });

  it("reads compound numbers", () => {
    expect(readNumber("nine hundred and ninety nine thousand".split(" "), 0)).toEqual({
      value: 999_000,
      length: 6,
    });
    expect(readNumber(["hundred"], 0)).toBeNull();
    expect(readNumber(["twenty", "twelve"], 0)).toEqual({ value: 20, length: 1 });
  });
});
