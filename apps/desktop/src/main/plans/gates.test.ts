import { describe, expect, it } from "vitest";
import { FREE_LIMITS, FREE_MEETINGS_PER_MONTH, type Rewrite } from "@murmur/shared";
import {
  boundRewriteShortcuts,
  meetingsThisMonth,
  meetingStartRefusal,
  planRefusal,
  refuseNewRewrite,
  refuseRewriteShortcut,
} from "./gates";

function rewrite(id: string, fields: Partial<Rewrite> = {}): Rewrite {
  return {
    id,
    name: id,
    builtinKey: null,
    description: "",
    instruction: "Do it.",
    example: null,
    enabled: true,
    sortOrder: 0,
    shortcut: null,
    shortcutLabel: null,
    applyDirectly: false,
    autoApply: false,
    autoApplyMinWords: 0,
    autoApplyCategories: [],
    useCount: 0,
    lastUsedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...fields,
  } as Rewrite;
}

const builtins = ["concise", "formal", "casual", "fix", "bullets"].map((key) =>
  rewrite(key, { builtinKey: key as Rewrite["builtinKey"] }),
);
const SHORTCUT = '{"type":"key","keyCode":1,"modifiers":["control","option"]}';

describe("plan gates", () => {
  it("refuses the fourth custom Rewrite on Free with Available on Pro", () => {
    const three = [...builtins, rewrite("a"), rewrite("b"), rewrite("c")];
    expect(refuseNewRewrite("free", [...builtins, rewrite("a"), rewrite("b")])).toBeNull();
    expect(refuseNewRewrite("free", three)).toEqual({
      ok: false,
      reason: "plan",
      message: "Available on Pro",
    });
    expect(refuseNewRewrite("pro", three)).toBeNull();
    expect(refuseNewRewrite("pro", three)).toBeNull();
  });

  it("allows three Rewrite shortcuts on Free, and changing one already set", () => {
    const set = (id: string) => rewrite(id, { shortcut: SHORTCUT });
    const list = [set("a"), set("b"), set("c"), rewrite("d")];
    expect(refuseRewriteShortcut("free", list, "d")).toBe("Available on Pro");
    expect(refuseRewriteShortcut("free", list, "a")).toBeNull();
    expect(refuseRewriteShortcut("free", list.slice(1), "d")).toBeNull();
    expect(refuseRewriteShortcut("pro", list, "d")).toBeNull();
    expect(boundRewriteShortcuts("free")).toBe(FREE_LIMITS.rewriteShortcuts);
    expect(boundRewriteShortcuts("pro")).toBeUndefined();
  });
});

const AT = new Date(2026, 10, 15, 12).getTime();
const inNov = (day: number) => ({ startedAt: new Date(2026, 10, day, 9).getTime() });
const inOct = { startedAt: new Date(2026, 9, 30, 23).getTime() };
const many = (count: number) => Array.from({ length: count }, (_, i) => inNov(i + 1));

describe("meetingsThisMonth", () => {
  it("counts only the meetings started in the month of now", () => {
    expect(meetingsThisMonth([inNov(1), inNov(2), inOct, inNov(15)], AT)).toBe(3);
    expect(meetingsThisMonth([{ startedAt: AT + 1 }], AT)).toBe(0);
  });
});

describe("meetingStartRefusal", () => {
  const refusal = (plan: "free" | "pro", meetings: { startedAt: number }[]) =>
    meetingStartRefusal({ plan: () => plan, meetings: () => meetings, now: () => AT });

  it("lets Free record up to the monthly limit, and then says so", () => {
    expect(refusal("free", many(FREE_MEETINGS_PER_MONTH - 1))).toBeNull();
    expect(refusal("free", many(FREE_MEETINGS_PER_MONTH))).toBe(
      "Available on Pro. Free records 5 meetings a month.",
    );
  });

  it("does not limit Pro, and counts only this month", () => {
    expect(refusal("pro", many(30))).toBeNull();
    expect(refusal("free", [inOct, inOct, inOct, inOct, inOct, inOct])).toBeNull();
  });
});

describe("planRefusal", () => {
  it("names the plan that has the feature", () => {
    expect(planRefusal("free", "askMeetings")).toBe("Available on Pro");
    expect(planRefusal("pro", "askMeetings")).toBeNull();
  });
});
