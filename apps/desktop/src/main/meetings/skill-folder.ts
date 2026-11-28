import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** A Skill file is a few pages of text at the most. */
const MAX_BYTES = 100_000;
const MAX_FILES = 100;

/** The Markdown files directly in a folder that are small enough to be Skills (NT-16). */
export function readSkillFiles(folder: string): { name: string; text: string }[] {
  return readdirSync(folder)
    .filter((name) => /\.(md|markdown)$/i.test(name))
    .sort()
    .slice(0, MAX_FILES)
    .flatMap((name) => {
      const file = path.join(folder, name);
      const info = statSync(file);
      return info.isFile() && info.size <= MAX_BYTES
        ? [{ name, text: readFileSync(file, "utf8") }]
        : [];
    });
}
