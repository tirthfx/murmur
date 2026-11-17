import { FOCUS_OVERLAY_ARGS, FOCUS_OVERLAY_CHANNELS, type FocusOverlayState } from "@murmur/shared";
import { isTrustedIpcSender } from "../../security/guards";

export interface FocusOverlayIpcDeps {
  /** The overlay page's URL. Only that page may use these channels. */
  entryUrl: string;
  state: () => FocusOverlayState;
  goBack: () => Promise<void>;
  pause: () => void;
  turnOff: () => void;
}

/** Handles one overlay channel: checks the sender and the arguments, then acts. */
export function createFocusOverlayIpcHandler(deps: FocusOverlayIpcDeps) {
  return async (
    channel: string,
    senderUrl: string | undefined,
    args: readonly unknown[],
  ): Promise<unknown> => {
    if (!isTrustedIpcSender(senderUrl, deps.entryUrl)) {
      throw new Error("Focus overlay IPC rejected: untrusted sender");
    }
    const schema = (
      FOCUS_OVERLAY_ARGS as Record<
        string,
        (typeof FOCUS_OVERLAY_ARGS)[keyof typeof FOCUS_OVERLAY_ARGS]
      >
    )[channel];
    if (!schema?.safeParse(args).success)
      throw new Error("Focus overlay IPC rejected: invalid call");
    switch (channel) {
      case FOCUS_OVERLAY_CHANNELS.ready:
        return deps.state();
      case FOCUS_OVERLAY_CHANNELS.goBack:
        return deps.goBack();
      case FOCUS_OVERLAY_CHANNELS.pause:
        return deps.pause();
      case FOCUS_OVERLAY_CHANNELS.turnOff:
        return deps.turnOff();
      default:
        throw new Error("Focus overlay IPC rejected: invalid call");
    }
  };
}
