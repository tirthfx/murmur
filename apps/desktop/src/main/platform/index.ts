import type { PlatformHelper } from "@murmur/shared";
import { createConsoleLogger, spawnHelperProcess, systemClock } from "../helper/node-runtime";
import { HelperSupervisor } from "../helper/supervisor";
import { createMacHelper, type MacHelperDeps } from "./mac-helper";

export type PlatformHelperDeps = MacHelperDeps & { platform: NodeJS.Platform };

/** Picks the helper implementation for this OS. The rest of main only sees `PlatformHelper`. */
export function createPlatformHelper(deps: PlatformHelperDeps): PlatformHelper {
  if (deps.platform === "darwin") {
    return createMacHelper(deps);
  }
  return new HelperSupervisor({
    binary: { path: null, message: `No helper exists for ${deps.platform} yet.` },
    appVersion: deps.appVersion,
    spawn: deps.spawn ?? spawnHelperProcess,
    clock: deps.clock ?? systemClock,
    logger: deps.logger ?? createConsoleLogger("[helper]"),
  });
}
