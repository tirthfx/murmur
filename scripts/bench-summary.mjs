// Runs the meeting summary (NT-09) on the local model with a made-up meeting: one short pass
// and one long enough to go through map-reduce. Reports the time, how many bullets have a
// link or "No source", the sections, and whether any cited time points at no line. Needs the
// model (`npm run model:download -- cleanup`) and vite-node (comes with vitest).
//
//   npx vite-node scripts/bench-summary.mjs

import os from "node:os";
import path from "node:path";
import { BUILT_IN_SKILLS } from "../packages/shared/src/skills.ts";
import { DEFAULT_CLEANUP_MODEL } from "../packages/shared/src/llm-models.ts";
import { CleanupEngine } from "../apps/desktop/src/main/cleanup/engine.ts";
import { estimateTokens, summarizeMeeting } from "../apps/desktop/src/main/meetings/summarizer.ts";
import { cleanupModelRoot } from "../apps/desktop/src/main/speech/paths.ts";
import { modelLocation } from "../apps/desktop/src/main/speech/model-store.ts";

const script = [
  [
    "system",
    "Okay, let's start. The goal today is to decide when we ship the new onboarding flow.",
  ],
  [
    "mic",
    "Thanks Dana. QA found three bugs last week, two are fixed, the microphone prompt one is still open.",
  ],
  ["system", "How long to fix the last one?"],
  ["mic", "About two days. I would say we can ship on Thursday the 27th if nothing else turns up."],
  ["system", "Marketing wanted the announcement on Monday. Priya, is that still possible?"],
  [
    "mic",
    "Priya here. Monday works if the build is out by Friday. Otherwise I need a week's notice.",
  ],
  ["system", "Then let's decide: we ship Thursday the 27th, announcement the Monday after."],
  ["mic", "Agreed. I will also write the release notes by Wednesday."],
  [
    "system",
    "Rahul, can you check the Frankfurt server capacity before the launch? Last time it was down for forty minutes.",
  ],
  ["mic", "Yes, I will run a load test on Tuesday and send the numbers to everyone."],
  ["system", "One open question: do we keep the old flow behind a switch for the first week?"],
  ["mic", "I would keep it, but it costs us about two extra days of testing."],
  [
    "system",
    "Let's decide that tomorrow once Rahul has the load numbers. Anything else? No? Thanks everyone.",
  ],
];
const segments = (copies) =>
  Array.from({ length: copies }, (_, copy) =>
    script.map(([channel, text], i) => ({
      id: `m:${channel}:${copy}:${i}`,
      channel,
      startMs: (copy * script.length + i) * 22_000,
      text,
    })),
  ).flat();

const root = cleanupModelRoot(path.join(os.homedir(), "Library", "Application Support"));
const modelPath = path.join(
  modelLocation(root, DEFAULT_CLEANUP_MODEL).dir,
  DEFAULT_CLEANUP_MODEL.files[0].path,
);
const engine = new CleanupEngine();
const { loadMs } = await engine.load(modelPath);
console.log(`loaded ${DEFAULT_CLEANUP_MODEL.label} in ${loadMs} ms\n`);

for (const [label, copies, skill] of [
  ["short meeting", 1, BUILT_IN_SKILLS[0]],
  ["short meeting, Action review", 1, BUILT_IN_SKILLS[1]],
  ["long meeting (map-reduce)", 14, BUILT_IN_SKILLS[0]],
]) {
  const segs = segments(copies);
  let calls = 0;
  let worstPrompt = 0;
  const started = performance.now();
  const markdown = await summarizeMeeting(
    {
      generate: async (request) => {
        calls++;
        worstPrompt = Math.max(
          worstPrompt,
          estimateTokens(request.system) + estimateTokens(request.prompt) + request.maxTokens,
        );
        return engine.generate(request, () => {});
      },
    },
    { segments: segs, notes: "", skill, length: skill.length },
  );
  const bullets = markdown.split("\n").filter((line) => line.startsWith("- "));
  const cited = bullets.filter((line) => /\(seg:/.test(line)).length;
  const none = bullets.filter((line) => line.endsWith("(No source)")).length;
  console.log(
    `${label}: ${segs.length} lines, ${calls} model calls, ${Math.round((performance.now() - started) / 1000)} s, largest call about ${worstPrompt} tokens.\n` +
      `  bullets ${bullets.length}: with a link ${cited}, No source ${none}\n${markdown}\n`,
  );
}
