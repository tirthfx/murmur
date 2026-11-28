// Coding CLI detection (PZ-28): a listed coding assistant running in the terminal in front
// makes the dictation a Developer one. Checked once per dictation; names are never stored.

/** Terminal apps where detection applies. */
export const TERMINALS: ReadonlySet<string> = new Set([
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "dev.warp.Warp-Stable",
  "com.mitchellh.ghostty",
  "org.alacritty",
  "net.kovidgoyal.kitty",
  "com.github.wez.wezterm",
  "co.zeit.hyper",
]);

/**
 * True when one of `listed` is among the process names under the terminal, or is a word of
 * its window title (terminals put the running command there).
 */
export function codingCliRunning(
  processNames: readonly string[],
  windowTitle: string | null,
  listed: readonly string[],
): boolean {
  const wanted = new Set(listed.map((name) => name.toLowerCase()));
  if (wanted.size === 0) return false;
  if (processNames.some((name) => wanted.has(name.toLowerCase().replace(/^-/, "")))) return true;
  const words = (windowTitle ?? "").toLowerCase().split(/[^a-z0-9._-]+/);
  return words.some((word) => wanted.has(word));
}
