import { IPC_CHANNELS, parseIpcRequest, type AppInfo } from "@murmur/shared";
import { isTrustedIpcSender } from "../security/guards";

export interface IpcDeps {
  entryUrl: string;
  getAppInfo: () => AppInfo;
}

export interface IpcEventLike {
  senderFrame?: { url: string } | null;
}

/**
 * Builds the handler for one channel. It checks the sender, validates the
 * arguments, then runs the implementation. Failures throw an error with no
 * payload content.
 */
export function createIpcHandler(deps: IpcDeps) {
  return (channel: string, event: IpcEventLike, args: readonly unknown[]): unknown => {
    if (!isTrustedIpcSender(event.senderFrame?.url, deps.entryUrl)) {
      throw new Error("IPC rejected: untrusted sender");
    }
    const request = parseIpcRequest(channel, args);
    if (!request.ok) {
      throw new Error(`IPC rejected: ${request.reason}`);
    }
    switch (channel) {
      case IPC_CHANNELS.getAppInfo:
        return deps.getAppInfo();
      default:
        throw new Error("IPC rejected: unknown-channel");
    }
  };
}
