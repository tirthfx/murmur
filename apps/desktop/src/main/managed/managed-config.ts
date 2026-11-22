import { MANAGED_CONFIG_PATH, parseManagedConfig, type ManagedConfig } from "@murmur/shared";

/**
 * Reads the managed configuration file, if there is one (TM-21). A missing file means nothing is
 * managed. A file that cannot be read as the contract says is ignored: the app carries on as if it
 * were not there, logs the reason, and keeps it so the Hub can tell an admin.
 */
export interface ManagedState {
  /** The configuration in force, or null when nothing (valid) is managed. */
  config: ManagedConfig | null;
  /** Why a file that exists was ignored, or null. */
  invalid: string | null;
}

export interface ManagedDeps {
  /** The file's text, or null when it does not exist. */
  read(path: string): string | null;
  log(line: string): void;
  path?: string;
}

export function loadManagedConfig(deps: ManagedDeps): ManagedState {
  let text: string | null;
  try {
    text = deps.read(deps.path ?? MANAGED_CONFIG_PATH);
  } catch {
    deps.log("[managed] The managed configuration could not be read; it is ignored.");
    return { config: null, invalid: "The managed configuration could not be read." };
  }
  if (text === null) return { config: null, invalid: null };
  const parsed = parseManagedConfig(text);
  if (!parsed.ok) {
    deps.log(`[managed] ${parsed.message} It is ignored.`);
    return { config: null, invalid: parsed.message };
  }
  return { config: parsed.config, invalid: null };
}
