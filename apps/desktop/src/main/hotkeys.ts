import type {
  HotkeyBinding,
  HotkeyEvent,
  HotkeyTapStatus,
  PermissionSnapshot,
  PlatformHelper,
  Unsubscribe,
} from "@murmur/shared";
import type { Logger } from "./helper/types";

/**
 * `off`: no helper, or nothing to bind. `needs_permission`: the helper reported that the
 * OS has not allowed key listening; nothing is requested, the user grants it themself.
 */
export type HotkeyServiceState = "off" | "configuring" | "active" | "needs_permission" | "failed";

export interface HotkeyServiceDeps {
  helper: Pick<
    PlatformHelper,
    "configureHotkeys" | "onHotkeyEvent" | "onHotkeyTapStatus" | "onStatusChange" | "getStatus"
  >;
  bindings: readonly HotkeyBinding[];
  logger: Logger;
  /** Epoch milliseconds, used for the latency in the log. */
  now?: () => number;
}

export interface HotkeyService {
  /** Subscribes to the helper and configures the bindings each time it becomes ready. */
  start(): void;
  stop(): void;
  getState(): HotkeyServiceState;
  /** Retries after a missing permission once a status check shows it granted. */
  handlePermissions(statuses: PermissionSnapshot): void;
}

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Keeps the helper's hotkey bindings in place and logs what they report. Bindings do not
 * survive a helper restart, so they are sent again on every `ready`. A generation counter
 * makes replies from an earlier helper process or an earlier attempt count for nothing.
 * Key events carry only the binding id and timing; nothing else about typing is seen.
 */
export function createHotkeyService(deps: HotkeyServiceDeps): HotkeyService {
  const { helper, logger } = deps;
  const bindings = [...deps.bindings];
  const now = deps.now ?? Date.now;
  let state: HotkeyServiceState = "off";
  let generation = 0;
  let subscriptions: Unsubscribe[] = [];

  function configure(): void {
    if (bindings.length === 0) {
      state = "off";
      return;
    }
    const attempt = ++generation;
    state = "configuring";
    helper.configureHotkeys(bindings).then(
      (result) => {
        if (attempt !== generation) return;
        for (const rejection of result.rejected) {
          logger.warn(`binding ${rejection.id} rejected (${rejection.code}): ${rejection.message}`);
        }
        state = result.registered.length > 0 ? "active" : "failed";
        logger.info(`registered: ${result.registered.join(", ") || "none"}`);
      },
      (error: unknown) => {
        if (attempt !== generation) return;
        const code = errorCode(error);
        if (code === "PERMISSION_DENIED") {
          state = "needs_permission";
          logger.warn(
            "Input Monitoring is not granted, so the dictation key is off. Grant it in System Settings; the key turns on at the next permission check.",
          );
        } else if (code === "HELPER_RESTARTED" || code === "HELPER_UNAVAILABLE") {
          // The next `ready` configures again.
          state = "off";
          logger.info(`configure skipped: ${errorMessage(error)}`);
        } else if (code === "UNSUPPORTED_REQUEST") {
          state = "failed";
          logger.warn(
            "This helper build has no hotkey support. Rebuild it with `npm run build:helper`.",
          );
        } else {
          state = "failed";
          logger.warn(`configure failed: ${errorMessage(error)}`);
        }
      },
    );
  }

  function handleEvent(event: HotkeyEvent): void {
    logger.info(`${event.bindingId} ${event.state} at=${event.at} latency=${now() - event.at}ms`);
  }

  function handleTapStatus(status: HotkeyTapStatus): void {
    if (status.state === "disabled_by_system") {
      logger.warn("macOS turned the key listener off; held keys were released");
    } else {
      logger.info(`key listener ${status.state}`);
    }
  }

  return {
    start() {
      if (subscriptions.length > 0) return;
      subscriptions = [
        helper.onHotkeyEvent(handleEvent),
        helper.onHotkeyTapStatus(handleTapStatus),
        helper.onStatusChange((status) => {
          if (status.state === "ready") {
            configure();
          } else {
            generation++;
            state = "off";
          }
        }),
      ];
      if (bindings.length === 0) logger.info("no default bindings on this platform");
      if (helper.getStatus().state === "ready") configure();
    },
    stop() {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      generation++;
      state = "off";
    },
    getState: () => state,
    handlePermissions(statuses) {
      if (state !== "needs_permission" || statuses.inputMonitoring !== "granted") return;
      if (helper.getStatus().state !== "ready") return;
      logger.info("Input Monitoring is now granted, turning the dictation key on");
      configure();
    },
  };
}
