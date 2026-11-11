import { z } from "zod";

// Coding CLI detection (PZ-28): the names of the processes running under the app in front
// (a terminal's shells and what they run). Names only, never arguments or command lines.

/** At most this many names in one reply. */
export const PROC_FOREGROUND_MAX_NAMES = 64;

export const procForegroundResultSchema = z.object({
  /** Lower-case process names, each once; empty when nothing could be read. */
  names: z.array(z.string().min(1).max(64)).max(PROC_FOREGROUND_MAX_NAMES),
});
export type ProcForegroundResult = z.infer<typeof procForegroundResultSchema>;
