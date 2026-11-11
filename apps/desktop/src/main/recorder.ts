import type {
  AudioLevel,
  AudioRouteChanged,
  AudioSilent,
  HotkeyEvent,
  FocusContext,
  InsertTextResult,
  Snippet,
  StyleFlags,
  PlatformHelper,
  Transcript,
  Unsubscribe,
} from "@murmur/shared";
import type { CleanupResult } from "./cleanup/cleanup-service";
import { DictationGesture, type GestureCommand } from "./gesture";
import { contextTerms, describeContext, speechPrompt } from "./context/context";
import { applyStyleRules, PRESETS } from "@murmur/shared";
import { splitMessages } from "./experimental/split-messages";
import { splitPressEnter } from "./insertion/press-enter";
import { applyReplacements, keepSpellings, speechPromptWithTerms } from "./dictionary/apply";
import type { DictionaryRules } from "./dictionary/dictionary-store";
import { assemble, findSnippets, type Piece } from "./snippets/match";
import type { ResolvedStyle } from "./styles/style-store";
import { dropSoundTags } from "./speech/sound-tags";
import { systemClock } from "./helper/node-runtime";
import type { Clock, Logger } from "./helper/types";

/** Failures worth one automatic retry (DC-38): the model or the helper was briefly away. */
const AUTO_RETRY_CODES: ReadonlySet<unknown> = new Set([
  "TRANSCRIPTION_TIMEOUT",
  "HELPER_RESTARTED",
  "HELPER_TIMEOUT",
  "HELPER_UNAVAILABLE",
  "MODEL_NOT_READY",
]);
/**
 * Key release to text in the field (M1: under 2.5 s for ten seconds of speech). Cleanup gets
 * what is left of this after transcription, so a long dictation uses the rules' text rather
 * than arrive late. Paste takes about 50 ms more.
 */
export const RESPONSE_TARGET_MS = 2300;

/** Wait before the automatic retry. */
export const AUTO_RETRY_DELAY_MS = 2000;

/** Longest wait for the focused field; a slow app never delays the text. */
const CONTEXT_WAIT_MS = 1500;

export interface RecorderDeps {
  helper: Pick<
    PlatformHelper,
    | "startAudio"
    | "stopAudio"
    | "cancelAudio"
    | "onAudioLevel"
    | "onAudioSilent"
    | "onStatusChange"
    | "onAudioRouteChanged"
  >;
  logger: Logger;
  newSessionId: () => string;
  levelIntervalMs?: number;
  /** Turns a recorded file into text. Without it, recordings are only logged. */
  transcribe?: (path: string, options: { prompt: string }) => Promise<Transcript>;
  /**
   * Reads the focused field when a recording starts (DC-30). Null when context is off or
   * cannot be read. Kept in memory for that dictation only.
   */
  readContext?: () => Promise<FocusContext | null>;
  /** Also log the recognised text. Off by default: logs never hold what was said. */
  logTranscripts?: boolean;
  /** Puts the text into the focused field. Without it, text is only logged. */
  insert?: (
    text: string,
    options: { pressEnter: boolean; html?: string },
  ) => Promise<InsertTextResult>;
  /**
   * Whether the text around the caret may be used (context awareness). When false the context
   * still names the app, for its style, but its text and title are not used. On when missing.
   */
  useContextText?: () => boolean;
  /** The style for the app in front (PZ-11, PZ-13). */
  styles?: {
    resolve(app: { bundleId: string | null; windowTitle: string | null }): ResolvedStyle;
  };
  /** Snippets (PZ-08): a trigger said on its own inserts the saved body, unchanged. */
  snippets?: {
    list(): Snippet[];
    recordUse(id: string): void;
  };
  /** Split long dictations into messages at pauses (experimental, DC-37). */
  splitMessages?: () => boolean;
  /** Whether "press enter" at the end of a dictation presses Return. Off when missing. */
  pressEnterCommand?: () => boolean;
  /** Clipboard fallback when inserting is not allowed. */
  copy?: (text: string) => Promise<void>;
  /** What happened, for the Bar. */
  onEvent?: (event: RecorderEvent) => void;
  /** Cleans the transcript before it is inserted. Without it, the raw text is inserted. */
  clean?: (
    text: string,
    options: { terms: string[]; budgetMs: number; instructions?: string[] },
  ) => Promise<CleanupResult>;
  /** Warms the cleanup model when recording starts. */
  prepareCleanup?: () => void;
  /**
   * The personal dictionary (PZ-01, PZ-04): terms for the speech prompt and cleanup, exact
   * spellings, and replacements applied before cleanup. Uses are counted per dictation.
   */
  dictionary?: {
    rules(): DictionaryRules;
    recordUses(ids: string[]): void;
  };
  /** Rewrites the recognised text before anything else (Hindi in Latin letters, DC-18). */
  rewriteText?: (text: string) => string;
  /** Whisper mode for the next recording (DC-12). */
  whisperMode?: () => boolean;
  /** The microphone for the next session: a device id, or null for the system default. */
  deviceId?: () => string | null;
  /** Stores a finished dictation (history). Returns the row id. */
  record?: (record: DictationRecord) => string | null;
  now?: () => number;
  /** Timers for the double-tap window. */
  clock?: Clock;
  /** Runs before the microphone starts (start sound, output mute). */
  beforeStart?: () => Promise<void>;
  /** Runs after every recording ends, whatever the outcome (restore the output). */
  afterEnd?: () => Promise<void>;
  /** Keeps a note of each recording until its history row is written (crash recovery). */
  pending?: {
    start(sessionId: string, at: number): void;
    stopped(sessionId: string, audioPath: string, durationMs: number): void;
    clear(sessionId: string): void;
  };
  /** The newest failed dictation in history that can still be retried. */
  lastRetryable?: () => {
    historyId: string;
    sessionId: string;
    createdAt: number;
    durationMs: number;
    audioPath: string;
  } | null;
  /** True once a retry of this history row inserted its text. */
  isResolved?: (historyId: string) => boolean;
  /** Waits until the speech model is ready again (after a helper restart), or gives up. */
  waitForSpeech?: () => Promise<void>;
  /** Sleeps before the automatic retry; tests pass a fake. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Asked before each recording: a sentence saying why dictation cannot start (setup not
   * finished), or null to go ahead.
   */
  blocked?: () => Promise<string | null>;
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
  /** Return was pressed after the text. */
  pressEnter?: boolean;
  /** The app the text went into. */
  appBundleId?: string | null;
  /** The app's name, from the context read at the start. */
  appName?: string | null;
  /** The style used (PZ-11). */
  styleId?: string | null;
}

/** A recording on its way through transcription, cleanup and insertion. */
interface Take {
  sessionId: string;
  source: DictationRecord["source"];
  createdAt: number;
  durationMs: number;
  audio: DictationRecord["audio"];
  retryOf: string | null;
  /** The focused field at the start; memory only, never stored. */
  context: Promise<FocusContext | null>;
  /** When the key was released (or a retry began): the response deadline counts from here. */
  releasedAt: number;
  /** Set on the one automatic retry, so it is never retried twice. */
  autoRetried?: boolean;
}

type InsertOutcome = Pick<DictationRecord, "insertStatus"> &
  Partial<Pick<DictationRecord, "insertMethod" | "errorCode" | "pressEnter" | "appBundleId">>;

/** A dictation's steps, as the Bar needs them. Never carries what was said. */
export type RecorderEvent =
  | { type: "started"; at: number }
  | { type: "locked" }
  | { type: "cancelled" }
  | { type: "start-failed"; message: string }
  | { type: "stopped" }
  | { type: "silent-mic"; deviceName: string }
  | { type: "no-speech" }
  | { type: "stop-failed" }
  | { type: "transcribed"; words: number }
  | { type: "transcription-failed" }
  | { type: "copied-instead" }
  | { type: "insert-failed" }
  /** The microphone in use went away mid-recording; recording goes on with another one. */
  | { type: "mic-switched"; deviceName: string | null }
  /** Return was asked for but another app had come to the front. */
  | { type: "enter-skipped" }
  /** A failed dictation is being transcribed again. */
  | { type: "retrying" };

export interface Recorder {
  start(): void;
  stop(): void;
  /**
   * Dictation keys: hold to talk, double tap or the hands-free shortcut to lock, Escape to
   * cancel. See `DictationGesture`.
   */
  handleHotkey(event: HotkeyEvent): void;
  /** Starts hands-free dictation, or stops the recording in progress. For the tray menu. */
  toggle(): void;
  /** True while recording, or while a recording is transcribed, cleaned or inserted. */
  isBusy(): boolean;
  /**
   * Transcribes the last recording that failed, from this run or (after a restart) from
   * history. False when there is none, or it is already being retried or was inserted.
   */
  retryLast(): boolean;
  /** Whether `retryLast` has something to retry. */
  canRetry(): boolean;
  /** Resolves when every queued start, stop and transcription is done. For tests and shutdown. */
  idle(): Promise<void>;
}

interface Session {
  id: string;
  deviceName: string | null;
  levels: number;
  context: Promise<FocusContext | null>;
  /** The Bar is told about an input change once per session. */
  switched: boolean;
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
  const retrying = new Set<string>();
  /** Bookkeeping that must never break a dictation. */
  function note(write: () => void): void {
    try {
      write();
    } catch (error) {
      logger.warn(`could not note the recording for recovery: ${errorMessage(error)}`);
    }
  }
  const now = deps.now ?? Date.now;
  const emit = (event: RecorderEvent) => deps.onEvent?.(event);

  /** Never rejects and never holds up a dictation for long. */
  function readContext(): Promise<FocusContext | null> {
    if (!deps.readContext) return Promise.resolve(null);
    const read = deps.readContext().then(
      (context) => {
        logger.info(describeContext(context));
        return context;
      },
      () => null,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), CONTEXT_WAIT_MS);
    });
    return Promise.race([read, limit]).finally(() => clearTimeout(timer));
  }
  const gesture = new DictationGesture(deps.clock ?? systemClock, (command) => perform(command));

  function perform(command: GestureCommand): void {
    switch (command) {
      case "start":
        enqueue(begin);
        return;
      case "stop":
        enqueue(end);
        return;
      case "lock":
        // Queued like start and stop, so the Bar sees "started" before "locked".
        enqueue(async () => {
          if (!current) return;
          logger.info("hands-free on");
          emit({ type: "locked" });
        });
        return;
      case "cancel":
        enqueue(cancelSession);
        return;
    }
  }

  function enqueue(step: () => Promise<void>): void {
    queue = queue.then(step, step);
  }

  async function begin(): Promise<void> {
    if (current) return;
    const reason = (await deps.blocked?.()) ?? null;
    if (reason !== null) {
      logger.warn(`dictation is blocked: ${reason}`);
      // Nothing was started, so no lock or hold may linger.
      gesture.reset();
      emit({ type: "start-failed", message: reason });
      return;
    }
    const session: Session = {
      id: deps.newSessionId(),
      deviceName: null,
      levels: 0,
      switched: false,
      // Read before the microphone starts, while the field the user is in still has focus.
      context: readContext(),
    };
    current = session;
    try {
      await deps.beforeStart?.();
      const chosen = deps.deviceId?.() ?? null;
      const options = {
        sessionId: session.id,
        emitLevels: true,
        levelIntervalMs,
        ...(deps.whisperMode?.() ? { whisper: true } : {}),
      };
      let started;
      try {
        started = await helper.startAudio({ ...options, deviceId: chosen });
      } catch (error) {
        // The chosen microphone is gone: record from the system default instead.
        if (chosen === null || errorCode(error) !== "DEVICE_NOT_FOUND") throw error;
        logger.warn("the chosen microphone is not connected; using the system default");
        started = await helper.startAudio({ ...options, deviceId: null });
      }
      session.deviceName = started.deviceName;
      logger.info(`recording from ${started.deviceName}`);
      note(() => deps.pending?.start(session.id, now()));
      emit({ type: "started", at: started.startedAt });
      deps.prepareCleanup?.();
    } catch (error) {
      if (current === session) current = null;
      // A failed start leaves no lock behind, so the next press starts cleanly.
      gesture.reset();
      await deps.afterEnd?.();
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
    const releasedAt = now();
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
        context: session.context,
        releasedAt,
      };
      if (result.audioFile) {
        const audioPath = result.audioFile.path;
        note(() => deps.pending?.stopped(session.id, audioPath, result.durationMs));
      }
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
    } finally {
      await deps.afterEnd?.();
    }
  }

  /** Escape: discard the recording, insert nothing. */
  async function cancelSession(): Promise<void> {
    const session = current;
    if (!session) return;
    current = null;
    emit({ type: "cancelled" });
    try {
      await helper.cancelAudio(session.id);
      note(() => deps.pending?.clear(session.id));
      logger.info("dictation cancelled; the recording was discarded");
    } catch (error) {
      logger.warn(`could not cancel the recording: ${errorMessage(error)}`);
    } finally {
      await deps.afterEnd?.();
    }
  }

  /** Transcribe, clean, insert, then write the history row. */
  let processing = 0;

  async function runTake(take: Take): Promise<void> {
    processing++;
    try {
      await processTake(take);
    } finally {
      processing--;
    }
  }

  async function processTake(take: Take): Promise<void> {
    let transcript: Transcript;
    try {
      const context = textContext(await take.context);
      const promptTerms = deps.dictionary?.rules().promptTerms ?? [];
      transcript = await deps.transcribe!(take.audio!.path, {
        prompt: speechPromptWithTerms(promptTerms, speechPrompt(context)),
      });
    } catch (error) {
      logger.warn(`could not transcribe: ${errorMessage(error)}`);
      if (AUTO_RETRY_CODES.has(errorCode(error)) && !take.autoRetried) {
        // Nothing is recorded yet: only the outcome of the retry is, so text goes in once.
        logger.info(`retrying once in ${AUTO_RETRY_DELAY_MS / 1000} s`);
        await (deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(
          AUTO_RETRY_DELAY_MS,
        );
        await deps.waitForSpeech?.().catch(() => {});
        // The wait used the time; the retried text uses the rules unless time is left.
        await processTake({ ...take, autoRetried: true });
        return;
      }
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
    // Noise labels ("*thud*") were never said; then any script rewrite (Hindi in Latin letters),
    // then the dictionary's replacements and spellings.
    const rules = deps.dictionary?.rules() ?? null;
    const used = new Set<string>();
    const byDictionary = (text: string): string => {
      if (!rules) return text;
      const replaced = applyReplacements(text, rules.replacements);
      const spelled = keepSpellings(replaced.text, rules.spellings);
      for (const id of [...replaced.used, ...spelled.used]) used.add(id);
      return spelled.text;
    };
    /** After cleanup the model may have changed a case; uses were counted already. */
    const respell = (text: string): string =>
      rules ? keepSpellings(text, rules.spellings).text : text;
    const toText = (raw: string): string => {
      const spokenOnly = dropSoundTags(raw);
      return byDictionary(deps.rewriteText ? deps.rewriteText(spokenOnly) : spokenOnly);
    };
    const heard = toText(transcript.text);
    // The command is taken off before cleanup, so the model never sees it.
    const spoken = deps.pressEnterCommand?.()
      ? splitPressEnter(heard.trim())
      : { text: heard, pressEnter: false };
    const context = await take.context;
    const terms = [
      ...contextTerms(textContext(context)),
      ...(rules ? dictionaryTermsIn(heard, rules) : []),
    ];
    // The style for the app in front: rules after cleanup, instructions for the model.
    const resolved =
      deps.styles?.resolve({
        bundleId: context?.bundleId ?? null,
        windowTitle: context?.windowTitle ?? null,
      }) ?? null;
    const style: TakeStyle = resolved
      ? {
          id: resolved.style.id,
          flags: PRESETS[resolved.style.preset].flags,
          instructions: styleInstructions(resolved),
          appName: context?.appName ?? null,
        }
      : { id: null, flags: null, instructions: [], appName: context?.appName ?? null };
    if (resolved) {
      logger.info(
        `style: ${resolved.style.category} (${resolved.category}, from ${resolved.source})`,
      );
    }
    const keep = new Set(terms.map((term) => term.toLowerCase()));
    const styled = (text: string) =>
      style.flags ? applyStyleRules(text, style.flags, keep) : text;
    // Split into messages (experimental, DC-37): each part goes in and is sent with Return.
    const parts = deps.splitMessages?.()
      ? splitMessages({
          text: spoken.text,
          segments: transcript.segments.map((segment) => ({
            ...segment,
            text: toText(segment.text),
          })),
        })
      : [];
    const countUses = () => {
      if (used.size > 0) deps.dictionary?.recordUses([...used]);
    };
    if (parts.length > 1) {
      await sendMessages(
        take,
        transcript,
        parts,
        spoken.pressEnter,
        terms,
        (text) => styled(respell(text)),
        style,
      );
      countUses();
      return;
    }
    const pieces = deps.snippets ? findSnippets(spoken.text, deps.snippets.list()) : null;
    if (pieces) {
      await insertWithSnippets(
        take,
        transcript,
        pieces,
        spoken.pressEnter,
        terms,
        (text) => styled(respell(text)),
        style,
      );
      countUses();
      return;
    }
    const cleanup =
      spoken.text.trim() === ""
        ? null
        : await cleanUp(spoken.text, terms, take.releasedAt, style.instructions);
    const final = styled(respell(cleanup?.text ?? spoken.text.trim()));
    countUses();
    const finalWords = final.split(/\s+/).filter(Boolean).length;
    emit(
      finalWords === 0 && !spoken.pressEnter
        ? { type: "no-speech" }
        : { type: "transcribed", words: finalWords },
    );
    const outcome =
      final === "" && !spoken.pressEnter
        ? { insertStatus: "empty" as const }
        : await insert(final, spoken.pressEnter);
    record(take, {
      ...outcome,
      language: transcript.language || null,
      rawText: transcript.text,
      finalText: final,
      wordCount: finalWords,
      cleanup,
      styleId: style.id,
      appName: style.appName,
    });
  }

  /**
   * A dictation with snippets: the text around each trigger is cleaned on its own, so the
   * model never sees a body, then the bodies go back in unchanged.
   */
  async function insertWithSnippets(
    take: Take,
    transcript: Transcript,
    pieces: Piece[],
    pressEnter: boolean,
    terms: string[],
    finish: (text: string) => string,
    style: TakeStyle,
  ): Promise<void> {
    const cleaned: Piece[] = [];
    for (const piece of pieces) {
      if (piece.kind === "snippet") {
        cleaned.push(piece);
        continue;
      }
      const cleanup = await cleanUp(piece.text, terms, take.releasedAt, style.instructions);
      cleaned.push({ kind: "text", text: finish(cleanup?.text ?? piece.text) });
    }
    const expanded = cleaned.filter((piece) => piece.kind === "snippet");
    logger.info(`expanded ${expanded.length} snippet${expanded.length === 1 ? "" : "s"}`);
    for (const piece of expanded) {
      if (piece.kind === "snippet") deps.snippets?.recordUse(piece.snippet.id);
    }
    const { text, html } = assemble(cleaned);
    const words = text.split(/\s+/).filter(Boolean).length;
    emit({ type: "transcribed", words });
    const outcome = await insert(text, pressEnter, html);
    record(take, {
      ...outcome,
      language: transcript.language || null,
      rawText: transcript.text,
      finalText: text,
      wordCount: words,
      cleanup: null,
      styleId: style.id,
      appName: style.appName,
    });
  }

  /** Inserts each part, pressing Return after all but the last (unless asked for by voice). */
  async function sendMessages(
    take: Take,
    transcript: Transcript,
    parts: string[],
    pressEnterAtEnd: boolean,
    terms: string[],
    finish: (text: string) => string,
    style: TakeStyle,
  ): Promise<void> {
    logger.info(`split into ${parts.length} messages`);
    // The spoken command, if any, was on the last part's segments; take it off there too.
    const last = splitPressEnter(parts.at(-1)!);
    const texts = [...parts.slice(0, -1), pressEnterAtEnd ? last.text : parts.at(-1)!];
    emit({ type: "transcribed", words: texts.join(" ").split(/\s+/).filter(Boolean).length });
    const finals: string[] = [];
    let outcome: InsertOutcome = { insertStatus: "inserted" };
    for (const [index, text] of texts.entries()) {
      const cleanup =
        text.trim() === "" ? null : await cleanUp(text, terms, take.releasedAt, style.instructions);
      const final = finish(cleanup?.text ?? text.trim());
      finals.push(final);
      const isLast = index === texts.length - 1;
      const result = await insert(final, isLast ? pressEnterAtEnd : true);
      outcome = result;
      // A part that did not go in stops the rest, so messages never arrive out of order.
      if (result.insertStatus !== "inserted") break;
    }
    const finalText = finals.join("\n");
    const finalWords = finalText.split(/\s+/).filter(Boolean).length;
    record(take, {
      ...outcome,
      language: transcript.language || null,
      rawText: transcript.text,
      finalText,
      wordCount: finalWords,
      cleanup: null,
      styleId: style.id,
      appName: style.appName,
    });
  }

  async function cleanUp(
    text: string,
    terms: string[],
    releasedAt: number,
    instructions: string[] = [],
  ): Promise<CleanupResult | null> {
    if (!deps.clean) return null;
    const budgetMs = Math.max(0, RESPONSE_TARGET_MS - (now() - releasedAt));
    const result = await deps.clean(text, {
      terms,
      budgetMs,
      ...(instructions.length > 0 ? { instructions } : {}),
    });
    const how =
      result.source === "model"
        ? `model in ${result.modelMs} ms`
        : `rules only${result.reason ? ` (${result.reason})` : ""}`;
    logger.info(`cleanup: ${how}`);
    if (deps.logTranscripts) logger.info(`clean text: ${result.text}`);
    return result;
  }

  async function insert(
    text: string,
    pressEnter: boolean,
    html: string | null = null,
  ): Promise<InsertOutcome> {
    if (!deps.insert) return { insertStatus: "failed", errorCode: "NO_INSERTER" };
    const started = Date.now();
    try {
      const result = await deps.insert(text, { pressEnter, ...(html ? { html } : {}) });
      const restored =
        result.clipboardRestored === null
          ? ""
          : result.clipboardRestored
            ? ", clipboard restored"
            : ", clipboard kept (it changed meanwhile)";
      logger.info(`inserted by ${result.method} in ${Date.now() - started} ms${restored}`);
      if (pressEnter && result.enterPressed !== true) {
        logger.warn("Return was not pressed: another app had come to the front");
        emit({ type: "enter-skipped" });
      }
      return {
        insertStatus: "inserted",
        insertMethod: result.method === "auto" ? null : result.method,
        pressEnter: result.enterPressed === true,
        appBundleId: result.appBundleId ?? null,
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

  /** The context as far as its text may be used: none of it when context awareness is off. */
  function textContext(context: FocusContext | null): FocusContext | null {
    if (!context || deps.useContextText?.() !== false) return context;
    return { ...context, windowTitle: null, textBefore: "", textAfter: "" };
  }

  function handleLevel(level: AudioLevel): void {
    if (current && level.sessionId === current.id) current.levels += 1;
  }

  function handleRouteChanged(change: AudioRouteChanged): void {
    if (!current || change.sessionId !== current.id) return;
    const name = change.deviceName;
    logger.warn(
      name === null
        ? `the microphone went away (${change.reason}) and no other input could start`
        : `the microphone changed (${change.reason}); recording goes on from ${name}`,
    );
    if (name !== null) current.deviceName = name;
    if (current.switched) return;
    current.switched = true;
    emit({ type: "mic-switched", deviceName: name });
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
        helper.onAudioRouteChanged(handleRouteChanged),
        helper.onStatusChange((status) => {
          // A restarted helper has no session; forget ours, and any lock.
          if (status.state !== "ready") {
            current = null;
            gesture.reset();
          }
        }),
      ];
    },
    stop() {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
    },
    handleHotkey(event) {
      if (event.action === "dictate.hold") {
        if (event.state === "down") gesture.holdDown(event.at);
        else if (event.state === "up") gesture.holdUp(event.at);
      } else if (event.action === "dictate.toggle" && event.state !== "up") {
        gesture.toggle();
      } else if (event.action === "dictate.cancel" && event.state !== "up") {
        gesture.cancel();
      }
    },
    toggle() {
      gesture.toggle();
    },
    isBusy: () => current !== null || processing > 0,
    retryLast() {
      if (!deps.transcribe) return false;
      let take: Take | null = null;
      const failed = lastFailed;
      lastFailed = null;
      if (failed) {
        // History moves a failed dictation's audio to the kept folder; read it from there.
        const stored = failed.historyId !== null ? (deps.lastRetryable?.() ?? null) : null;
        const audio =
          stored && stored.historyId === failed.historyId && failed.take.audio
            ? { ...failed.take.audio, path: stored.audioPath }
            : failed.take.audio;
        take = {
          ...failed.take,
          audio,
          source: "retry",
          createdAt: now(),
          retryOf: failed.historyId,
          releasedAt: now(),
        };
      } else {
        // After a restart: the newest failed or interrupted dictation in history.
        const stored = deps.lastRetryable?.() ?? null;
        if (stored) {
          take = {
            sessionId: stored.sessionId,
            source: "retry",
            createdAt: now(),
            durationMs: stored.durationMs,
            audio: { path: stored.audioPath, codec: "pcm_s16le", durationMs: stored.durationMs },
            retryOf: stored.historyId,
            context: Promise.resolve(null),
            releasedAt: now(),
          };
        }
      }
      if (!take) return false;
      const retryOf = take.retryOf;
      // Never insert the same dictation twice: not while a retry of it runs, and not after
      // one succeeded.
      if (retryOf !== null && (retrying.has(retryOf) || deps.isResolved?.(retryOf))) return false;
      if (retryOf !== null) retrying.add(retryOf);
      logger.info("retrying the last transcription");
      emit({ type: "retrying" });
      const chosen = take;
      transcriptions = transcriptions.then(async () => {
        try {
          await runTake(chosen);
        } finally {
          if (retryOf !== null) retrying.delete(retryOf);
        }
      });
      return true;
    },
    canRetry() {
      if (lastFailed) return true;
      const stored = deps.lastRetryable?.() ?? null;
      return stored !== null && !retrying.has(stored.historyId);
    },
    idle: async () => {
      await queue;
      await transcriptions;
    },
  };
}

/** Dictionary terms that occur in the text, for the cleanup model to keep as written. */
export function dictionaryTermsIn(text: string, rules: DictionaryRules): string[] {
  const lower = text.toLowerCase();
  const found = rules.spellings
    .map((rule) => rule.term)
    .filter((term) => lower.includes(term.toLowerCase()));
  // Replacement outputs that are single words are worth keeping too.
  for (const rule of rules.replacements) {
    if (/^[\p{L}\p{N}'’-]{2,40}$/u.test(rule.replacement) && text.includes(rule.replacement)) {
      found.push(rule.replacement);
    }
  }
  return found;
}

/** The style a dictation was resolved to, as the pipeline needs it. */
interface TakeStyle {
  id: string | null;
  flags: StyleFlags | null;
  instructions: string[];
  appName: string | null;
}

/** The preset's instruction and the owner's own, for the cleanup model. */
export function styleInstructions(resolved: ResolvedStyle): string[] {
  const preset = PRESETS[resolved.style.preset].instruction;
  const own = resolved.style.instructions.trim();
  return [...(preset ? [preset] : []), ...(own ? [own] : [])];
}
