import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { ImportSection } from "./ImportSection";
import { DICTIONARY_LIMITS, type DictionaryEntry } from "@murmur/shared";

export type DictionarySort = "az" | "recent" | "used";

/** Rows drawn at once; search narrows the rest. */
export const SHOWN_AT_ONCE = 300;

/** Starred first, then by the chosen order. */
export function sortEntries(entries: readonly DictionaryEntry[], sort: DictionarySort) {
  const by: Record<DictionarySort, (a: DictionaryEntry, b: DictionaryEntry) => number> = {
    az: (a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" }),
    recent: (a, b) => b.updatedAt - a.updatedAt,
    used: (a, b) => b.useCount - a.useCount || a.term.localeCompare(b.term),
  };
  return [...entries].sort((a, b) => Number(b.starred) - Number(a.starred) || by[sort](a, b));
}

export function filterEntries(
  entries: readonly DictionaryEntry[],
  query: string,
  starredOnly: boolean,
  learnedOnly = false,
) {
  const needle = query.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      (!starredOnly || entry.starred) &&
      (!learnedOnly || entry.source === "auto") &&
      (needle === "" ||
        entry.term.toLowerCase().includes(needle) ||
        (entry.replacement ?? "").toLowerCase().includes(needle)),
  );
}

interface Draft {
  id?: string;
  term: string;
  replacement: string;
  caseSensitive: boolean;
  starred: boolean;
}

const EMPTY: Draft = { term: "", replacement: "", caseSensitive: false, starred: false };

const SOURCE_LABEL: Record<DictionaryEntry["source"], string | null> = {
  manual: null,
  auto: "Learned",
  import: "Imported",
};

/**
 * The Dictionary page (PZ-01, PZ-03, PZ-04): words Murmur should spell exactly, and
 * replacements from what is said to what is written.
 */
export function DictionaryPage() {
  const [entries, setEntries] = useState<DictionaryEntry[] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DictionarySort>("az");
  const [starredOnly, setStarredOnly] = useState(false);
  const [learnedOnly, setLearnedOnly] = useState(false);
  const [learning, setLearning] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  useEffect(() => {
    window.murmur.getSettings().then(
      (view) => setImporting(view.settings.experimental.bulkImport),
      () => setImporting(false),
    );
  }, []);
  const reload = useCallback(async () => {
    try {
      setEntries(await window.murmur.dictionaryList());
    } catch {
      setEntries([]);
      setProblem("The dictionary could not be read.");
    }
  }, []);

  useEffect(() => {
    void reload();
    window.murmur.getSettings().then(
      (view) => setLearning(view.settings.learnCorrections),
      () => setLearning(null),
    );
  }, [reload]);

  const shown = useMemo(
    () => sortEntries(filterEntries(entries ?? [], query, starredOnly, learnedOnly), sort),
    [entries, query, starredOnly, learnedOnly, sort],
  );

  async function save(next: Draft) {
    const result = await window.murmur.dictionarySave({
      ...(next.id ? { id: next.id } : {}),
      term: next.term,
      replacement: next.replacement.trim() === "" ? null : next.replacement,
      caseSensitive: next.caseSensitive,
      starred: next.starred,
    });
    if (!result.ok) {
      setProblem(result.message);
      return false;
    }
    setProblem(null);
    await reload();
    return true;
  }

  async function submit() {
    if (await save(draft)) setDraft(EMPTY);
  }

  async function toggleStar(entry: DictionaryEntry) {
    await save({
      id: entry.id,
      term: entry.term,
      replacement: entry.replacement ?? "",
      caseSensitive: entry.caseSensitive,
      starred: !entry.starred,
    });
  }

  async function remove(entry: DictionaryEntry) {
    if (entry.useCount > DICTIONARY_LIMITS.confirmDeleteAbove && confirming !== entry.id) {
      setConfirming(entry.id);
      return;
    }
    setConfirming(null);
    await window.murmur.dictionaryDelete(entry.id);
    if (draft.id === entry.id) setDraft(EMPTY);
    await reload();
  }

  const editing = draft.id !== undefined;
  const isReplacement = draft.replacement.trim() !== "";

  return (
    <VStack gap={4}>
      <Text color="secondary">
        Names and terms here are passed to the speech model and kept exactly as written. Add a
        replacement to turn what you say into something else, for example “k8s” into “Kubernetes”.
      </Text>

      {learning !== null ? (
        <Switch
          label="Learn from my corrections"
          description="When you fix a word or two of a dictation within a minute, Murmur notices. A change of capitals is learned at once, any other change after the second time. Learned entries are marked so you can keep or delete them. Only the changed words are kept."
          value={learning}
          onChange={async (learnCorrections) => {
            const view = await window.murmur.updateSettings({ learnCorrections });
            setLearning(view.settings.learnCorrections);
          }}
        />
      ) : null}

      <section aria-labelledby="dictionary-form-heading">
        <VStack gap={2}>
          <Text weight="semibold" id="dictionary-form-heading">
            {editing ? "Change entry" : "Add a word"}
          </Text>
          <HStack gap={2} align="end" wrap="wrap">
            <TextInput
              label="Word or phrase"
              value={draft.term}
              onChange={(term) => setDraft({ ...draft, term })}
              placeholder="Kubernetes"
            />
            <TextInput
              label="Replace with"
              isOptional
              value={draft.replacement}
              onChange={(replacement) => setDraft({ ...draft, replacement })}
              placeholder="Leave empty to keep the spelling"
            />
          </HStack>
          <HStack gap={4} wrap="wrap">
            {isReplacement ? (
              <Switch
                label="Match case"
                description="Replace only when the case is the same."
                value={draft.caseSensitive}
                onChange={(caseSensitive) => setDraft({ ...draft, caseSensitive })}
              />
            ) : null}
            <Switch
              label="Starred"
              description="Always passed to the speech model."
              value={draft.starred}
              onChange={(starred) => setDraft({ ...draft, starred })}
            />
          </HStack>
          <HStack gap={2}>
            <Button
              label={editing ? "Save changes" : "Add"}
              onClick={() => void submit()}
              isDisabled={draft.term.trim() === ""}
            >
              {editing ? "Save changes" : "Add"}
            </Button>
            {editing ? (
              <Button
                variant="ghost"
                label="Cancel"
                onClick={() => {
                  setDraft(EMPTY);
                  setProblem(null);
                }}
              >
                Cancel
              </Button>
            ) : null}
          </HStack>
          {problem ? <Banner status="error" title={problem} /> : null}
        </VStack>
      </section>

      {importing ? <ImportSection kind="dictionary" onImported={() => void reload()} /> : null}

      <section aria-labelledby="dictionary-list-heading">
        <VStack gap={2}>
          <HStack gap={2} align="end" wrap="wrap">
            <TextInput
              label="Search"
              hasClear
              value={query}
              onChange={setQuery}
              placeholder="Find a word"
            />
            <Selector
              label="Sort"
              options={[
                { value: "az", label: "A to Z" },
                { value: "recent", label: "Recently changed" },
                { value: "used", label: "Most used" },
              ]}
              value={sort}
              onChange={(value) => setSort(value as DictionarySort)}
            />
            <Switch label="Starred only" value={starredOnly} onChange={setStarredOnly} />
            <Switch label="Learned only" value={learnedOnly} onChange={setLearnedOnly} />
          </HStack>
          <Text weight="semibold" id="dictionary-list-heading">
            {entries === null
              ? "Loading…"
              : `${entries.length.toLocaleString("en")} ${entries.length === 1 ? "entry" : "entries"}`}
          </Text>
          {entries !== null && shown.length === 0 ? (
            <Text color="secondary">
              {entries.length === 0 ? "No words saved yet." : "Nothing matches."}
            </Text>
          ) : null}
          <ul className="hub-dictionary-list" aria-label="Dictionary entries">
            {shown.slice(0, SHOWN_AT_ONCE).map((entry) => (
              <li key={entry.id}>
                <HStack gap={2} align="center" justify="between">
                  <HStack gap={2} align="center" wrap="wrap">
                    <Text weight="semibold">{entry.term}</Text>
                    {entry.replacement !== null ? (
                      <Text color="secondary">→ {entry.replacement}</Text>
                    ) : null}
                    {entry.starred ? <Badge variant="info" label="Starred" /> : null}
                    {SOURCE_LABEL[entry.source] ? (
                      <Badge variant="neutral" label={SOURCE_LABEL[entry.source]!} />
                    ) : null}
                    {entry.caseSensitive ? <Badge variant="neutral" label="Match case" /> : null}
                    <Text size="sm" color="secondary">
                      {entry.useCount === 1 ? "used once" : `used ${entry.useCount} times`}
                    </Text>
                  </HStack>
                  <HStack gap={1}>
                    {entry.source === "auto" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        label={`Keep ${entry.term}`}
                        onClick={async () => {
                          await window.murmur.dictionaryKeep(entry.id);
                          await reload();
                        }}
                      >
                        Keep
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      label={`${entry.starred ? "Unstar" : "Star"} ${entry.term}`}
                      onClick={() => void toggleStar(entry)}
                    >
                      {entry.starred ? "Unstar" : "Star"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      label={`Edit ${entry.term}`}
                      onClick={() =>
                        setDraft({
                          id: entry.id,
                          term: entry.term,
                          replacement: entry.replacement ?? "",
                          caseSensitive: entry.caseSensitive,
                          starred: entry.starred,
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant={confirming === entry.id ? "destructive" : "ghost"}
                      label={
                        confirming === entry.id
                          ? `Confirm deleting ${entry.term}`
                          : `Delete ${entry.term}`
                      }
                      onClick={() => void remove(entry)}
                    >
                      {confirming === entry.id ? `Delete (used ${entry.useCount} times)` : "Delete"}
                    </Button>
                  </HStack>
                </HStack>
              </li>
            ))}
          </ul>
          {shown.length > SHOWN_AT_ONCE ? (
            <Text size="sm" color="secondary">
              Showing {SHOWN_AT_ONCE} of {shown.length.toLocaleString("en")}. Search to find the
              rest.
            </Text>
          ) : null}
        </VStack>
      </section>
    </VStack>
  );
}
