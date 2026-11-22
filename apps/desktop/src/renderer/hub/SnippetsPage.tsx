import { ShareWithTeam } from "./ShareWithTeam";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { ImportSection } from "./ImportSection";
import { plainToRich, richToHtml, type Snippet } from "@murmur/shared";
import { domToRich } from "./rich-text";
import { RichEditor } from "./RichEditor";

export function filterSnippets(snippets: readonly Snippet[], query: string): Snippet[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...snippets];
  return snippets.filter(
    (snippet) =>
      snippet.trigger.toLowerCase().includes(needle) ||
      snippet.plain.toLowerCase().includes(needle),
  );
}

/** The Snippets page (PZ-08, PZ-09): say a trigger on its own to insert the saved text. */
export function SnippetsPage() {
  const [snippets, setSnippets] = useState<Snippet[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [trigger, setTrigger] = useState("");
  const [loadKey, setLoadKey] = useState("new-0");
  const [initialHtml, setInitialHtml] = useState("");
  const body = useRef<HTMLElement | null>(null);
  const [hasBody, setHasBody] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [importing, setImporting] = useState(false);
  useEffect(() => {
    window.murmur.getSettings().then(
      (view) => setImporting(view.settings.experimental.bulkImport),
      () => setImporting(false),
    );
  }, []);
  const reload = useCallback(async () => {
    try {
      setSnippets(await window.murmur.snippetsList());
    } catch {
      setSnippets([]);
      setProblem("Snippets could not be read.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const shown = useMemo(() => filterSnippets(snippets ?? [], query), [snippets, query]);

  function load(snippet: Snippet | null) {
    setEditingId(snippet?.id ?? null);
    setTrigger(snippet?.trigger ?? "");
    setInitialHtml(snippet ? richToHtml(snippet.rich ?? plainToRich(snippet.plain)) : "");
    setHasBody(snippet !== null);
    body.current = null;
    setLoadKey(`${snippet?.id ?? "new"}-${Date.now()}`);
    setProblem(null);
  }

  async function submit() {
    const root = body.current;
    const doc = root
      ? domToRich(root)
      : plainToRich(snippets?.find((s) => s.id === editingId)?.plain ?? "");
    const result = await window.murmur.snippetsSave({
      ...(editingId ? { id: editingId } : {}),
      trigger,
      plain: "",
      rich: doc,
    });
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    load(null);
    await reload();
  }

  async function remove(snippet: Snippet) {
    await window.murmur.snippetsDelete(snippet.id);
    if (editingId === snippet.id) load(null);
    await reload();
  }

  return (
    <VStack gap={4}>
      <Text color="secondary">
        Say a trigger as a whole dictation, or as a sentence on its own, and Murmur inserts the
        saved text exactly as written. Bold, italic, underline, lists and links paste as rich text;
        apps that take plain text get the same lines without formatting.
      </Text>

      <section aria-labelledby="snippet-form-heading">
        <VStack gap={2}>
          <Text weight="semibold" id="snippet-form-heading">
            {editingId ? "Change snippet" : "Add a snippet"}
          </Text>
          <TextInput
            label="Trigger phrase"
            description="What you say, for example “my address”."
            value={trigger}
            onChange={setTrigger}
          />
          <RichEditor
            loadKey={loadKey}
            initialHtml={initialHtml}
            onInput={(root) => {
              body.current = root;
              setHasBody((root.textContent ?? "").trim() !== "");
            }}
          />
          <HStack gap={2}>
            <Button
              label={editingId ? "Save changes" : "Add snippet"}
              isDisabled={trigger.trim() === "" || !hasBody}
              onClick={() => void submit()}
            >
              {editingId ? "Save changes" : "Add snippet"}
            </Button>
            {editingId ? (
              <Button variant="ghost" label="Cancel" onClick={() => load(null)}>
                Cancel
              </Button>
            ) : null}
          </HStack>
          {problem ? <Banner status="error" title={problem} /> : null}
        </VStack>
      </section>

      {importing ? <ImportSection kind="snippets" onImported={() => void reload()} /> : null}

      <section aria-labelledby="snippet-list-heading">
        <VStack gap={2}>
          <TextInput
            label="Search"
            hasClear
            value={query}
            onChange={setQuery}
            placeholder="Find a snippet"
          />
          <Text weight="semibold" id="snippet-list-heading">
            {snippets === null
              ? "Loading…"
              : `${snippets.length} ${snippets.length === 1 ? "snippet" : "snippets"}`}
          </Text>
          {snippets !== null && shown.length === 0 ? (
            <Text color="secondary">
              {snippets.length === 0 ? "No snippets yet." : "Nothing matches."}
            </Text>
          ) : null}
          <ul className="hub-dictionary-list" aria-label="Snippets">
            {shown.map((snippet) => (
              <li key={snippet.id}>
                <HStack gap={2} align="start" justify="between">
                  <VStack gap={0}>
                    <HStack gap={2} align="center" wrap="wrap">
                      <Text weight="semibold">“{snippet.trigger}”</Text>
                      {snippet.rich ? <Badge variant="info" label="Rich text" /> : null}
                      <Text size="sm" color="secondary">
                        {snippet.useCount === 1 ? "used once" : `used ${snippet.useCount} times`}
                      </Text>
                    </HStack>
                    <Text size="sm" color="secondary" className="hub-snippet-preview">
                      {snippet.plain.split("\n").slice(0, 2).join(" / ")}
                      {snippet.plain.split("\n").length > 2 ? " …" : ""}
                    </Text>
                  </VStack>
                  <HStack gap={1}>
                    <ShareWithTeam
                      name={snippet.trigger}
                      input={{
                        kind: "snippet",
                        trigger: snippet.trigger,
                        expansion: snippet.plain,
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      label={`Edit ${snippet.trigger}`}
                      onClick={() => load(snippet)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      label={`Delete ${snippet.trigger}`}
                      onClick={() => void remove(snippet)}
                    >
                      Delete
                    </Button>
                  </HStack>
                </HStack>
              </li>
            ))}
          </ul>
        </VStack>
      </section>
    </VStack>
  );
}
