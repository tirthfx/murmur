import { existsSync } from "node:fs";
import path from "node:path";
import type { PlatformHelper } from "@murmur/shared";
import { createConsoleLogger, spawnHelperProcess, systemClock } from "../helper/node-runtime";
import { HelperSupervisor, type HelperBinary } from "../helper/supervisor";
import type { Clock, Logger, SpawnHelper } from "../helper/types";
import { checkHelperBinary, type IntegrityResult } from "./helper-integrity";

export const WINDOWS_HELPER_BINARY_NAME = "murmur-helper.exe";

export interface WindowsHelperPathOptions {
  isPackaged: boolean;
  /** Packaged app: the app's resources directory. */
  resourcesPath: string;
  /** Development: the desktop app directory (`apps/desktop`). */
  appPath: string;
  env: Record<string, string | undefined>;
  exists?: (candidate: string) => boolean;
}

/** The .NET target the helper is built for (`native/helper-win`). */
const BUILD_TARGET = "net9.0-windows10.0.19041.0";

/**
 * Finds the Windows helper. Packaged builds use `resources/helper/murmur-helper.exe`.
 * Development uses `MURMUR_HELPER_PATH` if set, then the .NET build output.
 */
export function resolveWindowsHelperBinary(options: WindowsHelperPathOptions): HelperBinary {
  const exists = options.exists ?? existsSync;
  if (options.isPackaged) {
    const packaged = path.join(options.resourcesPath, "helper", WINDOWS_HELPER_BINARY_NAME);
    return exists(packaged)
      ? { path: packaged }
      : { path: null, message: `The helper is missing from this build (expected ${packaged}).` };
  }
  const override = options.env.MURMUR_HELPER_PATH;
  if (override) {
    return exists(override)
      ? { path: override }
      : { path: null, message: `MURMUR_HELPER_PATH points to a missing file: ${override}` };
  }
  const buildDir = path.resolve(options.appPath, "../../native/helper-win/src/MurmurHelper/bin");
  for (const configuration of ["Release", "Debug"]) {
    const candidate = path.join(buildDir, configuration, BUILD_TARGET, WINDOWS_HELPER_BINARY_NAME);
    if (exists(candidate)) return { path: candidate };
  }
  return {
    path: null,
    message: "The helper has not been built. Run `npm run build:helper:win`, then restart the app.",
  };
}

export interface WindowsHelperDeps extends WindowsHelperPathOptions {
  appVersion: string;
  logger?: Logger;
  clock?: Clock;
  spawn?: SpawnHelper;
  /** Checks the binary against its hash file before it is launched (SW-13). */
  integrity?: (binaryPath: string) => IntegrityResult;
}

/** The binary, or why it is not used: one that does not match its hash is not started. */
export function resolveVerifiedWindowsHelper(deps: WindowsHelperDeps): HelperBinary {
  const binary = resolveWindowsHelperBinary(deps);
  if (binary.path === null) return binary;
  const result = (deps.integrity ?? checkHelperBinary)(binary.path);
  return result.ok ? binary : { path: null, message: result.message };
}

/** The Windows implementation of `PlatformHelper`: the .NET helper under supervision. */
export function createWindowsHelper(deps: WindowsHelperDeps): PlatformHelper {
  return new HelperSupervisor({
    binary: resolveVerifiedWindowsHelper(deps),
    appVersion: deps.appVersion,
    spawn: deps.spawn ?? spawnHelperProcess,
    clock: deps.clock ?? systemClock,
    logger: deps.logger ?? createConsoleLogger("[helper]"),
  });
}
