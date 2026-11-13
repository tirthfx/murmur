// The model's part in Command Mode matching (RW-09): when no rule matches, the local model
// may only pick a command id from the fixed list, or "none". It never writes text.
import {
  COMMAND_IDS,
  COMMANDS,
  type CommandId,
} from "../../../../../packages/shared/src/commands.ts";

/** Longest phrase sent to the model. */
const MAX_PHRASE_CHARS = 300;
/** The engine's smallest output budget; an id ends long before it. */
export const COMMAND_CHOICE_MAX_TOKENS = 128;

export function commandChoicePrompt(phrase: string): { system: string; prompt: string } {
  const list = COMMANDS.map(
    (command) =>
      `${command.id}: ${command.label} (for example: ${command.phrases.slice(0, 3).join("; ")})`,
  );
  return {
    system: [
      "You map a short spoken request to one command from a fixed list.",
      "Answer with the command id only, exactly as written in the list, and nothing else.",
      "Requests are often casual or indirect: pick the command whose effect on the text is what the user wants.",
      'Answer "none" only when the request is not about changing the text, its format, or pressing a key.',
      "",
      "Commands:",
      ...list,
    ].join("\n"),
    prompt: `Request: ${phrase.slice(0, MAX_PHRASE_CHARS).trim()}\nCommand id:`,
  };
}

/** The command id the model chose, or null for "none" or anything not on the list. */
export function parseCommandChoice(answer: string): CommandId | null {
  const first = answer
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim()
    .toLowerCase()
    .replace(/^[`"'*\s]+/, "")
    .split(/[\s`"'*.,:;]+/)[0];
  return (COMMAND_IDS as readonly string[]).includes(first ?? "") ? (first as CommandId) : null;
}
