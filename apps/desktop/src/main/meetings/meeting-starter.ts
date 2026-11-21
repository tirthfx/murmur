import type { MeetingSource, NotetakerSettings } from "@murmur/shared";
import type { Logger } from "../helper/types";
import type { MeetingRecorder, StartResult } from "./meeting-recorder";
import type { MeetingsStore } from "./meetings-store";

export interface MeetingStarterDeps {
  recorder: Pick<MeetingRecorder, "state" | "start" | "stop">;
  store: Pick<MeetingsStore, "acknowledgeConsent">;
  /** `notetaker.consent`. */
  consent(): NotetakerSettings["consent"];
  /** Remembers that the notice was shown once (the `first` setting). */
  markNoticeSeen(): void;
  /** Shows the recording notice; true when the owner pressed OK. */
  confirmNotice(): Promise<boolean>;
  now(): number;
  logger: Logger;
}

export type ToggleResult =
  | { ok: true; action: "started"; meetingId: string }
  | { ok: true; action: "stopped" }
  | { ok: false; message: string };

export interface MeetingStarter {
  /** Starts a recording, after the consent notice when the setting asks for it. */
  start(source?: MeetingSource): Promise<StartResult>;
  /** The hotkey (NT-03): starts when idle, stops when recording. */
  toggle(source?: MeetingSource): Promise<ToggleResult>;
}

export const CANCELLED_MESSAGE =
  "The recording was not started because the notice was not accepted.";

/**
 * The one way a recording is started by the owner (NT-03, NT-25): from the hotkey, the tray or
 * the Notetaker page. With the notice on `always`, or `first` and not yet seen, nothing is
 * captured until the owner accepts it. The recording indicators do not depend on this.
 */
export function createMeetingStarter(deps: MeetingStarterDeps): MeetingStarter {
  let asking = false;

  const needsNotice = () => {
    const { notice, seen } = deps.consent();
    return notice === "always" || (notice === "first" && !seen);
  };

  async function start(source: MeetingSource = "ad_hoc"): Promise<StartResult> {
    if (asking) return { ok: false, message: "The recording notice is waiting for an answer." };
    const idle = deps.recorder.state().status === "idle";
    let shown = false;
    if (idle && needsNotice()) {
      asking = true;
      try {
        if (!(await deps.confirmNotice())) {
          deps.logger.info("meeting recording not started: notice not accepted");
          return { ok: false, message: CANCELLED_MESSAGE };
        }
      } finally {
        asking = false;
      }
      shown = true;
      deps.markNoticeSeen();
    }
    const result = await deps.recorder.start({ source });
    if (result.ok && shown) deps.store.acknowledgeConsent(result.meetingId, deps.now());
    return result;
  }

  return {
    start,
    async toggle(source = "ad_hoc") {
      const state = deps.recorder.state();
      if (state.status === "recording") {
        await deps.recorder.stop();
        return { ok: true, action: "stopped" };
      }
      if (state.status !== "idle") return { ok: false, message: "A recording is busy." };
      const result = await start(source);
      return result.ok ? { ok: true, action: "started", meetingId: result.meetingId } : result;
    },
  };
}
