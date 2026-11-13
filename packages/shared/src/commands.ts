import type { PressKey, PressModifier } from "./selection";

// Command Mode (RW-08, RW-09): a fixed list of spoken commands that act on the selected text
// or the last dictation. Murmur's own wording. Main matches what was said to one of these;
// raw speech is never inserted.

/**
 * - `rewrite`: the local model rewrites the text; the result is shown before Replace.
 * - `output`: the local model writes something new that goes below the text.
 * - `text`: changed in Murmur, no model.
 * - `keys`: a key press in the app (Command+B and so on).
 */
export const COMMAND_KINDS = ["rewrite", "output", "text", "keys"] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

export const COMMAND_IDS = [
  "shorter",
  "clearer",
  "list",
  "formal",
  "friendly",
  "translate",
  "grammar",
  "uppercase",
  "lowercase",
  "capitalise",
  "delete",
  "new_line",
  "new_paragraph",
  "bold",
  "italic",
  "select_all",
  "undo",
  "press_enter",
  "summary",
  "questions",
] as const;
export type CommandId = (typeof COMMAND_IDS)[number];

export interface CommandDefinition {
  id: CommandId;
  kind: CommandKind;
  /** The name shown on the panel and in the Hub's list. */
  label: string;
  /** Example phrases, for the Hub's list and the model's choice. */
  phrases: readonly string[];
  /** Whether it needs text to act on (the selection or the last dictation). */
  needsText: boolean;
  /** For `rewrite` and `output`: what the model is asked. `{language}` is filled in. */
  instruction?: string;
  /** For `keys`. */
  keys?: { key: PressKey; modifiers: PressModifier[] };
}

export const COMMANDS: readonly CommandDefinition[] = [
  {
    id: "shorter",
    kind: "rewrite",
    label: "Make it shorter",
    phrases: [
      "make this shorter",
      "shorten it",
      "tighten this up",
      "make it more concise",
      "trim it down",
    ],
    needsText: true,
    instruction:
      "Make the text shorter. Remove repetition and filler, keep every point and fact, and keep the tone.",
  },
  {
    id: "clearer",
    kind: "rewrite",
    label: "Make it clearer",
    phrases: [
      "make it clearer",
      "clarify this",
      "make this easier to read",
      "simplify it",
      "make it more clear",
    ],
    needsText: true,
    instruction:
      "Make the text clearer and easier to read. Use plain words and short sentences, and keep the meaning and the facts.",
  },
  {
    id: "list",
    kind: "rewrite",
    label: "Make it a list",
    phrases: [
      "make it a list",
      "turn this into bullet points",
      "make this a bulleted list",
      "list form",
      "bullet this",
    ],
    needsText: true,
    instruction:
      'Turn the text into a bulleted list. Put one point on each line, starting with "- ". Keep the wording where you can.',
  },
  {
    id: "formal",
    kind: "rewrite",
    label: "Make it formal",
    phrases: [
      "make it formal",
      "make this more professional",
      "sound more formal",
      "make it polite",
      "formalise this",
    ],
    needsText: true,
    instruction:
      "Rewrite the text in a formal, professional tone. Keep the meaning, the facts and roughly the length.",
  },
  {
    id: "friendly",
    kind: "rewrite",
    label: "Make it friendly",
    phrases: [
      "make it friendly",
      "make this friendlier",
      "make it more casual",
      "sound warmer",
      "make it less formal",
    ],
    needsText: true,
    instruction:
      "Rewrite the text in a warm, friendly tone. Keep the meaning, the facts and roughly the length.",
  },
  {
    id: "translate",
    kind: "rewrite",
    label: "Translate",
    phrases: [
      "translate to Spanish",
      "translate this into French",
      "put this in German",
      "say this in Hindi",
      "translate it to Japanese",
    ],
    needsText: true,
    instruction:
      "Translate the text into {language}. Keep names, numbers, links and code exactly as written.",
  },
  {
    id: "grammar",
    kind: "rewrite",
    label: "Fix the grammar",
    phrases: [
      "fix the grammar",
      "correct the spelling",
      "fix the typos",
      "proofread this",
      "fix this up",
    ],
    needsText: true,
    instruction:
      "Correct grammar, spelling and punctuation only. Do not change the wording, the tone or the length otherwise.",
  },
  {
    id: "uppercase",
    kind: "text",
    label: "Uppercase",
    phrases: [
      "uppercase that",
      "make it all caps",
      "capital letters",
      "upper case this",
      "all caps",
    ],
    needsText: true,
  },
  {
    id: "lowercase",
    kind: "text",
    label: "Lowercase",
    phrases: [
      "lowercase that",
      "make it lower case",
      "small letters",
      "lower case this",
      "no caps",
    ],
    needsText: true,
  },
  {
    id: "capitalise",
    kind: "text",
    label: "Capitalise",
    phrases: [
      "capitalise that",
      "capitalize this",
      "title case",
      "capitalise each word",
      "make it title case",
    ],
    needsText: true,
  },
  {
    id: "delete",
    kind: "text",
    label: "Delete",
    phrases: ["delete that", "remove this", "erase it", "delete", "get rid of that"],
    needsText: true,
  },
  {
    id: "new_line",
    kind: "text",
    label: "New line",
    phrases: ["new line", "next line", "line break", "add a new line", "insert a line break"],
    needsText: false,
  },
  {
    id: "new_paragraph",
    kind: "text",
    label: "New paragraph",
    phrases: [
      "new paragraph",
      "next paragraph",
      "start a new paragraph",
      "add a paragraph break",
      "paragraph break",
    ],
    needsText: false,
  },
  {
    id: "bold",
    kind: "keys",
    label: "Bold",
    phrases: ["bold that", "make it bold", "bold this", "embolden it", "put that in bold"],
    needsText: false,
    keys: { key: "b", modifiers: ["command"] },
  },
  {
    id: "italic",
    kind: "keys",
    label: "Italic",
    phrases: [
      "italicise that",
      "make it italic",
      "italics",
      "italicize this",
      "put that in italics",
    ],
    needsText: false,
    keys: { key: "i", modifiers: ["command"] },
  },
  {
    id: "select_all",
    kind: "keys",
    label: "Select all",
    phrases: [
      "select all",
      "select everything",
      "select all the text",
      "highlight everything",
      "select the whole thing",
    ],
    needsText: false,
    keys: { key: "a", modifiers: ["command"] },
  },
  {
    id: "undo",
    kind: "keys",
    label: "Undo",
    phrases: ["undo that", "undo", "take that back", "undo the last change", "revert that"],
    needsText: false,
    keys: { key: "z", modifiers: ["command"] },
  },
  {
    id: "press_enter",
    kind: "keys",
    label: "Press Enter",
    phrases: ["press enter", "hit enter", "press return", "hit return", "enter"],
    needsText: false,
    keys: { key: "return", modifiers: [] },
  },
  {
    id: "summary",
    kind: "output",
    label: "Add a summary below",
    phrases: [
      "add a summary below",
      "summarise this",
      "summarize it",
      "give me a summary",
      "write a tldr",
    ],
    needsText: true,
    instruction:
      "Write a short summary of the text in two to four sentences. Use only what the text says.",
  },
  {
    id: "questions",
    kind: "output",
    label: "List the questions",
    phrases: [
      "list the questions",
      "what are the questions",
      "pull out the questions",
      "find the questions",
      "extract the questions",
    ],
    needsText: true,
    instruction:
      'List every question the text asks or leaves open, one per line, each starting with "- ". If there are none, answer "- No open questions".',
  },
];

export function commandById(id: string): CommandDefinition | null {
  return COMMANDS.find((command) => command.id === id) ?? null;
}

/** "delete that" asks first when the text is longer than this (RW-09). */
export const COMMAND_DELETE_CONFIRM_CHARS = 200;
/** With nothing selected, a command acts on the last dictation within this long (RW-08). */
export const COMMAND_LAST_DICTATION_MS = 5 * 60_000;

/** What the Bar says (RW-08, RW-09). */
export const COMMAND_MESSAGES = {
  notUnderstood: "Did not understand. Try again or pick a command from the list.",
  selectText: "Select text first",
  noLanguage: "Say which language to translate into",
  tooLong: "Select less text (8,000 characters max).",
  secure: "Commands do not read password fields",
  needsAccessibility: "Command Mode needs Accessibility. Turn it on in Settings.",
  changed: "The text changed. Nothing was done.",
  failed: "The command could not be done",
  deleteAsk: "Delete the selected text?",
  done: "Done",
} as const;

/** How a command run ended, for `command_runs`. */
export const COMMAND_OUTCOMES = [
  /** The text was replaced, or the output put below it. */
  "replaced",
  /** A key was pressed in the app. */
  "keys_sent",
  /** A new line or paragraph went in. */
  "inserted",
  /** The result went to the clipboard instead. */
  "copied",
  /** The panel was closed, or a confirmation declined. */
  "discarded",
  /** Nothing matched what was said. */
  "not_understood",
  /** No selection and no recent dictation. */
  "no_text",
  "failed",
] as const;
export type CommandOutcome = (typeof COMMAND_OUTCOMES)[number];

export const COMMAND_TRIGGERS = ["key", "wake_phrase"] as const;
export type CommandTrigger = (typeof COMMAND_TRIGGERS)[number];
