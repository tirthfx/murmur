import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  SUMMARY_FEEDBACK_REASONS,
  SUMMARY_FEEDBACK_TEXT,
  type MeetingDetail,
  type MeetingSummary,
  type Skill,
  type SummaryFeedbackReason,
} from "@murmur/shared";

/** `[12:34](seg:id)` and `**bold**`; everything else is plain text. No HTML is ever rendered. */
const INLINE = /\[([^\]]+)\]\(seg:([^)\s]+)\)|\*\*([^*]+)\*\*/g;

function inline(text: string, onOpen: (segmentId: string) => void, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[2]) {
      nodes.push(
        <button
          key={`${keyBase}-${match.index}`}
          type="button"
          className="hub-cite"
          aria-label={`Open the transcript at ${match[1]}`}
          onClick={() => onOpen(match[2]!)}
        >
          {match[1]}
        </button>,
      );
    } else {
      nodes.push(<strong key={`${keyBase}-${match.index}`}>{match[3]}</strong>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** The summary's Markdown: `##` headings, `-` bullets and paragraphs. */
export function SummaryBody({
  markdown,
  onOpen,
}: {
  markdown: string;
  onOpen: (segmentId: string) => void;
}) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (bullets.length === 0) return;
    const items = bullets;
    blocks.push(
      <ul key={`ul-${key}`}>
        {items.map((item, i) => (
          <li key={i}>{inline(item, onOpen, `${key}-${i}`)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  markdown.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (line === "") return;
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1]!);
      return;
    }
    flush(String(index));
    if (heading) blocks.push(<h4 key={`h-${index}`}>{heading[1]}</h4>);
    else blocks.push(<p key={`p-${index}`}>{inline(line, onOpen, String(index))}</p>);
  });
  flush("end");
  return <Fragment>{blocks}</Fragment>;
}

const when = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const versionLabel = (summary: MeetingSummary) =>
  `Version ${summary.version}: ${summary.skillName}, ${when(summary.createdAt)}${summary.quick ? " (quick)" : ""}`;

/** The Summary tab (NT-09): the newest summary, a version picker, a Skill picker and thumbs. */
export function SummaryTab({
  detail,
  onChange,
  onOpenSegment,
}: {
  detail: MeetingDetail;
  onChange: () => void;
  onOpenSegment: (segmentId: string) => void;
}) {
  const { meeting, summaries, summaryStatus } = detail;
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillId, setSkillId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void window.murmur.skillsList().then((list) => alive && setSkills(list));
    return () => {
      alive = false;
    };
  }, []);

  const shown = summaries.find((summary) => summary.id === chosen) ?? summaries.at(-1) ?? null;
  const recording = meeting.status === "recording";
  const working = summaryStatus.state === "running";
  const noText = detail.segments.every((segment) => segment.isDictated);

  async function write(quick: boolean) {
    setError(null);
    setChosen(null);
    const result = await window.murmur.meetingSummarize(meeting.id, {
      ...(skillId ? { skillId } : {}),
      ...(quick ? { quick: true } : {}),
    });
    if (!result.ok) setError(result.message);
    onChange();
  }

  async function rate(
    summary: MeetingSummary,
    rating: "up" | "down",
    reason: SummaryFeedbackReason | null,
  ) {
    const same = summary.feedback?.rating === rating && summary.feedback.reason === reason;
    await window.murmur.meetingSummaryFeedback(summary.id, same ? null : { rating, reason });
    setReasonFor(rating === "down" && !same ? summary.id : null);
    onChange();
  }

  return (
    <VStack gap={3}>
      <HStack gap={2} align="end" wrap="wrap">
        <Selector
          label="Skill"
          value={skillId ?? skills[0]?.id ?? ""}
          options={skills.map((skill) => ({ value: skill.id, label: skill.name }))}
          onChange={(value) => setSkillId(value)}
        />
        <Button
          variant="primary"
          label={shown ? "Write a new version" : "Write a summary"}
          isDisabled={working || recording || noText}
          onClick={() => void write(false)}
        >
          {shown ? "Write a new version" : "Write a summary"}
        </Button>
        {recording ? (
          <Button
            variant="secondary"
            label="Quick summary so far"
            isDisabled={working || noText}
            onClick={() => void write(true)}
          >
            Quick summary so far
          </Button>
        ) : null}
        {summaries.length > 1 ? (
          <Selector
            label="Version"
            value={shown?.id ?? ""}
            options={[...summaries]
              .reverse()
              .map((summary) => ({ value: summary.id, label: versionLabel(summary) }))}
            onChange={(value) => setChosen(value)}
          />
        ) : null}
      </HStack>
      {summaryStatus.state === "running" ? (
        <Text size="sm" color="secondary" role="status">
          Writing the summary: step {Math.min(summaryStatus.done + 1, summaryStatus.total)} of{" "}
          {summaryStatus.total}.
        </Text>
      ) : summaryStatus.state === "waiting" ? (
        <Text size="sm" color="secondary" role="status">
          The summary is written once the transcript and the language model are ready.
        </Text>
      ) : null}
      {summaryStatus.state === "failed" ? (
        <Banner status="warning" title={summaryStatus.message} />
      ) : null}
      {error ? <Banner status="warning" title={error} /> : null}
      {shown ? (
        <VStack gap={2}>
          <HStack gap={2} align="center">
            <Text size="sm" color="secondary">
              {versionLabel(shown)}
            </Text>
            {shown.quick ? <Badge label="Quick" /> : null}
          </HStack>
          <div className="hub-summary" aria-label="Summary">
            <SummaryBody markdown={shown.markdown} onOpen={onOpenSegment} />
          </div>
          <HStack gap={2} align="center" wrap="wrap">
            <Text size="sm" color="secondary">
              Was this useful?
            </Text>
            <Button
              size="sm"
              variant={shown.feedback?.rating === "up" ? "primary" : "ghost"}
              label="Good summary"
              onClick={() => void rate(shown, "up", null)}
            >
              👍
            </Button>
            <Button
              size="sm"
              variant={shown.feedback?.rating === "down" ? "primary" : "ghost"}
              label="Poor summary"
              onClick={() => void rate(shown, "down", null)}
            >
              👎
            </Button>
            {reasonFor === shown.id || shown.feedback?.rating === "down"
              ? SUMMARY_FEEDBACK_REASONS.map((reason) => (
                  <Button
                    key={reason}
                    size="sm"
                    variant={shown.feedback?.reason === reason ? "primary" : "secondary"}
                    label={SUMMARY_FEEDBACK_TEXT[reason]}
                    onClick={() => void rate(shown, "down", reason)}
                  >
                    {SUMMARY_FEEDBACK_TEXT[reason]}
                  </Button>
                ))
              : null}
          </HStack>
        </VStack>
      ) : summaryStatus.state === "idle" ? (
        <Text color="secondary">
          {recording
            ? "A summary is written after the meeting ends. You can ask for a quick one meanwhile."
            : noText
              ? "There is no transcript to summarise."
              : "No summary yet. Pick a Skill and write one."}
        </Text>
      ) : null}
    </VStack>
  );
}
