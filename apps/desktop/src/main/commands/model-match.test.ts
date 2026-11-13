import { describe, expect, it } from "vitest";
import { COMMAND_IDS } from "@murmur/shared";
import { commandChoicePrompt, parseCommandChoice } from "./model-match";

describe("commandChoicePrompt", () => {
  it("lists every command id and the request", () => {
    const { system, prompt } = commandChoicePrompt("make it sound less stiff");
    for (const id of COMMAND_IDS) expect(system).toContain(`${id}:`);
    expect(prompt).toContain("make it sound less stiff");
  });

  it("cuts a long request", () => {
    expect(commandChoicePrompt("x".repeat(1000)).prompt.length).toBeLessThan(400);
  });
});

describe("parseCommandChoice", () => {
  it("accepts an id from the list only", () => {
    expect(parseCommandChoice("friendly")).toBe("friendly");
    expect(parseCommandChoice("  `select_all`.\n")).toBe("select_all");
    expect(parseCommandChoice("Shorter")).toBe("shorter");
    expect(parseCommandChoice("<think>\nmaybe bold\n</think>\n\nitalic")).toBe("italic");
    expect(parseCommandChoice("none")).toBeNull();
    expect(parseCommandChoice("make it friendly")).toBeNull();
    expect(parseCommandChoice("")).toBeNull();
  });
});
