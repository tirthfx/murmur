// Runs the task extraction (NT-26) on the local model with a made-up meeting: a short one with
// three explicit action items, and a long one that is read in parts. Reports the time, the
// number of model calls, whether the JSON was valid, and the tasks with owner, due date and
// source line. Needs the model (`npm run model:download -- cleanup`) and vite-node.
//
//   npx vite-node scripts/bench-tasks.mjs

import os from "node:os";
import path from "node:path";
import { DEFAULT_CLEANUP_MODEL } from "../packages/shared/src/llm-models.ts";
import { CleanupEngine } from "../apps/desktop/src/main/cleanup/engine.ts";
import { estimateTokens } from "../apps/desktop/src/main/meetings/summarizer.ts";
import { extractTasks } from "../apps/desktop/src/main/meetings/tasks-extractor.ts";
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

const startedAt = new Date(2026, 10, 21, 10, 0).getTime();

for (const [label, copies] of [
  ["short meeting", 1],
  ["long meeting (read in parts)", 14],
]) {
  const segs = segments(copies);
  let calls = 0;
  let worstPrompt = 0;
  const started = performance.now();
  const result = await extractTasks(
    {
      generate: async (request) => {
        calls++;
        worstPrompt = Math.max(
          worstPrompt,
          estimateTokens(request.system) + estimateTokens(request.prompt) + request.maxTokens,
        );
        const text = await engine.generate(request, () => {});
        if (process.env.RAW) console.log(`--- raw (${text.length} chars)\n${text}\n---`);
        return text;
      },
    },
    { segments: segs, meetingStartedAt: startedAt, max: 15 },
  );
  console.log(
    `${label}: ${segs.length} lines, ${calls} model calls, ${Math.round((performance.now() - started) / 1000)} s, largest call about ${worstPrompt} tokens.`,
  );
  if (!result.ok) {
    console.log(`  no tasks: ${result.reason}\n`);
    continue;
  }
  console.log(`  ${result.tasks.length} tasks`);
  for (const task of result.tasks) {
    const line = segs.find((s) => s.id === task.sourceSegmentId);
    console.log(
      `  - ${task.title} | owner ${task.ownerIsMe ? "me" : (task.owner ?? "none")} | due ${task.dueOn ?? "none"} | source ${line ? `"${line.text.slice(0, 40)}..."` : "none"}`,
    );
  }
  console.log("");
}
