// Checks Instruct Mode drafts (RW-11) on the local model: a reply about Thursday must mention
// Thursday and add no other plan; action requests must give a draft that does not claim to
// have been sent or scheduled. Needs the model and Node 22.18+.
//
//   node scripts/bench-instruct.mjs            the Fast (cleanup) model
//   node scripts/bench-instruct.mjs quality    the Quality model, once downloaded

import os from "node:os";
import path from "node:path";
import {
  DEFAULT_CLEANUP_MODEL,
  QUALITY_INSTRUCT_MODEL,
} from "../packages/shared/src/llm-models.ts";
import { GENERATION_LIMITS } from "../packages/shared/src/generation.ts";
import { CleanupEngine } from "../apps/desktop/src/main/cleanup/engine.ts";
import { buildGenerationPrompt } from "../apps/desktop/src/main/generation/prompt.ts";
import { stripPreface } from "../apps/desktop/src/main/generation/output.ts";
import {
  actionInstruction,
  asksForAction,
  followUpInstruction,
} from "../apps/desktop/src/main/instruct/actions.ts";
import { cleanupModelRoot } from "../apps/desktop/src/main/speech/paths.ts";
import { modelLocation } from "../apps/desktop/src/main/speech/model-store.ts";

const cases = [
  {
    instruction: "draft a reply saying I can do Thursday",
    field: "Hi, could we meet next week to go over the budget? Let me know which day suits you.",
    check: (text) =>
      /thursday/i.test(text) &&
      !/\b(monday|tuesday|wednesday|friday|saturday|sunday)\b/i.test(text),
    what: "mentions Thursday, no other day",
  },
  {
    instruction: "draft a reply saying I can do Thursday, keep it short",
    field: "Are you free for a call this week?",
    check: (text) => /thursday/i.test(text) && text.split(/\s+/).length <= 40,
    what: "mentions Thursday, 40 words or fewer",
  },
  {
    instruction: "send this to Sam",
    selection: "The release moves to 14 March because QA found two blocking bugs.",
    check: (text) =>
      /sam/i.test(text) &&
      /14 march/i.test(text) &&
      !/send this/i.test(text) &&
      !/\b(sent|forwarded|scheduled|booked)\b/i.test(text),
    what: "a message to Sam with the content, no echo, no claim it was sent",
  },
  {
    instruction: "schedule a meeting with Priya on Friday at 10 about the roadmap",
    check: (text) => /friday/i.test(text) && !/\b(sent|scheduled|booked|confirmed)\b/i.test(text),
    what: "a draft mentioning Friday, no claim it was scheduled",
  },
];

const root = cleanupModelRoot(path.join(os.homedir(), "Library", "Application Support"));
const chosen = process.argv[2] === "quality" ? QUALITY_INSTRUCT_MODEL : DEFAULT_CLEANUP_MODEL;
const modelPath = path.join(modelLocation(root, chosen).dir, chosen.files[0].path);
console.log(`Model: ${chosen.label}\n`);
const engine = new CleanupEngine();
await engine.load(modelPath);

let passed = 0;
for (const item of cases) {
  const action = asksForAction(item.instruction);
  const { system, prompt } = buildGenerationPrompt({
    instruction: action ? actionInstruction(item.instruction) : item.instruction,
    text: item.selection ?? "",
    ...(item.field ? { fieldText: item.field } : {}),
  });
  const started = performance.now();
  const raw = await engine.generate(
    { system, prompt, maxTokens: GENERATION_LIMITS.instruct.maxTokens },
    () => {},
  );
  const text = stripPreface(raw);
  const ok = item.check(text);
  if (ok) passed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${item.instruction} (${item.what}; action ${action}; ${Math.round(performance.now() - started)} ms)\n  → ${text.replace(/\n/g, "\n    ")}\n`,
  );
}
// A follow-up (RW-12): "make it shorter" must shorten the same draft and keep Thursday.
const first = {
  instruction:
    "draft a friendly reply saying I can do Thursday afternoon, that I will bring the budget numbers and the Q3 forecast, and asking whether we should invite Priya from finance",
  field: "Hi, could we meet next week to go over the budget? Let me know which day suits you.",
};
const opening = buildGenerationPrompt({
  instruction: first.instruction,
  text: "",
  fieldText: first.field,
});
const draft = stripPreface(
  await engine.generate(
    {
      system: opening.system,
      prompt: opening.prompt,
      maxTokens: GENERATION_LIMITS.instruct.maxTokens,
    },
    () => {},
  ),
);
const follow = buildGenerationPrompt({
  instruction: followUpInstruction("make it shorter", []),
  text: draft,
  fieldText: first.field,
});
const shorter = stripPreface(
  await engine.generate(
    {
      system: follow.system,
      prompt: follow.prompt,
      maxTokens: GENERATION_LIMITS.instruct.maxTokens,
      history: [
        { role: "user", text: first.instruction },
        { role: "assistant", text: draft },
      ],
    },
    () => {},
  ),
);
const followOk = shorter.length < draft.length && /thursday/i.test(shorter);
if (followOk) passed++;
console.log(
  `${followOk ? "ok  " : "FAIL"} follow-up "make it shorter" (${draft.length} → ${shorter.length} characters, keeps Thursday)\n  → ${draft.replace(/\n/g, " ")}\n  → ${shorter.replace(/\n/g, " ")}\n`,
);
console.log(`${passed}/${cases.length + 1} passed`);
await engine.unload();
