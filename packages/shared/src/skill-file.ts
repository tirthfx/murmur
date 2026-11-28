import { SKILL_LENGTHS, skillDraftSchema, type Skill, type SkillDraft } from "./skills";

/**
 * A Skill as a Markdown file (NT-16): a front-matter block between two lines of `---`, then the
 * prompt.
 *
 *     ---
 *     name: Customer call notes
 *     description: Problems, asks and commitments.
 *     length: medium
 *     sections:
 *       - Problems raised
 *       - What they asked for
 *     ---
 *     Write notes of a call with a customer...
 *
 * `model: quality` asks for the larger local model; anything else means the fast one. `version`
 * may be present (the spec lists it); it is read and not used.
 * Anything wrong is reported with the number of the line it is on.
 */

export type SkillFileResult =
  { ok: true; draft: SkillDraft } | { ok: false; line: number; message: string };

const KEYS = ["name", "description", "sections", "length", "version", "model"] as const;
type Key = (typeof KEYS)[number];

const fail = (line: number, message: string): SkillFileResult => ({ ok: false, line, message });

/** A value written bare, in double quotes (as JSON) or in single quotes. */
function readValue(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const text = raw.trim();
  if (text.startsWith('"')) {
    try {
      const value: unknown = JSON.parse(text);
      if (typeof value === "string") return { ok: true, value };
    } catch {
      // fall through
    }
    return { ok: false, message: "A value in double quotes must end with a closing double quote." };
  }
  if (text.startsWith("'")) {
    if (text.length >= 2 && text.endsWith("'")) return { ok: true, value: text.slice(1, -1) };
    return { ok: false, message: "A value in single quotes must end with a closing single quote." };
  }
  return { ok: true, value: text };
}

export function parseSkillFile(input: string): SkillFileResult {
  const lines = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  if (lines[0]?.trim() !== "---")
    return fail(1, "A Skill file starts with a line of three dashes (---).");
  const close = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (close === -1)
    return fail(lines.length, "The front matter is not closed: add a line of three dashes (---).");

  const values = new Map<Key, { value: string; line: number }>();
  const sections: { text: string; line: number }[] = [];
  let sectionsLine = 0;
  let inList = false;
  for (let i = 1; i < close; i++) {
    const line = lines[i]!;
    const number = i + 1;
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const item = /^\s+-\s*(.*)$/.exec(line) ?? (inList ? /^-\s*(.*)$/.exec(line) : null);
    if (item) {
      if (!inList) return fail(number, "A list item must be under “sections:”.");
      const read = readValue(item[1]!);
      if (!read.ok) return fail(number, read.message);
      sections.push({ text: read.value, line: number });
      continue;
    }
    const pair = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(line);
    if (!pair) return fail(number, "Expected a line like “name: Meeting summary”.");
    inList = false;
    const key = pair[1]!.toLowerCase() as Key;
    if (!KEYS.includes(key))
      return fail(number, `“${pair[1]}” is not a Skill field. Fields: ${KEYS.join(", ")}.`);
    if (values.has(key) || (key === "sections" && sectionsLine > 0))
      return fail(number, `“${key}” appears more than once.`);
    if (key === "sections") {
      sectionsLine = number;
      const rest = pair[2]!.trim();
      if (rest === "") {
        inList = true;
      } else if (rest.startsWith("[") && rest.endsWith("]")) {
        for (const part of rest.slice(1, -1).split(",")) {
          const read = readValue(part);
          if (!read.ok) return fail(number, read.message);
          if (read.value !== "") sections.push({ text: read.value, line: number });
        }
      } else {
        return fail(number, "“sections” is a list: put one “- Heading” on each line below it.");
      }
      continue;
    }
    const read = readValue(pair[2]!);
    if (!read.ok) return fail(number, read.message);
    values.set(key, { value: read.value, line: number });
  }

  const name = values.get("name");
  if (!name || name.value === "")
    return fail(2 <= close ? 2 : 1, "The name is missing: add “name: …”.");
  const length = values.get("length");
  if (length && !(SKILL_LENGTHS as readonly string[]).includes(length.value))
    return fail(length.line, `The length must be one of: ${SKILL_LENGTHS.join(", ")}.`);
  const version = values.get("version");
  if (version && !/^\d+$/.test(version.value))
    return fail(version.line, "The version must be a whole number.");
  if (sections.length === 0)
    return fail(sectionsLine || close + 1, "Add at least one section under “sections:”.");

  const prompt = lines
    .slice(close + 1)
    .join("\n")
    .trim();
  if (prompt === "")
    return fail(
      close + 1,
      "The prompt is empty: write what the Skill should do below the front matter.",
    );

  const draft = {
    name: name.value,
    description: values.get("description")?.value ?? "",
    sections: sections.map((section) => section.text),
    length: (length?.value ?? "medium") as Skill["length"],
    prompt,
    // A file may name some other tool's model; only "quality" asks for the larger one here.
    model: values.get("model")?.value === "quality" ? ("quality" as const) : ("fast" as const),
  };
  const checked = skillDraftSchema.safeParse(draft);
  if (checked.success) return { ok: true, draft: checked.data };
  const issue = checked.error.issues[0]!;
  const field = issue.path[0];
  const where =
    field === "sections"
      ? ((typeof issue.path[1] === "number" ? sections[issue.path[1]]?.line : undefined) ??
        sectionsLine)
      : field === "name"
        ? name.line
        : field === "description"
          ? (values.get("description")?.line ?? 1)
          : close + 1;
  const limits: Record<string, string> = {
    name: "The name must be 1 to 80 characters.",
    description: "The description must be at most 300 characters.",
    sections: "Each section name must be 1 to 60 characters, and there can be at most 12.",
    prompt: "The prompt must be at most 4000 characters.",
  };
  return fail(where || 1, limits[String(field)] ?? "That value is not allowed.");
}

const needsQuotes = (text: string) =>
  text === "" ||
  /^[\s"'[\]#-]/.test(text) ||
  /\s$/.test(text) ||
  /:\s|\s#/.test(text) ||
  text.includes("\n");
const word = (text: string) => (needsQuotes(text) ? JSON.stringify(text) : text);

export function formatSkillFile(
  skill: Pick<
    Skill,
    "name" | "description" | "sections" | "length" | "prompt" | "version" | "model"
  >,
): string {
  return [
    "---",
    `name: ${word(skill.name)}`,
    `description: ${word(skill.description.replace(/\s*\n\s*/g, " "))}`,
    `length: ${skill.length}`,
    `version: ${skill.version}`,
    `model: ${skill.model}`,
    "sections:",
    ...skill.sections.map((section) => `  - ${word(section)}`),
    "---",
    skill.prompt.trim(),
    "",
  ].join("\n");
}

/** A file name for a Skill: lower case words joined by dashes, plus ".md". */
export function skillFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "skill"}.md`;
}
