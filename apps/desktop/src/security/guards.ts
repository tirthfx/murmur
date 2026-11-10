/**
 * Pure guards for navigation, new windows, permissions and IPC senders. They
 * take plain values so they can be unit tested without launching Electron.
 */

export interface WindowOpenDetails {
  url: string;
}

/** Every `window.open` and `target=_blank` is denied. Nothing is opened. */
export function denyWindowOpen(_details: WindowOpenDetails): { action: "deny" } {
  return { action: "deny" };
}

/**
 * Returns true when `candidate` is the app's own page. For a file entry the
 * path must match exactly (hash and query are ignored). For a dev-server entry
 * the origin must match.
 */
export function isAppUrl(candidate: string, entryUrl: string): boolean {
  let target: URL;
  let entry: URL;
  try {
    target = new URL(candidate);
    entry = new URL(entryUrl);
  } catch {
    return false;
  }

  if (entry.protocol === "file:") {
    return target.protocol === "file:" && target.pathname === entry.pathname;
  }
  return target.origin === entry.origin && target.origin !== "null";
}

export interface Preventable {
  preventDefault(): void;
}

/** Builds a `will-navigate` handler that blocks every navigation away from the app. */
export function createNavigationGuard(entryUrl: string) {
  return (event: Preventable, url: string): void => {
    if (!isAppUrl(url, entryUrl)) {
      event.preventDefault();
    }
  };
}

/** Web content may not request any permission (camera, microphone, notifications, and so on). */
export function denyPermissionRequest(
  _permission: string,
  callback: (granted: boolean) => void,
): void {
  callback(false);
}

export function denyPermissionCheck(): boolean {
  return false;
}

/** Accepts IPC only from a frame that is showing the app's own page. */
export function isTrustedIpcSender(senderUrl: string | undefined, entryUrl: string): boolean {
  return senderUrl !== undefined && isAppUrl(senderUrl, entryUrl);
}
