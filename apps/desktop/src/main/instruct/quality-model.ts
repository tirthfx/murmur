import type { InstructModelStatus } from "@murmur/shared";
import type { ModelManifest } from "@murmur/shared";
import type { Logger } from "../helper/types";
import type { ModelCheck } from "../speech/model-store";

export interface QualityModelDeps {
  model: ModelManifest;
  /** Checks every file's size and SHA-256. */
  check: () => Promise<ModelCheck>;
  /** Downloads and checks it, reporting bytes. */
  download: (onProgress: (done: number, total: number) => void) => Promise<unknown>;
  /** Deletes its folder. */
  remove: () => Promise<void>;
  /** Called when it becomes ready, or stops being. */
  onChange?: (ready: boolean) => void;
  logger: Logger;
}

export interface QualityModel {
  status(): Promise<InstructModelStatus>;
  /** Starts the download if it is not there or running; returns at once. */
  download(): InstructModelStatus;
  remove(): Promise<InstructModelStatus>;
  /** True once checked and complete. */
  isReady(): Promise<boolean>;
}

/**
 * Instruct Mode's Quality model on disk (RW-15): never downloaded unless asked, checked once
 * per run (5 GB takes a few seconds), and removable to free the space.
 */
export function createQualityModel(deps: QualityModelDeps): QualityModel {
  const { model } = deps;
  let checked: Promise<boolean> | null = null;
  let downloading: { done: number } | null = null;
  let failure: string | null = null;

  function snapshot(ready: boolean): InstructModelStatus {
    return {
      state: downloading ? "downloading" : ready ? "ready" : failure ? "failed" : "missing",
      label: model.label,
      totalBytes: model.totalBytes,
      doneBytes: downloading ? downloading.done : ready ? model.totalBytes : 0,
      message: failure,
    };
  }

  function isReady(): Promise<boolean> {
    if (downloading) return Promise.resolve(false);
    checked ??= deps.check().then(
      (result) => {
        if (!result.ok && result.reason !== "missing") {
          deps.logger.warn(`the Quality model failed its ${result.reason} check`);
        }
        return result.ok;
      },
      () => false,
    );
    return checked;
  }

  return {
    async status() {
      return snapshot(await isReady());
    },
    download() {
      if (downloading) return snapshot(false);
      downloading = { done: 0 };
      failure = null;
      checked = null;
      deps.logger.info(`downloading ${model.label}`);
      void deps
        .download((done) => {
          if (downloading) downloading.done = done;
        })
        .then(
          () => {
            downloading = null;
            checked = Promise.resolve(true);
            deps.logger.info(`${model.label} is ready`);
            deps.onChange?.(true);
          },
          (error: unknown) => {
            downloading = null;
            checked = null;
            failure = "The download did not finish. Check the connection and try again.";
            deps.logger.warn(`Quality model download failed: ${String(error)}`);
          },
        );
      return snapshot(false);
    },
    async remove() {
      if (downloading) return snapshot(false);
      await deps.remove();
      checked = Promise.resolve(false);
      failure = null;
      deps.onChange?.(false);
      return snapshot(false);
    },
    isReady,
  };
}
