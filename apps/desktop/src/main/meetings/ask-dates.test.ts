import { describe, expect, it } from "vitest";
import { describeRange, questionRange, withoutDates } from "./ask-dates";

// Saturday 21 November 2026, 15:30 local time.
const now = new Date(2026, 10, 21, 15, 30).getTime();
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day).getTime();

describe("questionRange", () => {
  it.each([
    ["what did we decide yesterday?", d(2026, 11, 20), d(2026, 11, 21)],
    ["anything today", d(2026, 11, 21), d(2026, 11, 22)],
    ["in the meeting last Tuesday", d(2026, 11, 17), d(2026, 11, 18)],
    ["last saturday", d(2026, 11, 14), d(2026, 11, 15)],
    ["last Friday", d(2026, 11, 20), d(2026, 11, 21)],
    ["last week", d(2026, 11, 9), d(2026, 11, 16)],
    ["this week", d(2026, 11, 16), d(2026, 11, 23)],
    ["last month", d(2026, 10, 1), d(2026, 11, 1)],
    ["this month", d(2026, 11, 1), d(2026, 12, 1)],
    ["in the last 3 days", d(2026, 11, 19), d(2026, 11, 22)],
    ["the past 2 weeks", d(2026, 11, 8), d(2026, 11, 22)],
  ])("reads %s", (question, from, to) => {
    expect(questionRange(question, now)).toMatchObject({ from, to });
  });

  it("reads last month in January as December", () => {
    const january = new Date(2027, 0, 10).getTime();
    expect(questionRange("last month", january)).toMatchObject({
      from: d(2026, 12, 1),
      to: d(2027, 1, 1),
    });
  });

  it.each(["what was the budget?", "", "last quarter", "the last 0 days"])(
    "finds no range in %s",
    (question) => {
      expect(questionRange(question, now)).toBeNull();
    },
  );
});

describe("describeRange", () => {
  it("names a day, or the first and last day", () => {
    expect(describeRange({ from: d(2026, 11, 17), to: d(2026, 11, 18) })).toBe("17 Nov 2026");
    expect(describeRange({ from: d(2026, 11, 9), to: d(2026, 11, 16) })).toBe(
      "9 Nov 2026 to 15 Nov 2026",
    );
  });
});

describe("withoutDates", () => {
  it.each([
    ["What did we say about shipping last Tuesday?", "What did we say about shipping?"],
    [
      "What was said about shipping in the meeting last Tuesday?",
      "What was said about shipping in the meeting?",
    ],
    ["Yesterday, what did Priya say?", "What did Priya say?"],
    ["Anything decided in the last 3 days?", "Anything decided?"],
    ["What happened last week on the budget?", "What happened on the budget?"],
    ["What was decided in the meeting last month?", "What was decided in the meeting?"],
  ])("takes %s to %s", (question, expected) => {
    expect(withoutDates(question, questionRange(question, now))).toBe(expected);
  });

  it("leaves a question with no dates, or only dates, as it was", () => {
    expect(withoutDates("What is the plan?", questionRange("What is the plan?", now))).toBe(
      "What is the plan?",
    );
    expect(withoutDates("yesterday?", questionRange("yesterday?", now))).toBe("yesterday?");
    expect(withoutDates("x", null)).toBe("x");
  });
});
