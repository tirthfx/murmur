import {
  IPC_CHANNELS,
  parseIpcRequest,
  type AppInfo,
  type HelperStatus,
  type PermissionKind,
  type PermissionsInfo,
  type RequestablePermissionKind,
} from "@murmur/shared";
import { isTrustedIpcSender } from "../security/guards";

export interface IpcDeps {
  entryUrl: string;
  getAppInfo: () => AppInfo;
  getHelperStatus: () => HelperStatus;
  /** Re-checks every permission now. */
  getPermissions: () => Promise<PermissionsInfo>;
  /** Only called with a requestable kind; the schema has already refused everything else. */
  requestPermission: (kind: RequestablePermissionKind) => Promise<PermissionsInfo>;
  /** Opens the System Settings pane for a known permission. */
  openPermissionSettings: (kind: PermissionKind) => Promise<void>;
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
      case IPC_CHANNELS.getHelperStatus:
        return deps.getHelperStatus();
      case IPC_CHANNELS.getPermissions:
        return deps.getPermissions();
      case IPC_CHANNELS.requestPermission:
        return deps.requestPermission(request.args[0] as RequestablePermissionKind);
      case IPC_CHANNELS.openPermissionSettings:
        return deps.openPermissionSettings(request.args[0] as PermissionKind);
      default:
        throw new Error("IPC rejected: unknown-channel");
    }
  };
}
