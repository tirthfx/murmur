import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  IMPORT_LIMITS,
  type ImportKind,
  type ImportPreview,
  type ImportRequest,
} from "@murmur/shared";

const HELP: Record<ImportKind, string> = {
  dictionary:
    "A .txt or .csv file: one word per line, or “spoken, written” for a replacement. Up to 5,000 rows and 1 MB.",
  snippets:
    "A .csv file (“trigger, text”) or a Markdown .md file with a heading per snippet and its text below. Up to 1,000 snippets and 2 MB.",
};

/** Bulk import (PZ-07, PZ-10): pick a file, see what would change, then confirm. */
export function ImportSection({ kind, onImported }: { kind: ImportKind; onImported: () => void }) {
  const [request, setRequest] = useState<ImportRequest | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [message, setMessage] = useState<{ status: "success" | "error"; text: string } | null>(
    null,
  );

  async function choose(file: File | undefined) {
    setPreview(null);
    setMessage(null);
    if (!file) return;
    if (file.size > IMPORT_LIMITS[kind].bytes) {
      setMessage({ status: "error", text: "The file is too large." });
      return;
    }
    const next: ImportRequest = { kind, fileName: file.name, text: await file.text() };
    setRequest(next);
    setPreview(await window.murmur.importPreview(next));
  }

  async function confirm() {
    if (!request) return;
    const result = await window.murmur.importApply(request);
    setPreview(null);
    setRequest(null);
    if (result.ok) {
      setMessage({ status: "success", text: `Imported ${result.added}.` });
      onImported();
    } else setMessage({ status: "error", text: result.message });
  }

  return (
    <section aria-labelledby={`import-${kind}`}>
      <VStack gap={2}>
        <Text weight="semibold" id={`import-${kind}`}>
          Import from a file
        </Text>
        <Text size="sm" color="secondary">
          {HELP[kind]}
        </Text>
        <input
          type="file"
          accept={kind === "dictionary" ? ".txt,.csv" : ".csv,.md,.markdown"}
          aria-label={`Choose a file to import into ${kind === "dictionary" ? "the dictionary" : "snippets"}`}
          onChange={(event) => void choose(event.currentTarget.files?.[0])}
        />
        {preview ? (
          <VStack gap={1}>
            {preview.blocked ? (
              <Banner status="error" title={preview.blocked} />
            ) : (
              <Text>
                {preview.added} new, {preview.duplicates.length} already there (skipped),{" "}
                {preview.invalid.length} not readable.
              </Text>
            )}
            {preview.sample.length > 0 ? (
              <ul className="hub-import-list" aria-label="First rows to import">
                {preview.sample.map((row) => (
                  <li key={row.line}>
                    <Text size="sm">{row.text}</Text>
                  </li>
                ))}
              </ul>
            ) : null}
            {preview.invalid.length > 0 ? (
              <ul className="hub-import-list" aria-label="Lines that cannot be imported">
                {preview.invalid.slice(0, 50).map((row) => (
                  <li key={row.line}>
                    <Text size="sm" color="secondary">
                      Line {row.line}: {row.text}
                    </Text>
                  </li>
                ))}
              </ul>
            ) : null}
            <HStack gap={2}>
              <Button
                label={`Import ${preview.added}`}
                isDisabled={preview.blocked !== null || preview.added === 0}
                onClick={() => void confirm()}
              >
                Import {preview.added}
              </Button>
              <Button
                variant="ghost"
                label="Cancel the import"
                onClick={() => {
                  setPreview(null);
                  setRequest(null);
                }}
              >
                Cancel
              </Button>
            </HStack>
          </VStack>
        ) : null}
        {message ? <Banner status={message.status} title={message.text} /> : null}
      </VStack>
    </section>
  );
}
