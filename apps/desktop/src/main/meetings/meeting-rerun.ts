import type { MeetingLanguageInput, RerunResult } from "@murmur/shared";
import type { MeetingJobs } from "./meeting-jobs";
import type { MeetingsStore } from "./meetings-store";
import type { TranscriptVersions } from "./transcript-versions";

export interface MeetingRerunDeps {
  meetings: MeetingsStore;
  versions: TranscriptVersions;
  jobs: Pick<MeetingJobs, "enqueue" | "kick">;
  /** `notetaker.rerun.keepPreviousVersionDays`. */
  keepDays(): number;
  /** True when every audio chunk file of the meeting is still on the disk. */
  audioPresent(meetingId: string): boolean;
  now(): number;
  /** The meeting changed. */
  onChange(meetingId: string): void;
}

export interface MeetingRerun {
  /** Why the meeting cannot be transcribed again now, or null when it can. */
  blocked(meetingId: string): string | null;
  /** Transcribes a finished meeting again, as a new version, with this language. */
  rerun(meetingId: string, input: MeetingLanguageInput): RerunResult;
  /** Sets how a meeting that is still recording is transcribed from now on. */
  setLanguage(meetingId: string, input: MeetingLanguageInput): RerunResult;
  restore(meetingId: string, versionId: number): RerunResult;
}

/**
 * Rerun from saved audio (NT-23). A rerun is not an edit in place: the transcript it replaces
 * is saved first, in one transaction with the new job being queued, and the old one can be put
 * back for a number of days. Notes and tasks are not touched, so tasks marked done stay done.
 */
export function createMeetingRerun(deps: MeetingRerunDeps): MeetingRerun {
  const blocked = (meetingId: string): string | null => {
    const meeting = deps.meetings.get(meetingId);
    if (!meeting) return "That meeting is gone.";
    if (meeting.status === "recording") return "The meeting is still recording.";
    if (meeting.status === "queued" || meeting.status === "processing")
      return "The meeting is being transcribed. Try again when that is done.";
    if (meeting.audioDeletedAt !== null)
      return "The audio of this meeting was deleted, so it cannot be transcribed again.";
    if (deps.meetings.chunks(meetingId).length === 0) return "There is no audio to transcribe.";
    if (!deps.audioPresent(meetingId))
      return "Some of the audio files of this meeting are missing.";
    return null;
  };

  return {
    blocked,

    rerun(meetingId, input) {
      const reason = blocked(meetingId);
      if (reason) return { ok: false, message: reason };
      deps.versions.startRerun(
        meetingId,
        { language: input.language, translate: input.translate },
        deps.keepDays(),
        deps.now(),
      );
      deps.jobs.enqueue(meetingId, "transcribe");
      deps.jobs.kick();
      deps.onChange(meetingId);
      return { ok: true };
    },

    setLanguage(meetingId, input) {
      const meeting = deps.meetings.get(meetingId);
      if (!meeting) return { ok: false, message: "That meeting is gone." };
      if (meeting.status !== "recording")
        return {
          ok: false,
          message: "Changing the language of a finished meeting transcribes it again.",
        };
      deps.meetings.setLanguage(meetingId, input.language, input.translate);
      deps.onChange(meetingId);
      return { ok: true };
    },

    restore(meetingId, versionId) {
      const meeting = deps.meetings.get(meetingId);
      if (!meeting) return { ok: false, message: "That meeting is gone." };
      if (meeting.status !== "ready" && meeting.status !== "failed")
        return { ok: false, message: "Wait until the meeting has been transcribed." };
      const result = deps.versions.restore(meetingId, versionId, deps.keepDays(), deps.now());
      if (result.ok) deps.onChange(meetingId);
      return result;
    },
  };
}
