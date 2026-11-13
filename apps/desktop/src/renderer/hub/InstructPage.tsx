import { useCallback, useEffect, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  INSTRUCT_LIMITS,
  type InstructOutcome,
  type InstructThread,
  type InstructThreadSummary,
  type Settings,
} from "@murmur/shared";

const OUTCOME_LABELS: Record<InstructOutcome, string> = {
  pending: "Not used",
  inserted: "Inserted",
  copied: "Copied",
  discarded: "Discarded",
};

const whenOf = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/** One thread opened to read: every request and its draft. */
function ThreadView({ thread, onClose }: { thread: InstructThread; onClose: () => void }) {
  return (
    <section aria-label="Thread" className="hub-permissions">
      <VStack gap={2}>
        <HStack gap={2} justify="between" align="center">
          <Text weight="semibold">{thread.title}</Text>
          <Button size="sm" variant="ghost" label="Close the thread" onClick={onClose}>
            Close
          </Button>
        </HStack>
        <ol className="hub-instruct-turns" aria-label="Turns">
          {thread.turns.map((turn) => (
            <li key={turn.seq}>
              <Text size="sm" color="secondary">
                “{turn.instruction}”
              </Text>
              <div className="hub-instruct-draft">{turn.draft ?? ""}</div>
            </li>
          ))}
        </ol>
      </VStack>
    </section>
  );
}

/** The Instruct page (RW-14): saved threads with search, for 30 days. */
export function InstructPage() {
  const [query, setQuery] = useState("");
  const [threads, setThreads] = useState<InstructThreadSummary[] | null>(null);
  const [open, setOpen] = useState<InstructThread | null>(null);
  const [settings, setSettings] = useState<Settings["instruct"] | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [message, setMessage] = useState<{ status: "info" | "error"; text: string } | null>(null);

  const reload = useCallback(async (search: string) => {
    try {
      setThreads(await window.murmur.instructThreads(search));
    } catch {
      setThreads([]);
      setMessage({ status: "error", text: "Instruct threads could not be read." });
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(query), 150);
    return () => window.clearTimeout(timer);
  }, [query, reload]);

  useEffect(() => {
    window.murmur.getSettings().then(
      (view) => setSettings(view.settings.instruct),
      () => setSettings(null),
    );
  }, []);

  async function setSaving(saveThreads: boolean) {
    if (!settings) return;
    const view = await window.murmur.updateSettings({ instruct: { ...settings, saveThreads } });
    setSettings(view.settings.instruct);
  }

  async function openThread(id: string) {
    setOpen(await window.murmur.instructThread(id));
  }

  async function copy(thread: InstructThreadSummary) {
    if (!thread.finalDraft) return;
    try {
      await navigator.clipboard.writeText(thread.finalDraft);
      setMessage({ status: "info", text: "Copied the last draft." });
    } catch {
      setMessage({ status: "error", text: "The draft could not be copied." });
    }
  }

  async function reuse(thread: InstructThreadSummary) {
    const opened = await window.murmur.instructReuse(thread.id);
    setMessage(
      opened
        ? { status: "info", text: "Opened in the Instruct panel as a new thread." }
        : { status: "error", text: "This thread's text is gone." },
    );
  }

  async function remove(id: string) {
    await window.murmur.instructDelete(id);
    if (open?.id === id) setOpen(null);
    await reload(query);
  }

  async function removeAll() {
    await window.murmur.instructDeleteAll();
    setConfirmAll(false);
    setOpen(null);
    await reload(query);
  }

  return (
    <VStack gap={4}>
      <section aria-labelledby="instruct-page-heading">
        <VStack gap={2}>
          <Text weight="semibold" id="instruct-page-heading">
            Threads from Instruct Mode
          </Text>
          <Text size="sm" color="secondary">
            Each request and draft is kept on this Mac for {INSTRUCT_LIMITS.keepDays} days, then
            only the counts stay. At most {INSTRUCT_LIMITS.maxThreads.toLocaleString("en")} threads.
          </Text>
          {settings ? (
            <Switch
              label="Save Instruct threads"
              value={settings.saveThreads}
              onChange={(value) => void setSaving(value)}
            />
          ) : null}
          <TextInput label="Search threads" value={query} onChange={setQuery} hasClear />
          {message ? <Banner status={message.status} title={message.text} /> : null}
        </VStack>
      </section>

      {open ? <ThreadView thread={open} onClose={() => setOpen(null)} /> : null}

      <section aria-label="Threads">
        <VStack gap={2}>
          <HStack gap={2} justify="between" align="center">
            <Text weight="semibold">
              {threads === null
                ? "Loading…"
                : `${threads.length} ${threads.length === 1 ? "thread" : "threads"}`}
            </Text>
            {threads && threads.length > 0 && query.trim() === "" ? (
              confirmAll ? (
                <HStack gap={1}>
                  <Button
                    size="sm"
                    variant="secondary"
                    label="Delete every thread"
                    onClick={() => void removeAll()}
                  >
                    Delete all
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Keep the threads"
                    onClick={() => setConfirmAll(false)}
                  >
                    Cancel
                  </Button>
                </HStack>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  label="Delete all threads"
                  onClick={() => setConfirmAll(true)}
                >
                  Delete all…
                </Button>
              )
            ) : null}
          </HStack>
          {threads !== null && threads.length === 0 ? (
            <Text color="secondary">
              {query.trim()
                ? "No thread matches."
                : "No threads yet. Hold the Instruct key to start one."}
            </Text>
          ) : null}
          <ul className="hub-dictionary-list" aria-label="Instruct threads">
            {(threads ?? []).map((thread) => {
              const name = thread.textRemoved ? "Text removed after 30 days" : thread.title;
              return (
                <li key={thread.id}>
                  <HStack gap={2} align="start" justify="between">
                    <VStack gap={0}>
                      <HStack gap={2} align="center" wrap="wrap">
                        <Text weight="semibold">{name}</Text>
                        <Badge variant="neutral" label={OUTCOME_LABELS[thread.outcome]} />
                      </HStack>
                      <Text size="sm" color="secondary">
                        {thread.turnCount} {thread.turnCount === 1 ? "request" : "requests"} ·{" "}
                        {whenOf(thread.updatedAt)}
                      </Text>
                    </VStack>
                    <HStack gap={1} align="center">
                      {!thread.textRemoved ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            label={`Open “${name}”`}
                            onClick={() => void openThread(thread.id)}
                          >
                            Open
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            label={`Copy the last draft of “${name}”`}
                            onClick={() => void copy(thread)}
                          >
                            Copy
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            label={`Start a new thread from “${name}”`}
                            onClick={() => void reuse(thread)}
                          >
                            Reuse
                          </Button>
                        </>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        label={`Delete “${name}”`}
                        onClick={() => void remove(thread.id)}
                      >
                        Delete
                      </Button>
                    </HStack>
                  </HStack>
                </li>
              );
            })}
          </ul>
        </VStack>
      </section>
    </VStack>
  );
}
