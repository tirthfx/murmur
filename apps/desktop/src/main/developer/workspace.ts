import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isIgnored, parseGitignore, type GitignoreRules } from "./gitignore";

// File tagging in AI editors (PZ-24): the open workspace's files, indexed in main, and "at"
// plus a file name turned into a tag such as @src/auth/session.ts.

/** AI coding editors where file tags apply. */
export const TAG_EDITORS: ReadonlySet<string> = new Set([
  "com.microsoft.VSCode",
  "com.microsoft.VSCodeInsiders",
  "com.todesktop.230313mzl4w4u92",
  "com.exafunction.windsurf",
  "dev.zed.Zed",
]);

export const MAX_INDEXED_FILES = 50_000;
export const INDEX_MAX_AGE_MS = 60_000;
/** Never indexed, whatever .gitignore says. */
const ALWAYS_SKIP = new Set([".git", "node_modules", ".DS_Store"]);

/**
 * The workspace folder for an editor window. Editors put the folder name in the title
 * ("session.ts — murmur"), or the full path when set up to. A full path is used if it is a
 * folder in the home folder; a name is looked up as one of the owner's code folders or a
 * folder directly inside one.
 */
export async function findWorkspace(
  title: string | null,
  codeFolders: readonly string[],
  isDir: (folder: string) => Promise<boolean> = async (folder) =>
    (await fs.stat(folder).catch(() => null))?.isDirectory() ?? false,
  home: string = os.homedir(),
): Promise<string | null> {
  if (!title) return null;
  const parts = title
    .split(/\s+[—–-]\s+|\s*[|•]\s*/)
    .map((part) => part.trim().replace(/^\[|\]$/g, ""))
    .filter(Boolean);
  for (const part of parts) {
    const expanded = part.startsWith("~/") ? path.join(home, part.slice(2)) : part;
    if (path.isAbsolute(expanded)) {
      const folder = path.resolve(expanded);
      if (folder.startsWith(home + path.sep) && (await isDir(folder))) return folder;
    }
  }
  for (const part of [...parts].reverse()) {
    if (!/^[\w.@+-][\w .@+-]{0,100}$/.test(part)) continue;
    for (const base of codeFolders) {
      const root = path.resolve(base.startsWith("~/") ? path.join(home, base.slice(2)) : base);
      if (path.basename(root) === part && (await isDir(root))) return root;
      const child = path.join(root, part);
      if (path.dirname(child) === root && (await isDir(child))) return child;
    }
  }
  return null;
}

/**
 * Relative paths ("src/auth/session.ts") of the files under `root`, following .gitignore files
 * at every level, never following links, never leaving the root, at most `maxFiles`.
 */
export async function indexWorkspace(
  root: string,
  maxFiles: number = MAX_INDEXED_FILES,
): Promise<string[]> {
  const files: string[] = [];
  const queue: { dir: string; rel: string; rules: { base: string; rules: GitignoreRules }[] }[] = [
    { dir: root, rel: "", rules: [] },
  ];
  while (queue.length > 0 && files.length < maxFiles) {
    const { dir, rel, rules } = queue.shift()!;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    let scoped = rules;
    if (entries.some((entry) => entry.name === ".gitignore" && entry.isFile())) {
      const text = await fs.readFile(path.join(dir, ".gitignore"), "utf8").catch(() => "");
      scoped = [...rules, { base: rel, rules: parseGitignore(text) }];
    }
    const ignored = (relPath: string, isDir: boolean) =>
      scoped.some(({ base, rules: list }) =>
        isIgnored(list, base === "" ? relPath : relPath.slice(base.length + 1), isDir),
      );
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (ALWAYS_SKIP.has(entry.name) || entry.isSymbolicLink()) continue;
      const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!ignored(relPath, true)) {
          queue.push({ dir: path.join(dir, entry.name), rel: relPath, rules: scoped });
        }
      } else if (entry.isFile() && !ignored(relPath, false)) {
        files.push(relPath);
        if (files.length >= maxFiles) break;
      }
    }
  }
  return files;
}

/** Indexes are kept per workspace and rebuilt when older than a minute. */
export function createWorkspaceIndexer(
  now: () => number = Date.now,
  index: (root: string) => Promise<string[]> = indexWorkspace,
) {
  const cache = new Map<string, { at: number; files: Promise<string[]> }>();
  return {
    /** Starts (or reuses) the index for `root`; call when a recording starts. */
    prepare(root: string): Promise<string[]> {
      const cached = cache.get(root);
      if (cached && now() - cached.at < INDEX_MAX_AGE_MS) return cached.files;
      const files = index(root).catch(() => []);
      cache.set(root, { at: now(), files });
      // Only the latest few workspaces are kept.
      if (cache.size > 5) cache.delete(cache.keys().next().value!);
      return files;
    },
  };
}

/** The best file for a spoken name: same file name, then a path suffix; null if none. */
export function matchFile(name: string, files: readonly string[]): string | null {
  const wanted = name
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .toLowerCase();
  if (wanted === "") return null;
  const candidates = wanted.includes("/")
    ? files.filter((file) => {
        const lower = file.toLowerCase();
        return lower === wanted || lower.endsWith(`/${wanted}`);
      })
    : files.filter((file) => path.posix.basename(file).toLowerCase() === wanted);
  if (candidates.length === 0) return null;
  // The exact case first, then the shortest path.
  return [...candidates].sort(
    (a, b) =>
      Number(!a.endsWith(name)) - Number(!b.endsWith(name)) ||
      a.length - b.length ||
      a.localeCompare(b),
  )[0]!;
}

/**
 * "at session.ts" (after spoken syntax) becomes "@src/auth/session.ts" when that file is in
 * the workspace. Only names with a dot or a slash are looked up, so "meet at noon" is left
 * alone. Unknown names stay as text.
 */
export function tagFiles(text: string, files: readonly string[]): string {
  if (files.length === 0) return text;
  return text.replace(
    /(^|[\s(])at\s+([\w@+-][\w@+./\\-]*?[./][\w@+./\\-]*\w)(?=$|[\s,;:!?)]|\.(?:\s|$))/gi,
    (whole, before: string, name: string) => {
      const found = matchFile(name, files);
      return found ? `${before}@${found}` : whole;
    },
  );
}
