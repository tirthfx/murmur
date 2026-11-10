import type { PlatformHelper, SpeechModel, Transcript, Unsubscribe } from "@murmur/shared";
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
    "loadSpeechModel" | "transcribeFile" | "onStatusChange" | "getStatus"
  >;
  model: SpeechModel;
  /** `.../Application Support/Murmur/models/speech/whisperkit`. */
  root: string;
  logger: Logger;
  /** BCP-47 codes; empty means detect. Settings (#13) will provide this. */
  languages?: string[];
  check?: (root: string, model: SpeechModel) => Promise<ModelCheck>;
}

export interface SpeechService {
  start(): void;
  stop(): void;
  getState(): SpeechState;
  /** Transcribes a recorded file. Rejects when the model is not ready. */
  transcribe(path: string): Promise<Transcript>;
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
  const languages = deps.languages ?? [];
  const location = modelLocation(root, model);
  let state: SpeechState = "idle";
  let generation = 0;
  let verified = false;
  let subscription: Unsubscribe | null = null;

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
    transcribe(path) {
      if (state !== "ready") {
        return Promise.reject(new Error(`The speech model is not ready (${state})`));
      }
      return helper.transcribeFile({ path, languages });
    },
  };
}
