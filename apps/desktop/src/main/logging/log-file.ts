import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

/** How many days of logs are kept, today included (HB-49). */
export const LOG_DAYS = 7;

const NAME = /^murmur-(\d{4}-\d{2}-\d{2})\.log$/;

const day = (at: number) => new Date(at).toISOString().slice(0, 10);

export interface LogFile {
  write(level: "info" | "warn" | "error", line: string): void;
}

/**
 * HB-49, HB-55: one text log file a day in `dir`, older ones removed. Only what Murmur's
 * loggers say goes in, which never includes dictated text. A log that cannot be written is
 * dropped: logging must never stop the app.
 */
export function createLogFile(deps: { dir: string; now: () => number }): LogFile {
  let pruned: string | null = null;

  function prune(today: string): void {
    const oldest = day(Date.parse(today) - (LOG_DAYS - 1) * 86_400_000);
    for (const name of readdirSync(deps.dir)) {
      const date = NAME.exec(name)?.[1];
      if (date && date < oldest) rmSync(path.join(deps.dir, name), { force: true });
    }
    pruned = today;
  }

  return {
    write(level, line) {
      const at = deps.now();
      const today = day(at);
      try {
        if (pruned !== today) {
          mkdirSync(deps.dir, { recursive: true });
          prune(today);
        }
        appendFileSync(
          path.join(deps.dir, `murmur-${today}.log`),
          `${new Date(at).toISOString()} ${level} ${line}\n`,
        );
      } catch {
        pruned = null;
      }
    },
  };
}
