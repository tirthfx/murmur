import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { formatElapsed, type MeetingDetail } from "@murmur/shared";
import { SummaryBody } from "./MeetingSummary";

const timeOf = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * NT-13: "What did I miss?" while a meeting records: a short recap of the last minutes, with a time
 * on every bullet, kept under Recaps. The recaps stay with the meeting.
 */
export function RecapPanel({
  detail,
  onOpenSegment,
}: {
  detail: MeetingDetail;
  onOpenSegment: (segmentId: string) => void;
}) {
  const { meeting, recaps, recapStatus } = detail;
  const [message, setMessage] = useState<string | null>(null);
  const recording = meeting.status === "recording";
  const running = recapStatus.state === "running";

  async function ask() {
    setMessage(null);
    const result = await window.murmur.meetingRecap(meeting.id);
    if (!result.ok) setMessage(result.message);
  }

  if (!recording && recaps.length === 0) return null;
  return (
    <section aria-label="Recaps">
      <VStack gap={2}>
        <HStack gap={2} align="center" wrap="wrap">
          <Text weight="semibold">Recaps</Text>
          {recording ? (
            <Button
              size="sm"
              variant="secondary"
              label="What did I miss?"
              isDisabled={running}
              onClick={() => void ask()}
            >
              What did I miss?
            </Button>
          ) : null}
        </HStack>
        {running ? (
          <Text size="sm" color="secondary" role="status">
            Writing the recap…
          </Text>
        ) : null}
        {message ? <Banner status="info" title={message} /> : null}
        {recapStatus.state === "failed" ? (
          <Banner status="warning" title={recapStatus.message} />
        ) : null}
        {recaps.length === 0 && !running ? (
          <Text size="sm" color="secondary">
            Ask for a recap of the last few minutes if you looked away.
          </Text>
        ) : null}
        <ul className="hub-recaps" aria-label="Recaps">
          {recaps.map((recap) => (
            <li key={recap.id}>
              <VStack gap={1}>
                <Text size="sm" color="secondary">
                  {formatElapsed(recap.windowStartMs)} to {formatElapsed(recap.windowEndMs)} of the
                  meeting, written at {timeOf(recap.createdAt)}
                </Text>
                <div className="hub-summary">
                  <SummaryBody markdown={recap.markdown} onOpen={onOpenSegment} />
                </div>
              </VStack>
            </li>
          ))}
        </ul>
      </VStack>
    </section>
  );
}
