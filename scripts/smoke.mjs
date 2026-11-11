// End-to-end smoke test for M1 (see docs/smoke-test.md). Runs on a Mac only; not part of CI.
//
//   npm run smoke
//
// It starts the app on a clean, temporary profile, has the app press its own push-to-talk
// key while a generated speech clip plays in place of the microphone, and then checks that
// the expected words reached a test text box and that exactly one history row was written.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const PHRASE = "The quick brown fox jumps over the lazy dog";
const TIMEOUT_MS = 5 * 60_000;
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const keep = process.argv.includes("--keep");
// `--packaged` runs the app built by `npm run package` instead of the development build.
const packaged = process.argv.includes("--packaged");
const packagedBinary = path.join(
  repo,
  "apps/desktop/out/Murmur-darwin-arm64/Murmur.app/Contents/MacOS/Murmur",
);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

/** Lower case, letters and digits only, single spaces. */
const normalise = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

if (process.platform !== "darwin") {
  console.error("The smoke test needs macOS.");
  process.exit(1);
}
const helperBinary = path.join(repo, "native/helper-mac/.build/release/murmur-helper");
if (packaged && !existsSync(packagedBinary)) {
  console.error("The packaged app is not built. Run `npm run package` first.");
  process.exit(1);
}
if (!packaged && !existsSync(helperBinary)) {
  console.error("The helper is not built. Run `npm run build:helper` first.");
  process.exit(1);
}

const profile = mkdtempSync(path.join(os.tmpdir(), "murmur-smoke-"));
const clip = path.join(profile, "clip.wav");

// The clip is made here with the system voice, so no audio file lives in the repository.
execFileSync("say", ["-o", path.join(profile, "clip.aiff"), PHRASE]);
execFileSync("afconvert", [
  "-f",
  "WAVE",
  "-d",
  "LEI16@16000",
  "-c",
  "1",
  path.join(profile, "clip.aiff"),
  clip,
]);
const clipMs = Math.round(((statSync(clip).size - 44) / 32_000) * 1000);
console.log(`profile: ${profile}`);
console.log(`clip: "${PHRASE}" (${(clipMs / 1000).toFixed(1)} s)`);

const child = spawn(packaged ? packagedBinary : "npm", packaged ? [] : ["run", "dev"], {
  cwd: repo,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    MURMUR_PROFILE_DIR: profile,
    MURMUR_SHARE_MODELS: "1",
    MURMUR_SMOKE: "1",
    MURMUR_SMOKE_HOLD_MS: String(clipMs + 800),
    MURMUR_AUDIO_FIXTURE: clip,
    MURMUR_AUDIO_DIR: path.join(profile, "audio-tmp"),
  },
});

const result = await new Promise((resolve) => {
  let buffer = "";
  const timer = setTimeout(() => resolve(null), TIMEOUT_MS);
  const read = (chunk) => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (/^\[(smoke|audio|speech|cleanup|helper|permissions|profile|db)\]/.test(line)) {
        console.log(`  ${line}`);
      }
      const mark = line.indexOf("[smoke] result ");
      if (mark >= 0) {
        clearTimeout(timer);
        resolve(JSON.parse(line.slice(mark + "[smoke] result ".length)));
      }
    }
  };
  child.stdout.on("data", read);
  child.stderr.on("data", read);
  child.on("exit", () => {
    clearTimeout(timer);
    // Give a result printed just before the exit the chance to win.
    setTimeout(() => resolve(null), 200);
  });
});

// Give the app a moment to quit by itself, then stop whatever is left.
await new Promise((resolve) => setTimeout(resolve, 1500));
try {
  process.kill(-child.pid, "SIGTERM");
} catch {
  // Already gone.
}

if (result === null) {
  fail("the app ended or timed out without a result");
} else {
  console.log(`steps: ${result.events.join(", ")}`);
  console.log(`test box: ${JSON.stringify(result.fieldText)}`);
  if (!result.ok) fail(result.reason);
  else if (normalise(result.fieldText) !== normalise(PHRASE)) {
    fail(`the test box does not hold the expected sentence "${PHRASE}"`);
  }

  const dbFile = path.join(profile, "Murmur", "murmur.db");
  if (!existsSync(dbFile)) fail("no database was created");
  else {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    const rows = db.prepare("SELECT raw_text, final_text, insert_status FROM history").all();
    db.close();
    console.log(`history rows: ${rows.length}`);
    if (rows.length !== 1) fail(`expected exactly one history row, found ${rows.length}`);
    else {
      const [row] = rows;
      if (!row.raw_text?.trim()) fail("the history row has no raw text");
      if (!row.final_text?.trim()) fail("the history row has no final text");
      else if (row.final_text.trim() !== result.fieldText.trim()) {
        fail("the history row's final text differs from the inserted text");
      }
      if (row.insert_status !== "inserted") fail(`insert status is "${row.insert_status}"`);
    }
  }
}

if (keep) console.log(`kept: ${profile}`);
else rmSync(profile, { recursive: true, force: true });
if (!process.exitCode) console.log("PASS");
