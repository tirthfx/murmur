import type { Logger } from "../helper/types";
import type { MeetingRecap, RecapStatus } from "@murmur/shared";
import { createModelAsk, type ModelAskDeps } from "./model-ask";
import { MAX_TOKENS, SYSTEM, groundRecap, recapPrompt, type RecapLine } from "./recap";
import type { RecapsStore } from "./recaps-store";

export type RecapErrorCode = "busy" | "model-missing" | "no-text" | "failed";

export class RecapError extends Error {
  constructor(
    readonly code: RecapErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RecapError";
  }
}

export interface RecapRunnerDeps extends ModelAskDeps {
  /** Where the meeting is on its timeline now; null when there is no such meeting. */
  position(meetingId: string): { recording: boolean; nowMs: number } | null;
  /** The lines said so far (final ones and the grey live ones), in time order, spoken only. */
  lines(meetingId: string): RecapLine[];
  /** When the last summary was written on the meeting's timeline, or null (NT-13). */
  lastSummaryMs(meetingId: string): number | null;
  windowMinutes(): number;
  recaps: Pick<RecapsStore, "add">;
  modelId: string;
  modelReady(): Promise<boolean>;
  now(): number;
  newId(): string;
  onChange(meetingId: string): void;
  logger: Logger;
}

export interface RecapRunner {
  /** Writes a recap of the last minutes and keeps it. A second request while one runs is refused. */
  run(meetingId: string): Promise<MeetingRecap>;
  status(meetingId: string): RecapStatus;
}

/**
 * "What did I miss" (NT-13): a short recap of the last N minutes of a meeting, or of the time since
 * the last summary if that is shorter. One pass of the local model on the live transcript; it waits
 * behind a dictation and any other generation, and is asked again once with fewer bullets if what
 * came back has no bullet with a time inside the window.
 */
export function createRecapRunner(deps: RecapRunnerDeps): RecapRunner {
  const states = new Map<string, RecapStatus>();
  let running: string | null = null;
  const ask = createModelAsk(deps);
  const set = (meetingId: string, status: RecapStatus | null) => {
    if (status) states.set(meetingId, status);
    else states.delete(meetingId);
    deps.onChange(meetingId);
  };

  return {
    status: (meetingId) => states.get(meetingId) ?? { state: "idle" },

    async run(meetingId) {
      if (running !== null) throw new RecapError("busy", "A recap is being written.");
      const position = deps.position(meetingId);
      if (!position) throw new RecapError("failed", "That meeting is gone.");
      const minutes = deps.windowMinutes();
      const endMs = position.nowMs;
      const since = deps.lastSummaryMs(meetingId);
      const startMs = Math.max(0, endMs - minutes * 60_000, since ?? 0);
      const lines = deps
        .lines(meetingId)
        .filter((line) => line.startMs >= startMs && line.startMs <= endMs);
      if (lines.length === 0)
        throw new RecapError(
          "no-text",
          since !== null && since > endMs - minutes * 60_000
            ? "Nothing new has been said since the last summary."
            : `Nothing has been said in the last ${minutes} minutes yet.`,
        );
      if (!(await deps.modelReady()))
        throw new RecapError(
          "model-missing",
          "The language model is not downloaded. Get it in Settings.",
        );
      running = meetingId;
      set(meetingId, { state: "running" });
      try {
        let markdown = "";
        for (const brief of [false, true]) {
          const output = await ask({
            system: SYSTEM(brief),
            prompt: recapPrompt(lines),
            maxTokens: MAX_TOKENS,
          });
          markdown = groundRecap(output, lines, { startMs, endMs });
          if (markdown !== "") break;
        }
        if (markdown === "")
          throw new RecapError("failed", "The recap could not be written. Try again.");
        const recap = deps.recaps.add({
          id: deps.newId(),
          meetingId,
          windowStartMs: startMs,
          windowEndMs: endMs,
          markdown,
          modelId: deps.modelId,
          at: deps.now(),
        });
        set(meetingId, null);
        return recap;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.logger.warn(`recap of meeting ${meetingId} failed: ${message}`);
        set(meetingId, { state: "failed", message: "The recap could not be written. Try again." });
        throw error instanceof RecapError ? error : new RecapError("failed", message);
      } finally {
        running = null;
      }
    },
  };
}
