import { describe, expect, it } from "vitest";
import { FREE_LIMITS, type Rewrite } from "@murmur/shared";
import { boundRewriteShortcuts, refuseNewRewrite, refuseRewriteShortcut } from "./gates";

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
    expect(refuseNewRewrite("enterprise", three)).toBeNull();
  });

  it("allows three Rewrite shortcuts on Free, and changing one already set", () => {
    const set = (id: string) => rewrite(id, { shortcut: SHORTCUT });
    const list = [set("a"), set("b"), set("c"), rewrite("d")];
    expect(refuseRewriteShortcut("free", list, "d")).toBe("Available on Pro");
    expect(refuseRewriteShortcut("free", list, "a")).toBeNull();
    expect(refuseRewriteShortcut("free", list.slice(1), "d")).toBeNull();
    expect(refuseRewriteShortcut("team", list, "d")).toBeNull();
    expect(boundRewriteShortcuts("free")).toBe(FREE_LIMITS.rewriteShortcuts);
    expect(boundRewriteShortcuts("pro")).toBeUndefined();
  });
});
