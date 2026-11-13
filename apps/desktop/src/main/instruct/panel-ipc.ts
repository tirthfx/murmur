import { INSTRUCT_PANEL_ARGS, INSTRUCT_PANEL_CHANNELS, type InstructSource } from "@murmur/shared";
import { isTrustedIpcSender } from "../../security/guards";
import type { InstructController } from "./instruct-controller";

export interface InstructPanelIpcDeps {
  /** The panel page's URL. Only that page may use these channels. */
  entryUrl: string;
  controller: InstructController;
}

/**
 * Handles one Instruct panel channel: checks the sender and the arguments, then acts. Throws
 * on a rejected call.
 */
export function createInstructPanelIpcHandler(deps: InstructPanelIpcDeps) {
  const { controller } = deps;
  return async (
    channel: string,
    senderUrl: string | undefined,
    args: readonly unknown[],
  ): Promise<unknown> => {
    if (!isTrustedIpcSender(senderUrl, deps.entryUrl)) {
      throw new Error("Instruct panel IPC rejected: untrusted sender");
    }
    const schema = (
      INSTRUCT_PANEL_ARGS as Record<
        string,
        (typeof INSTRUCT_PANEL_ARGS)[keyof typeof INSTRUCT_PANEL_ARGS]
      >
    )[channel];
    const parsed = schema?.safeParse(args);
    if (!parsed?.success) throw new Error("Instruct panel IPC rejected: invalid call");
    switch (channel) {
      case INSTRUCT_PANEL_CHANNELS.ready:
        return controller.state();
      case INSTRUCT_PANEL_CHANNELS.insert:
        return controller.insert();
      case INSTRUCT_PANEL_CHANNELS.copy:
        return controller.copy();
      case INSTRUCT_PANEL_CHANNELS.regenerate:
        return controller.regenerate();
      case INSTRUCT_PANEL_CHANNELS.toggleSource:
        return controller.toggleSource(parsed.data[0] as InstructSource);
      case INSTRUCT_PANEL_CHANNELS.followUp:
        return controller.followUp(parsed.data[0] as string);
      case INSTRUCT_PANEL_CHANNELS.newThread:
        return controller.newThread();
      case INSTRUCT_PANEL_CHANNELS.undo:
        return controller.undo();
      case INSTRUCT_PANEL_CHANNELS.setModel:
        return controller.setModel(parsed.data[0] as "fast" | "quality");
      case INSTRUCT_PANEL_CHANNELS.close:
        return controller.close();
      default:
        throw new Error("Instruct panel IPC rejected: invalid call");
    }
  };
}
