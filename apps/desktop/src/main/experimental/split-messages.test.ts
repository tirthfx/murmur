import { describe, expect, it } from "vitest";
import { splitMessages } from "./split-messages";

const segment = (startMs: number, endMs: number, text: string) => ({
  startMs,
  endMs,
  text,
  confidence: 0.9,
});

describe("split into messages", () => {
  it("makes three messages from two long pauses", () => {
    const parts = splitMessages({
      text: "",
      segments: [
        segment(0, 2000, "Hey, are you free this afternoon?"),
        segment(5000, 7000, "I wanted to go over the plan."),
        segment(10_000, 12_000, "Let me know what time works best."),
      ],
    });
    expect(parts).toEqual([
      "Hey, are you free this afternoon?",
      "I wanted to go over the plan.",
      "Let me know what time works best.",
    ]);
  });

  it("keeps short pauses inside one message", () => {
    expect(
      splitMessages({
        text: "",
        segments: [segment(0, 1000, "One two three."), segment(1500, 2500, "Four five six.")],
      }),
    ).toEqual(["One two three. Four five six."]);
  });

  it("joins a part shorter than five words to the one before", () => {
    expect(
      splitMessages({
        text: "",
        segments: [
          segment(0, 2000, "I wanted to go over the plan."),
          segment(5000, 6000, "Thanks!"),
          segment(9000, 11_000, "Call me when you get this message."),
        ],
      }),
    ).toEqual(["I wanted to go over the plan. Thanks!", "Call me when you get this message."]);
  });

  it("joins a short first part to the next, and returns the text when there are no segments", () => {
    expect(
      splitMessages({
        text: "",
        segments: [segment(0, 500, "Hi."), segment(4000, 6000, "Are we still on for lunch today?")],
      }),
    ).toEqual(["Hi. Are we still on for lunch today?"]);
    expect(splitMessages({ text: " Hello there. ", segments: [] })).toEqual(["Hello there."]);
    expect(splitMessages({ text: "", segments: [] })).toEqual([]);
  });
});
