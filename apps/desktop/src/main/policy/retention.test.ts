import { describe, expect, it } from "vitest";
import {
  DICTATION_AUDIO,
  HISTORY_TEXT,
  MEETING_AUDIO,
  MEETING_TRANSCRIPT,
  effectivePeriod,
} from "./retention";

const none = { max: null, min: null };

describe("effectivePeriod", () => {
  it("leaves a choice alone when there is no limit, or it is within the limit", () => {
    expect(effectivePeriod(MEETING_AUDIO, "forever", none)).toBe("forever");
    expect(effectivePeriod(MEETING_AUDIO, "7d", { max: 30, min: null })).toBe("7d");
    expect(effectivePeriod(MEETING_TRANSCRIPT, "90d", { max: 365, min: 30 })).toBe("90d");
  });

  it("brings a longer choice, and keeping for ever, down to the longest choice within the maximum", () => {
    expect(effectivePeriod(MEETING_AUDIO, "forever", { max: 30, min: null })).toBe("30d");
    expect(effectivePeriod(MEETING_AUDIO, "30d", { max: 10, min: null })).toBe("7d");
    expect(effectivePeriod(MEETING_TRANSCRIPT, "forever", { max: 100, min: null })).toBe("90d");
    expect(effectivePeriod(HISTORY_TEXT, null, { max: 60, min: null })).toBe(30);
    expect(effectivePeriod(DICTATION_AUDIO, "keep", { max: 1, min: null })).toBe("24h");
  });

  it("uses the shortest choice when none is short enough", () => {
    expect(effectivePeriod(MEETING_TRANSCRIPT, "forever", { max: 10, min: null })).toBe("30d");
    expect(effectivePeriod(HISTORY_TEXT, 365, { max: 3, min: null })).toBe(7);
  });

  it("brings a shorter choice up to the shortest choice that is long enough", () => {
    expect(effectivePeriod(MEETING_AUDIO, "processing", { max: null, min: 7 })).toBe("7d");
    expect(effectivePeriod(MEETING_AUDIO, "7d", { max: null, min: 20 })).toBe("30d");
    expect(effectivePeriod(MEETING_TRANSCRIPT, "30d", { max: null, min: 400 })).toBe("forever");
    expect(effectivePeriod(DICTATION_AUDIO, "never", { max: null, min: 1 })).toBe("24h");
  });

  it("keeps a choice it does not know", () => {
    expect(effectivePeriod(MEETING_AUDIO, "other" as never, { max: 7, min: null })).toBe("other");
  });
});
