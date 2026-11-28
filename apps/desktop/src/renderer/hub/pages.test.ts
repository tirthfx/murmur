import { describe, expect, it } from "vitest";
import { pageFromHash, resolvePage, visiblePages } from "./pages";

describe("pages", () => {
  it("hides a page whose feature is off and sends it to Home", () => {
    expect(visiblePages({ scratchpad: false }).some((page) => page.id === "scratchpad")).toBe(
      false,
    );
    expect(resolvePage("scratchpad", { scratchpad: false }).id).toBe("home");
    expect(resolvePage("scratchpad", {}).id).toBe("scratchpad");
  });

  it("reads a page id from the hash", () => {
    expect(pageFromHash("#/my-voice")).toBe("my-voice");
    expect(pageFromHash("#/../x")).toBeNull();
    expect(pageFromHash("")).toBeNull();
  });
});

describe("Creator mode (HB-13)", () => {
  it("brings the writing pages to the top and changes nothing else", () => {
    const usual = visiblePages({}).map((page) => page.id);
    const creator = visiblePages({}, true).map((page) => page.id);
    expect(creator.slice(0, 3)).toEqual(["home", "scratchpad", "rewrites"]);
    expect([...creator].sort()).toEqual([...usual].sort());
    expect(visiblePages({ scratchpad: false }, true)[1]!.id).toBe("rewrites");
  });
});
