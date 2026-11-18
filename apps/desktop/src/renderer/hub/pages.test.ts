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
