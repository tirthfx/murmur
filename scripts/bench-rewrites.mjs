// Checks the built-in Rewrites (RW-02) on the local model: Tighten must come out shorter and
// keep every number and name; Keep tone must add no content words (a spelling fix close to
// an original word does not count). Needs the model and Node 22.18+.
//
//   node scripts/bench-rewrites.mjs

import os from "node:os";
import path from "node:path";
import { DEFAULT_CLEANUP_MODEL } from "../packages/shared/src/llm-models.ts";
import { GENERATION_LIMITS } from "../packages/shared/src/generation.ts";
import { BUILTIN_REWRITES } from "../packages/shared/src/rewrites.ts";
import { CleanupEngine } from "../apps/desktop/src/main/cleanup/engine.ts";
import { buildGenerationPrompt } from "../apps/desktop/src/main/generation/prompt.ts";
import { stripPreface } from "../apps/desktop/src/main/generation/output.ts";
import { cleanupModelRoot } from "../apps/desktop/src/main/speech/paths.ts";
import { modelLocation } from "../apps/desktop/src/main/speech/model-store.ts";

const tightenSet = [
  "So I just wanted to quickly let you know that, as I mentioned before, the meeting with Priya has been moved from Wednesday to Thursday at 3:30 in the afternoon.",
  "Basically the invoice, which is for 1,250 euros, really needs to be paid by the 15th, because otherwise there is going to be a late fee of 5 percent added on top.",
  "I think that we should probably consider maybe shipping the release on Monday rather than on Friday, mainly because QA has found 3 bugs that are quite serious.",
  "Rahul mentioned to me earlier today that the server in Frankfurt was down for roughly 40 minutes last night, and as far as I know nobody got paged about it at all.",
  "Just as a quick reminder for everyone, the office in Pune will be closed on the 2nd of October, so please plan your work and your deliveries around that date.",
  "We have, as far as I can see, basically three options here: we can rebuild the cache, we can add a second node, or we can simply just wait and see what happens.",
  "I wanted to say a really big thank you to Ana for all of her help with the migration, which honestly would have taken us at least 2 more weeks without her.",
  "The new onboarding flow that we built has five steps in total, but it looks like users drop off at step 3, where around 22 percent of them leave the flow.",
  "Could you please, when you have a moment, send the signed contract over to the legal team, ideally before Friday, since they need it for the budget of $48,000?",
  "To be honest, I am not completely sure that the numbers in the Q3 report are correct, because the total of 4,812 does not seem to match the sum of the rows.",
];
const keepToneSet = [
  "i dont think we shoud ship this untill the tests pass, its to risky.",
  "Thanks for you're help yesterday, the demo went realy well and the client loved it.",
  "can you send me the file's before friday? i need them for the report",
  "Their going to call us back tommorow about the budget, lets wait.",
  "the meeting is at 3pm in room 4, dont be late becuase we start on time",
];
const glue = new Set(
  "a an the and or but to of in on at for is are was were be it its it's this that with as by from i we you they he she do does did not dont don't".split(
    " ",
  ),
);
const words = (text) =>
  text
    .toLowerCase()
    .replace(/['’]/g, "")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}
const numbersAndNames = (text) =>
  (text.match(/\d[\d,.:$%]*\d|\d|\b[A-Z][a-z]+\b/g) ?? []).filter(
    (token, index) => /\d/.test(token) || index > 0,
  );

const root = cleanupModelRoot(path.join(os.homedir(), "Library", "Application Support"));
const modelPath = path.join(
  modelLocation(root, DEFAULT_CLEANUP_MODEL).dir,
  DEFAULT_CLEANUP_MODEL.files[0].path,
);
const engine = new CleanupEngine();
await engine.load(modelPath);

async function run(key, text) {
  const builtin = BUILTIN_REWRITES.find((item) => item.key === key);
  const { system, prompt } = buildGenerationPrompt({ instruction: builtin.instruction, text });
  const raw = await engine.generate(
    { system, prompt, maxTokens: GENERATION_LIMITS.rewrite.maxTokens },
    () => {},
  );
  return stripPreface(raw);
}

let shorter = 0;
let kept = 0;
console.log("Tighten\n");
for (const text of tightenSet) {
  const answer = await run("concise", text);
  const isShorter = answer.length < text.length;
  const missing = numbersAndNames(text).filter(
    (token) => !answer.includes(token.replace(/[.,]$/, "")),
  );
  if (isShorter) shorter++;
  if (missing.length === 0) kept++;
  console.log(
    `${isShorter ? "shorter" : "LONGER "} ${missing.length === 0 ? "kept" : `LOST ${missing.join(" ")}`}  ${text.length} → ${answer.length}\n  → ${answer}\n`,
  );
}
let clean = 0;
console.log("Keep tone\n");
for (const text of keepToneSet) {
  const answer = await run("keep_tone", text);
  const source = words(text);
  const added = words(answer).filter(
    (word) =>
      !glue.has(word) &&
      !source.includes(word) &&
      !source.some((original) => distance(original, word) <= 2),
  );
  if (added.length === 0) clean++;
  console.log(
    `${added.length === 0 ? "clean" : `ADDED ${added.join(" ")}`}\n  ${text}\n  → ${answer}\n`,
  );
}
console.log(
  `Tighten: shorter ${shorter}/${tightenSet.length}, numbers and names kept ${kept}/${tightenSet.length}. Keep tone: no added words ${clean}/${keepToneSet.length}.`,
);
await engine.unload();
