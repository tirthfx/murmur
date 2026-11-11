import { describe, expect, it } from "vitest";
import { dropSoundTags } from "./sound-tags";

describe("sound tags", () => {
  it("drops labels for noises", () => {
    expect(dropSoundTags("*thud*")).toBe("");
    expect(dropSoundTags("[BLANK_AUDIO]")).toBe("");
    expect(dropSoundTags("(laughs)")).toBe("");
    expect(dropSoundTags("Send it now [Music] please.")).toBe("Send it now please.");
    expect(dropSoundTags("*coughs* Okay, let's start.")).toBe("Okay, let's start.");
  });

  it("keeps dictated words, including words in parentheses", () => {
    expect(dropSoundTags("Hi, good morning.")).toBe("Hi, good morning.");
    expect(dropSoundTags("The total (before tax) is ten.")).toBe("The total (before tax) is ten.");
  });
});
