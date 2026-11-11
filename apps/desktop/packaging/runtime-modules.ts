import { cpSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Forge's Vite plugin bundles JavaScript and leaves `node_modules` out of the app. A package
// that must be loaded at run time (node-llama-cpp, with its native library) is copied next
// to the app with everything it depends on.

export interface RuntimePackage {
  /** Absolute folder of the installed package. */
  source: string;
  /** Path under the copied `node_modules`, for example `ora/node_modules/chalk`. */
  target: string;
}

export interface ClosureOptions {
  /** Whether an optional dependency that is installed should be included. */
  includeOptional?: (name: string) => boolean;
}

interface Manifest {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** Finds an installed package the way Node does: nearest `node_modules` first. */
function resolvePackage(name: string, fromDir: string): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The path after the outermost `node_modules/`, so nested copies keep their place. */
function targetOf(source: string): string {
  const marker = `${path.sep}node_modules${path.sep}`;
  return source.slice(source.indexOf(marker) + marker.length);
}

/**
 * Every package `entry` needs at run time: itself, its dependencies and theirs. Optional
 * dependencies are included when installed and allowed by `includeOptional`.
 */
export function runtimeClosure(
  entry: string,
  fromDir: string,
  options: ClosureOptions = {},
): RuntimePackage[] {
  const includeOptional = options.includeOptional ?? (() => true);
  const found = new Map<string, RuntimePackage>();
  const visit = (name: string, from: string, optional: boolean): void => {
    const source = resolvePackage(name, from);
    if (source === null) {
      if (optional) return;
      throw new Error(`Cannot package ${entry}: ${name} is not installed (needed from ${from})`);
    }
    if (found.has(source)) return;
    const target = targetOf(source);
    for (const other of found.values()) {
      if (other.target === target) {
        throw new Error(`Cannot package ${entry}: two different copies of ${target}`);
      }
    }
    found.set(source, { source, target });
    const manifest = JSON.parse(
      readFileSync(path.join(source, "package.json"), "utf8"),
    ) as Manifest;
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      visit(dependency, source, false);
    }
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
      if (includeOptional(dependency)) visit(dependency, source, true);
    }
  };
  visit(entry, fromDir, false);
  return [...found.values()].sort((a, b) => a.target.localeCompare(b.target));
}

/**
 * Copies the packages into `<targetDir>/node_modules`. Nested `node_modules` folders are not
 * copied wholesale (the packages needed from them are in the list already), and `skip`
 * leaves out files by their path under `node_modules`.
 */
export function copyRuntimePackages(
  packages: RuntimePackage[],
  targetDir: string,
  skip: (relativePath: string) => boolean = () => false,
): void {
  for (const item of packages) {
    cpSync(item.source, path.join(targetDir, "node_modules", item.target), {
      recursive: true,
      dereference: true,
      filter: (file) => {
        const inside = path.relative(item.source, file);
        if (inside.split(path.sep).includes("node_modules")) return false;
        return !skip(path.join(item.target, inside));
      },
    });
  }
}

/** Folder under the app's Resources that holds the copied packages. */
export const LLM_MODULES_DIR = "llm-modules";

/** Only this Mac's binaries; the other platforms' packages are not installed anyway. */
export const includeLlamaOptional = (name: string): boolean =>
  !name.startsWith("@node-llama-cpp/") || name === "@node-llama-cpp/mac-arm64-metal";

/** The 35 MB source bundle is only for building llama.cpp from source. */
export const skipLlamaFile = (relativePath: string): boolean =>
  relativePath === path.join("node-llama-cpp", "llama", "gitRelease.bundle");
