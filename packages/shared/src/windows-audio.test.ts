import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTETAKER,
  DEFAULT_WINDOWS_AUDIO,
  MEETING_WARNING_TEXT,
  notetakerSettingsSchema,
  shouldWarnAboutPlayback,
} from "./index";

describe("shouldWarnAboutPlayback", () => {
  const both = ["mic", "system"] as const;
  it("warns on Windows, once, when the system channel is recording", () => {
    expect(shouldWarnAboutPlayback("windows", both, DEFAULT_WINDOWS_AUDIO)).toBe(true);
    expect(
      shouldWarnAboutPlayback("windows", both, { ...DEFAULT_WINDOWS_AUDIO, warned: true }),
    ).toBe(false);
  });

  it("does not warn on a Mac, with the microphone alone, or when switched off", () => {
    expect(shouldWarnAboutPlayback("mac", both, DEFAULT_WINDOWS_AUDIO)).toBe(false);
    expect(shouldWarnAboutPlayback(null, both, DEFAULT_WINDOWS_AUDIO)).toBe(false);
    expect(shouldWarnAboutPlayback("windows", ["mic"], DEFAULT_WINDOWS_AUDIO)).toBe(false);
    expect(
      shouldWarnAboutPlayback("windows", both, { ...DEFAULT_WINDOWS_AUDIO, warnOnPlayback: false }),
    ).toBe(false);
  });
});

describe("the Windows audio setting", () => {
  it("fills in for settings saved before it existed", () => {
    const before: Record<string, unknown> = { ...DEFAULT_NOTETAKER };
    delete before.windowsAudio;
    const parsed = notetakerSettingsSchema.parse(before);
    expect(parsed.windowsAudio).toEqual({
      endpoint: "default",
      warnOnPlayback: true,
      warned: false,
    });
  });

  it("has a text the person reads", () => {
    expect(MEETING_WARNING_TEXT.system_playback).toMatch(/music/);
  });
});
