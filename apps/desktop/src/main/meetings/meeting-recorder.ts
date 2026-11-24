import path from "node:path";
import {
  defaultMeetingTitle,
  type Meeting,
  type MeetingAttendee,
  type MeetingChannel,
  type MeetingSource,
  type MeetingWarning,
  type PlatformHelper,
  type RecordingState,
} from "@murmur/shared";
import type { Logger } from "../helper/types";
import type { MeetingsStore } from "./meetings-store";

export type StartResult = { ok: true; meetingId: string } | { ok: false; message: string };

export interface MeetingRecorderDeps {
  helper: Pick<
    PlatformHelper,
    "startMeetingCapture" | "stopMeetingCapture" | "onCaptureChunk" | "onCaptureError"
  >;
  store: MeetingsStore;
  /** `<profile>/meetings`; each meeting gets a folder inside it. */
  meetingsDir: string;
  now(): number;
  newId(): string;
  options(): {
    captureSystem: boolean;
    chunkSeconds: number;
    micDeviceId: string | null;
    /** NT-20: a new meeting's language (null detects it) and whether it is translated to English. */
    language?: string | null;
    translate?: boolean;
    /** NT-17: the folder a new meeting goes in; null is the Inbox. */
    folderId?: string | null;
  };
  /**
   * SW-12: whether to warn that the computer's sound, with music and all, is being recorded.
   * Asked once the system channel has started.
   */
  playbackWarning?(channels: readonly MeetingChannel[]): boolean;
  /** Called after that warning went into a recording, so it is not said again. */
  onPlaybackWarned?(): void;
  /** Called on every change, for the Hub, the tray and the Bar. */
  onState(state: RecordingState): void;
  /** Called once a recording has ended and is ready to be transcribed. */
  onFinished?(meeting: Meeting): void;
  /** Deletes unfinished chunk files left in a folder by a crash. */
  removePartials(folder: string): void;
  logger: Logger;
}

export interface MeetingRecorder {
  state(): RecordingState;
  start(input?: {
    title?: string;
    source?: MeetingSource;
    /** NT-02: started from a calendar event: its id, who was invited, and the folder that calendar uses. */
    calendar?: { eventId: string; attendees: readonly MeetingAttendee[]; folderId?: string | null };
  }): Promise<StartResult>;
  /** Stops the recording; resolves with the finished meeting, or null when none ran. */
  stop(): Promise<Meeting | null>;
  /** The helper went away: the recording ends with what was saved. */
  helperDown(): void;
  /** Ends meetings a crash left as recording. Returns how many. */
  recover(): number;
  dispose(): void;
}

function startError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === "PERMISSION_DENIED") return "Murmur needs microphone access to record a meeting.";
  if (code === "HELPER_UNAVAILABLE")
    return "The helper is not running, so nothing can be recorded.";
  if (code === "DEVICE_NOT_FOUND") return "No microphone is connected.";
  if (code === "BUSY") return "A meeting is already being recorded.";
  return "The recording could not start.";
}

/**
 * One meeting recording at a time (NT-04). Main owns the meeting row; the helper writes the
 * chunk files and reports each one, and main stores it as it arrives.
 */
export function createMeetingRecorder(deps: MeetingRecorderDeps): MeetingRecorder {
  let state: RecordingState = { status: "idle" };

  const setState = (next: RecordingState) => {
    state = next;
    deps.onState(next);
  };

  const offChunk = deps.helper.onCaptureChunk((chunk) => {
    if (!deps.store.get(chunk.meetingId)) return;
    deps.store.addChunk(chunk);
  });

  const offError = deps.helper.onCaptureError((error) => {
    deps.store.addWarning(error.meetingId, error.code);
    if (state.status === "recording" && state.meetingId === error.meetingId) {
      if (!state.warnings.includes(error.code)) {
        setState({ ...state, warnings: [...state.warnings, error.code] });
      }
    }
  });

  /** Ends a meeting row: its length comes from the clock, or the chunks when it crashed. */
  function finish(meetingId: string, endedAt: number): Meeting | null {
    const meeting = deps.store.get(meetingId);
    if (!meeting) return null;
    const chunks = deps.store.chunks(meetingId);
    const recorded = Math.max(0, ...chunks.map((chunk) => chunk.startMs + chunk.durationMs));
    const durationMs = Math.max(recorded, endedAt - meeting.startedAt);
    if (chunks.length === 0) {
      // Nothing was saved: there is no meeting to keep.
      deps.store.remove(meetingId);
      return null;
    }
    deps.store.finish(meetingId, meeting.startedAt + durationMs, durationMs, "queued");
    const done = deps.store.get(meetingId);
    if (done) deps.onFinished?.(done);
    return done;
  }

  return {
    state: () => state,

    async start(input = {}) {
      if (state.status !== "idle")
        return { ok: false, message: "A meeting is already being recorded." };
      setState({ status: "starting" });
      const options = deps.options();
      const id = deps.newId();
      const startedAt = deps.now();
      const folder = path.join(deps.meetingsDir, id);
      const title = input.title?.trim() || defaultMeetingTitle(startedAt);
      deps.store.create({
        id,
        title,
        startedAt,
        source: input.source ?? "ad_hoc",
        folder,
        language: options.language ?? null,
        translate: options.translate ?? false,
        folderId: input.calendar?.folderId ?? options.folderId ?? null,
        calendarEventId: input.calendar?.eventId ?? null,
        attendees: input.calendar?.attendees ?? [],
      });
      const wanted: MeetingChannel[] = options.captureSystem ? ["mic", "system"] : ["mic"];
      try {
        const result = await deps.helper.startMeetingCapture({
          meetingId: id,
          folder,
          channels: wanted,
          chunkSeconds: options.chunkSeconds,
          micDeviceId: options.micDeviceId,
        });
        const channels = (["mic", "system"] as const).filter((name) => result.channels[name]);
        deps.store.setChannels(id, channels);
        const warnings: MeetingWarning[] = [...result.warnings];
        if (deps.playbackWarning?.(channels)) {
          warnings.push("system_playback");
          deps.onPlaybackWarned?.();
        }
        for (const warning of warnings) deps.store.addWarning(id, warning);
        deps.logger.info(`meeting recording started (${channels.join(", ")})`);
        setState({
          status: "recording",
          meetingId: id,
          title,
          startedAt,
          channels,
          warnings,
        });
        return { ok: true, meetingId: id };
      } catch (error) {
        deps.store.remove(id);
        deps.logger.info(`meeting recording did not start: ${String(error)}`);
        setState({ status: "idle" });
        return { ok: false, message: startError(error) };
      }
    },

    async stop() {
      if (state.status !== "recording") return null;
      const meetingId = state.meetingId;
      setState({ status: "stopping", meetingId });
      try {
        await deps.helper.stopMeetingCapture(meetingId);
      } catch (error) {
        deps.logger.info(`meeting stop failed: ${String(error)}`);
        deps.store.addWarning(meetingId, "interrupted");
      }
      const meeting = finish(meetingId, deps.now());
      setState({ status: "idle" });
      return meeting;
    },

    helperDown() {
      if (state.status !== "recording" && state.status !== "stopping") return;
      const meetingId = state.meetingId;
      deps.store.addWarning(meetingId, "interrupted");
      finish(meetingId, deps.now());
      setState({ status: "idle" });
    },

    recover() {
      const left = deps.store.withStatus("recording");
      for (const id of left) {
        const folder = deps.store.folderOf(id);
        if (folder) deps.removePartials(folder);
        deps.store.addWarning(id, "interrupted");
        // The end is where the saved audio ends, not the time of this start.
        finish(id, 0);
      }
      return left.length;
    },

    dispose() {
      offChunk();
      offError();
    },
  };
}
