import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import type { MurmurRewriteApi, RewritePanelItem, RewritePanelState } from "@murmur/shared";
import { wordDiff } from "./word-diff";

/** Items whose name or detail contains every word typed, names first. */
export function filterItems(items: RewritePanelItem[], query: string): RewritePanelItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  const matches = (text: string) => words.every((word) => text.toLowerCase().includes(word));
  return [
    ...items.filter((item) => matches(item.name)),
    ...items.filter((item) => !matches(item.name) && matches(`${item.name} ${item.detail}`)),
  ];
}

/** The Rewrite panel (RW-01). Main holds the session; this page shows it. */
export function RewritePanel({ api }: { api: MurmurRewriteApi }) {
  const [state, setState] = useState<RewritePanelState>({ stage: "hidden" });

  useEffect(() => {
    const unsubscribe = api.onState(setState);
    void api.ready().then(setState);
    return unsubscribe;
  }, [api]);

  // Escape closes from anywhere in the panel.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void api.close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api]);

  if (state.stage === "hidden") return null;
  return (
    <div className="rewrite-card" role="dialog" aria-label="Rewrite">
      {state.stage === "list" ? <ListStage api={api} state={state} /> : null}
      {state.stage === "running" ? (
        <>
          <Text weight="semibold">{state.rewriteName}</Text>
          <div className="rewrite-output" aria-live="polite" aria-busy="true">
            {state.text || (state.loading ? "Loading model…" : "Writing…")}
          </div>
          <HStack gap={2} justify="end">
            <Button variant="ghost" label="Stop" onClick={() => void api.back()}>
              Stop
            </Button>
          </HStack>
        </>
      ) : null}
      {state.stage === "result" ? <ResultStage api={api} state={state} /> : null}
      {state.stage === "message" ? (
        <>
          <div className="rewrite-output" role="status">
            {state.message}
          </div>
          <HStack gap={2} justify="end">
            {state.canRetry ? (
              <Button variant="secondary" label="Try again" onClick={() => void api.back()}>
                Try again
              </Button>
            ) : null}
            {state.canCopy ? (
              <Button label="Copy" onClick={() => void api.copy()}>
                Copy
              </Button>
            ) : null}
            <Button variant="ghost" label="Close" onClick={() => void api.close()}>
              Close
            </Button>
          </HStack>
        </>
      ) : null}
    </div>
  );
}

function ListStage({
  api,
  state,
}: {
  api: MurmurRewriteApi;
  state: Extract<RewritePanelState, { stage: "list" }>;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const shown = useMemo(() => filterItems(state.items, query), [state.items, query]);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => setActive(0), [query]);
  // The filter takes the keyboard as soon as the list shows.
  useEffect(() => {
    filterRef.current?.querySelector("input")?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, shown.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = shown[active];
      if (item) void api.choose(item.id);
    }
  }

  return (
    <>
      <Text weight="semibold">
        Rewrite {state.selectionLength.toLocaleString("en")}{" "}
        {state.selectionLength === 1 ? "character" : "characters"}
      </Text>
      <div onKeyDown={onKeyDown} ref={filterRef}>
        <TextInput
          label="Find a Rewrite"
          isLabelHidden
          placeholder="Type to filter"
          value={query}
          onChange={setQuery}
        />
      </div>
      <ul className="rewrite-list" role="listbox" aria-label="Rewrites">
        {shown.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              className="rewrite-item"
              onMouseEnter={() => setActive(index)}
              onClick={() => void api.choose(item.id)}
            >
              {item.name}
              <span className="rewrite-item-detail">{item.detail}</span>
            </button>
          </li>
        ))}
      </ul>
      {shown.length === 0 ? <Text color="secondary">No Rewrite matches.</Text> : null}
    </>
  );
}

/** "3 words removed, 2 added". */
export function changeSummary(removed: number, added: number): string {
  const words = (count: number) => `${count} ${count === 1 ? "word" : "words"}`;
  return `${words(removed)} removed, ${added} added`;
}

/** View changes (RW-06): the result with removed words struck through and added ones marked. */
function ChangesView({ source, text }: { source: string; text: string }) {
  const diff = useMemo(() => wordDiff(source, text), [source, text]);
  return (
    <>
      <Text size="sm" color="secondary">
        {diff.parts
          ? changeSummary(diff.removed, diff.added)
          : `Too long to show word by word: ${changeSummary(diff.removed, diff.added)}`}
      </Text>
      {diff.parts ? (
        <div className="rewrite-output" aria-label="Changes">
          {diff.parts.map((part, index) =>
            part.kind === "added" ? (
              <ins key={index} className="diff-added">
                {part.text}
              </ins>
            ) : part.kind === "removed" ? (
              <del key={index} className="diff-removed">
                {part.text}
              </del>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )}
        </div>
      ) : null}
    </>
  );
}

function ResultStage({
  api,
  state,
}: {
  api: MurmurRewriteApi;
  state: Extract<RewritePanelState, { stage: "result" }>;
}) {
  const replaceRef = useRef<HTMLDivElement>(null);
  const [changes, setChanges] = useState(false);
  // A command's output (summary, questions) goes below the text, so there is nothing to compare.
  const below = state.placement === "below";
  useEffect(() => {
    setChanges(false);
    replaceRef.current?.querySelector("button")?.focus();
  }, [state.text]);
  // Control+Option+D switches between the result and its changes.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (below) return;
      if (event.code === "KeyD" && event.ctrlKey && event.altKey && !event.metaKey) {
        event.preventDefault();
        setChanges((shown) => !shown);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [below]);
  return (
    <>
      <Text weight="semibold">{state.rewriteName}</Text>
      {changes ? (
        <ChangesView source={state.source} text={state.text} />
      ) : (
        <div className="rewrite-output" aria-label="Result">
          {state.text}
        </div>
      )}
      <HStack gap={2} justify="end" wrap="wrap">
        {below ? null : (
          <Button
            variant="ghost"
            label={changes ? "Show result" : "View changes"}
            onClick={() => setChanges((shown) => !shown)}
          >
            {changes ? "Show result" : "View changes"}
          </Button>
        )}
        <Button variant="ghost" label="Try another Rewrite" onClick={() => void api.back()}>
          Try another
        </Button>
        <Button variant="ghost" label="Regenerate" onClick={() => void api.regenerate()}>
          Regenerate
        </Button>
        <Button variant="ghost" label="Discard" onClick={() => void api.close()}>
          Discard
        </Button>
        <Button variant="secondary" label="Copy" onClick={() => void api.copy()}>
          Copy
        </Button>
        <div ref={replaceRef}>
          <Button
            label={below ? "Insert below the text" : "Replace"}
            onClick={() => void api.replace()}
          >
            {below ? "Insert below" : "Replace"}
          </Button>
        </div>
      </HStack>
    </>
  );
}
