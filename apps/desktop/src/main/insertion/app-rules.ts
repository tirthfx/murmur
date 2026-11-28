// Which apps need special handling when text is inserted (DC-33, DC-34). The helper applies
// the lists to the app in front at the moment of insertion.

/** Terminal emulators: pasted text must never end in a newline, so nothing runs by itself. */
export const TERMINAL_APPS: readonly string[] = [
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "com.mitchellh.ghostty",
  "dev.warp.Warp-Stable",
  "org.alacritty",
  "net.kovidgoyal.kitty",
  "com.github.wez.wezterm",
];

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
];

/** The per-app part of an `insert.text` request. */
export function insertionRules(
  choice: { pasteInRemoteDesktops: boolean; typeInApps: readonly string[] } = {
    pasteInRemoteDesktops: false,
    typeInApps: [],
  },
): { typeInApps: string[]; trimTrailingNewlinesInApps: string[] } {
  return {
    typeInApps: [
      ...(choice.pasteInRemoteDesktops ? [] : REMOTE_DESKTOP_APPS),
      ...choice.typeInApps,
    ],
    trimTrailingNewlinesInApps: [...TERMINAL_APPS],
  };
}

/** The helper's method for the chosen one (DC-32): typed when asked for or forced. */
export function insertionMethod(
  choice: "auto" | "paste" | "type",
  forceTyped = false,
): "auto" | "paste_cmd_v" | "keystrokes" {
  if (forceTyped || choice === "type") return "keystrokes";
  return choice === "paste" ? "paste_cmd_v" : "auto";
}
