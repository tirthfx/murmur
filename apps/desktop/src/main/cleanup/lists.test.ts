import { describe, expect, it } from "vitest";
import { formatLists } from "./lists";

describe("spoken lists (DC-26)", () => {
  it("writes numbered cues as a numbered list", () => {
    expect(formatLists("Number one buy milk number two call mum")).toBe("1. Buy milk\n2. Call mum");
  });

  it("copes with the model's punctuation and digits", () => {
    expect(formatLists("Number 1, buy milk. Number 2, call mum.")).toBe("1. Buy milk\n2. Call mum");
  });

  it("keeps the words before and after the list as text", () => {
    expect(
      formatLists(
        "Two things for today: number one, the report, and number two, the budget. Thanks all.",
      ),
    ).toBe("Two things for today:\n1. The report\n2. The budget\nThanks all.");
  });

  it("reads first and second when each opens a clause", () => {
    expect(formatLists("First, open the app. Second, sign in. Third, save.")).toBe(
      "1. Open the app\n2. Sign in\n3. Save",
    );
  });

  it("writes bullet and next item cues as bullets", () => {
    expect(formatLists("Shopping bullet milk bullet point eggs next item bread")).toBe(
      "Shopping\n- Milk\n- Eggs\n- Bread",
    );
  });

  it("leaves ordinary sentences alone", () => {
    for (const text of [
      "I was number one in the queue.",
      "The first time we met, the second half had started.",
      "First of all, thank you. Second of all, goodbye.",
      "He bit the bullet and fired the silver bullet.",
      "Move to the next item and then the next item.",
      "Call number two before number one.",
      "Wait one second, then press the button.",
      "A single bullet point is enough.",
      "Number one, number two",
    ]) {
      expect(formatLists(text), text).toBe(text);
    }
  });

  it("leaves text that already has lines", () => {
    const text = "number one a\nnumber two b";
    expect(formatLists(text)).toBe(text);
  });
});
