import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { VStack } from "@astryxdesign/core/VStack";
import type { MeetingDetail } from "@murmur/shared";

/**
 * NT-24: gives several transcript lines to one speaker. Each line is its own correction, so each
 * can be taken back from the line's history.
 */
export function BulkSpeaker({
  detail,
  selected,
  onSelect,
}: {
  detail: MeetingDetail;
  /** The chosen lines, or null while not selecting. */
  selected: Set<string> | null;
  onSelect: (selected: Set<string> | null) => void;
}) {
  const [speakerId, setSpeakerId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  if (selected === null)
    return (
      <div>
        <Button
          size="sm"
          variant="secondary"
          label="Select several lines to change their speaker"
          onClick={() => onSelect(new Set())}
        >
          Select lines
        </Button>
      </div>
    );

  const target = speakerId || (detail.speakers[0]?.id ?? "");

  async function apply(lines: Set<string>) {
    setWorking(true);
    setMessage(null);
    try {
      for (const segmentId of lines) {
        const result = await window.murmur.meetingCorrect(detail.meeting.id, {
          kind: "speaker",
          segmentId,
          speakerId: target,
        });
        if (!result.ok) {
          setMessage(result.message);
          return;
        }
      }
      onSelect(null);
    } finally {
      setWorking(false);
    }
  }

  return (
    <VStack gap={2}>
      <HStack gap={2} align="end" wrap="wrap">
        <Selector
          label="Speaker for the selected lines"
          value={target}
          options={detail.speakers.map((speaker) => ({ value: speaker.id, label: speaker.name }))}
          onChange={setSpeakerId}
        />
        <Button
          size="sm"
          variant="primary"
          label="Give the selected lines to this speaker"
          isDisabled={working || selected.size === 0 || target === ""}
          onClick={() => void apply(selected)}
        >
          Apply to {selected.size} {selected.size === 1 ? "line" : "lines"}
        </Button>
        <Button size="sm" variant="ghost" label="Stop selecting" onClick={() => onSelect(null)}>
          Cancel
        </Button>
      </HStack>
      {message ? <Banner status="warning" title={message} /> : null}
    </VStack>
  );
}
