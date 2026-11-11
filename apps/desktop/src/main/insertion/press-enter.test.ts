import { describe, expect, it } from "vitest";
import { splitPressEnter } from "./press-enter";

describe("press enter", () => {
  it("takes the command off the end and keeps a sentence ending", () => {
    expect(splitPressEnter("Send the file, press enter.")).toEqual({
      text: "Send the file.",
      pressEnter: true,
    });
    expect(splitPressEnter("Is it done? Press Enter")).toEqual({
      text: "Is it done?",
      pressEnter: true,
    });
    expect(splitPressEnter("sounds good press enter")).toEqual({
      text: "sounds good.",
      pressEnter: true,
    });
  });

  it("leaves the phrase alone anywhere else", () => {
    for (const text of [
      "Press enter the key on the left",
      "You can press enter to continue, or wait.",
      "Send the file.",
      "do not suppress enter",
    ]) {
      expect(splitPressEnter(text)).toEqual({ text, pressEnter: false });
    }
  });

  it("handles the command on its own", () => {
    expect(splitPressEnter("Press enter.")).toEqual({ text: "", pressEnter: true });
  });
});
