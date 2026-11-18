import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Bytes in a file or a folder, counted on demand (HB-49); 0 when missing. */
export function sizeOf(target: string): number {
  if (!existsSync(target)) return 0;
  const info = statSync(target);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    if (entry.isSymbolicLink()) continue;
    total += entry.isDirectory() ? sizeOf(child) : statSync(child).size;
  }
  return total;
}
