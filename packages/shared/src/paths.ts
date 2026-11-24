import { z } from "zod";

/**
 * An absolute path on any OS the helper runs on (SW-09): POSIX (`/Users/me`), a Windows drive
 * (`C:\Users\me` or `C:/Users/me`) or a network share (`\\server\share`). The helper
 * resolves it; this only refuses a relative path, so the protocol does not fix one OS's shape.
 */
const ABSOLUTE_PATH = /^(\/|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/])/;

export function isAbsolutePath(value: string): boolean {
  return ABSOLUTE_PATH.test(value);
}

export const absolutePathSchema = z.string().refine(isAbsolutePath, "must be an absolute path");
