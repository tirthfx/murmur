import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  BRIEF_SOURCE_TEXT,
  type BriefOverview,
  type BriefSourceReport,
  type BriefSourceState,
  type MeetingBrief,
} from "@murmur/shared";

type Variant = "neutral" | "info" | "success" | "warning" | "error";

const STATE_TEXT: Record<BriefSourceState, { label: string; variant: Variant }> = {
  used: { label: "Used", variant: "success" },
  empty: { label: "Nothing found", variant: "neutral" },
  off: { label: "Off", variant: "neutral" },
  "not-connected": { label: "Not connected", variant: "info" },
  "needs-permission": { label: "Needs permission", variant: "warning" },
  failed: { label: "Could not read", variant: "error" },
};

const whenText = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

/** `[3]` marks a source. Everything else is plain text: nothing here is rendered as markup. */
function withCitations(text: string, key: string): ReactNode[] {
  return text.split(/(\[\d+\])/g).map((part, index) =>
    /^\[\d+\]$/.test(part) ? (
      <sup
        key={`${key}-${index}`}
        className="hub-brief-cite"
        aria-label={`Source ${part.slice(1, -1)}`}
      >
        {part}
      </sup>
    ) : (
      <Fragment key={`${key}-${index}`}>{part}</Fragment>
    ),
  );
}

/** The brief's `##` headings, `-` bullets and paragraphs. */
export function BriefBody({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={`ul-${key}`}>
        {items.map((item, index) => (
          <li key={index}>{withCitations(item, `${key}-${index}`)}</li>
        ))}
      </ul>,
    );
  };
  markdown.split("\n").forEach((line, index) => {
    if (line.startsWith("## ")) {
      flush(String(index));
      blocks.push(
        <h4 key={`h-${index}`} className="hub-brief-heading">
          {line.slice(3)}
        </h4>,
      );
    } else if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
    } else if (line.trim() !== "") {
      flush(String(index));
      blocks.push(<p key={`p-${index}`}>{withCitations(line, `p${index}`)}</p>);
    }
  });
  flush("end");
  return <>{blocks}</>;
}

/** One brief: when it was built, the text with its citations, and the numbered sources. */
export function BriefView({
  brief,
  onOpenMeeting,
}: {
  brief: MeetingBrief;
  onOpenMeeting: (meetingId: string) => void;
}) {
  return (
    <VStack gap={3}>
      <div className="hub-brief" aria-label={`Brief for ${brief.title}`}>
        <Text size="sm" color="secondary">
          Built {new Date(brief.builtAt).toLocaleString()}
          {brief.modelWrote ? "" : ". The opening is left out: the local model did not write one."}
        </Text>
        <BriefBody markdown={brief.markdown} />
      </div>
      {brief.items.length > 0 ? (
        <VStack gap={1}>
          <Text weight="semibold">Sources</Text>
          <ol className="hub-connector-list" aria-label="Sources of the brief">
            {brief.items.map((item) => (
              <li key={item.n}>
                <HStack gap={2} align="center" wrap="wrap">
                  <Text size="sm">
                    [{item.n}] {BRIEF_SOURCE_TEXT[item.source].label}: {item.title}
                    {item.at ? `, ${new Date(item.at).toLocaleDateString()}` : ""}
                  </Text>
                  {item.meetingId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      label={`Open the meeting “${item.title}”`}
                      onClick={() => onOpenMeeting(item.meetingId!)}
                    >
                      Open the meeting
                    </Button>
                  ) : null}
                  {item.url ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      label={`Open “${item.title}” in ${BRIEF_SOURCE_TEXT[item.source].label}`}
                      onClick={() => void window.murmur.briefOpen(item.url!)}
                    >
                      Open
                    </Button>
                  ) : null}
                </HStack>
              </li>
            ))}
          </ol>
        </VStack>
      ) : null}
    </VStack>
  );
}

/** A recorded meeting's own brief: the one built before it, or one built now from what came before. */
export function MeetingBriefTab({
  meetingId,
  onOpenMeeting,
}: {
  meetingId: string;
  onOpenMeeting: (meetingId: string) => void;
}) {
  const [brief, setBrief] = useState<MeetingBrief | null | undefined>(undefined);
  const [building, setBuilding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setBrief(undefined);
    setMessage(null);
    void window.murmur.briefForMeeting(meetingId).then(
      (found) => alive && setBrief(found),
      () => alive && setBrief(null),
    );
    return () => {
      alive = false;
    };
  }, [meetingId]);

  async function build() {
    setBuilding(true);
    setMessage(null);
    try {
      const result = await window.murmur.briefBuild(`meeting:${meetingId}`);
      if (result.ok) setBrief(result.brief);
      else setMessage(result.message);
    } finally {
      setBuilding(false);
    }
  }

  if (brief === undefined) return <Text color="secondary">Loading…</Text>;
  if (brief === null)
    return (
      <VStack gap={2}>
        <Text color="secondary">
          No brief was built before this meeting. You can build one from the meetings and open tasks
          that came before it.
        </Text>
        <div>
          <Button
            variant="secondary"
            label="Build a brief for this meeting"
            isDisabled={building}
            onClick={() => void build()}
          >
            {building ? "Building…" : "Build a brief"}
          </Button>
        </div>
        {message ? <Banner status="warning" title={message} /> : null}
      </VStack>
    );
  return <BriefView brief={brief} onOpenMeeting={onOpenMeeting} />;
}

/** Which sources to connect or turn on, in plain words. */
function missing(sources: readonly BriefSourceReport[]): BriefSourceReport[] {
  return sources.filter(
    (source) => source.state === "not-connected" || source.state === "needs-permission",
  );
}

/**
 * The Brief tab (NT-11): the meetings that are coming, the brief of the one chosen with the
 * sources it cites, and what to connect to add more. A brief builds from earlier meetings and open
 * tasks with no connector at all.
 */
export function BriefPanel({
  focus = null,
  onOpenMeeting,
}: {
  /** The meeting the menu bar asked for. */
  focus?: string | null;
  onOpenMeeting: (meetingId: string) => void;
}) {
  const [overview, setOverview] = useState<BriefOverview | null>(null);
  const [chosen, setChosen] = useState<string | null>(focus);
  const [brief, setBrief] = useState<MeetingBrief | null>(null);
  const [building, setBuilding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setOverview(await window.murmur.briefOverview());
  }, []);

  useEffect(() => {
    void load().catch(() => setMessage("The meetings could not be read."));
  }, [load]);

  useEffect(() => {
    if (focus) setChosen(focus);
  }, [focus]);

  const events = overview?.events ?? [];
  const eventKey =
    chosen && events.some((e) => e.eventKey === chosen) ? chosen : (events[0]?.eventKey ?? null);

  useEffect(() => {
    let alive = true;
    setBrief(null);
    if (eventKey)
      void window.murmur.briefGet(eventKey).then(
        // A brief built while this was being read is newer, so it stays.
        (found) => alive && setBrief((current) => current ?? found),
        () => undefined,
      );
    return () => {
      alive = false;
    };
  }, [eventKey]);

  async function build() {
    if (!eventKey) return;
    setBuilding(true);
    setMessage(null);
    try {
      const result = await window.murmur.briefBuild(eventKey);
      if (result.ok) setBrief(result.brief);
      else setMessage(result.message);
      await load();
    } finally {
      setBuilding(false);
    }
  }

  if (!overview)
    return message ? <Banner status="warning" title={message} /> : <Text>Loading…</Text>;

  const event = events.find((e) => e.eventKey === eventKey) ?? null;
  const toConnect = missing(brief?.sources ?? overview.sources);

  return (
    <VStack gap={3}>
      <Text color="secondary">
        A brief is built here on this Mac before a calendar meeting: earlier meetings with the same
        people, their open tasks, and what your connected services have about them. It is written
        {overview.settings.auto
          ? ` ${overview.settings.leadMinutes} minutes before the start, and again when you ask.`
          : " when you ask."}
      </Text>

      {overview.calendarConnected ? null : (
        <Banner
          status="info"
          title="Connect a calendar to see your meetings here"
          description="Connect Google Calendar or Outlook on the Connectors page. Until then a brief cannot be made for a meeting."
        />
      )}
      {message ? <Banner status="warning" title={message} /> : null}

      {events.length > 0 ? (
        <HStack gap={2} align="end" wrap="wrap">
          <Selector
            label="Meeting"
            value={eventKey ?? ""}
            options={events.map((entry) => ({
              value: entry.eventKey,
              label: `${entry.title}, ${whenText(entry.startMs)}${entry.builtAt ? "" : " (no brief yet)"}`,
            }))}
            onChange={setChosen}
          />
          <Button
            variant="primary"
            label={brief ? "Build the brief again" : "Build the brief"}
            isDisabled={building || !eventKey}
            onClick={() => void build()}
          >
            {building ? "Building…" : brief ? "Build again" : "Build the brief"}
          </Button>
        </HStack>
      ) : overview.calendarConnected ? (
        <Text color="secondary">No meetings in the next day.</Text>
      ) : null}

      {event && !brief && !building ? (
        <Text color="secondary">
          No brief for “{event.title}” yet.
          {event.people.length > 0 ? ` With ${event.people.join(", ")}.` : ""}
        </Text>
      ) : null}

      {brief ? <BriefView brief={brief} onOpenMeeting={onOpenMeeting} /> : null}

      <VStack gap={1}>
        <Text weight="semibold">Where it looks</Text>
        <ul className="hub-connector-list" aria-label="Sources used for briefs">
          {(brief?.sources ?? overview.sources).map((source) => (
            <li key={source.id}>
              <HStack gap={2} align="center" wrap="wrap">
                <Text size="sm">{source.label}</Text>
                <Badge
                  variant={STATE_TEXT[source.state].variant}
                  label={STATE_TEXT[source.state].label}
                />
                {brief && source.count > 0 ? (
                  <Text size="sm" color="secondary">
                    {source.count} {source.count === 1 ? "item" : "items"}
                  </Text>
                ) : null}
                {source.note ? (
                  <Text size="sm" color="secondary">
                    {source.note}
                  </Text>
                ) : null}
              </HStack>
            </li>
          ))}
        </ul>
      </VStack>

      {toConnect.length > 0 ? (
        <Banner
          status="info"
          title="Add more to your briefs"
          description={`Connect ${toConnect.map((source) => source.label).join(", ")} on the Connectors page, and turn it on under Settings, Meeting briefs.`}
        />
      ) : null}
    </VStack>
  );
}
