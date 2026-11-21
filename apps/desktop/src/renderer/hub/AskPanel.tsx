import { Fragment, useCallback, useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  ASK_LIMITS,
  ASK_SOURCE_TEXT,
  formatElapsed,
  INBOX,
  isCalendarDate,
  type AskCitation,
  type AskMessage,
  type AskScope,
  type AskThread,
  type AskThreadItem,
  type MeetingFolder,
  type MeetingTab,
} from "@murmur/shared";

/** Where a citation opens: a meeting, on a tab, at a transcript line. */
export interface AskTarget {
  meetingId: string;
  tab: MeetingTab;
  segmentId: string | null;
}

type Choice = "all" | "week" | "month" | "dates" | "folder" | "meeting" | "meetings";

const CHOICE_LABEL: Record<Choice, string> = {
  all: "All meetings",
  week: "Last 7 days",
  month: "Last 30 days",
  dates: "Choose dates",
  folder: "A folder",
  meeting: "This meeting",
  meetings: "Chosen meetings",
};

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n));
};

const targetOf = (citation: AskCitation): AskTarget => ({
  meetingId: citation.meetingId,
  tab:
    citation.source === "summary"
      ? "summary"
      : citation.source === "notes"
        ? "notes"
        : citation.source === "task"
          ? "tasks"
          : "transcript",
  segmentId: citation.source === "transcript" ? citation.ref : null,
});

const chipLabel = (citation: AskCitation) =>
  `${citation.meetingTitle} · ${
    citation.source === "transcript" && citation.startMs !== null
      ? formatElapsed(citation.startMs)
      : ASK_SOURCE_TEXT[citation.source]
  }`;

/** The text of an answer with each [n] as a chip that opens its source. Only text is rendered. */
function AnswerText({
  message,
  onOpen,
}: {
  message: AskMessage;
  onOpen: (target: AskTarget) => void;
}) {
  const parts = message.text.split(/(\[\d+\])/);
  return (
    <p className="hub-ask-text">
      {parts.map((part, index) => {
        const n = /^\[(\d+)\]$/.exec(part)?.[1];
        const citation = n ? message.citations.find((c) => c.n === Number(n)) : undefined;
        if (!citation) return <Fragment key={index}>{part}</Fragment>;
        return citation.gone ? (
          <span key={index} className="hub-cite" aria-disabled="true">
            {chipLabel(citation)} (meeting deleted)
          </span>
        ) : (
          <button
            key={index}
            type="button"
            className="hub-cite"
            title={citation.excerpt}
            aria-label={`Open ${chipLabel(citation)}`}
            onClick={() => onOpen(targetOf(citation))}
          >
            {chipLabel(citation)}
          </button>
        );
      })}
    </p>
  );
}

/**
 * NT-14: ask a question about the meetings. The answer comes only from numbered sources, each
 * shown as a chip that opens the meeting where it was said. If the meetings do not support an
 * answer it says so and names the closest ones.
 */
export function AskPanel({
  about = null,
  onOpen,
}: {
  /** Start a new question about one meeting. */
  about?: { id: string; title: string; n: number } | null;
  onOpen: (target: AskTarget) => void;
}) {
  const [threads, setThreads] = useState<AskThreadItem[]>([]);
  const [thread, setThread] = useState<AskThread | null>(null);
  const [choice, setChoice] = useState<Choice>(about ? "meeting" : "all");
  const [meetingIds, setMeetingIds] = useState<string[]>(about ? [about.id] : []);
  const [folders, setFolders] = useState<MeetingFolder[]>([]);
  const [folderChoice, setFolderChoice] = useState<string>(INBOX);
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void window.murmur.foldersList().then(setFolders);
  }, []);

  const loadThreads = useCallback(async () => setThreads(await window.murmur.askThreads()), []);
  useEffect(() => {
    void loadThreads().catch(() => setThreads([]));
  }, [loadThreads]);

  // A new question starts in the scope from Settings, unless it is about one meeting.
  useEffect(() => {
    if (about) return;
    void window.murmur.getSettings().then((view) => {
      const scope = view.settings.notetaker.ask.defaultScope;
      setChoice((current) =>
        current === "all" || current === "week" || current === "month" ? scope : current,
      );
    });
  }, [about]);
  useEffect(() => {
    if (!about) return;
    setThread(null);
    setChoice("meeting");
    setMeetingIds([about.id]);
  }, [about]);

  function showScope(scope: AskScope) {
    if (scope.kind === "all") setChoice("all");
    else if (scope.kind === "range") {
      setChoice("dates");
      setFrom(scope.from);
      setTo(scope.to);
    } else if (scope.kind === "folder") {
      setChoice("folder");
      setFolderChoice(scope.folderId ?? INBOX);
    } else {
      setChoice(
        about && scope.ids.length === 1 && scope.ids[0] === about.id ? "meeting" : "meetings",
      );
      setMeetingIds(scope.ids);
    }
  }

  async function open(id: string) {
    setProblem(null);
    const next = await window.murmur.askThread(id);
    setThread(next);
    if (next) showScope(next.scope);
  }

  function scopeNow(): AskScope | string {
    if (choice === "all") return { kind: "all" };
    if (choice === "week") return { kind: "range", from: daysAgo(6), to: daysAgo(0) };
    if (choice === "month") return { kind: "range", from: daysAgo(29), to: daysAgo(0) };
    if (choice === "dates") {
      if (!isCalendarDate(from) || !isCalendarDate(to)) return "Write both dates as YYYY-MM-DD.";
      if (from > to) return "The first date comes after the last.";
      return { kind: "range", from, to };
    }
    if (choice === "folder")
      return { kind: "folder", folderId: folderChoice === INBOX ? null : folderChoice };
    return meetingIds.length > 0
      ? { kind: "meetings", ids: meetingIds }
      : "Choose a meeting first.";
  }

  async function send() {
    const text = question.trim();
    if (text === "" || sending) return;
    const scope = scopeNow();
    if (typeof scope === "string") return setProblem(scope);
    setProblem(null);
    setSending(true);
    try {
      const result = await window.murmur.askSend({
        threadId: thread?.id ?? null,
        question: text,
        scope,
      });
      if (result.ok) {
        setThread(result.thread);
        setQuestion("");
        await loadThreads();
      } else {
        setProblem(result.message);
      }
    } catch {
      setProblem("The question could not be answered. Try again.");
    } finally {
      setSending(false);
    }
  }

  const choices: Choice[] = [
    "all",
    "week",
    "month",
    "dates",
    "folder",
    ...(about ? (["meeting"] as const) : []),
    ...(choice === "meetings" ? (["meetings"] as const) : []),
  ];

  return (
    <div className="hub-notetaker">
      <section aria-label="Conversations">
        <VStack gap={2}>
          <Button
            variant="secondary"
            label="New question"
            onClick={() => {
              setThread(null);
              setProblem(null);
              setQuestion("");
            }}
          >
            New question
          </Button>
          {threads.length === 0 ? (
            <Text size="sm" color="secondary">
              Your questions are kept here.
            </Text>
          ) : (
            <ul className="hub-meeting-list" aria-label="Conversations">
              {threads.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="hub-meeting-item"
                    aria-current={item.id === thread?.id ? "true" : undefined}
                    onClick={() => void open(item.id)}
                  >
                    <Text weight="semibold">{item.title}</Text>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </VStack>
      </section>
      <section aria-label="Ask">
        <VStack gap={3}>
          <HStack gap={2} align="end" wrap="wrap">
            <Selector
              label="Look in"
              value={choice}
              options={choices.map((value) => ({ value, label: CHOICE_LABEL[value] }))}
              onChange={(value) => setChoice(value as Choice)}
            />
            {choice === "dates" ? (
              <>
                <TextInput label="From" placeholder="YYYY-MM-DD" value={from} onChange={setFrom} />
                <TextInput label="To" placeholder="YYYY-MM-DD" value={to} onChange={setTo} />
              </>
            ) : null}
            {choice === "folder" ? (
              <Selector
                label="Folder"
                value={folderChoice}
                options={[
                  { value: INBOX, label: "Inbox" },
                  ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
                ]}
                onChange={setFolderChoice}
              />
            ) : null}
            {choice === "meeting" && about ? (
              <Text size="sm" color="secondary">
                {about.title}
              </Text>
            ) : null}
            {thread ? (
              <Button
                variant="secondary"
                label="Delete this conversation"
                onClick={() => {
                  const id = thread.id;
                  void window.murmur.askDelete(id).then(async () => {
                    setThread(null);
                    await loadThreads();
                  });
                }}
              >
                Delete
              </Button>
            ) : null}
          </HStack>

          {thread === null ? (
            <Text color="secondary">
              Ask about what was said in your meetings. Answers come only from your own meetings and
              cite where they came from.
            </Text>
          ) : (
            <ul className="hub-ask-messages" aria-label="Messages">
              {thread.messages.map((message) => (
                <li key={message.id} className={`hub-ask-message hub-ask-${message.role}`}>
                  <Text size="sm" color="secondary">
                    {message.role === "user" ? "You" : "Murmur"}
                  </Text>
                  {message.role === "user" ? (
                    <p className="hub-ask-text">{message.text}</p>
                  ) : (
                    <>
                      <AnswerText message={message} onOpen={onOpen} />
                      {message.supported === false && message.closest.length > 0 ? (
                        <ul className="hub-ask-closest" aria-label="Closest meetings">
                          {message.closest.map((meeting) => (
                            <li key={meeting.meetingId}>
                              <button
                                type="button"
                                className="hub-cite"
                                aria-label={`Open ${meeting.title}`}
                                onClick={() =>
                                  onOpen({
                                    meetingId: meeting.meetingId,
                                    tab: "summary",
                                    segmentId: null,
                                  })
                                }
                              >
                                {meeting.title} ·{" "}
                                {new Date(meeting.startedAt).toLocaleDateString(undefined, {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {problem ? <Banner status="warning" title={problem} /> : null}
          {sending ? (
            <Text size="sm" color="secondary" role="status">
              Looking through your meetings…
            </Text>
          ) : null}
          <VStack gap={2}>
            <TextArea
              label="Your question"
              rows={3}
              value={question}
              onChange={setQuestion}
              maxLength={ASK_LIMITS.question}
            />
            <div>
              <Button
                variant="primary"
                label="Ask"
                isDisabled={sending || question.trim() === ""}
                onClick={() => void send()}
              >
                Ask
              </Button>
            </div>
          </VStack>
        </VStack>
      </section>
    </div>
  );
}
