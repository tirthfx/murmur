import { REWRITE_PANEL_ARGS, REWRITE_PANEL_CHANNELS } from "@murmur/shared";
import { isTrustedIpcSender } from "../../security/guards";
import type { RewriteController } from "./rewrite-controller";

export interface RewritePanelIpcDeps {
  /** The panel page's URL. Only that page may use these channels. */
  entryUrl: string;
  controller: RewriteController;
}

/**
 * Handles one Rewrite panel channel: checks the sender and the arguments, then acts. Throws
 * on a rejected call.
 */
export function createRewritePanelIpcHandler(deps: RewritePanelIpcDeps) {
  const { controller } = deps;
  return async (
    channel: string,
    senderUrl: string | undefined,
    args: readonly unknown[],
  ): Promise<unknown> => {
    if (!isTrustedIpcSender(senderUrl, deps.entryUrl)) {
      throw new Error("Rewrite panel IPC rejected: untrusted sender");
    }
    const schema = (
      REWRITE_PANEL_ARGS as Record<
        string,
        (typeof REWRITE_PANEL_ARGS)[keyof typeof REWRITE_PANEL_ARGS]
      >
    )[channel];
    const parsed = schema?.safeParse(args);
    if (!parsed?.success) throw new Error("Rewrite panel IPC rejected: invalid call");
    switch (channel) {
      case REWRITE_PANEL_CHANNELS.ready:
        return controller.state();
      case REWRITE_PANEL_CHANNELS.choose:
        return controller.choose(parsed.data[0] as string);
      case REWRITE_PANEL_CHANNELS.regenerate:
        return controller.regenerate();
      case REWRITE_PANEL_CHANNELS.back:
        return controller.back();
      case REWRITE_PANEL_CHANNELS.replace:
        return controller.replace();
      case REWRITE_PANEL_CHANNELS.copy:
        return controller.copy();
      case REWRITE_PANEL_CHANNELS.close:
        return controller.close();
      default:
        throw new Error("Rewrite panel IPC rejected: invalid call");
    }
  };
}
