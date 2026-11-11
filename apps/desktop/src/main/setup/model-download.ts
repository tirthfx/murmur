import type { SpeechModel, SpeechModelStatus } from "@murmur/shared";
import type { Logger } from "../helper/types";
import type { SpeechState } from "../speech/speech-service";

export interface ModelDownloadDeps {
  model: SpeechModel;
  /** Downloads and verifies every file; reports bytes present so far. */
  download(onProgress: (done: number, total: number) => void): Promise<unknown>;
  /** The speech service's view of the model on disk. */
  speechState(): SpeechState;
  /** Called after a good download so the model is checked and loaded. */
  onDownloaded(): void;
  logger: Logger;
}

export interface ModelDownload {
  /** Starts a download unless one is running or the model is already there. */
  start(): void;
  status(): SpeechModelStatus;
  /** Resolves when the running download ends. For tests. */
  settled(): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The speech model download behind the setup screen: one at a time, with progress. */
export function createModelDownload(deps: ModelDownloadDeps): ModelDownload {
  const { model } = deps;
  let running: Promise<void> | null = null;
  let downloaded = 0;
  let failure: string | null = null;

  function status(): SpeechModelStatus {
    const base = { label: model.label, totalBytes: model.totalBytes, message: null };
    if (running) return { ...base, state: "downloading", downloadedBytes: downloaded };
    const speech = deps.speechState();
    if (speech === "ready") return { ...base, state: "ready", downloadedBytes: 0 };
    if (failure !== null) {
      return { ...base, state: "failed", downloadedBytes: 0, message: failure };
    }
    if (speech === "failed") {
      return {
        ...base,
        state: "failed",
        downloadedBytes: 0,
        message: "The speech model could not be loaded.",
      };
    }
    if (speech === "missing" || speech === "corrupt") {
      return { ...base, state: "missing", downloadedBytes: 0 };
    }
    // idle, checking or loading: the files are being looked at, or the helper is starting.
    return { ...base, state: "preparing", downloadedBytes: 0 };
  }

  return {
    start() {
      if (running || deps.speechState() === "ready") return;
      failure = null;
      downloaded = 0;
      deps.logger.info(`downloading ${model.label}`);
      running = deps
        .download((done) => {
          downloaded = Math.min(done, model.totalBytes);
        })
        .then(
          () => {
            running = null;
            deps.logger.info("speech model downloaded and verified");
            deps.onDownloaded();
          },
          (error: unknown) => {
            running = null;
            failure = `The download did not finish: ${errorMessage(error)}`;
            deps.logger.warn(failure);
          },
        );
    },
    status,
    settled: () => running ?? Promise.resolve(),
  };
}
