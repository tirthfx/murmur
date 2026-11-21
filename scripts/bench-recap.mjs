// Runs "What did I miss" (NT-13) on the local model with a made-up live meeting: ten minutes
// of lines. Reports the time, the bullets and whether each carries a time inside the window.
// Needs the model (`npm run model:download -- cleanup`) and vite-node (comes with vitest).
//
//   npx vite-node scripts/bench-recap.mjs

import os from "node:os";
import path from "node:path";
import { DEFAULT_CLEANUP_MODEL } from "../packages/shared/src/llm-models.ts";
import { CleanupEngine } from "../apps/desktop/src/main/cleanup/engine.ts";
import {
  MAX_TOKENS,
  SYSTEM,
  groundRecap,
  recapPrompt,
} from "../apps/desktop/src/main/meetings/recap.ts";
import { cleanupModelRoot } from "../apps/desktop/src/main/speech/paths.ts";
import { modelLocation } from "../apps/desktop/src/main/speech/model-store.ts";

const script = [
  ["Dana", "Okay, let's start. The goal today is to decide when we ship the new onboarding flow."],
  ["Sam", "QA found three bugs last week. Two are fixed, the microphone prompt one is still open."],
  ["Dana", "How long to fix the last one?"],
  ["Sam", "About two days. We can ship on Thursday the 27th if nothing else turns up."],
  ["Dana", "Priya, is the Monday announcement still possible?"],
  ["Priya", "Monday works if the build is out by Friday, otherwise I need a week's notice."],
  ["Dana", "Then let's decide: we ship Thursday the 27th, announcement the Monday after."],
  ["You", "Agreed. I will also write the release notes by Wednesday."],
  ["Dana", "Rahul, can you check the Frankfurt server capacity before the launch?"],
  ["Rahul", "Yes, I will run a load test on Tuesday and send the numbers to everyone."],
  ["Dana", "One open question: do we keep the old flow behind a switch for the first week?"],
  ["Sam", "I would keep it, but it costs us about two extra days of testing."],
];
// A line every 50 seconds, from 30:00 into the meeting.
const lines = script.map(([speaker, text], i) => ({
  id: `s${i}`,
  startMs: 1_800_000 + i * 50_000,
  speaker,
  text,
}));
const window = { startMs: 1_800_000, endMs: 1_800_000 + 11 * 50_000 + 10_000 };

const root = cleanupModelRoot(path.join(os.homedir(), "Library", "Application Support"));
const modelPath = path.join(
  modelLocation(root, DEFAULT_CLEANUP_MODEL).dir,
  DEFAULT_CLEANUP_MODEL.files[0].path,
);
const engine = new CleanupEngine();
const { loadMs } = await engine.load(modelPath);
console.log(`loaded ${DEFAULT_CLEANUP_MODEL.label} in ${loadMs} ms\n`);

for (const brief of [false, true]) {
  const started = performance.now();
  const output = await engine.generate(
    { system: SYSTEM(brief), prompt: recapPrompt(lines), maxTokens: MAX_TOKENS },
    () => {},
  );
  const ms = Math.round(performance.now() - started);
  const grounded = groundRecap(output, lines, window);
  console.log(
    `${brief ? "brief" : "normal"}: ${ms} ms, ${grounded ? grounded.split("\n").length : 0} bullets kept\n--- raw\n${output}\n--- kept\n${grounded}\n`,
  );
}
