import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFICATIONS } from "@murmur/shared";
import { createNotifier, FAILURE_COOLDOWN_MS, type ShownNotification } from "./notifier";

function setup(overrides: Partial<typeof DEFAULT_NOTIFICATIONS> = {}) {
  const shown: ShownNotification[] = [];
  let clock = 0;
  const notifier = createNotifier({
    settings: () => ({ language: "en", notifications: { ...DEFAULT_NOTIFICATIONS, ...overrides } }),
    show: (notification) => shown.push(notification),
    now: () => clock,
  });
  return { notifier, shown, advance: (ms: number) => (clock += ms) };
}

describe("notifier (HB-24)", () => {
  it("sends what is on by default and nothing that is off", () => {
    const { notifier, shown } = setup();
    notifier.dictationFailed();
    notifier.modelDownload(true);
    notifier.focusEnded();
    notifier.milestone("1,000 words");
    notifier.weeklySummary(1200, 3);
    expect(shown.map((item) => item.target)).toEqual(["dictation", "home", "home"]);
  });

  it("sends a failure at most once a minute", () => {
    const { notifier, shown, advance } = setup();
    notifier.dictationFailed();
    notifier.dictationFailed();
    advance(FAILURE_COOLDOWN_MS);
    notifier.dictationFailed();
    expect(shown).toHaveLength(2);
  });

  it("puts counts and names in, never more", () => {
    const { notifier, shown } = setup({ milestone: true, weeklySummary: true });
    notifier.milestone("7-day streak");
    notifier.weeklySummary(1234.4, 1);
    expect(shown).toEqual([
      {
        title: "Milestone: 7-day streak",
        body: "See it on the Insights page.",
        target: "insights",
      },
      {
        title: "Your week with Murmur",
        body: "1,234 words dictated last week. Daily streak: 1 day.",
        target: "insights",
      },
    ]);
  });

  it("has no way to send dictated text", () => {
    // Every method takes counts or a milestone name only; a failed dictation sends a fixed text.
    const { notifier, shown } = setup();
    notifier.dictationFailed();
    expect(shown[0]!.body).toBe("Its recording is kept. Open Murmur to retry it.");
  });

  it("sends the test notification whatever the switches say", () => {
    const { notifier, shown } = setup({
      dictationFailed: false,
      modelDownload: false,
      focusEnded: false,
    });
    notifier.test();
    expect(shown).toHaveLength(1);
  });
});
