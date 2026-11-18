import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  HISTORY_LIMITS,
  HISTORY_STATUS_LABELS,
  HISTORY_STATUSES,
  type HistoryPage as HistoryPageData,
  type HistoryRow,
  type HistoryStatus,
} from "@murmur/shared";
import { wordDiff } from "../rewrite/word-diff";

/** Search runs this long after typing stops. */
const SEARCH_DELAY_MS = 200;

const DAY_MS = 24 * 60 * 60_000;

const RANGES = [
  { value: "all", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "365", label: "Last 12 months" },
] as const;

/** The start of a range, in local time; null for any time. */
export function rangeStart(range: string, now: Date): number | null {
  if (range === "all") return null;
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range === "today") return midnight;
  return midnight - (Number(range) - 1) * DAY_MS;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function formatWhen(epoch: number): string {
  return new Date(epoch).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const EMPTY: HistoryPageData = { rows: [], total: 0, apps: [], languages: [] };

/** Raw text against final text, word by word. */
function Changes({ row }: { row: HistoryRow }) {
  const diff = useMemo(
    () => wordDiff(row.rawText ?? "", row.finalText ?? ""),
    [row.rawText, row.finalText],
  );
  if (!diff.parts) {
    return (
      <Text size="sm" color="secondary">
        Too long to show word by word.
      </Text>
    );
  }
  return (
    <p className="hub-history-diff" aria-label="Changes from what was heard">
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
  );
}

function HistoryItem({
  row,
  selected,
  onSelect,
  onChanged,
  onProblem,
}: {
  row: HistoryRow;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onChanged: () => void;
  onProblem: (message: string) => void;
}) {
  const [showChanges, setShowChanges] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState(row.feedbackNote ?? "");
  const app = row.appName ?? row.appBundleId ?? "Unknown app";
  const words = `${row.wordCount} ${row.wordCount === 1 ? "word" : "words"}`;

  async function copy(text: string | null) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      onProblem("The text could not be copied.");
    }
  }

  async function feedback(value: "good" | "bad" | null, text: string = note) {
    await window.murmur.historyFeedback({ id: row.id, feedback: value, note: text.trim() || null });
    onChanged();
  }

  async function archive() {
    await window.murmur.historyArchive([row.id], !row.archived);
    onChanged();
  }

  async function remove() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await window.murmur.historyDelete([row.id]);
    onChanged();
  }

  return (
    <li className="hub-history-row">
      <VStack gap={2}>
        <HStack gap={2} align="center" justify="between" wrap="wrap">
          <HStack gap={2} align="center">
            <CheckboxInput
              label={`Select the dictation from ${formatWhen(row.createdAt)}`}
              isLabelHidden
              value={selected}
              onChange={onSelect}
            />
            <Text weight="semibold">{formatWhen(row.createdAt)}</Text>
            <Text size="sm" color="secondary">
              {[
                app,
                HISTORY_STATUS_LABELS[row.status],
                row.language?.toUpperCase(),
                formatDuration(row.durationMs),
                words,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </HStack>
        </HStack>
        <Text>{row.finalText || <em>No text</em>}</Text>
        {showRaw && row.rawText ? (
          <Text size="sm" color="secondary">
            Heard: {row.rawText}
          </Text>
        ) : null}
        {showChanges ? <Changes row={row} /> : null}
        <HStack gap={1} align="center" wrap="wrap">
          <Button
            size="sm"
            variant="ghost"
            label="Copy the final text"
            isDisabled={!row.finalText}
            onClick={() => void copy(row.finalText)}
          >
            Copy
          </Button>
          <Button
            size="sm"
            variant="ghost"
            label="Copy the text as heard"
            isDisabled={!row.rawText}
            onClick={() => void copy(row.rawText)}
          >
            Copy raw
          </Button>
          <Button
            size="sm"
            variant="ghost"
            label={showRaw ? "Hide the text as heard" : "Show the text as heard"}
            isDisabled={!row.rawText}
            onClick={() => setShowRaw(!showRaw)}
          >
            {showRaw ? "Hide raw" : "Show raw"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            label={showChanges ? "Hide changes" : "View changes"}
            isDisabled={!row.rawText || !row.finalText}
            onClick={() => setShowChanges(!showChanges)}
          >
            {showChanges ? "Hide changes" : "View changes"}
          </Button>
          <Button
            size="sm"
            variant={row.feedback === "good" ? "secondary" : "ghost"}
            label="Good result"
            aria-pressed={row.feedback === "good"}
            onClick={() => void feedback(row.feedback === "good" ? null : "good")}
          >
            Good
          </Button>
          <Button
            size="sm"
            variant={row.feedback === "bad" ? "secondary" : "ghost"}
            label="Poor result"
            aria-pressed={row.feedback === "bad"}
            onClick={() => void feedback(row.feedback === "bad" ? null : "bad")}
          >
            Poor
          </Button>
          <Button
            size="sm"
            variant="ghost"
            label={row.archived ? "Move back to history" : "Archive"}
            onClick={() => void archive()}
          >
            {row.archived ? "Unarchive" : "Archive"}
          </Button>
          <Button
            size="sm"
            variant={confirming ? "destructive" : "ghost"}
            label={confirming ? "Confirm deleting this dictation" : "Delete this dictation"}
            onClick={() => void remove()}
            onBlur={() => setConfirming(false)}
          >
            {confirming ? "Delete for good" : "Delete"}
          </Button>
        </HStack>
        {row.feedback !== null ? (
          <HStack gap={2} align="end" wrap="wrap">
            <TextInput
              label="Note about this result"
              description="Kept only on this Mac."
              value={note}
              onChange={(value) => setNote(value.slice(0, HISTORY_LIMITS.feedbackNote))}
              onEnter={() => void feedback(row.feedback, note)}
            />
            <Button
              size="sm"
              variant="secondary"
              label="Save the note"
              isDisabled={note.trim() === (row.feedbackNote ?? "")}
              onClick={() => void feedback(row.feedback, note)}
            >
              Save note
            </Button>
          </HStack>
        ) : null}
      </VStack>
    </li>
  );
}

/** History (HB-35): every dictation, with search, filters, archive, delete and feedback. */
export function HistoryPage() {
  const [tab, setTab] = useState<"dictations" | "instruct">("dictations");
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [range, setRange] = useState("all");
  const [app, setApp] = useState("");
  const [status, setStatus] = useState("");
  const [language, setLanguage] = useState("");
  const [archived, setArchived] = useState(false);
  const [data, setData] = useState<HistoryPageData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(text), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  const query = useMemo(
    () => ({
      text: search,
      from: rangeStart(range, new Date()),
      to: null,
      app: app || null,
      status: (status || null) as HistoryStatus | null,
      language: language || null,
      archived,
    }),
    [search, range, app, status, language, archived],
  );

  const load = useCallback(
    async (offset = 0) => {
      const id = ++request.current;
      try {
        const page = await window.murmur.historyPage({ ...query, offset });
        if (id !== request.current) return;
        setData((current) =>
          offset === 0 ? page : { ...page, rows: [...current.rows, ...page.rows] },
        );
        setProblem(null);
      } catch {
        if (id === request.current) setProblem("History could not be read.");
      } finally {
        if (id === request.current) setLoaded(true);
      }
    },
    [query],
  );

  useEffect(() => {
    setSelected(new Set());
    setConfirmBulk(false);
    void load(0);
  }, [load]);

  const reload = () => {
    setSelected(new Set());
    setConfirmBulk(false);
    void load(0);
  };

  async function bulkArchive() {
    await window.murmur.historyArchive([...selected], !archived);
    reload();
  }

  async function bulkDelete() {
    if (!confirmBulk) {
      setConfirmBulk(true);
      return;
    }
    await window.murmur.historyDelete([...selected]);
    reload();
  }

  const filtered = search.trim() !== "" || range !== "all" || app || status || language;

  return (
    <VStack gap={4}>
      <HStack gap={1} role="group" aria-label="History of">
        <Button
          variant={tab === "dictations" ? "secondary" : "ghost"}
          label="Dictations"
          aria-pressed={tab === "dictations"}
          onClick={() => setTab("dictations")}
        >
          Dictations
        </Button>
        <Button
          variant={tab === "instruct" ? "secondary" : "ghost"}
          label="Instruct"
          aria-pressed={tab === "instruct"}
          onClick={() => setTab("instruct")}
        >
          Instruct
        </Button>
      </HStack>

      {tab === "instruct" ? (
        <VStack gap={2}>
          <Text color="secondary">
            Instruct threads are kept on the Instruct page, with their own search. Their text is
            kept for 30 days.
          </Text>
          <div>
            <Button
              variant="secondary"
              label="Open the Instruct page"
              onClick={() => {
                window.location.hash = "#/instruct";
              }}
            >
              Open Instruct
            </Button>
          </div>
        </VStack>
      ) : (
        <>
          <VStack gap={2}>
            <TextInput
              label="Search history"
              placeholder="Words in what you said or what was inserted"
              value={text}
              onChange={setText}
              hasClear
            />
            <HStack gap={2} align="end" wrap="wrap">
              <Selector
                label="When"
                options={RANGES.map((item) => ({ value: item.value, label: item.label }))}
                value={range}
                onChange={setRange}
              />
              <Selector
                label="App"
                options={[
                  { value: "", label: "All apps" },
                  ...data.apps.map((item) => ({ value: item.bundleId, label: item.name })),
                ]}
                value={app}
                onChange={setApp}
              />
              <Selector
                label="Status"
                options={[
                  { value: "", label: "Any status" },
                  ...HISTORY_STATUSES.map((item) => ({
                    value: item,
                    label: HISTORY_STATUS_LABELS[item],
                  })),
                ]}
                value={status}
                onChange={setStatus}
              />
              <Selector
                label="Language"
                options={[
                  { value: "", label: "Any language" },
                  ...data.languages.map((item) => ({ value: item, label: item.toUpperCase() })),
                ]}
                value={language}
                onChange={setLanguage}
              />
            </HStack>
            <Switch label="Show archived only" value={archived} onChange={setArchived} />
          </VStack>

          <Text size="sm" color="secondary" role="status" data-testid="history-count">
            {loaded
              ? `${data.total} ${data.total === 1 ? "dictation" : "dictations"}${archived ? " archived" : ""}`
              : "Loading…"}
          </Text>

          {selected.size > 0 ? (
            <HStack gap={2} align="center" wrap="wrap">
              <Text size="sm">{selected.size} selected</Text>
              <Button
                size="sm"
                variant="secondary"
                label={
                  archived ? "Unarchive the selected dictations" : "Archive the selected dictations"
                }
                onClick={() => void bulkArchive()}
              >
                {archived ? "Unarchive" : "Archive"}
              </Button>
              <Button
                size="sm"
                variant={confirmBulk ? "destructive" : "secondary"}
                label={
                  confirmBulk
                    ? `Confirm deleting ${selected.size} dictations`
                    : "Delete the selected dictations"
                }
                onClick={() => void bulkDelete()}
              >
                {confirmBulk ? `Delete ${selected.size} for good, with their recordings` : "Delete"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                label="Clear the selection"
                onClick={() => {
                  setSelected(new Set());
                  setConfirmBulk(false);
                }}
              >
                Clear
              </Button>
            </HStack>
          ) : null}

          {problem ? <Banner status="error" title={problem} /> : null}

          {loaded && data.rows.length === 0 ? (
            <Text color="secondary">
              {filtered
                ? "Nothing matches. Try other words or filters."
                : archived
                  ? "Nothing is archived."
                  : "No dictations yet. Each one is kept here, on this Mac."}
            </Text>
          ) : (
            <ul className="hub-history-list" aria-label="Dictations">
              {data.rows.map((row) => (
                <HistoryItem
                  key={row.id}
                  row={row}
                  selected={selected.has(row.id)}
                  onSelect={(on) => {
                    setConfirmBulk(false);
                    setSelected((current) => {
                      const next = new Set(current);
                      if (on) next.add(row.id);
                      else next.delete(row.id);
                      return next;
                    });
                  }}
                  onChanged={reload}
                  onProblem={setProblem}
                />
              ))}
            </ul>
          )}

          {data.rows.length < data.total ? (
            <div>
              <Button
                variant="secondary"
                label="Show more dictations"
                onClick={() => void load(data.rows.length)}
              >
                Show more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </VStack>
  );
}
