// Which apps need special handling when text is inserted (DC-33, DC-34). The helper applies
// the lists to the app in front at the moment of insertion (Windows program names ignore case).

import { appKey, WINDOWS_TERMINALS } from "../apps/app-id";

/** Terminal emulators: pasted text must never end in a newline, so nothing runs by itself. */
export const TERMINAL_APPS: readonly string[] = [
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "com.mitchellh.ghostty",
  "dev.warp.Warp-Stable",
  "org.alacritty",
  "net.kovidgoyal.kitty",
  "com.github.wez.wezterm",
  ...WINDOWS_TERMINALS,
];

/**
 * Terminals where Ctrl+V does not paste (it sends a control character), so text is typed.
 * The others on Windows paste with Ctrl+V.
 */
export const TYPED_TERMINAL_APPS: readonly string[] = ["putty.exe", "kitty.exe", "mintty.exe"];

/** Remote desktop clients: the local clipboard does not reach the remote side, so type. */
export const REMOTE_DESKTOP_APPS: readonly string[] = [
  "com.microsoft.rdc.macos",
  "com.microsoft.rdc.mac",
  "com.vmware.horizon",
  "com.omnissa.horizon.client.mac",
  "com.citrix.receiver.icaviewer.mac",
  "com.parallels.desktop.console",
  "com.teamviewer.TeamViewer",
  "com.philandro.anydesk",
  "com.apple.ScreenSharing",
  "mstsc.exe",
  "msrdc.exe",
  "vmconnect.exe",
  "vmware-view.exe",
  "horizon-client.exe",
  "wfica32.exe",
  "cdviewer.exe",
  "teamviewer.exe",
  "anydesk.exe",
];

export function isTerminalApp(bundleId: string | null | undefined): boolean {
  return bundleId != null && TERMINAL_APPS.includes(appKey(bundleId));
}

/** The per-app part of an `insert.text` request. */
export function insertionRules(): { typeInApps: string[]; trimTrailingNewlinesInApps: string[] } {
  return {
    typeInApps: [...REMOTE_DESKTOP_APPS, ...TYPED_TERMINAL_APPS],
    trimTrailingNewlinesInApps: [...TERMINAL_APPS],
  };
}
