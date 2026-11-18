import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { NOTE_REWRITE_MAX_CHARS, type NoteRewriteChoice } from "@murmur/shared";
import { wordDiff } from "../rewrite/word-diff";

/** How many Rewrites show as buttons; the rest are under "More". */
const SHOWN = 3;

interface Target {
  scope: "selection" | "note";
  range: Range | null;
  text: string;
}

interface Result {
  choice: NoteRewriteChoice;
  target: Target;
  text: string | null;
  error: string | null;
}

/** The text selected inside the editor, with its range; null when nothing is. */
function selectionIn(box: HTMLElement | null): { range: Range; text: string } | null {
  const selection = document.getSelection();
  if (!box || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!box.contains(range.commonAncestorContainer)) return null;
  const text = selection.toString();
  return text.trim() ? { range: range.cloneRange(), text } : null;
}

/** Puts text in place of a range (or the whole box) as one edit the editor can undo. */
function replaceIn(box: HTMLElement, range: Range | null, text: string): void {
  box.focus();
  const selection = document.getSelection();
  const target =
    range ??
    (() => {
      const all = document.createRange();
      all.selectNodeContents(box);
      return all;
    })();
  selection?.removeAllRanges();
  selection?.addRange(target);
  const done =
    typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
  if (!done) {
    target.deleteContents();
    target.insertNode(document.createTextNode(text));
  }
  box.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Rewrites inside a note (HB-32): on the selection, or the whole note when nothing is
 * selected. The result shows here with Replace, Copy, Discard, View changes and Regenerate;
 * only Replace changes the note.
 */
export function NoteRewrite({
  noteId,
  box,
  wholeText,
  beforeRecord,
}: {
  noteId: string;
  /** The editor's box. */
  box: () => HTMLElement | null;
  /** The whole note's text, for "Rewrite whole note". */
  wholeText: () => string;
  /** Saves pending typing, so Replace's version holds the new text. */
  beforeRecord: () => Promise<void>;
}) {
  const [choices, setChoices] = useState<NoteRewriteChoice[]>([]);
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState<{ range: Range; text: string } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = useRef(0);

  useEffect(() => {
    void window.murmur.noteRewrites().then(setChoices, () => setChoices([]));
  }, []);

  // Follow the selection, so the bar says what a Rewrite will work on.
  useEffect(() => {
    const onChange = () => {
      const now = selectionIn(box());
      if (now || !busy) setSelected(now);
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [box, busy]);

  useEffect(() => {
    setResult(null);
    setMessage(null);
  }, [noteId]);

  async function start(choice: NoteRewriteChoice, target: Target) {
    if (target.text.trim() === "") {
      setMessage("There is no text to rewrite.");
      return;
    }
    if (target.text.length > NOTE_REWRITE_MAX_CHARS) {
      setMessage(
        `Rewrites work on up to ${NOTE_REWRITE_MAX_CHARS.toLocaleString()} characters. Select a part of the note.`,
      );
      return;
    }
    const id = ++run.current;
    setBusy(true);
    setMessage(null);
    setShowChanges(false);
    setResult({ choice, target, text: null, error: null });
    const outcome = await window.murmur
      .noteRewriteRun({ noteId, rewriteId: choice.id, text: target.text })
      .catch(() => ({ ok: false as const, message: "The Rewrite could not run." }));
    if (id !== run.current) return;
    setBusy(false);
    setResult({
      choice,
      target,
      text: outcome.ok ? outcome.text : null,
      error: outcome.ok ? null : outcome.message,
    });
  }

  const pick = (choice: NoteRewriteChoice) => {
    setMore(false);
    const target: Target = selected
      ? { scope: "selection", range: selected.range, text: selected.text }
      : { scope: "note", range: null, text: wholeText() };
    void start(choice, target);
  };

  async function finish(outcome: "replaced" | "copied" | "discarded") {
    if (!result) return;
    const { choice, target, text } = result;
    if (outcome === "replaced" && text !== null) {
      const element = box();
      if (!element) return;
      replaceIn(element, target.range, text);
      await beforeRecord();
      setMessage(`${choice.name} applied. A version was saved.`);
    }
    if (outcome === "copied" && text !== null) {
      try {
        await navigator.clipboard.writeText(text);
        setMessage("Copied.");
      } catch {
        setMessage("The text could not be copied.");
        return;
      }
    }
    await window.murmur
      .noteRewriteRecord({ noteId, rewriteId: choice.id, scope: target.scope, outcome })
      .catch(() => {});
    setResult(null);
  }

  const diff = useMemo(
    () => (result?.text ? wordDiff(result.target.text, result.text) : null),
    [result],
  );

  if (choices.length === 0) return null;
  const shown = more ? choices : choices.slice(0, SHOWN);

  return (
    <section className="scratchpad-rewrite" aria-label="Rewrite">
      <VStack gap={2}>
        <HStack gap={1} align="center" wrap="wrap">
          <Text size="sm" color="secondary">
            {selected
              ? `Rewrite the selection (${selected.text.length.toLocaleString()} characters):`
              : "Rewrite the whole note:"}
          </Text>
          {shown.map((choice) => (
            <Button
              key={choice.id}
              size="sm"
              variant="ghost"
              label={`${choice.name}${selected ? " the selection" : " the whole note"}`}
              isDisabled={busy}
              onClick={() => pick(choice)}
            >
              {choice.name}
            </Button>
          ))}
          {choices.length > SHOWN ? (
            <Button
              size="sm"
              variant="ghost"
              label={more ? "Fewer Rewrites" : "More Rewrites"}
              onClick={() => setMore(!more)}
            >
              {more ? "Fewer" : "More"}
            </Button>
          ) : null}
        </HStack>

        {result ? (
          <VStack gap={2}>
            {result.text === null && result.error === null ? (
              <Text size="sm" color="secondary" role="status">
                {result.choice.name}: working on it…
              </Text>
            ) : result.error ? (
              <Text size="sm" role="alert">
                {result.error}
              </Text>
            ) : (
              <>
                {showChanges && diff?.parts ? (
                  <p className="hub-history-diff" aria-label="Changes the Rewrite makes">
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
                  </p>
                ) : (
                  <p className="scratchpad-rewrite-result" data-testid="rewrite-result">
                    {result.text}
                  </p>
                )}
                <HStack gap={1} wrap="wrap">
                  <Button
                    size="sm"
                    label="Replace with the Rewrite"
                    onClick={() => void finish("replaced")}
                  >
                    Replace
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    label="Copy the Rewrite"
                    onClick={() => void finish("copied")}
                  >
                    Copy
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    label={showChanges ? "Hide changes" : "View changes"}
                    onClick={() => setShowChanges(!showChanges)}
                  >
                    {showChanges ? "Hide changes" : "View changes"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Regenerate the Rewrite"
                    onClick={() => void start(result.choice, result.target)}
                  >
                    Regenerate
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Discard the Rewrite"
                    onClick={() => void finish("discarded")}
                  >
                    Discard
                  </Button>
                </HStack>
              </>
            )}
          </VStack>
        ) : null}
        {message ? (
          <Text size="sm" color="secondary" role="status">
            {message}
          </Text>
        ) : null}
      </VStack>
    </section>
  );
}
