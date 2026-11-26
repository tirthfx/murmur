import { spawn } from "node:child_process";
import path from "node:path";

/**
 * The Windows installer (Squirrel) starts the app with a `--squirrel-…` argument when it
 * installs, updates or removes it. The app then only makes or removes its shortcut and quits.
 */

/** The id Windows files the app's notifications and taskbar entry under, as Squirrel writes it. */
export const WINDOWS_APP_USER_MODEL_ID = "com.squirrel.Murmur.Murmur";

type Run = (command: string, args: string[]) => Promise<void>;

/** Runs the updater and waits, but never keeps the installer waiting for long. */
const runUpdater: Run = (command, args) =>
  new Promise((resolve) => {
    const done = () => resolve();
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", done);
    child.once("exit", done);
    setTimeout(done, 5000).unref();
    child.unref();
  });

/**
 * Handles an installer start. Null for an ordinary start (the first one after an install
 * included); otherwise the work to finish before quitting.
 */
export function squirrelStartup(
  argv: readonly string[],
  execPath: string,
  run: Run = runUpdater,
): Promise<void> | null {
  const event = argv[1];
  // `win32` paths, so the rule can be tested on any machine.
  const updater = path.win32.resolve(path.win32.dirname(execPath), "..", "Update.exe");
  const program = path.win32.basename(execPath);
  switch (event) {
    case "--squirrel-install":
    case "--squirrel-updated":
      return run(updater, ["--createShortcut", program]);
    case "--squirrel-uninstall":
      return run(updater, ["--removeShortcut", program]);
    case "--squirrel-obsolete":
      return Promise.resolve();
    default:
      return null;
  }
}
