// Checks Command Mode matching (RW-09) on the local model: phrases no rule matches go to the
// model, which may only answer with a command id. Reports how often the rules were enough and
// how often the model picked the right command, with its time. Needs the model and Node 22.18+.
//
//   node scripts/bench-commands.mjs

import os from "node:os";
import path from "node:path";
import { DEFAULT_CLEANUP_MODEL } from "../packages/shared/src/llm-models.ts";
import { CleanupEngine } from "../apps/desktop/src/main/cleanup/engine.ts";
import { matchCommand } from "../apps/desktop/src/main/commands/match.ts";
import {
  COMMAND_CHOICE_MAX_TOKENS,
  commandChoicePrompt,
  parseCommandChoice,
} from "../apps/desktop/src/main/commands/model-match.ts";
import { cleanupModelRoot } from "../apps/desktop/src/main/speech/paths.ts";
import { modelLocation } from "../apps/desktop/src/main/speech/model-store.ts";

// Said differently from the catalogue, so some miss the rules on purpose. null: not a command.
const set = [
  ["slant those words", "italic"],
  ["could you squeeze this into fewer lines", "shorter"],
  ["make it sound less stiff", "friendly"],
  ["put a fat font on it", "bold"],
  ["what's being asked here", "questions"],
  ["boil it down for me", "summary"],
  ["sort out the commas and stuff", "grammar"],
  ["make it sound like a lawyer wrote it", "formal"],
  ["shout it", "uppercase"],
  ["get this into Spanish", "translate"],
  ["throw that away", "delete"],
  ["go down a line", "new_line"],
  ["send it", "press_enter"],
  ["grab everything", "select_all"],
  ["oops go back", "undo"],
  ["break it into points", "list"],
  ["say it more simply", "clearer"],
  ["what time is it", null],
  ["I love this song", null],
  ["remind me to call mum", null],
];

const root = cleanupModelRoot(path.join(os.homedir(), "Library", "Application Support"));
const modelPath = path.join(
  modelLocation(root, DEFAULT_CLEANUP_MODEL).dir,
  DEFAULT_CLEANUP_MODEL.files[0].path,
);
const engine = new CleanupEngine();
await engine.load(modelPath);

let byRule = 0;
let right = 0;
const times = [];
for (const [phrase, wanted] of set) {
  const rule = matchCommand(phrase);
  let got;
  let how;
  if (rule) {
    byRule++;
    got = rule.id;
    how = "rule";
  } else {
    const { system, prompt } = commandChoicePrompt(phrase);
    const started = performance.now();
    const answer = await engine.generate(
      { system, prompt, maxTokens: COMMAND_CHOICE_MAX_TOKENS },
      () => {},
    );
    times.push(performance.now() - started);
    got = parseCommandChoice(answer);
    how = "model";
  }
  if (got === wanted) right++;
  console.log(`${got === wanted ? "ok  " : "MISS"} ${how.padEnd(5)} ${phrase} -> ${got ?? "none"}`);
}
times.sort((a, b) => a - b);
const p50 = times[Math.floor(times.length / 2)] ?? 0;
console.log(
  `\n${right}/${set.length} right; rules matched ${byRule}; model asked ${times.length} times, p50 ${Math.round(p50)} ms, max ${Math.round(times.at(-1) ?? 0)} ms`,
);
await engine.unload();
