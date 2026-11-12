import { execFile } from "node:child_process";

/** Bundle ids are reverse-DNS names; anything else is never passed to `open`. */
const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export function isBundleId(value: string): boolean {
  return value.length <= 255 && BUNDLE_ID.test(value);
}

/**
 * Activates a running app by bundle id with `open -b`, bringing its front window back with
 * its selection. Used after the Rewrite panel took the keyboard. Resolves either way.
 */
export function activateMacApp(bundleId: string, run: typeof execFile = execFile): Promise<void> {
  if (!isBundleId(bundleId)) return Promise.resolve();
  return new Promise((resolve) => {
    run("/usr/bin/open", ["-b", bundleId], { timeout: 2000 }, () => resolve());
  });
}
