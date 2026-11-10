import type {
  AudioLevel,
  AudioSilent,
  HotkeyEvent,
  InsertTextResult,
  PlatformHelper,
  Transcript,
  Unsubscribe,
} from "@murmur/shared";
import type { CleanupResult } from "./cleanup/cleanup-service";
import type { Logger } from "./helper/types";

export interface RecorderDeps {
  helper: Pick<
    PlatformHelper,
    "startAudio" | "stopAudio" | "onAudioLevel" | "onAudioSilent" | "onStatusChange"
  >;
  logger: Logger;
  newSessionId: () => string;
  levelIntervalMs?: number;
  /** Turns a recorded file into text. Without it, recordings are only logged. */
  transcribe?: (path: string) => Promise<Transcript>;
  /** Also log the recognised text. Off by default: logs never hold what was said. */
  logTranscripts?: boolean;
  /** Puts the text into the focused field. Without it, text is only logged. */
  insert?: (text: string) => Promise<InsertTextResult>;
  /** Clipboard fallback when inserting is not allowed. */
  copy?: (text: string) => Promise<void>;
  /** What happened, for the Bar. */
  onEvent?: (event: RecorderEvent) => void;
  /** Cleans the transcript before it is inserted. Without it, the raw text is inserted. */
  clean?: (text: string) => Promise<CleanupResult>;
  /** Warms the cleanup model when recording starts. */
  prepareCleanup?: () => void;
  /** Stores a finished dictation (history). Returns the row id. */
  record?: (record: DictationRecord) => string | null;
  now?: () => number;
}

/** One finished dictation, as the history store keeps it. */
export interface DictationRecord {
  sessionId: string;
  source: "hold" | "retry";
  createdAt: number;
  durationMs: number;
  language: string | null;
  rawText: string | null;
  finalText: string | null;
  wordCount: number;
  cleanup: CleanupResult | null;
  insertStatus: "inserted" | "clipboard_only" | "failed" | "empty";
  insertMethod: "paste_cmd_v" | "keystrokes" | "clipboard" | null;
  errorCode: string | null;
  audio: { path: string; codec: "pcm_s16le" | "opus"; durationMs: number } | null;
  /** History id of the failed dictation this one retries. */
  retryOf: string | null;
}

/** A recording on its way through transcription, cleanup and insertion. */
interface Take {
  sessionId: string;
  source: DictationRecord["source"];
  createdAt: number;
  durationMs: number;
  audio: DictationRecord["audio"];
  retryOf: string | null;
}

type InsertOutcome = Pick<DictationRecord, "insertStatus"> &
  Partial<Pick<DictationRecord, "insertMethod" | "errorCode">>;

/** A dictation's steps, as the Bar needs them. Never carries what was said. */
export type RecorderEvent =
  | { type: "started"; at: number }
  | { type: "start-failed"; message: string }
  | { type: "stopped" }
  | { type: "silent-mic"; deviceName: string }
  | { type: "no-speech" }
  | { type: "stop-failed" }
  | { type: "transcribed"; words: number }
  | { type: "transcription-failed" }
  | { type: "copied-instead" }
  | { type: "insert-failed" };

export interface Recorder {
  start(): void;
  stop(): void;
  /** Hold-to-dictate: `down` starts a microphone session, `up` stops it. */
  handleHotkey(event: HotkeyEvent): void;
  /** Transcribes the last recording that failed to transcribe. False when there is none. */
  retryLast(): boolean;
  /** Resolves when every queued start, stop and transcription is done. For tests and shutdown. */
  idle(): Promise<void>;
}

interface Session {
  id: string;
  deviceName: string | null;
  levels: number;
}

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Turns the dictation key into microphone sessions. Starts and stops run one after the other,
 * so a quick release never reaches the helper before its start (which would answer BUSY).
 * Audio stays in the helper. After a stop the recording is transcribed and inserted, and
 * each step is reported through `onEvent` for the Bar.
 */
export function createRecorder(deps: RecorderDeps): Recorder {
  const { helper, logger } = deps;
  const levelIntervalMs = deps.levelIntervalMs ?? 100;
  let queue: Promise<void> = Promise.resolve();
  // Transcriptions run on their own queue so the next recording never waits for one.
  let transcriptions: Promise<void> = Promise.resolve();
  let current: Session | null = null;
  let subscriptions: Unsubscribe[] = [];
  let lastFailed: { take: Take; historyId: string | null } | null = null;
  const now = deps.now ?? Date.now;
  const emit = (event: RecorderEvent) => deps.onEvent?.(event);

  function enqueue(step: () => Promise<void>): void {
    queue = queue.then(step, step);
  }

  async function begin(): Promise<void> {
    if (current) return;
    const session: Session = { id: deps.newSessionId(), deviceName: null, levels: 0 };
    current = session;
    try {
      const started = await helper.startAudio({
        sessionId: session.id,
        emitLevels: true,
        levelIntervalMs,
      });
      session.deviceName = started.deviceName;
      logger.info(`recording from ${started.deviceName}`);
      emit({ type: "started", at: started.startedAt });
      deps.prepareCleanup?.();
    } catch (error) {
      if (current === session) current = null;
      if (errorCode(error) === "PERMISSION_DENIED") {
        logger.warn(
          "Microphone access is not granted, so nothing was recorded. Grant it from the Hub's Settings.",
        );
        emit({ type: "start-failed", message: "Microphone access is not granted" });
      } else {
        logger.warn(`could not start recording: ${errorMessage(error)}`);
        emit({ type: "start-failed", message: "The microphone could not start" });
      }
    }
  }

  async function end(): Promise<void> {
    const session = current;
    if (!session) return;
    current = null;
    emit({ type: "stopped" });
    try {
      const result = await helper.stopAudio(session.id);
      const seconds = (result.durationMs / 1000).toFixed(2);
      const file = result.audioFile ? `${result.audioFile.bytes} bytes` : "no file";
      logger.info(
        `captured ${seconds} s (${result.samples} samples at 16 kHz), peak ${result.peakDb} dB, mean ${result.meanDb} dB, ${session.levels} level events, ${file}`,
      );
      const take: Take = {
        sessionId: session.id,
        source: "hold",
        createdAt: now(),
        durationMs: result.durationMs,
        audio: result.audioFile
          ? {
              path: result.audioFile.path,
              codec: result.audioFile.codec,
              durationMs: result.durationMs,
            }
          : null,
        retryOf: null,
      };
      if (result.silent || !result.audioFile) {
        if (result.silent) logger.warn("nothing above the silence threshold was heard");
        emit({ type: "no-speech" });
        record(take, { insertStatus: "empty" });
      } else if (deps.transcribe) {
        transcriptions = transcriptions.then(() => runTake(take));
      }
    } catch (error) {
      logger.warn(`could not stop recording: ${errorMessage(error)}`);
      emit({ type: "stop-failed" });
    }
  }

  /** Transcribe, clean, insert, then write the history row. */
  async function runTake(take: Take): Promise<void> {
    let transcript: Transcript;
    try {
      transcript = await deps.transcribe!(take.audio!.path);
    } catch (error) {
      logger.warn(`could not transcribe: ${errorMessage(error)}`);
      const historyId = record(take, {
        insertStatus: "failed",
        errorCode:
          typeof errorCode(error) === "string"
            ? (errorCode(error) as string)
            : "TRANSCRIPTION_FAILED",
      });
      lastFailed = { take, historyId };
      emit({ type: "transcription-failed" });
      return;
    }
    const words = transcript.text.split(/\s+/).filter(Boolean).length;
    logger.info(
      `transcribed ${(transcript.audioMs / 1000).toFixed(2)} s in ${transcript.decodeMs} ms: ${words} words, language ${transcript.language || "unknown"}`,
    );
    if (deps.logTranscripts) logger.info(`text: ${transcript.text}`);
    lastFailed = null;
    const cleanup = await cleanUp(transcript.text);
    const final = cleanup?.text ?? transcript.text.trim();
    const finalWords = final.split(/\s+/).filter(Boolean).length;
    emit(finalWords === 0 ? { type: "no-speech" } : { type: "transcribed", words: finalWords });
    const outcome = final === "" ? { insertStatus: "empty" as const } : await insert(final);
    record(take, {
      ...outcome,
      language: transcript.language || null,
      rawText: transcript.text,
      finalText: final,
      wordCount: finalWords,
      cleanup,
    });
  }

  async function cleanUp(text: string): Promise<CleanupResult | null> {
    if (!deps.clean) return null;
    const result = await deps.clean(text);
    const how =
      result.source === "model"
        ? `model in ${result.modelMs} ms`
        : `rules only${result.reason ? ` (${result.reason})` : ""}`;
    logger.info(`cleanup: ${how}`);
    if (deps.logTranscripts) logger.info(`clean text: ${result.text}`);
    return result;
  }

  async function insert(text: string): Promise<InsertOutcome> {
    if (!deps.insert) return { insertStatus: "failed", errorCode: "NO_INSERTER" };
    const started = Date.now();
    try {
      const result = await deps.insert(text);
      const restored =
        result.clipboardRestored === null
          ? ""
          : result.clipboardRestored
            ? ", clipboard restored"
            : ", clipboard kept (it changed meanwhile)";
      logger.info(`inserted by ${result.method} in ${Date.now() - started} ms${restored}`);
      return {
        insertStatus: "inserted",
        insertMethod: result.method === "auto" ? null : result.method,
      };
    } catch (error) {
      if (errorCode(error) === "PERMISSION_DENIED" && deps.copy) {
        await deps.copy(text).catch(() => {});
        logger.warn(
          "Accessibility is not granted, so the text was copied to the clipboard instead. Grant it from the Hub's Settings.",
        );
        emit({ type: "copied-instead" });
        return { insertStatus: "clipboard_only", insertMethod: "clipboard" };
      }
      logger.warn(`could not insert: ${errorMessage(error)}`);
      emit({ type: "insert-failed" });
      const code = errorCode(error);
      return {
        insertStatus: "failed",
        errorCode: typeof code === "string" ? code : "PASTE_FAILED",
      };
    }
  }

  /** Hands the finished dictation to the history store. Returns its row id, if stored. */
  function record(
    take: Take,
    fields: Partial<DictationRecord> & Pick<DictationRecord, "insertStatus">,
  ): string | null {
    if (!deps.record) return null;
    try {
      return deps.record({
        sessionId: take.sessionId,
        source: take.source,
        createdAt: take.createdAt,
        durationMs: take.durationMs,
        audio: take.audio,
        retryOf: take.retryOf,
        language: null,
        rawText: null,
        finalText: null,
        wordCount: 0,
        cleanup: null,
        insertMethod: null,
        errorCode: null,
        ...fields,
      });
    } catch (error) {
      logger.warn(`could not save to history: ${errorMessage(error)}`);
      return null;
    }
  }

  function handleLevel(level: AudioLevel): void {
    if (current && level.sessionId === current.id) current.levels += 1;
  }

  function handleSilent(silent: AudioSilent): void {
    if (!current || silent.sessionId !== current.id) return;
    const name = silent.deviceName ?? current.deviceName ?? "the microphone";
    logger.warn(`No sound from ${name}. Check the input in System Settings.`);
    emit({ type: "silent-mic", deviceName: name });
  }

  return {
    start() {
      if (subscriptions.length > 0) return;
      subscriptions = [
        helper.onAudioLevel(handleLevel),
        helper.onAudioSilent(handleSilent),
        helper.onStatusChange((status) => {
          // A restarted helper has no session; forget ours.
          if (status.state !== "ready") current = null;
        }),
      ];
    },
    stop() {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
    },
    handleHotkey(event) {
      if (event.action !== "dictate.hold") return;
      // Every press gets a session, however short; later steps decide what to keep.
      if (event.state === "down") enqueue(begin);
      else if (event.state === "up") enqueue(end);
    },
    retryLast() {
      const failed = lastFailed;
      if (!failed || !deps.transcribe) return false;
      lastFailed = null;
      logger.info("retrying the last transcription");
      const take: Take = {
        ...failed.take,
        source: "retry",
        createdAt: now(),
        retryOf: failed.historyId,
      };
      transcriptions = transcriptions.then(() => runTake(take));
      return true;
    },
    idle: async () => {
      await queue;
      await transcriptions;
    },
  };
}
