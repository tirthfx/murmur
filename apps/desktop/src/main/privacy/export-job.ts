import type { ExportCategory, ExportStatus } from "@murmur/shared";
import type { Logger } from "../helper/types";

export interface ExportJobDeps {
  write(
    folder: string,
    categories: readonly ExportCategory[],
    onProgress: (done: number, category: ExportCategory) => void,
  ): Promise<Record<string, number>>;
  logger: Logger;
}

export interface ExportJob {
  /** Starts an export and returns at once; false while one is running. */
  start(folder: string, categories: readonly ExportCategory[]): boolean;
  status(): ExportStatus;
  /** Resolves when the running export ends. For tests. */
  settled(): Promise<void>;
}

/** HB-46: one export at a time, in the background, with its progress and outcome kept. */
export function createExportJob(deps: ExportJobDeps): ExportJob {
  let status: ExportStatus = { state: "idle" };
  let running: Promise<void> | null = null;

  return {
    start(folder, categories) {
      const first = categories[0];
      if (running || !first) return false;
      const total = categories.length;
      status = { state: "running", done: 0, total, category: first };
      running = deps
        .write(folder, categories, (done, category) => {
          status = { state: "running", done, total, category };
        })
        .then(
          (counts) => {
            status = { state: "done", folder, counts };
            deps.logger.info(`wrote ${JSON.stringify(counts)}`);
          },
          (error: unknown) => {
            const reason = error instanceof Error ? error.message : String(error);
            status = { state: "failed", message: `The export could not be written: ${reason}` };
            deps.logger.warn(status.message);
          },
        )
        .finally(() => (running = null));
      return true;
    },
    status: () => status,
    settled: () => running ?? Promise.resolve(),
  };
}
