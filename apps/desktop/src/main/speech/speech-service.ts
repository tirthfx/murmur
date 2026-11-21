import type {
  LiveTranscript,
  PlatformHelper,
  SpeechModel,
  TranscribeLiveInput,
  Transcript,
  Unsubscribe,
} from "@murmur/shared";
import type { Logger } from "../helper/types";
import { checkModel, modelLocation, type ModelCheck } from "./model-store";

/**
 * `missing`: not downloaded. `corrupt`: a file failed its size or SHA-256 check, so the model
 * is not loaded. `failed`: the helper could not load it.
 */
export type SpeechState =
  "idle" | "checking" | "missing" | "corrupt" | "loading" | "ready" | "failed";

export interface SpeechServiceDeps {
  helper: Pick<
    PlatformHelper,
    "loadSpeechModel" | "transcribeFile" | "onStatusChange" | "getStatus" | "transcribeLive"
  >;
  model: SpeechModel;
  /** `.../Application Support/Murmur/models/speech/whisperkit`. */
  root: string;
  logger: Logger;
  /** BCP-47 codes, read at each transcription; empty means detect. */
  languages?: () => string[];
  check?: (root: string, model: SpeechModel) => Promise<ModelCheck>;
}

export interface SpeechService {
  start(): void;
  stop(): void;
  getState(): SpeechState;
  /**
   * Resolves once the model is ready, or after `timeoutMs`, or as soon as it cannot become
   * ready (missing, corrupt or failed). Used before an automatic retry.
   */
  whenReady(timeoutMs?: number): Promise<void>;
  /** Looks at the files again and loads the model, for example after a download. */
  recheck(): void;
  /** Transcribes a recorded file. Rejects when the model is not ready. */
  /** `prompt`: words already on screen, to help spell names. */
  transcribe(path: string, prompt?: string): Promise<Transcript>;
  /**
   * NT-05: transcribes a meeting chunk, keeping its timing. Waits behind any dictation, which
   * always goes first: the helper decodes one file at a time.
   */
  /** `translate` writes the words in English whatever is spoken (NT-20). */
  transcribeMeeting(path: string, languages: string[], translate?: boolean): Promise<Transcript>;
  /** NT-06: the chunk still being recorded on a channel; waits behind dictation too. */
  transcribeLive(input: TranscribeLiveInput): Promise<LiveTranscript>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Checks the model files once per run (every file's SHA-256), then loads the model into the
 * helper each time the helper becomes ready. A file that fails the check stops the load.
 */
export function createSpeechService(deps: SpeechServiceDeps): SpeechService {
  const { helper, model, root, logger } = deps;
  const check = deps.check ?? checkModel;
  const languages = deps.languages ?? (() => []);
  const location = modelLocation(root, model);
  let state: SpeechState = "idle";
  let generation = 0;
  let verified = false;
  let subscription: Unsubscribe | null = null;

  // One decode at a time in the helper; a dictation waiting is served before a meeting chunk.
  let decoding = false;
  const waiting: { dictation: boolean; go: () => void }[] = [];
  async function turn(dictation: boolean): Promise<void> {
    if (!decoding) {
      decoding = true;
      return;
    }
    await new Promise<void>((go) => waiting.push({ dictation, go }));
  }
  function done(): void {
    const first = waiting.findIndex((entry) => entry.dictation);
    const next = first >= 0 ? waiting.splice(first, 1)[0] : waiting.shift();
    if (next) next.go();
    else decoding = false;
  }
  async function decode<T>(dictation: boolean, work: () => Promise<T>): Promise<T> {
    await turn(dictation);
    try {
      return await work();
    } finally {
      done();
    }
  }

  function notReady(): Error {
    // A model that is loading or waiting for the helper is worth a retry; see the recorder.
    return Object.assign(new Error(`The speech model is not ready (${state})`), {
      code: state === "missing" || state === "corrupt" ? "MODEL_MISSING" : "MODEL_NOT_READY",
    });
  }

  async function prepare(): Promise<void> {
    const attempt = ++generation;
    if (!verified) {
      state = "checking";
      const result = await check(root, model);
      if (attempt !== generation) return;
      if (!result.ok) {
        if (result.reason === "missing") {
          state = "missing";
          logger.warn(
            `The speech model is not downloaded (${(model.totalBytes / 1e6).toFixed(0)} MB). Run \`npm run model:download\`.`,
          );
        } else {
          state = "corrupt";
          logger.error(
            `The speech model failed its ${result.reason} check (${result.file}), so it was not loaded. Run \`npm run model:download\` to repair it.`,
          );
        }
        return;
      }
      verified = true;
    }
    state = "loading";
    logger.info(`loading ${model.label}`);
    try {
      const loaded = await helper.loadSpeechModel({
        model: model.id,
        modelDir: location.modelDir,
        tokenizerDir: location.tokenizerDir,
      });
      if (attempt !== generation) return;
      state = "ready";
      logger.info(`speech model ready in ${loaded.loadMs} ms (${loaded.computeUnits})`);
    } catch (error) {
      if (attempt !== generation) return;
      state = "failed";
      logger.error(`the speech model could not be loaded: ${errorMessage(error)}`);
    }
  }

  return {
    start() {
      if (subscription) return;
      subscription = helper.onStatusChange((status) => {
        if (status.state === "ready") void prepare();
        else {
          generation++;
          if (state === "loading" || state === "ready") state = "idle";
        }
      });
      if (helper.getStatus().state === "ready") void prepare();
    },
    stop() {
      subscription?.();
      subscription = null;
      generation++;
    },
    getState: () => state,
    async whenReady(timeoutMs = 60_000) {
      const deadline = Date.now() + timeoutMs;
      while (state !== "ready" && Date.now() < deadline) {
        if (state === "missing" || state === "corrupt" || state === "failed") return;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    },
    recheck() {
      verified = false;
      if (subscription && helper.getStatus().state === "ready") void prepare();
    },
    transcribe(path, prompt) {
      if (state !== "ready") return Promise.reject(notReady());
      return decode(true, () =>
        helper.transcribeFile({
          path,
          languages: languages(),
          ...(prompt ? { prompt } : {}),
        }),
      );
    },
    transcribeLive(input) {
      if (state !== "ready") return Promise.reject(notReady());
      return decode(false, () => {
        if (state !== "ready") return Promise.reject(notReady());
        return helper.transcribeLive(input);
      });
    },
    transcribeMeeting(path, meetingLanguages, translate = false) {
      if (state !== "ready") return Promise.reject(notReady());
      return decode(false, () => {
        if (state !== "ready") return Promise.reject(notReady());
        return helper.transcribeFile({
          path,
          languages: meetingLanguages,
          keepTiming: true,
          ...(translate ? { translate: true } : {}),
        });
      });
    },
  };
}
