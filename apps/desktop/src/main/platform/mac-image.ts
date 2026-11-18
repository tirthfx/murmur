import { execFile } from "node:child_process";

/**
 * Converts an image the app's image reader cannot open (HEIC, HEIF, GIF) to PNG with the
 * system's `sips` tool (HB-30). A GIF gives its first frame. The PNG is then re-encoded by
 * main, which drops any metadata `sips` kept. Resolves false when it could not.
 */
export function convertMacImageToPng(
  input: string,
  output: string,
  run: typeof execFile = execFile,
): Promise<boolean> {
  return new Promise((resolve) => {
    run(
      "/usr/bin/sips",
      ["-s", "format", "png", input, "--out", output],
      { timeout: 20_000 },
      (error) => resolve(!error),
    );
  });
}
