import { existsSync } from "node:fs";
import path from "node:path";
import type { PlatformHelper } from "@murmur/shared";
import { createConsoleLogger, spawnHelperProcess, systemClock } from "../helper/node-runtime";
import { HelperSupervisor, type HelperBinary } from "../helper/supervisor";
import type { Clock, Logger, SpawnHelper } from "../helper/types";

export const MAC_HELPER_BINARY_NAME = "murmur-helper";

export interface MacHelperPathOptions {
  isPackaged: boolean;
  /** Packaged app: the app's Resources directory. */
  resourcesPath: string;
  /** Development: the desktop app directory (`apps/desktop`). */
  appPath: string;
  env: Record<string, string | undefined>;
  exists?: (candidate: string) => boolean;
}

/**
 * Finds the Swift helper binary. Packaged builds use `Resources/helper/murmur-helper`.
 * Development uses `MURMUR_HELPER_PATH` if set, then the Swift build output.
 */
export function resolveMacHelperBinary(options: MacHelperPathOptions): HelperBinary {
  const exists = options.exists ?? existsSync;
  if (options.isPackaged) {
    const packaged = path.join(options.resourcesPath, "helper", MAC_HELPER_BINARY_NAME);
    return exists(packaged)
      ? { path: packaged }
      : {
          path: null,
          message: `The helper is missing from this build (expected ${packaged}).`,
        };
  }

  const override = options.env.MURMUR_HELPER_PATH;
  if (override) {
    return exists(override)
      ? { path: override }
      : { path: null, message: `MURMUR_HELPER_PATH points to a missing file: ${override}` };
  }

  const buildDir = path.resolve(options.appPath, "../../native/helper-mac/.build");
  for (const configuration of ["release", "debug"]) {
    const candidate = path.join(buildDir, configuration, MAC_HELPER_BINARY_NAME);
    if (exists(candidate)) return { path: candidate };
  }
  return {
    path: null,
    message: "The helper has not been built. Run `npm run build:helper`, then restart the app.",
  };
}

export interface MacHelperDeps extends MacHelperPathOptions {
  appVersion: string;
  logger?: Logger;
  clock?: Clock;
  spawn?: SpawnHelper;
}

/** The macOS implementation of `PlatformHelper`: the Swift helper under supervision. */
export function createMacHelper(deps: MacHelperDeps): PlatformHelper {
  return new HelperSupervisor({
    binary: resolveMacHelperBinary(deps),
    appVersion: deps.appVersion,
    spawn: deps.spawn ?? spawnHelperProcess,
    clock: deps.clock ?? systemClock,
    logger: deps.logger ?? createConsoleLogger("[helper]"),
  });
}
