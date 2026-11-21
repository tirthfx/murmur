import type { DetectSettings, DetectSubscribeInput, MeetingMatcher } from "@murmur/shared";
import type { Logger } from "../helper/types";

export interface DetectionSyncDeps {
  matchers(): MeetingMatcher[];
  settings(): DetectSettings;
  helperReady(): boolean;
  /** Sends `detect.subscribe`. */
  watch(input: DetectSubscribeInput): Promise<void>;
  /** Detection went off: forget calls and close any prompt. */
  stopped(): void;
  logger: Logger;
}

export interface DetectionSync {
  /** Settings changed, or the helper came up or went away. */
  sync(): void;
}

/**
 * Keeps the helper's watch in step with the settings (NT-01). With detection off, or every
 * app off or never, nothing is sent at all: the helper receives no `detect.subscribe`. A stop is
 * sent only after a start. The same matchers are not sent twice, and a helper that restarted
 * is told again, because it forgot.
 */
export function createDetectionSync(deps: DetectionSyncDeps): DetectionSync {
  let sent: string | null = null;
  return {
    sync() {
      const detect = deps.settings();
      const list = deps
        .matchers()
        .filter(
          (matcher) => detect.apps[matcher.id] !== false && !detect.neverApps.includes(matcher.id),
        );
      const ready = deps.helperReady();
      if (detect.enabled && ready && list.length > 0) {
        const key = JSON.stringify(list);
        if (key === sent) return;
        sent = key;
        deps
          .watch({ enabled: true, matchers: list })
          .catch((error: unknown) =>
            deps.logger.warn(`detection could not start: ${String(error)}`),
          );
        return;
      }
      if (sent === null) return;
      sent = null;
      deps.stopped();
      // A helper that is gone has nothing to stop.
      if (ready) deps.watch({ enabled: false, matchers: [] }).catch(() => {});
    },
  };
}
