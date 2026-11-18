import { translate, type CatalogueKey, type Settings } from "@murmur/shared";

/** What a notification opens when clicked (HB-24). */
export type NotificationTarget = "dictation" | "home" | "insights" | "settings";

export interface ShownNotification {
  title: string;
  body: string;
  target: NotificationTarget;
}

export interface NotifierDeps {
  settings: () => Pick<Settings, "notifications" | "language">;
  /** Shows a macOS notification; clicking it opens the target. */
  show: (notification: ShownNotification) => void;
  now?: () => number;
}

/**
 * HB-24: Murmur's notifications. Every text comes from the catalogue and only ever takes
 * counts or a milestone's name, so no dictated word can reach a notification. Each type
 * has its own switch; failures are sent at most once a minute.
 */
export interface Notifier {
  dictationFailed(): void;
  modelDownload(ok: boolean): void;
  focusEnded(): void;
  milestone(name: string): void;
  weeklySummary(words: number, streak: number): void;
  /** The Testing page's check (HB-55); sent whatever the switches say. */
  test(): void;
}

export const FAILURE_COOLDOWN_MS = 60_000;

export function createNotifier(deps: NotifierDeps): Notifier {
  const now = deps.now ?? Date.now;
  let lastFailure = -Infinity;

  function send(
    title: CatalogueKey,
    body: CatalogueKey,
    target: NotificationTarget,
    values: Record<string, string | number> = {},
  ): void {
    const language = deps.settings().language;
    deps.show({
      title: translate(language, title, values),
      body: translate(language, body, values),
      target,
    });
  }

  const on = () => deps.settings().notifications;

  return {
    dictationFailed() {
      if (!on().dictationFailed) return;
      if (now() - lastFailure < FAILURE_COOLDOWN_MS) return;
      lastFailure = now();
      send("notify.dictationFailed.title", "notify.dictationFailed.body", "dictation");
    },
    modelDownload(ok) {
      if (!on().modelDownload) return;
      if (ok) send("notify.modelReady.title", "notify.modelReady.body", "home");
      else send("notify.modelFailed.title", "notify.modelFailed.body", "home");
    },
    focusEnded() {
      if (on().focusEnded) send("notify.focusEnded.title", "notify.focusEnded.body", "home");
    },
    milestone(name) {
      if (on().milestone) {
        send("notify.milestone.title", "notify.milestone.body", "insights", { name });
      }
    },
    weeklySummary(words, streak) {
      if (!on().weeklySummary) return;
      send("notify.weekly.title", "notify.weekly.body", "insights", {
        words: Math.max(0, Math.round(words)).toLocaleString("en"),
        streak: `${streak} ${streak === 1 ? "day" : "days"}`,
      });
    },
    test() {
      send("notify.test.title", "notify.test.body", "settings");
    },
  };
}
