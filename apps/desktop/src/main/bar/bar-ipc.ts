import { BAR_IPC_CHANNELS, parseBarIpc, type BarView } from "@murmur/shared";
import { isTrustedIpcSender } from "../../security/guards";

export interface BarIpcDeps {
  /** The Bar page's URL. Only that page may use these channels. */
  entryUrl: string;
  getView: () => BarView;
  dragStart: () => void;
  drag: (dx: number, dy: number) => void;
  dragEnd: () => void;
  click: () => void;
  /** The answer to the Bar's question. */
  answer: (choice: "yes" | "no") => void;
}

/**
 * Handles one Bar channel: checks the sender and the arguments, then acts. Returns the reply
 * for `ready`; the other channels return nothing. Throws on a rejected call.
 */
export function createBarIpcHandler(deps: BarIpcDeps) {
  return (channel: string, senderUrl: string | undefined, args: readonly unknown[]): unknown => {
    if (!isTrustedIpcSender(senderUrl, deps.entryUrl)) {
      throw new Error("Bar IPC rejected: untrusted sender");
    }
    const parsed = parseBarIpc(channel, args);
    if (!parsed) throw new Error("Bar IPC rejected: invalid call");
    switch (channel) {
      case BAR_IPC_CHANNELS.ready:
        return deps.getView();
      case BAR_IPC_CHANNELS.dragStart:
        return deps.dragStart();
      case BAR_IPC_CHANNELS.drag:
        return deps.drag(parsed[0] as number, parsed[1] as number);
      case BAR_IPC_CHANNELS.dragEnd:
        return deps.dragEnd();
      case BAR_IPC_CHANNELS.click:
        return deps.click();
      case BAR_IPC_CHANNELS.answer:
        return deps.answer(parsed[0] as "yes" | "no");
      default:
        throw new Error("Bar IPC rejected: invalid call");
    }
  };
}
