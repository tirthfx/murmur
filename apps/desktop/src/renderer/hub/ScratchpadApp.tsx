import { useCallback, useEffect, useRef, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  NOTE_LIMITS,
  noteTitle,
  richToHtml,
  richToPlain,
  type Note,
  type NoteSummary,
  type RichDoc,
} from "@murmur/shared";
import { domToRich } from "./rich-text";
import { NoteVersions } from "./NoteVersions";
import { RichEditor } from "./RichEditor";

interface Draft {
  title: string;
  body: RichDoc;
}

type SaveState = "saved" | "saving" | "unsaved" | "error";

/**
 * The Scratchpad window (HB-26, HB-31): notes beside up to eight tabs, each saved two seconds
 * after typing stops. Shown by the Hub page at `#/scratchpad-window`.
 */
export function ScratchpadApp() {
  const [summaries, setSummaries] = useState<NoteSummary[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [tabs, setTabs] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newTab, setNewTab] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const drafts = useRef(new Map<string, Draft>());
  const timer = useRef<number | null>(null);

  const active = tabs.find((note) => note.id === activeId) ?? null;

  const refresh = useCallback(async (text: string) => {
    try {
      setSummaries(await window.murmur.notesList(text));
    } catch {
      setProblem("Notes could not be read.");
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setSearch(query), NOTE_LIMITS.searchDelayMs);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    void refresh(search);
  }, [refresh, search]);

  useEffect(() => {
    void window.murmur.getSettings().then(
      (view) => setNewTab(view.settings.scratchpad.newTab),
      () => {},
    );
  }, []);

  /** Writes every pending draft now. */
  const flush = useCallback(async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const pending = [...drafts.current];
    if (pending.length === 0) return;
    drafts.current.clear();
    setSaveState("saving");
    let failed: string | null = null;
    for (const [id, draft] of pending) {
      try {
        const result = await window.murmur.noteSave({ id, ...draft });
        if (!result.ok) failed = result.message;
      } catch {
        failed = "The note could not be saved.";
      }
    }
    setSaveState(failed ? "error" : "saved");
    setProblem(failed);
    void refresh(search);
  }, [refresh, search]);

  // Quitting or closing the window: save what is left (at most two seconds of typing).
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
    };
  }, [flush]);

  const changed = (id: string, draft: Draft) => {
    drafts.current.set(id, draft);
    setTabs((list) =>
      list.map((note) => (note.id === id ? { ...note, title: draft.title } : note)),
    );
    setSaveState("unsaved");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), NOTE_LIMITS.autosaveMs);
  };

  const open = useCallback(
    async (id: string) => {
      await flush();
      const note = await window.murmur.noteGet(id);
      if (!note) {
        setProblem("This note is no longer there.");
        return;
      }
      setTabs((list) => {
        if (list.some((item) => item.id === id)) return list;
        if (!newTab && activeId) return list.map((item) => (item.id === activeId ? note : item));
        // At most eight tabs: the oldest one makes room.
        const next = [...list, note];
        return next.length > NOTE_LIMITS.tabs ? next.slice(next.length - NOTE_LIMITS.tabs) : next;
      });
      setActiveId(id);
      setConfirmDelete(false);
    },
    [flush, newTab, activeId],
  );

  useEffect(() => window.murmur.onScratchpadOpenNote((id) => void open(id)), [open]);

  async function create(fromLastDictation: boolean) {
    const result = await window.murmur.noteCreate({ fromLastDictation });
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setProblem(null);
    await refresh(search);
    await open(result.note.id);
  }

  async function close(id: string) {
    await flush();
    // HB-28: closing a note keeps a version of it (when it changed).
    void window.murmur
      .noteVersionSave({ noteId: id, label: null, reason: "close" })
      .catch(() => {});
    setTabs((list) => {
      const next = list.filter((item) => item.id !== id);
      if (activeId === id) setActiveId(next.at(-1)?.id ?? null);
      return next;
    });
  }

  async function remove() {
    if (!active) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    drafts.current.delete(active.id);
    await window.murmur.noteDelete(active.id);
    setConfirmDelete(false);
    await close(active.id);
    await refresh(search);
  }

  async function pin(note: Note) {
    const result = await window.murmur.notePin(note.id, !note.pinned);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setProblem(null);
    setTabs((list) =>
      list.map((item) => (item.id === note.id ? { ...item, pinned: !note.pinned } : item)),
    );
    await refresh(search);
  }

  async function movePin(id: string, step: -1 | 1) {
    await window.murmur.notePinMove(id, step);
    await refresh(search);
  }

  const status: Record<SaveState, string> = {
    saved: "Saved",
    saving: "Saving…",
    unsaved: "Not saved yet",
    error: "Not saved",
  };

  return (
    <div className="scratchpad">
      <aside className="scratchpad-list" aria-label="Notes">
        <VStack gap={2}>
          <HStack gap={1} wrap="wrap">
            <Button variant="secondary" label="New note" onClick={() => void create(false)}>
              New note
            </Button>
            <Button
              variant="ghost"
              label="New note from the last dictation"
              onClick={() => void create(true)}
            >
              From last dictation
            </Button>
          </HStack>
          <TextInput
            label="Search notes"
            isLabelHidden
            placeholder="Search notes"
            value={query}
            onChange={setQuery}
            hasClear
          />
          {summaries.length === 0 ? (
            <Text size="sm" color="secondary">
              {search.trim() ? "No note matches." : "No notes yet."}
            </Text>
          ) : (
            <ul className="scratchpad-notes" aria-label="All notes">
              {summaries.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="scratchpad-note"
                    aria-current={item.id === activeId ? "true" : undefined}
                    onClick={() => void open(item.id)}
                  >
                    <span className="scratchpad-note-title">{item.title}</span>
                    <span className="scratchpad-note-preview">
                      {item.preview.map((part, index) =>
                        part.hit ? (
                          <mark key={index}>{part.text}</mark>
                        ) : (
                          <span key={index}>{part.text}</span>
                        ),
                      )}
                    </span>
                    <span className="scratchpad-note-date">
                      {new Date(item.updatedAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                    {item.pinned ? <span className="scratchpad-note-date">Pinned</span> : null}
                  </button>
                  {item.pinned && !search.trim() ? (
                    <HStack gap={1}>
                      <Button
                        size="sm"
                        variant="ghost"
                        label={`Move ${item.title} up`}
                        onClick={() => void movePin(item.id, -1)}
                      >
                        Up
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        label={`Move ${item.title} down`}
                        onClick={() => void movePin(item.id, 1)}
                      >
                        Down
                      </Button>
                    </HStack>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </VStack>
      </aside>

      <main className="scratchpad-main">
        {tabs.length > 0 ? (
          <div className="scratchpad-tabs" role="tablist" aria-label="Open notes">
            {tabs.map((note) => (
              <div key={note.id} className="scratchpad-tab" data-active={note.id === activeId}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={note.id === activeId}
                  onClick={() => setActiveId(note.id)}
                >
                  {noteTitle(note.title, note.plain)}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${noteTitle(note.title, note.plain)}`}
                  onClick={() => void close(note.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {problem ? <Banner status="error" title={problem} /> : null}

        {active ? (
          <VStack gap={2} role="tabpanel">
            <HStack gap={2} align="end" justify="between" wrap="wrap">
              <TextInput
                label="Title"
                placeholder={noteTitle("", active.plain)}
                value={active.title}
                onChange={(title) =>
                  changed(active.id, {
                    title,
                    body: drafts.current.get(active.id)?.body ?? active.body,
                  })
                }
              />
              <HStack gap={2} align="center">
                <Text size="sm" color="secondary" role="status" data-testid="save-state">
                  {status[saveState]}
                </Text>
                <Button
                  size="sm"
                  variant="ghost"
                  label={active.pinned ? "Unpin this note" : "Pin this note"}
                  aria-pressed={active.pinned}
                  onClick={() => void pin(active)}
                >
                  {active.pinned ? "Unpin" : "Pin"}
                </Button>
                <Button
                  size="sm"
                  variant={showVersions ? "secondary" : "ghost"}
                  label={showVersions ? "Hide versions" : "Show versions"}
                  aria-pressed={showVersions}
                  onClick={() => setShowVersions(!showVersions)}
                >
                  Versions
                </Button>
                <Button
                  size="sm"
                  variant={confirmDelete ? "destructive" : "ghost"}
                  label={confirmDelete ? "Confirm deleting this note" : "Delete this note"}
                  onClick={() => void remove()}
                >
                  {confirmDelete ? "Delete for good" : "Delete"}
                </Button>
              </HStack>
            </HStack>
            {showVersions ? (
              <NoteVersions
                note={active}
                currentPlain={richToPlain(drafts.current.get(active.id)?.body ?? active.body)}
                beforeChange={flush}
                onRestored={(note) =>
                  setTabs((list) => list.map((item) => (item.id === note.id ? note : item)))
                }
              />
            ) : null}
            <RichEditor
              loadKey={`${active.id}:${active.updatedAt}`}
              initialHtml={richToHtml(active.body)}
              label="Note"
              testId="note-editor"
              className="hub-rich-editor scratchpad-editor"
              onInput={(root) =>
                changed(active.id, {
                  title: drafts.current.get(active.id)?.title ?? active.title,
                  body: domToRich(root),
                })
              }
            />
          </VStack>
        ) : (
          <VStack gap={2}>
            <Text color="secondary">
              Choose a note, or start a new one. Notes stay on this Mac and save as you type.
            </Text>
          </VStack>
        )}
      </main>
    </div>
  );
}
