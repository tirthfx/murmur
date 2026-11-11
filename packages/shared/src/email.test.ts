import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL,
  emailSettingsSchema,
  formatKb,
  isReplyTitle,
  wantsSignature,
  withSignature,
} from "./email";

describe("email", () => {
  it("tells replies from new messages by the window title", () => {
    expect(isReplyTitle("Re: Lunch on Friday")).toBe(true);
    expect(isReplyTitle("RE[2]: Lunch")).toBe(true);
    expect(isReplyTitle("re : lunch")).toBe(true);
    expect(isReplyTitle("New Message")).toBe(false);
    expect(isReplyTitle("Fwd: Lunch")).toBe(false);
    expect(isReplyTitle("Remember the milk")).toBe(false);
    expect(isReplyTitle(null)).toBe(false);
  });

  it("adds the signature once, after a blank line", () => {
    const sig = "Best,\nTirth";
    expect(withSignature("See you at five.", sig)).toBe("See you at five.\n\nBest,\nTirth");
    expect(withSignature("See you at five.\n", `  ${sig}  `)).toBe(
      "See you at five.\n\nBest,\nTirth",
    );
    // The owner said the signature: not added again.
    expect(withSignature("See you at five. Best, Tirth.", sig)).toBe(
      "See you at five. Best, Tirth.",
    );
    expect(withSignature("", sig)).toBe("");
    expect(withSignature("Hello.", " ")).toBe("Hello.");
  });

  it("adds it to new messages and, only when asked, to replies", () => {
    const on = { ...DEFAULT_EMAIL, signature: "Tirth" };
    expect(wantsSignature(on, "New Message")).toBe(true);
    expect(wantsSignature(on, null)).toBe(true);
    expect(wantsSignature(on, "Re: Plans")).toBe(false);
    expect(wantsSignature({ ...on, addToReplies: true }, "Re: Plans")).toBe(true);
    expect(wantsSignature({ ...on, addToNew: false }, "New Message")).toBe(false);
    expect(wantsSignature(DEFAULT_EMAIL, "New Message")).toBe(false);
  });

  it("limits the signature to 500 characters and the language to known ones", () => {
    expect(
      emailSettingsSchema.safeParse({ ...DEFAULT_EMAIL, signature: "x".repeat(500) }).success,
    ).toBe(true);
    expect(
      emailSettingsSchema.safeParse({ ...DEFAULT_EMAIL, signature: "x".repeat(501) }).success,
    ).toBe(false);
    expect(emailSettingsSchema.safeParse({ ...DEFAULT_EMAIL, language: "fr" }).success).toBe(true);
    expect(emailSettingsSchema.safeParse({ ...DEFAULT_EMAIL, language: "hi-Latn" }).success).toBe(
      false,
    );
  });

  it("formats sizes in KB", () => {
    expect(formatKb(20 * 1024)).toBe("20 KB");
    expect(formatKb(25 * 1024 + 300)).toBe("25 KB");
    expect(formatKb(1536)).toBe("1.5 KB");
    expect(formatKb(2)).toBe("under 1 KB");
  });
});
