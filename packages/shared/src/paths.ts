import { z } from "zod";

/** An absolute path. The helper resolves it; this only refuses a relative one. */
export function isAbsolutePath(value: string): boolean {
  return value.startsWith("/");
}

export const absolutePathSchema = z.string().refine(isAbsolutePath, "must be an absolute path");
