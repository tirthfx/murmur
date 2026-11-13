// Prompts for Rewrites and Instruct Mode (RW-07). Murmur's own wording. Imports only plain
// .ts files, so the benchmark script can load it with Node directly.
import {
  GENERATION_INSTRUCTION_MAX,
  GENERATION_MEMORY_MAX,
  GENERATION_SAMPLES,
} from "../../../../../packages/shared/src/generation.ts";

/** The engine's rules, always first. A Rewrite's own instruction comes after and cannot undo them. */
export const ENGINE_RULES = [
  "You rewrite or write text for the user, who will paste your answer straight into a document or message.",
  "Keep every name, number, date, link, email address and piece of code exactly as written; numbers written as digits stay digits.",
  "Do not add facts that are not in the text or the notes below.",
  "Answer with the resulting text only: no introduction, no explanation, no quotation marks around it, and no comment about what you changed.",
  "Write in the same language as the text unless the instruction asks for another.",
] as const;

export interface GenerationPromptInput {
  /** What to do, for example a Rewrite's instruction. */
  instruction: string;
  /** The text to work on (the selection). Empty for Instruct Mode without a selection. */
  text: string;
  /** An example of the wanted output (RW-03). */
  example?: string;
  /** The category style's notes (PZ-11), already worded. */
  style?: string[];
  /** Memory facts (PZ-18). */
  memory?: string[];
  /** The user's own writing (PZ-20), as tone reference. */
  samples?: string[];
  /** Text already in the field around the caret (Instruct Mode, DC-30), for reference only. */
  fieldText?: string;
}

export interface GenerationPrompt {
  system: string;
  prompt: string;
  /** Which context sources went in, for the panel's chips (RW-17). */
  sources: ("memory" | "samples" | "style" | "field")[];
}

/** Field text in the prompt: both sides of the caret together. */
const FIELD_MAX = 4000;

const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

export function buildGenerationPrompt(input: GenerationPromptInput): GenerationPrompt {
  const lines: string[] = [...ENGINE_RULES];
  const sources: GenerationPrompt["sources"] = [];
  const style = (input.style ?? []).map((note) => note.trim()).filter(Boolean);
  if (style.length > 0) {
    lines.push("", "Style notes for this app:", ...style.map((note) => `- ${note}`));
    sources.push("style");
  }
  const memory = (input.memory ?? [])
    .map((fact) => fact.trim())
    .filter(Boolean)
    .slice(0, GENERATION_MEMORY_MAX);
  if (memory.length > 0) {
    lines.push(
      "",
      "Facts about the user (use only when relevant):",
      ...memory.map((f) => `- ${f}`),
    );
    sources.push("memory");
  }
  const samples = (input.samples ?? [])
    .map((sample) => sample.trim())
    .filter(Boolean)
    .slice(0, GENERATION_SAMPLES.max)
    .map((sample) => cut(sample, GENERATION_SAMPLES.chars));
  if (samples.length > 0) {
    lines.push(
      "",
      "Samples of how the user writes. Match their tone and length; never copy their content:",
      ...samples.map((sample, index) => `<sample ${index + 1}>\n${sample}\n</sample ${index + 1}>`),
    );
    sources.push("samples");
  }
  const field = input.fieldText?.trim();
  if (field) {
    lines.push(
      "",
      "Text already in the field where the answer will go, for reference only. Do not repeat it:",
      `<field>\n${cut(field, FIELD_MAX)}\n</field>`,
    );
    sources.push("field");
  }
  lines.push("", "Instruction:", cut(input.instruction.trim(), GENERATION_INSTRUCTION_MAX));
  const example = input.example?.trim();
  if (example) {
    lines.push("", "Example of the wanted result:", cut(example, GENERATION_INSTRUCTION_MAX));
  }
  const text = input.text.trim();
  return {
    system: lines.join("\n"),
    prompt: text === "" ? input.instruction.trim() : `<text>\n${text}\n</text>`,
    sources,
  };
}
