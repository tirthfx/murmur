import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { createDictionaryStore } from "../dictionary/dictionary-store";
import { createSnippetStore } from "../snippets/snippet-store";
import { createImporter } from "./importer";
import { parseCsv, parseDictionaryFile, parseSnippetFile } from "./parse";

describe("parsing import files", () => {
  it("reads CSV with quotes, commas and line breaks inside fields", () => {
    expect(parseCsv('a,"b, c"\n"say ""hi""","two\nlines"\n')).toEqual([
      { line: 1, cells: ["a", "b, c"] },
      { line: 2, cells: ['say "hi"', "two\nlines"] },
    ]);
  });

  it("reads terms and replacements, and names bad lines", () => {
    const { rows, invalid } = parseDictionaryFile(
      "spoken,written\nKubernetes\nk8s, Kubernetes\n\na,b,c\n" + "x".repeat(61),
    );
    expect(rows).toEqual([
      { line: 2, term: "Kubernetes", replacement: null },
      { line: 3, term: "k8s", replacement: "Kubernetes" },
    ]);
    expect(invalid).toEqual([
      { line: 5, text: "more than two columns" },
      { line: 6, text: "longer than 60 characters" },
    ]);
  });

  it("reads Markdown snippets, one per heading", () => {
    const { rows, invalid } = parseSnippetFile(
      "snippets.md",
      "stray line\n# my address\n\n12 Hill Road\nPune\n\n## sign off\nBest, Tirth\n# x\nshort trigger",
    );
    expect(rows).toEqual([
      { line: 2, trigger: "my address", body: "12 Hill Road\nPune" },
      { line: 7, trigger: "sign off", body: "Best, Tirth" },
    ]);
    expect(invalid).toEqual([
      { line: 1, text: "text before the first heading" },
      { line: 9, text: "trigger must be 2 to 60 characters" },
    ]);
  });

  it("reads CSV snippets", () => {
    expect(parseSnippetFile("s.csv", 'trigger,text\nmy address,"12 Hill Road\nPune"').rows).toEqual(
      [{ line: 2, trigger: "my address", body: "12 Hill Road\nPune" }],
    );
  });
});

describe("importing", () => {
  function setup() {
    const db = openDatabase(":memory:");
    const dictionary = createDictionaryStore(db);
    const snippets = createSnippetStore(db);
    return { dictionary, snippets, importer: createImporter({ dictionary, snippets }) };
  }

  it("previews 500 rows with duplicates, then imports them in one go", () => {
    const { dictionary, importer } = setup();
    dictionary.save({ term: "word7", replacement: null, caseSensitive: false, starred: false });
    const lines = Array.from({ length: 500 }, (_, index) => `word${index}`);
    lines.push("WORD3");
    const request = { kind: "dictionary" as const, fileName: "words.txt", text: lines.join("\n") };
    const preview = importer.preview(request);
    expect(preview).toMatchObject({ added: 499, blocked: null, invalid: [] });
    expect(preview.duplicates).toEqual([
      { line: 8, text: "word7" },
      { line: 501, text: "WORD3" },
    ]);
    expect(preview.sample).toHaveLength(20);
    expect(importer.apply(request)).toEqual({ ok: true, added: 499 });
    expect(dictionary.list()).toHaveLength(500);
    expect(dictionary.list().filter((entry) => entry.source === "import")).toHaveLength(499);
    expect(importer.apply(request)).toEqual({ ok: false, message: "Nothing new to import." });
  });

  it("imports snippets and skips triggers already there", () => {
    const { snippets, importer } = setup();
    snippets.save({ trigger: "Sign off!", plain: "old", rich: null });
    const request = {
      kind: "snippets" as const,
      fileName: "s.md",
      text: "# my address\n12 Hill Road\n# sign off\nBest\n# third one\nThree",
    };
    expect(importer.preview(request)).toMatchObject({
      added: 2,
      duplicates: [{ line: 3, text: "sign off" }],
    });
    expect(importer.apply(request)).toEqual({ ok: true, added: 2 });
    expect(snippets.list().map((snippet) => snippet.trigger)).toEqual([
      "my address",
      "Sign off!",
      "third one",
    ]);
  });

  it("blocks a file that is too large", () => {
    const { importer } = setup();
    const preview = importer.preview({
      kind: "dictionary",
      fileName: "big.txt",
      text: "a\n".repeat(600_000),
    });
    expect(preview.blocked).toContain("larger than 1 MB");
  });
});
