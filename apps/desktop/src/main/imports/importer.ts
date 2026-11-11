import {
  IMPORT_LIMITS,
  type ImportPreview,
  type ImportRequest,
  type ImportResult,
} from "@murmur/shared";
import type { DictionaryStore } from "../dictionary/dictionary-store";
import type { SnippetStore } from "../snippets/snippet-store";
import { normaliseTrigger } from "../snippets/snippet-store";
import { parseDictionaryFile, parseSnippetFile, type Problem } from "./parse";

/** Rows of the sample shown before importing. */
const SAMPLE_ROWS = 20;

interface Plan {
  preview: ImportPreview;
  apply: () => ImportResult;
}

export interface Importer {
  preview(request: ImportRequest): ImportPreview;
  apply(request: ImportRequest): ImportResult;
}

export function createImporter(deps: {
  dictionary: Pick<DictionaryStore, "list" | "importMany"> | null;
  snippets: Pick<SnippetStore, "list" | "importMany"> | null;
}): Importer {
  function plan(request: ImportRequest): Plan {
    const limits = IMPORT_LIMITS[request.kind];
    const empty = (blocked: string): Plan => ({
      preview: { kind: request.kind, added: 0, sample: [], duplicates: [], invalid: [], blocked },
      apply: () => ({ ok: false, message: blocked }),
    });
    if (Buffer.byteLength(request.text, "utf8") > limits.bytes) {
      return empty(`The file is larger than ${limits.bytes / (1024 * 1024)} MB.`);
    }
    if (request.kind === "dictionary") {
      const store = deps.dictionary;
      if (!store) return empty("The dictionary could not be opened.");
      const { rows, invalid } = parseDictionaryFile(request.text);
      if (rows.length + invalid.length > limits.rows) {
        return empty(`The file has more than ${limits.rows.toLocaleString("en")} rows.`);
      }
      const known = new Set(store.list().map((entry) => entry.term.toLowerCase()));
      const duplicates: Problem[] = [];
      const fresh = rows.filter((row) => {
        const key = row.term.toLowerCase();
        if (known.has(key)) {
          duplicates.push({ line: row.line, text: row.term });
          return false;
        }
        known.add(key);
        return true;
      });
      return {
        preview: {
          kind: "dictionary",
          added: fresh.length,
          sample: fresh.slice(0, SAMPLE_ROWS).map((row) => ({
            line: row.line,
            text: row.replacement ? `${row.term} → ${row.replacement}` : row.term,
          })),
          duplicates,
          invalid,
          blocked: null,
        },
        apply: () => store.importMany(fresh),
      };
    }
    const store = deps.snippets;
    if (!store) return empty("Snippets could not be opened.");
    const { rows, invalid } = parseSnippetFile(request.fileName, request.text);
    if (rows.length + invalid.length > limits.rows) {
      return empty(`The file has more than ${limits.rows.toLocaleString("en")} snippets.`);
    }
    const known = new Set(store.list().map((snippet) => normaliseTrigger(snippet.trigger)));
    const duplicates: Problem[] = [];
    const fresh = rows.filter((row) => {
      const key = normaliseTrigger(row.trigger);
      if (key === "" || known.has(key)) {
        duplicates.push({ line: row.line, text: row.trigger });
        return false;
      }
      known.add(key);
      return true;
    });
    return {
      preview: {
        kind: "snippets",
        added: fresh.length,
        sample: fresh.slice(0, SAMPLE_ROWS).map((row) => ({
          line: row.line,
          text: `“${row.trigger}”: ${row.body.split("\n")[0]}${row.body.includes("\n") ? " …" : ""}`,
        })),
        duplicates,
        invalid,
        blocked: null,
      },
      apply: () =>
        store.importMany(fresh.map((row) => ({ trigger: row.trigger, plain: row.body }))),
    };
  }

  return {
    preview: (request) => plan(request).preview,
    // Parsed again, so what is written matches the file as it is now.
    apply(request) {
      const { preview, apply } = plan(request);
      if (preview.blocked) return { ok: false, message: preview.blocked };
      if (preview.added === 0) return { ok: false, message: "Nothing new to import." };
      return apply();
    },
  };
}
