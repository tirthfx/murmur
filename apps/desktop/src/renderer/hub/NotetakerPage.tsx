import { useCallback, useEffect, useRef, useState } from "react";
import { BriefPanel, MeetingBriefTab } from "./BriefPanel";
import { SummaryTab } from "./MeetingSummary";
import { AskPanel, type AskTarget } from "./AskPanel";
import { ExportPanel } from "./ExportPanel";
import { FoldersManager } from "./FoldersManager";
import { ImportPanel } from "./ImportPanel";
import { LanguagePanel } from "./LanguagePanel";
import { LineEditor } from "./LineEditor";
import { SkillsManager } from "./SkillsManager";
import { SpeakersPanel } from "./SpeakersPanel";
import { TasksPanel } from "./TasksPanel";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  formatElapsed,
  INBOX,
  MEETING_LIMITS,
  MEETING_TABS,
  MEETING_WARNING_TEXT,
  type LivePartial,
  type MeetingChannel,
  type MeetingDetail,
  type MeetingFolder,
  type MeetingListItem,
  type MeetingTab,
  type RecordingState,
} from "@murmur/shared";

const TAB_LABELS: Record<MeetingTab, string> = {
  notes: "My notes",
  summary: "Summary",
  transcript: "Transcript",
  tasks: "Tasks",
  brief: "Brief",
  docs: "Docs",
};

/** Where to open a meeting: on a tab, with a transcript line marked. */
interface Jump {
  meetingId: string;
  tab: MeetingTab;
  segmentId: string | null;
  n: number;
}

/** Level 1 speaker labels (NT-07): the microphone is you, the Mac's sound everyone else. */
export const CHANNEL_LABELS: Record<MeetingChannel, string> = { mic: "You", system: "Remote" };

const NOTES_SAVE_MS = 2000;

const whenOf = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** What the meeting list says about a meeting's state. */
export function statusText(item: MeetingListItem): string {
  switch (item.status) {
    case "recording":
      return "Recording";
    case "queued":
      return "Waiting for the speech model";
    case "processing":
      return `Transcribing: ${item.progress.done} of ${item.progress.chunks} parts`;
    case "ready":
      return "Ready";
    case "failed":
      return "Transcription failed";
  }
}

/** The tab to open: the one last used for this meeting, else My notes while recording. */
function firstTab(detail: MeetingDetail): MeetingTab {
  try {
    const saved = window.localStorage.getItem(`murmur.meetingTab.${detail.meeting.id}`);
    if (saved && (MEETING_TABS as readonly string[]).includes(saved)) return saved as MeetingTab;
  } catch {
    // Storage can be unavailable; the default is fine.
  }
  return detail.meeting.status === "recording" ? "notes" : "transcript";
}

function rememberTab(meetingId: string, tab: MeetingTab): void {
  try {
    window.localStorage.setItem(`murmur.meetingTab.${meetingId}`, tab);
  } catch {
    // Only a convenience.
  }
}

/** The name of the speaker of a line: the speaker it belongs to, else its channel's ("You", "Remote"). */
function speakerName(
  detail: MeetingDetail,
  segment: { channel: MeetingChannel; speakerId?: string | null },
): string {
  const named =
    detail.speakers.find((speaker) => speaker.id === segment.speakerId) ??
    detail.speakers.find((speaker) => speaker.channel === segment.channel);
  return named?.name ?? CHANNEL_LABELS[segment.channel];
}

function Transcript({ detail, highlight }: { detail: MeetingDetail; highlight: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const lines = detail.segments.filter((segment) => detail.showDictated || !segment.isDictated);
  const live = detail.live.flatMap((partial) =>
    partial.segments.map((segment, index) => ({
      key: `live-${partial.channel}-${partial.seq}-${index}`,
      channel: partial.channel,
      ...segment,
    })),
  );
  const count = lines.length + live.length;

  // A link in the summary opens the transcript at its line.
  useEffect(() => {
    if (!highlight) return;
    setFollowing(false);
    const line = [...(box.current?.querySelectorAll("[data-segment-id]") ?? [])].find(
      (element) => element.getAttribute("data-segment-id") === highlight,
    );
    line?.scrollIntoView?.({ block: "center" });
  }, [highlight, count]);

  // Follow the newest text unless the owner scrolled up.
  useEffect(() => {
    const element = box.current;
    if (element && following) element.scrollTop = element.scrollHeight;
  }, [count, following]);

  const { progress, meeting } = detail;
  const waiting =
    meeting.status === "queued"
      ? "Waiting for the speech model. The transcript is written as soon as it is ready."
      : meeting.status === "processing"
        ? `Transcribing: ${progress.done} of ${progress.chunks} parts done.`
        : meeting.status === "failed"
          ? "The transcript could not be written."
          : null;

  return (
    <VStack gap={2}>
      <LanguagePanel detail={detail} />
      <SpeakersPanel detail={detail} />
      {waiting ? (
        <Text size="sm" color="secondary" role="status">
          {waiting}
        </Text>
      ) : null}
      {count === 0 ? (
        <Text color="secondary">
          {meeting.status === "recording"
            ? "Text appears here a few seconds after people speak."
            : meeting.transcriptDeletedAt !== null
              ? "The transcript was deleted by retention. The summary and the notes are kept unless you chose to delete the summary too."
              : "No speech was found in this recording."}
        </Text>
      ) : (
        <div
          ref={box}
          className="hub-transcript"
          aria-label="Transcript"
          tabIndex={0}
          onScroll={(event) => {
            const element = event.currentTarget;
            setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < 24);
          }}
        >
          {lines.map((segment) =>
            editing === segment.id ? (
              <div
                key={segment.id}
                className="hub-transcript-line"
                data-channel={segment.channel}
                data-segment-id={segment.id}
              >
                <LineEditor detail={detail} segment={segment} onClose={() => setEditing(null)} />
              </div>
            ) : (
              <p
                key={segment.id}
                className="hub-transcript-line"
                data-channel={segment.channel}
                data-segment-id={segment.id}
                {...(segment.id === highlight ? { "data-highlight": "true" } : {})}
              >
                <span className="hub-transcript-time">{formatElapsed(segment.startMs)}</span>
                <span className="hub-transcript-speaker">{speakerName(detail, segment)}</span>
                <span>
                  {segment.text}
                  {segment.isDictated ? (
                    <span
                      className="hub-transcript-dictated"
                      title="Dictated into another app while the meeting recorded"
                    >
                      Dictated
                    </span>
                  ) : null}
                  {segment.edited ? (
                    <span className="hub-transcript-edited" title="This line was corrected">
                      (edited)
                    </span>
                  ) : null}
                  {segment.isDictated ? null : (
                    <button
                      type="button"
                      className="hub-transcript-edit"
                      aria-label={`Correct the line at ${formatElapsed(segment.startMs)}`}
                      onClick={() => setEditing(segment.id)}
                    >
                      Edit
                    </button>
                  )}
                </span>
              </p>
            ),
          )}
          {live.map((segment) => (
            <p
              key={segment.key}
              className="hub-transcript-line hub-transcript-partial"
              data-channel={segment.channel}
            >
              <span className="hub-transcript-time">{formatElapsed(segment.startMs)}</span>
              <span className="hub-transcript-speaker">{speakerName(detail, segment)}</span>
              <span>{segment.text}</span>
            </p>
          ))}
        </div>
      )}
      {!following && meeting.status === "recording" ? (
        <div>
          <Button
            size="sm"
            variant="secondary"
            label="Jump to live"
            onClick={() => setFollowing(true)}
          >
            Jump to live
          </Button>
        </div>
      ) : null}
    </VStack>
  );
}

function Notes({ detail }: { detail: MeetingDetail }) {
  const id = detail.meeting.id;
  const [text, setText] = useState(detail.notes);
  const [state, setState] = useState<"saved" | "pending" | "error">("saved");
  const latest = useRef(text);
  const timer = useRef<number | null>(null);

  const save = useCallback(async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const ok = await window.murmur.meetingNotesSave(id, latest.current).catch(() => false);
    setState(ok ? "saved" : "error");
  }, [id]);

  // Save what is pending when the meeting changes or the page closes.
  useEffect(
    () => () => {
      if (timer.current !== null) void save();
    },
    [save],
  );

  return (
    <VStack gap={1}>
      <TextArea
        label="My notes"
        description="Your own notes for this meeting, in Markdown. Saved as you type."
        rows={12}
        value={text}
        onChange={(value) => {
          setText(value);
          latest.current = value;
          setState("pending");
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => void save(), NOTES_SAVE_MS);
        }}
        onBlur={() => {
          if (state === "pending") void save();
        }}
      />
      <Text size="sm" color="secondary" role="status">
        {state === "saved"
          ? "Saved."
          : state === "pending"
            ? "Saving…"
            : `Not saved: notes can be up to ${MEETING_LIMITS.notesBytes / 1000} KB.`}
      </Text>
    </VStack>
  );
}

function Docs({ detail, onChange }: { detail: MeetingDetail; onChange: () => void }) {
  const id = detail.meeting.id;
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function addLink() {
    const result = await window.murmur.meetingDocAddLink(id, url, title);
    if (result.ok) {
      setUrl("");
      setTitle("");
      setMessage(null);
      onChange();
    } else setMessage(result.message);
  }

  async function addFile() {
    const result = await window.murmur.meetingDocAddFile(id);
    if (result.ok) onChange();
    else if (!result.canceled) setMessage(result.message);
  }

  return (
    <VStack gap={3}>
      {detail.docs.length === 0 ? (
        <Text color="secondary">
          Links and files for this meeting. Files are copied into the meeting, so they stay when the
          original is moved or deleted. Nothing is uploaded.
        </Text>
      ) : (
        <ul className="hub-dictionary-list" aria-label="Docs">
          {detail.docs.map((doc) => (
            <li key={doc.id}>
              <HStack gap={2} justify="between" align="center">
                <VStack gap={0}>
                  <Text weight="semibold">{doc.title}</Text>
                  <Text size="sm" color="secondary">
                    {doc.kind === "link"
                      ? doc.url
                      : `File, ${Math.max(1, Math.round((doc.bytes ?? 0) / 1024))} KB`}
                  </Text>
                </VStack>
                <HStack gap={1}>
                  <Button
                    size="sm"
                    variant="ghost"
                    label={`Open ${doc.title}`}
                    onClick={() => void window.murmur.meetingDocOpen(doc.id)}
                  >
                    Open
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    label={`Remove ${doc.title}`}
                    onClick={() => void window.murmur.meetingDocRemove(doc.id).then(onChange)}
                  >
                    Remove
                  </Button>
                </HStack>
              </HStack>
            </li>
          ))}
        </ul>
      )}
      <HStack gap={2} align="end" wrap="wrap">
        <TextInput label="Link" value={url} onChange={setUrl} placeholder="https://" />
        <TextInput label="Title (optional)" value={title} onChange={setTitle} />
        <Button
          variant="secondary"
          label="Add the link"
          isDisabled={!url.trim()}
          onClick={() => void addLink()}
        >
          Add link
        </Button>
        <Button variant="secondary" label="Attach a file" onClick={() => void addFile()}>
          Attach a file…
        </Button>
      </HStack>
      {message ? <Banner status="error" title={message} /> : null}
    </VStack>
  );
}

function MeetingView({
  detail,
  jump,
  onChange,
  onDeleted,
  onAsk,
  onOpenMeeting,
  folders,
}: {
  detail: MeetingDetail;
  /** Open another meeting (from a brief's sources). */
  onOpenMeeting: (meetingId: string) => void;
  /** The personal folders; the Inbox is not in the list. */
  folders: MeetingFolder[];
  /** Ask a question about this meeting. */
  onAsk: (meeting: { id: string; title: string }) => void;
  /** Open at a transcript line (from a task's source). */
  jump: Jump | null;
  onChange: () => void;
  onDeleted: () => void;
}) {
  const { meeting } = detail;
  const jumpHere = jump && jump.meetingId === meeting.id ? jump : null;
  const [tab, setTab] = useState<MeetingTab>(() => (jumpHere ? jumpHere.tab : firstTab(detail)));
  const [title, setTitle] = useState(meeting.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(jumpHere?.segmentId ?? null);
  const jumpN = jumpHere?.n;
  useEffect(() => {
    if (!jumpHere) return;
    setTab(jumpHere.tab);
    setHighlight(jumpHere.segmentId);
    // Only a new jump moves the view.
  }, [jumpN]);

  useEffect(() => setTitle(meeting.title), [meeting.title]);

  async function rename() {
    const next = title.trim();
    if (!next || next === meeting.title) {
      setTitle(meeting.title);
      return;
    }
    await window.murmur.meetingRename(meeting.id, next);
    onChange();
  }

  const empty: Partial<Record<MeetingTab, string>> = {
    tasks: "To-dos found in the meeting will be listed here for you to accept.",
  };

  return (
    <section aria-label="Meeting" className="hub-meeting">
      <VStack gap={3}>
        <HStack gap={2} align="end" justify="between" wrap="wrap">
          <TextInput
            label="Title"
            value={title}
            onChange={setTitle}
            onBlur={() => void rename()}
            onEnter={() => void rename()}
          />
          <Button
            size="sm"
            variant="secondary"
            label="Ask about this meeting"
            onClick={() => onAsk({ id: meeting.id, title: meeting.title })}
          >
            Ask
          </Button>
          <Selector
            label="Folder"
            value={meeting.folderId ?? INBOX}
            options={[
              { value: INBOX, label: "Inbox" },
              ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
            ]}
            onChange={(value) =>
              void window.murmur.meetingMove(meeting.id, value === INBOX ? null : value)
            }
          />
          {meeting.status === "recording" ? (
            <Button
              size="sm"
              variant="secondary"
              label="What did I miss?"
              onClick={() => {
                setTab("summary");
                rememberTab(meeting.id, "summary");
                void window.murmur.meetingRecap(meeting.id);
              }}
            >
              What did I miss?
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            label="Export a shareable file"
            onClick={() => setExporting((open) => !open)}
          >
            Export…
          </Button>
          {confirmDelete ? (
            <HStack gap={1}>
              <Button
                size="sm"
                variant="destructive"
                label="Confirm deleting this meeting"
                onClick={() => void window.murmur.meetingDelete(meeting.id).then(() => onDeleted())}
              >
                Delete: this cannot be undone
              </Button>
              <Button
                size="sm"
                variant="ghost"
                label="Keep the meeting"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
            </HStack>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              label="Delete this meeting"
              isDisabled={meeting.status === "recording"}
              onClick={() => setConfirmDelete(true)}
            >
              Delete…
            </Button>
          )}
        </HStack>
        {meeting.audioDeletedAt !== null || meeting.transcriptDeletedAt !== null ? (
          <HStack gap={1} wrap="wrap">
            {meeting.audioDeletedAt !== null ? (
              <Badge
                variant="neutral"
                label={`Audio deleted by retention, ${whenOf(meeting.audioDeletedAt)}`}
              />
            ) : null}
            {meeting.transcriptDeletedAt !== null ? (
              <Badge
                variant="neutral"
                label={`Transcript deleted by retention, ${whenOf(meeting.transcriptDeletedAt)}`}
              />
            ) : null}
          </HStack>
        ) : null}
        {detail.folderSuggestion ? (
          <Banner
            status="info"
            title={`This looks like it belongs in “${detail.folderSuggestion.folderName}”.`}
            endContent={
              <HStack gap={1}>
                <Button
                  size="sm"
                  variant="primary"
                  label={`Move this meeting to ${detail.folderSuggestion.folderName}`}
                  onClick={() =>
                    void window.murmur.meetingMove(meeting.id, detail.folderSuggestion!.folderId)
                  }
                >
                  Move it
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  label="Do not suggest this folder again for meetings like this one"
                  onClick={() =>
                    void window.murmur.meetingFolderDismiss(
                      meeting.id,
                      detail.folderSuggestion!.folderId,
                    )
                  }
                >
                  Dismiss
                </Button>
              </HStack>
            }
          />
        ) : null}
        {exporting ? (
          <ExportPanel meetingId={meeting.id} onClose={() => setExporting(false)} />
        ) : null}
        <Text size="sm" color="secondary">
          {whenOf(meeting.startedAt)} · {formatElapsed(meeting.durationMs)} ·{" "}
          {(detail.speakers.length > 0
            ? detail.speakers.map((speaker) => speaker.name)
            : meeting.channels.map((channel) => CHANNEL_LABELS[channel])
          ).join(" and ")}
        </Text>
        {meeting.warnings.map((warning) => (
          <Banner
            key={warning}
            status="warning"
            title={MEETING_WARNING_TEXT[warning]}
            {...(warning === "system_permission"
              ? {
                  endContent: (
                    <Button
                      size="sm"
                      variant="secondary"
                      label="Open Screen Recording settings"
                      onClick={() => void window.murmur.openPermissionSettings("screenRecording")}
                    >
                      Open settings
                    </Button>
                  ),
                }
              : {})}
          />
        ))}
        <TabList
          value={tab}
          role="tablist"
          hasDivider
          onChange={(value) => {
            setTab(value as MeetingTab);
            rememberTab(meeting.id, value as MeetingTab);
          }}
        >
          {MEETING_TABS.map((value) => (
            <Tab key={value} value={value} label={TAB_LABELS[value]} panelId={`meeting-${value}`} />
          ))}
        </TabList>
        <div id={`meeting-${tab}`} role="tabpanel" aria-label={TAB_LABELS[tab]}>
          {tab === "transcript" ? (
            <Transcript detail={detail} highlight={highlight} />
          ) : tab === "summary" ? (
            <SummaryTab
              detail={detail}
              onChange={onChange}
              onOpenSegment={(segmentId) => {
                setHighlight(segmentId);
                setTab("transcript");
                rememberTab(meeting.id, "transcript");
              }}
            />
          ) : tab === "tasks" ? (
            <TasksPanel
              key={meeting.id}
              meetingId={meeting.id}
              taskStatus={detail.taskStatus}
              onOpenSource={(_meetingId, segmentId) => {
                setHighlight(segmentId);
                setTab("transcript");
                rememberTab(meeting.id, "transcript");
              }}
            />
          ) : tab === "notes" ? (
            <Notes key={meeting.id} detail={detail} />
          ) : tab === "docs" ? (
            <Docs detail={detail} onChange={onChange} />
          ) : tab === "brief" ? (
            <MeetingBriefTab
              meetingId={meeting.id}
              fromCalendar={Boolean(meeting.calendarEventId)}
              onOpenMeeting={onOpenMeeting}
            />
          ) : (
            <Text color="secondary">{empty[tab]}</Text>
          )}
        </div>
      </VStack>
    </section>
  );
}

/** The Notetaker page (NT-06, NT-10): recordings, and one meeting opened in tabs. */
export function NotetakerPage() {
  const [list, setList] = useState<MeetingListItem[] | null>(null);
  const [recording, setRecording] = useState<RecordingState>({ status: "idle" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [page, setPage] = useState<"meetings" | "upcoming" | "ask" | "tasks" | "skills">(
    "meetings",
  );
  const [briefFocus, setBriefFocus] = useState<string | null>(null);

  // The menu bar can ask for the brief of the next meeting: it is handed over once.
  useEffect(() => {
    const check = () =>
      void window.murmur.briefTarget().then((key) => {
        if (!key) return;
        setBriefFocus(key);
        setPage("upcoming");
      });
    check();
    return window.murmur.onOpenPage(() => setTimeout(check, 0));
  }, []);
  const [folders, setFolders] = useState<MeetingFolder[]>([]);
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [managingFolders, setManagingFolders] = useState(false);
  const [importing, setImporting] = useState(false);
  const [jump, setJump] = useState<Jump | null>(null);
  const [about, setAbout] = useState<{ id: string; title: string; n: number } | null>(null);
  const openRef = useRef<string | null>(null);
  openRef.current = openId;

  const loadList = useCallback(async () => {
    const [items, state, folderList] = await Promise.all([
      window.murmur.meetingsList(),
      window.murmur.meetingRecording(),
      window.murmur.foldersList(),
    ]);
    setList(items);
    setRecording(state);
    setFolders(folderList);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const next = await window.murmur.meetingDetail(id);
    if (openRef.current === id) setDetail(next);
  }, []);

  useEffect(() => {
    void loadList().catch(() => setList([]));
    const offChanged = window.murmur.onMeetingsChanged((meetingId) => {
      void loadList();
      const open = openRef.current;
      if (open && (meetingId === null || meetingId === open)) void loadDetail(open);
    });
    const offLive = window.murmur.onMeetingLive((partial: LivePartial) => {
      setDetail((current) =>
        current && current.meeting.id === partial.meetingId
          ? {
              ...current,
              live: [
                ...current.live.filter((item) => item.channel !== partial.channel),
                ...(partial.segments.length > 0 ? [partial] : []),
              ],
            }
          : current,
      );
    });
    return () => {
      offChanged();
      offLive();
    };
  }, [loadList, loadDetail]);

  useEffect(() => {
    if (openId) void loadDetail(openId);
    else setDetail(null);
  }, [openId, loadDetail]);

  useEffect(() => {
    if (recording.status !== "recording") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [recording.status]);

  const shownList = (list ?? []).filter(
    (item) =>
      folderFilter === "all" ||
      (folderFilter === INBOX ? item.folderId === null : item.folderId === folderFilter),
  );

  async function start() {
    setMessage(null);
    const result = await window.murmur.meetingStart();
    if (result.ok) setOpenId(result.meetingId);
    else setMessage(result.message);
    await loadList();
  }

  async function stop() {
    await window.murmur.meetingStop();
    await loadList();
  }

  return (
    <VStack gap={4}>
      <section aria-label="Recording">
        <VStack gap={2}>
          {recording.status === "recording" ? (
            <HStack gap={2} align="center">
              <span className="hub-rec-dot" aria-hidden="true" />
              <Text weight="semibold">
                Recording “{recording.title}” · {formatElapsed(now - recording.startedAt)}
              </Text>
              <Button label="Stop recording" onClick={() => void stop()}>
                Stop
              </Button>
            </HStack>
          ) : (
            <HStack gap={2} align="center">
              <Button
                label="Record a meeting"
                isDisabled={recording.status !== "idle"}
                onClick={() => void start()}
              >
                {recording.status === "idle" ? "Record a meeting" : "Please wait…"}
              </Button>
              <Text size="sm" color="secondary">
                Records your microphone and the Mac&apos;s sound. Everything stays on this Mac.
              </Text>
            </HStack>
          )}
          {message ? <Banner status="error" title={message} /> : null}
        </VStack>
      </section>

      <TabList
        value={page}
        role="tablist"
        hasDivider
        onChange={(value) => setPage(value as "meetings" | "upcoming" | "ask" | "tasks" | "skills")}
      >
        <Tab value="meetings" label="Meetings" panelId="notetaker-meetings" />
        <Tab value="upcoming" label="Upcoming" panelId="notetaker-upcoming" />
        <Tab value="ask" label="Ask" panelId="notetaker-ask" />
        <Tab value="tasks" label="My Tasks" panelId="notetaker-tasks" />
        <Tab value="skills" label="Skills" panelId="notetaker-skills" />
      </TabList>

      {page === "upcoming" ? (
        <div id="notetaker-upcoming" role="tabpanel" aria-label="Upcoming">
          <BriefPanel
            focus={briefFocus}
            onOpenMeeting={(meetingId) => {
              setOpenId(meetingId);
              setPage("meetings");
            }}
          />
        </div>
      ) : null}
      {page === "ask" ? (
        <div id="notetaker-ask" role="tabpanel" aria-label="Ask">
          <AskPanel
            about={about}
            onOpen={(target: AskTarget) => {
              setOpenId(target.meetingId);
              setJump({ ...target, n: Date.now() });
              setPage("meetings");
            }}
          />
        </div>
      ) : null}
      {page === "tasks" ? (
        <div id="notetaker-tasks" role="tabpanel" aria-label="My Tasks">
          <TasksPanel
            onOpenSource={(meetingId, segmentId) => {
              setOpenId(meetingId);
              setJump({ meetingId, segmentId, tab: "transcript", n: Date.now() });
              setPage("meetings");
            }}
          />
        </div>
      ) : null}
      {page === "skills" ? (
        <div id="notetaker-skills" role="tabpanel" aria-label="Skills">
          <SkillsManager />
        </div>
      ) : null}
      <div
        hidden={page !== "meetings"}
        id="notetaker-meetings"
        role="tabpanel"
        aria-label="Meetings"
      >
        <div className="hub-notetaker">
          <section aria-label="Meetings">
            <VStack gap={2}>
              <HStack gap={2} align="end" wrap="wrap">
                <Selector
                  label="Folder"
                  value={folderFilter}
                  options={[
                    { value: "all", label: "All meetings" },
                    { value: INBOX, label: "Inbox" },
                    ...folders.map((folder) => ({
                      value: folder.id,
                      label: `${folder.name} (${folder.meetings})`,
                    })),
                  ]}
                  onChange={setFolderFilter}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  label="Import a transcript file"
                  onClick={() => setImporting((open) => !open)}
                >
                  Import…
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  label="Manage folders"
                  onClick={() => setManagingFolders((open) => !open)}
                >
                  Folders…
                </Button>
              </HStack>
              {importing ? (
                <ImportPanel
                  onClose={() => setImporting(false)}
                  onImported={(meetingId) => {
                    setImporting(false);
                    setFolderFilter("all");
                    setOpenId(meetingId);
                    void loadList();
                  }}
                />
              ) : null}
              {managingFolders ? (
                <FoldersManager folders={folders} onChange={() => void loadList()} />
              ) : null}
              {list === null ? (
                <Text color="secondary">Loading…</Text>
              ) : list.length === 0 ? (
                <Text color="secondary">No meetings yet. Record one to see it here.</Text>
              ) : shownList.length === 0 ? (
                <Text color="secondary">No meetings in this folder.</Text>
              ) : (
                <ul className="hub-meeting-list" aria-label="Meetings">
                  {shownList.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="hub-meeting-item"
                        aria-current={item.id === openId ? "true" : undefined}
                        onClick={() => setOpenId(item.id)}
                      >
                        <Text weight="semibold">{item.title}</Text>
                        <Text size="sm" color="secondary">
                          {whenOf(item.startedAt)} · {formatElapsed(item.durationMs)}
                        </Text>
                        <span>
                          <Badge
                            variant={item.status === "failed" ? "error" : "neutral"}
                            label={statusText(item)}
                          />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </VStack>
          </section>
          {detail ? (
            <MeetingView
              folders={folders}
              key={detail.meeting.id}
              detail={detail}
              jump={jump}
              onAsk={(meeting) => {
                setAbout({ ...meeting, n: Date.now() });
                setPage("ask");
              }}
              onOpenMeeting={(meetingId) => setOpenId(meetingId)}
              onChange={() => {
                void loadList();
                if (openId) void loadDetail(openId);
              }}
              onDeleted={() => {
                setOpenId(null);
                void loadList();
              }}
            />
          ) : (
            <Text color="secondary">Choose a meeting to see its notes and transcript.</Text>
          )}
        </div>
      </div>
    </VStack>
  );
}
