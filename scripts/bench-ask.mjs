// Runs Ask (NT-14) on the local model over three made-up meetings and prints each answer with
// the sources it cites, and whether the meetings supported it. Needs the model
// (`npm run model:download -- cleanup`) and vite-node (comes with vitest).
//
//   npx vite-node scripts/bench-ask.mjs

import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CLEANUP_MODEL } from "../packages/shared/src/llm-models.ts";
import { CleanupEngine } from "../apps/desktop/src/main/cleanup/engine.ts";
import { openDatabase } from "../apps/desktop/src/main/db/database.ts";
import { createAskIndex } from "../apps/desktop/src/main/meetings/ask-index.ts";
import { createAskRunner } from "../apps/desktop/src/main/meetings/ask-runner.ts";
import { createAskStore } from "../apps/desktop/src/main/meetings/ask-store.ts";
import { createMeetingsStore } from "../apps/desktop/src/main/meetings/meetings-store.ts";
import { cleanupModelRoot } from "../apps/desktop/src/main/speech/paths.ts";
import { modelLocation } from "../apps/desktop/src/main/speech/model-store.ts";

const meetingsData = [
  [
    "launch",
    "Launch review",
    new Date(2026, 10, 17, 10).getTime(),
    [
      ["system", "Okay, the goal today is to decide when we ship the new onboarding flow."],
      [
        "mic",
        "QA found three bugs last week. Two are fixed, the microphone prompt one is still open.",
      ],
      ["system", "How long to fix the last one?"],
      ["mic", "About two days. We can ship on Thursday the 27th if nothing else turns up."],
      ["system", "Priya, is the Monday announcement still possible?"],
      [
        "mic",
        "Priya here. Monday works if the build is out by Friday, otherwise I need a week's notice.",
      ],
      ["system", "Rahul, can you check the Frankfurt server capacity before the launch?"],
      ["mic", "Yes, I will run a load test on Tuesday and send the numbers to everyone."],
    ],
  ],
  [
    "budget",
    "Budget call",
    new Date(2026, 10, 10, 14).getTime(),
    [
      ["system", "Let's go through the budget for next quarter."],
      ["mic", "The travel budget for the team offsite is twelve thousand euros, already approved."],
      ["system", "And the cloud spend?"],
      ["mic", "Cloud spend is flat at about four thousand a month. No change expected."],
      ["system", "Finance wants the headcount forecast by the end of the month."],
    ],
  ],
  [
    "hiring",
    "Hiring sync",
    new Date(2026, 10, 19, 9).getTime(),
    [
      ["system", "We have two open roles: a designer and a backend engineer."],
      ["mic", "The designer interviews start next week. Sam is coordinating the panel."],
      ["system", "For the backend role we are still waiting for the job description."],
      ["mic", "I will write the job description by Friday and post it on the careers page."],
    ],
  ],
];

const root = cleanupModelRoot(path.join(os.homedir(), "Library", "Application Support"));
const modelPath = path.join(
  modelLocation(root, DEFAULT_CLEANUP_MODEL).dir,
  DEFAULT_CLEANUP_MODEL.files[0].path,
);
const engine = new CleanupEngine();
const { loadMs } = await engine.load(modelPath);
console.log(`loaded ${DEFAULT_CLEANUP_MODEL.label} in ${loadMs} ms\n`);

const db = openDatabase(":memory:");
const meetings = createMeetingsStore(db);
let n = 0;
for (const [id, title, startedAt, lines] of meetingsData) {
  meetings.create({ id, title, startedAt, source: "ad_hoc", folder: `/m/${id}` });
  lines.forEach(([channel, text], i) =>
    db
      .prepare(
        `INSERT INTO meeting_segments (id, meeting_id, channel, start_ms, end_ms, text, is_dictated, is_final, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1, 1)`,
      )
      .run(`${id}:${++n}`, id, channel, i * 20_000, i * 20_000 + 5_000, text),
  );
}

const now = new Date(2026, 10, 21, 12).getTime();
const runner = createAskRunner({
  index: createAskIndex(db, { now: () => now }),
  store: createAskStore(db, { now: () => Date.now(), newId: () => randomUUID() }),
  settings: () => ({ topK: 12, includeNotes: true }),
  modelReady: async () => true,
  generate: async (request) => {
    const text = await engine.generate(request, () => {});
    if (process.env.RAW) console.log(`--- prompt\n${request.prompt}\n--- raw\n${text}\n---`);
    return text;
  },
  dictating: () => false,
  generating: () => false,
  wait: async () => undefined,
  now: () => now,
  logger: { info() {}, warn: (m) => console.log(`  [warn] ${m}`), error() {} },
});

for (const [question, scope] of [
  ["When are we shipping the new onboarding flow?", { kind: "all" }],
  ["Who is running the load test, and when?", { kind: "all" }],
  ["How much is the travel budget for the offsite?", { kind: "all" }],
  ["What did we decide about the office plants?", { kind: "all" }],
  ["What salary will the designer get?", { kind: "all" }],
  ["What did we say about shipping last Tuesday?", { kind: "all" }],
  ["What did we say about shipping?", { kind: "all" }],
  ["What was said about shipping in the meeting last Tuesday?", { kind: "all" }],
  ["What is the plan for the announcement?", { kind: "meetings", ids: ["budget"] }],
]) {
  const started = performance.now();
  const thread = await runner.send({ threadId: null, question, scope });
  const answer = thread.messages.at(-1);
  console.log(
    `Q: ${question}  [${scope.kind}]  (${Math.round((performance.now() - started) / 100) / 10} s)\n` +
      `A: ${answer.text}\n` +
      `   supported: ${answer.supported}` +
      (answer.citations.length
        ? `\n   cites: ${answer.citations.map((c) => `[${c.n}] ${c.meetingTitle} ${c.source} "${c.excerpt.slice(0, 50).replace(/\n/g, " / ")}..."`).join("\n          ")}`
        : "") +
      (answer.closest.length
        ? `\n   closest: ${answer.closest.map((m) => m.title).join(", ")}`
        : "") +
      "\n",
  );
}
