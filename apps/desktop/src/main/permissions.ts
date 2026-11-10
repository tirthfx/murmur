import {
  isRequestablePermissionKind,
  unknownPermissionSnapshot,
  type PermissionKind,
  type PermissionsInfo,
  type PermissionSnapshot,
  type PlatformHelper,
} from "@murmur/shared";
import type { Logger } from "./helper/types";

export interface PermissionsServiceDeps {
  helper: Pick<PlatformHelper, "checkPermissions" | "requestPermission">;
  logger: Logger;
}

export interface PermissionsService {
  /** Reads every status from the helper. Never prompts. Never rejects. */
  check(reason: string): Promise<PermissionsInfo>;
  /** Asks the OS for one permission, then re-reads the statuses. Rejects for other kinds. */
  request(kind: PermissionKind): Promise<PermissionsInfo>;
}

function describeFailure(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "UNSUPPORTED_REQUEST") {
    return "This build of the helper cannot report permissions. Rebuild it with `npm run build:helper`.";
  }
  if (code === "HELPER_UNAVAILABLE" || code === "HELPER_RESTARTED") {
    return "The helper is not running, so permission status is unknown.";
  }
  if (code === "HELPER_TIMEOUT") {
    return "The helper did not answer in time, so permission status is unknown.";
  }
  return "Permission status could not be read from the helper.";
}

function summarise(snapshot: PermissionSnapshot): string {
  return Object.entries(snapshot)
    .map(([kind, status]) => `${kind}=${status}`)
    .join(" ");
}

export function createPermissionsService(deps: PermissionsServiceDeps): PermissionsService {
  const { helper, logger } = deps;

  async function check(reason: string): Promise<PermissionsInfo> {
    try {
      const statuses = await helper.checkPermissions();
      logger.info(`checked (${reason}): ${summarise(statuses)}`);
      return { statuses, message: null };
    } catch (error) {
      const message = describeFailure(error);
      logger.warn(
        `check (${reason}) failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { statuses: unknownPermissionSnapshot(), message };
    }
  }

  return {
    check,
    async request(kind) {
      // Defence in depth: the IPC schema already refuses these, and the helper refuses too.
      if (!isRequestablePermissionKind(kind)) {
        throw new Error(`Permission request refused: ${String(kind)} cannot be requested`);
      }
      logger.info(`requesting ${kind} after a user click`);
      try {
        const result = await helper.requestPermission(kind);
        logger.info(`request for ${kind} returned ${result.status}`);
      } catch (error) {
        logger.warn(
          `request for ${kind} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return check(`after request for ${kind}`);
    },
  };
}
