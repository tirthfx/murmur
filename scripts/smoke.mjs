// End-to-end smoke test for M1 (see docs/smoke-test.md). Runs on a Mac only; not part of CI.
//
//   npm run smoke
//
// It starts the app on a clean, temporary profile, has the app press its own push-to-talk
// key while a generated speech clip plays in place of the microphone, and then checks that
// the expected words reached a test text box and that exactly one history row was written.

import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

// `--long` uses a sentence of about ten seconds, for the M1 timing check.
const PHRASE = process.argv.includes("--long")
  ? "This is a longer test of dictation. We want to know how quickly the words appear after the key is released, so this sentence keeps going for roughly ten seconds in all."
  : "The quick brown fox jumps over the lazy dog";
const TIMEOUT_MS = 5 * 60_000;
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const keep = process.argv.includes("--keep");
// `--packaged` runs the app built by `npm run package` instead of the development build.
const packaged = process.argv.includes("--packaged");
// `--full` adds the Bar, sounds and mute, tray, silent microphone and quit checks.
const full = process.argv.includes("--full");
const packagedBinary = path.join(
  repo,
  "apps/desktop/out/Murmur-darwin-arm64/Murmur.app/Contents/MacOS/Murmur",
);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

/**
 * Whether the inserted text says the expected sentence: at least 90% of the expected words,
 * in order, and at most one extra word (so words the model invents still fail). A number
 * written as digits ("10" for "ten") costs one word.
 */
function sameSentence(expected, actual) {
  const want = normalise(expected).split(" ").filter(Boolean);
  const got = normalise(actual).split(" ").filter(Boolean);
  const table = Array.from({ length: want.length + 1 }, () => new Array(got.length + 1).fill(0));
  for (let i = 1; i <= want.length; i++) {
    for (let j = 1; j <= got.length; j++) {
      table[i][j] =
        want[i - 1] === got[j - 1]
          ? table[i - 1][j - 1] + 1
          : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  return table[want.length][got.length] >= want.length * 0.9 && got.length <= want.length + 1;
}

/** Lower case, letters and digits only, single spaces. */
/** A 16 kHz mono 16-bit WAV file holding these samples. */
function wav(samples) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

/** The 16-bit samples of a WAV file, found by its "data" chunk. */
function samplesOf(file) {
  const bytes = readFileSync(file);
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    if (bytes.toString("ascii", offset, offset + 4) === "data") {
      return bytes.subarray(offset + 8, offset + 8 + size);
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`no audio data in ${file}`);
}

/** Speech from the system voice as a 16 kHz mono WAV file; returns its samples. */
function speak(text, file, voice) {
  const aiff = `${file}.aiff`;
  execFileSync("say", [...(voice ? ["-v", voice] : []), "-o", aiff, text]);
  execFileSync("afconvert", [
    "-f",
    "WAVE",
    "-d",
    "LEI16@16000",
    "-c",
    "1",
    aiff,
    `${file}.raw.wav`,
  ]);
  const samples = samplesOf(`${file}.raw.wav`);
  writeFileSync(file, wav(samples));
  return samples;
}

/** The same samples, quieter by this many decibels. */
function quieter(samples, db) {
  const out = Buffer.alloc(samples.length);
  const gain = 10 ** (-db / 20);
  for (let i = 0; i + 1 < samples.length; i += 2) {
    out.writeInt16LE(Math.round(samples.readInt16LE(i) * gain), i);
  }
  return out;
}

const msOf = (samples) => Math.round((samples.length / 32_000) * 1000);

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
// In full mode the app copies one of these over the clip to switch between them.
const clipsDir = path.join(profile, "clips");
if (full) {
  mkdirSync(clipsDir);
  const speech = samplesOf(clip);
  const lengths = { speech: msOf(speech), silent: 8000 };
  writeFileSync(path.join(clipsDir, "speech.wav"), wav(speech));
  writeFileSync(path.join(clipsDir, "silent.wav"), wav(Buffer.alloc(8 * 32_000)));
  lengths.enter = msOf(
    speak("Send the report to the team, press enter", path.join(clipsDir, "enter.wav")),
  );
  lengths.hindi = msOf(
    speak(
      "नमस्ते, आज मौसम बहुत अच्छा है और मैं बाज़ार जा रहा हूँ।",
      path.join(clipsDir, "hindi.wav"),
      "Lekha",
    ),
  );
  // About as loud as a whisper at a normal distance: 40 dB below the spoken clip.
  writeFileSync(path.join(clipsDir, "quiet.wav"), wav(quieter(speech, 40)));
  lengths.quiet = lengths.speech;
  lengths.remember = msOf(
    speak("Remember that I prefer metric units", path.join(clipsDir, "remember.wav")),
  );
  writeFileSync(path.join(clipsDir, "clips.json"), JSON.stringify(lengths));
}
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
    ...(full
      ? {
          MURMUR_SMOKE_FULL: "1",
          MURMUR_SMOKE_CLIPS_DIR: clipsDir,
        }
      : {}),
  },
});

let helperPid = null;
let exited = false;
child.on("exit", () => {
  exited = true;
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
      const ready = /helper ready: .*pid (\d+)/.exec(line);
      if (ready) helperPid = Number(ready[1]);
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
await new Promise((resolve) => setTimeout(resolve, full ? 4000 : 1500));
const isRunning = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
// Checked before anything is stopped from here, so only the app's own quit counts.
const quitCheck = !full
  ? null
  : helperPid === null
    ? "the helper's process id was not seen"
    : isRunning(helperPid)
      ? `the helper (pid ${helperPid}) is still running after the app quit`
      : !exited
        ? "the app did not exit by itself"
        : null;
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
  if (result.releaseToTextMs !== null) {
    console.log(`key release to text: ${result.releaseToTextMs} ms`);
  }
  if (!result.ok) fail(result.reason);
  for (const check of result.checks ?? []) {
    const mark = check.ok === null ? "SKIP" : check.ok ? "ok  " : "FAIL";
    console.log(`${mark} ${check.name}: ${check.detail}`);
    if (check.ok === false) fail(check.name);
  }
  if (full) {
    if (quitCheck) fail(`Quit: ${quitCheck}`);
    else console.log("ok   Quit: the app and the helper exited");
  } else if (!sameSentence(PHRASE, result.fieldText)) {
    fail(`the test box does not hold the expected sentence "${PHRASE}"`);
  }

  const dbFile = path.join(profile, "Murmur", "murmur.db");
  if (!existsSync(dbFile)) fail("no database was created");
  else {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    // Full mode dictates again after the main run; the main run's row is the first.
    const all = db
      .prepare("SELECT raw_text, final_text, insert_status FROM history ORDER BY rowid")
      .all();
    const rows = full ? all.slice(0, 1) : all;
    db.close();
    console.log(`history rows: ${all.length}`);
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
