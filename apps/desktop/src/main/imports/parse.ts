import { DICTIONARY_LIMITS, SNIPPET_LIMITS } from "@murmur/shared";

// Parsing for bulk import (PZ-07, PZ-10). Every row keeps the line it started on, so the
// preview can name the lines it refuses.

export interface CsvRow {
  line: number;
  cells: string[];
}

/** CSV with quoted fields (which may hold commas, quotes as "" and line breaks). */
export function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let touched = false;
  const endRow = () => {
    if (touched || cell !== "" || cells.length > 0)
      rows.push({ line: rowLine, cells: [...cells, cell] });
    cells = [];
    cell = "";
    touched = false;
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === "\n") line++;
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
      touched = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
      touched = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      endRow();
      line++;
      rowLine = line;
    } else {
      cell += char;
    }
  }
  endRow();
  return rows.map((row) => ({ ...row, cells: row.cells.map((value) => value.trim()) }));
}

export interface DictionaryRow {
  line: number;
  term: string;
  replacement: string | null;
}

export interface Problem {
  line: number;
  text: string;
}

/** One term per line, or `spoken, written` for a replacement. A header row is skipped. */
export function parseDictionaryFile(text: string): { rows: DictionaryRow[]; invalid: Problem[] } {
  const rows: DictionaryRow[] = [];
  const invalid: Problem[] = [];
  for (const { line, cells } of parseCsv(text)) {
    if (cells.every((cell) => cell === "")) continue;
    if (line === 1 && /^(spoken|term|word)$/i.test(cells[0] ?? "")) continue;
    if (cells.length > 2) {
      invalid.push({ line, text: "more than two columns" });
      continue;
    }
    const term = (cells[0] ?? "").replace(/\s+/g, " ");
    const replacement = cells.length === 2 && cells[1] !== "" ? cells[1]! : null;
    if (term === "") invalid.push({ line, text: "no word" });
    else if (term.length > DICTIONARY_LIMITS.termLength) {
      invalid.push({ line, text: `longer than ${DICTIONARY_LIMITS.termLength} characters` });
    } else if (replacement && replacement.length > DICTIONARY_LIMITS.replacementLength) {
      invalid.push({ line, text: "replacement too long" });
    } else rows.push({ line, term, replacement });
  }
  return { rows, invalid };
}

export interface SnippetRow {
  line: number;
  trigger: string;
  body: string;
}

function checkSnippet(row: SnippetRow): string | null {
  if (
    row.trigger.length < SNIPPET_LIMITS.triggerMin ||
    row.trigger.length > SNIPPET_LIMITS.triggerMax
  ) {
    return `trigger must be ${SNIPPET_LIMITS.triggerMin} to ${SNIPPET_LIMITS.triggerMax} characters`;
  }
  if (row.body.trim() === "") return "no text";
  if (Buffer.byteLength(row.body, "utf8") > SNIPPET_LIMITS.bodyBytes)
    return "text larger than 20 KB";
  return null;
}

/**
 * Snippets from CSV (`trigger, text`) or Markdown (a heading per snippet, the text below it).
 * Markdown is used for `.md` files, or when the text starts with a heading.
 */
export function parseSnippetFile(
  fileName: string,
  text: string,
): { rows: SnippetRow[]; invalid: Problem[] } {
  const markdown = /\.(md|markdown)$/i.test(fileName) || /^\s*#{1,6}\s/.test(text);
  const candidates: SnippetRow[] = [];
  const invalid: Problem[] = [];
  if (markdown) {
    let current: SnippetRow | null = null;
    const lines = text.split(/\r?\n/);
    lines.forEach((content, index) => {
      const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(content);
      if (heading) {
        if (current) candidates.push(current);
        current = { line: index + 1, trigger: heading[1]!.trim(), body: "" };
      } else if (current) {
        current.body += `${content}\n`;
      } else if (content.trim() !== "") {
        invalid.push({ line: index + 1, text: "text before the first heading" });
      }
    });
    if (current) candidates.push(current);
    for (const row of candidates) row.body = row.body.replace(/^\s*\n/, "").trimEnd();
  } else {
    for (const { line, cells } of parseCsv(text)) {
      if (cells.every((cell) => cell === "")) continue;
      if (line === 1 && /^trigger$/i.test(cells[0] ?? "")) continue;
      if (cells.length !== 2) {
        invalid.push({ line, text: "needs a trigger and the text" });
        continue;
      }
      candidates.push({ line, trigger: cells[0]!, body: cells[1]! });
    }
  }
  const rows: SnippetRow[] = [];
  for (const row of candidates) {
    const problem = checkSnippet(row);
    if (problem) invalid.push({ line: row.line, text: problem });
    else rows.push(row);
  }
  invalid.sort((a, b) => a.line - b.line);
  return { rows, invalid };
}
