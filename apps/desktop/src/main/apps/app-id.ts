// An app's id as the helper reports it: a bundle id on a Mac, a program file name on Windows.

/** The key an id is looked up by. Windows program names differ in case between versions. */
export function appKey(id: string): string {
  return /\.exe$/i.test(id) ? id.toLowerCase() : id;
}

/** Windows terminals and shells, as `appKey` writes them. */
export const WINDOWS_TERMINALS: readonly string[] = [
  "windowsterminal.exe",
  "cmd.exe",
  "powershell.exe",
  "pwsh.exe",
  "conhost.exe",
  "mintty.exe",
  "alacritty.exe",
  "wezterm-gui.exe",
  "hyper.exe",
  "warp.exe",
  "putty.exe",
  "kitty.exe",
];
