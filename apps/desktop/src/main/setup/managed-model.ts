import type { ModelId, ModelManifest, ModelState, ModelStatus } from "@murmur/shared";
import type { Logger } from "../helper/types";
import type { ModelCheck } from "../speech/model-store";

/** The files as they are now, when no download is running. */
export type ModelFilesState = Exclude<ModelState, "downloading">;

export interface ManagedModelDeps {
  id: ModelId;
  model: ModelManifest;
  inspect: () => Promise<ModelFilesState> | ModelFilesState;
  /** Downloads and verifies every file; reports bytes present so far. */
  download: (
    onProgress: (done: number, total: number) => void,
    signal: AbortSignal,
  ) => Promise<unknown>;
  /** Deletes the files, part-downloaded ones too. */
  remove: () => Promise<void>;
  /** Bytes it takes on disk now. */
  diskBytes: () => Promise<number>;
  /** The files changed: after a good download and after a removal. */
  changed: () => void;
  /** A download ended with the model, or without it. A cancelled one is neither. */
  onDownload?: (ok: boolean) => void;
  logger: Logger;
}

export interface ManagedModel {
  status(): Promise<ModelStatus>;
  /** Starts a download unless one is running or the model is ready; returns at once. */
  download(): Promise<ModelStatus>;
  /** Stops the running download, keeping what arrived. */
  cancel(): Promise<ModelStatus>;
  /** Deletes the files. Does nothing while a download is running. */
  remove(): Promise<ModelStatus>;
  isReady(): Promise<boolean>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One model on this Mac (HB-15): one download at a time, with progress, cancel and delete. */
export function createManagedModel(deps: ManagedModelDeps): ManagedModel {
  const { model } = deps;
  const host = model.files[0] ? new URL(model.files[0].url).hostname : "";
  let running: { done: number; stop: AbortController; ended: Promise<void> } | null = null;
  let failure: string | null = null;

  async function status(): Promise<ModelStatus> {
    const files = running ? null : await deps.inspect();
    const diskBytes = await deps.diskBytes();
    // A download may have started while the files were looked at.
    const now = running;
    const state: ModelState = now
      ? "downloading"
      : failure !== null && files !== "ready"
        ? "failed"
        : (files ?? "preparing");
    return {
      id: deps.id,
      state,
      label: model.label,
      host,
      totalBytes: model.totalBytes,
      diskBytes,
      downloadedBytes: now ? now.done : 0,
      message:
        state !== "failed" ? null : (failure ?? "The model is on disk but could not be loaded."),
    };
  }

  function start(): void {
    const stop = new AbortController();
    const entry = { done: 0, stop, ended: Promise.resolve() };
    running = entry;
    failure = null;
    deps.logger.info(`downloading ${model.label}`);
    entry.ended = deps
      .download((done) => {
        entry.done = Math.min(done, model.totalBytes);
      }, stop.signal)
      .then(
        () => {
          running = null;
          deps.logger.info(`${model.label} downloaded and verified`);
          deps.changed();
          deps.onDownload?.(true);
        },
        (error: unknown) => {
          running = null;
          if (stop.signal.aborted) {
            deps.logger.info(`download of ${model.label} cancelled`);
            return;
          }
          failure = `The download did not finish: ${errorMessage(error)}`;
          deps.logger.warn(failure);
          deps.onDownload?.(false);
        },
      );
  }

  return {
    status,
    async download() {
      if (!running && (await deps.inspect()) !== "ready" && !running) start();
      return status();
    },
    async cancel() {
      const entry = running;
      if (entry) {
        entry.stop.abort();
        await entry.ended;
      }
      return status();
    },
    async remove() {
      if (!running) {
        await deps.remove();
        failure = null;
        deps.changed();
      }
      return status();
    },
    isReady: async () => !running && (await deps.inspect()) === "ready",
  };
}

export interface CheckedFiles {
  inspect(): Promise<"ready" | "missing" | "corrupt">;
  /** Look at the files again next time. */
  forget(): void;
}

/**
 * Checks a model's files once and remembers the answer: hashing gigabytes takes a few seconds.
 * `onResult` hears each new answer.
 */
export function createCheckedFiles(
  check: () => Promise<ModelCheck>,
  onResult?: (result: ModelCheck) => void,
): CheckedFiles {
  let checked: Promise<"ready" | "missing" | "corrupt"> | null = null;
  return {
    inspect() {
      checked ??= check().then(
        (result) => {
          onResult?.(result);
          return result.ok ? "ready" : result.reason === "missing" ? "missing" : "corrupt";
        },
        () => "missing" as const,
      );
      return checked;
    },
    forget() {
      checked = null;
    },
  };
}
