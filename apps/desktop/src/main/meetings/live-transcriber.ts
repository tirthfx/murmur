import type {
  LivePartial,
  LiveTranscript,
  MeetingChannel,
  RecordingState,
  TranscribeLiveInput,
} from "@murmur/shared";
import type { Logger } from "../helper/types";

export interface LiveTranscriberDeps {
  transcribeLive(input: TranscribeLiveInput): Promise<LiveTranscript>;
  state(): RecordingState;
  /** True while a dictation is recording or being transcribed: it goes first. */
  dictating(): boolean;
  /** `notetaker.live`. */
  enabled(): boolean;
  /** How the meeting is transcribed (NT-20); without it the language is detected. */
  options?(meetingId: string): { languages: string[]; translate: boolean };
  /** True once a chunk's final segments are written: its partial is no longer shown. */
  isFinal(meetingId: string, channel: MeetingChannel, seq: number): boolean;
  wait(ms: number): Promise<void>;
  onPartial(partial: LivePartial): void;
  logger: Logger;
}

export interface LiveTranscriber {
  /** Runs until the recording of this meeting ends. Safe to call twice. */
  start(meetingId: string, channels: MeetingChannel[]): void;
  /** The grey text to show now, without chunks already transcribed for good. */
  partials(meetingId: string): LivePartial[];
  /** Resolves when the loop has ended (tests). */
  done(): Promise<void>;
}

/** Text the model writes for sounds rather than words. */
const NOT_SPEECH = /^[[(][^\])]*[\])]$/;

/** Pause between two live decodes, so the Mac is not kept busy. */
export const LIVE_PAUSE_MS = 1000;

/**
 * Live text during a meeting (NT-06): the chunk still being recorded on each channel is
 * decoded in turn, again and again, and shown as grey partial text. When the chunk is closed
 * the queue writes its final segments, which replace the partial. Each decode waits behind
 * any dictation.
 */
export function createLiveTranscriber(deps: LiveTranscriberDeps): LiveTranscriber {
  const latest = new Map<string, LivePartial>();
  let loop: Promise<void> | null = null;
  let loopMeeting: string | null = null;

  const recording = (meetingId: string) => {
    const state = deps.state();
    return state.status === "recording" && state.meetingId === meetingId;
  };

  async function run(meetingId: string, channels: MeetingChannel[]): Promise<void> {
    while (recording(meetingId)) {
      for (const channel of channels) {
        if (!recording(meetingId)) break;
        if (!deps.enabled() || deps.dictating()) continue;
        try {
          const how = deps.options?.(meetingId);
          const result = await deps.transcribeLive({
            meetingId,
            channel,
            ...(how && how.languages.length > 0 ? { languages: how.languages } : {}),
            ...(how?.translate ? { translate: true } : {}),
          });
          const partial: LivePartial = {
            meetingId,
            channel,
            seq: result.seq,
            segments: result.segments
              .map((segment) => ({
                startMs: result.startMs + segment.startMs,
                endMs: result.startMs + segment.endMs,
                text: segment.text.trim(),
              }))
              .filter((segment) => segment.text && !NOT_SPEECH.test(segment.text)),
          };
          latest.set(`${meetingId}:${channel}`, partial);
          deps.onPartial(partial);
        } catch (error) {
          // No model yet, or the helper is restarting: try again a little later.
          deps.logger.info(
            `live text paused: ${error instanceof Error ? error.message : String(error)}`,
          );
          await deps.wait(5 * LIVE_PAUSE_MS);
        }
      }
      await deps.wait(LIVE_PAUSE_MS);
    }
    for (const channel of channels) latest.delete(`${meetingId}:${channel}`);
  }

  return {
    start(meetingId, channels) {
      if (loop && loopMeeting === meetingId) return;
      loopMeeting = meetingId;
      loop = run(meetingId, channels).finally(() => {
        loop = null;
        loopMeeting = null;
      });
    },
    partials(meetingId) {
      return [...latest.values()].filter(
        (partial) =>
          partial.meetingId === meetingId &&
          partial.segments.length > 0 &&
          !deps.isFinal(meetingId, partial.channel, partial.seq),
      );
    },
    done: () => loop ?? Promise.resolve(),
  };
}
