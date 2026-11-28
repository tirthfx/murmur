import { useCallback, useEffect, useRef, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  SEGMENT_TEXT_MAX,
  type Correction,
  type CorrectionResult,
  type MeetingDetail,
  type MeetingSegment,
  type SegmentHistoryItem,
} from "@murmur/shared";

const NEW_SPEAKER = "__new";

const KIND_TEXT: Record<SegmentHistoryItem["kind"], string> = {
  text: "Edited the text",
  speaker: "Changed the speaker",
  split: "Split the line",
  merge: "Joined two lines",
};

const whenOf = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * NT-24: correct one transcript line. Edit its words, give it to another speaker, cut it in two
 * at the cursor or join it to the next line, and take back any of these from the history, the
 * newest first. The original is kept until the correction is taken back or kept for good.
 */
export function LineEditor({
  detail,
  segment,
  onClose,
}: {
  detail: MeetingDetail;
  segment: MeetingSegment;
  onClose: () => void;
}) {
  const meetingId = detail.meeting.id;
  const [text, setText] = useState(segment.text);
  const [speaker, setSpeaker] = useState(segment.speakerId ?? "");
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [history, setHistory] = useState<SegmentHistoryItem[]>([]);
  const box = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(async () => {
    setHistory(await window.murmur.meetingSegmentHistory(meetingId, segment.id));
  }, [meetingId, segment.id]);
  useEffect(() => {
    void loadHistory();
  }, [loadHistory, segment.edited]);

  async function correct(
    correction: Correction,
    then: "close" | "stay",
  ): Promise<CorrectionResult> {
    setMessage(null);
    setNote(null);
    const result = await window.murmur.meetingCorrect(meetingId, correction);
    if (!result.ok) {
      setMessage(result.message);
      return result;
    }
    if (result.learned) {
      setNote(
        `“${result.learned.spoken}” → “${result.learned.written}” was added to your Dictionary, for you to review.`,
      );
    }
    await loadHistory();
    if (then === "close" && !result.learned) onClose();
    return result;
  }

  async function revert(item: SegmentHistoryItem) {
    setMessage(null);
    const result = await window.murmur.meetingCorrectionRevert(meetingId, item.id);
    if (!result.ok) return setMessage(result.message);
    await loadHistory();
    onClose();
  }

  /** Where the cursor is in the text box, for cutting the line there. */
  const cursor = () => box.current?.querySelector("textarea")?.selectionStart ?? 0;

  const changed = text.trim() !== segment.text;

  return (
    <VStack gap={2}>
      <div ref={box}>
        <TextArea
          label="Line"
          rows={3}
          value={text}
          onChange={setText}
          maxLength={SEGMENT_TEXT_MAX}
        />
      </div>
      <HStack gap={2} wrap="wrap" align="center">
        <Button
          size="sm"
          variant="primary"
          label="Save this line"
          isDisabled={!changed}
          onClick={() => void correct({ kind: "text", segmentId: segment.id, text }, "close")}
        >
          Save
        </Button>
        {segment.isDictated ? null : (
          <>
            <Button
              size="sm"
              variant="secondary"
              label="Cut this line in two at the cursor"
              isDisabled={changed}
              onClick={() =>
                void correct({ kind: "split", segmentId: segment.id, offset: cursor() }, "close")
              }
            >
              Split at the cursor
            </Button>
            <Button
              size="sm"
              variant="secondary"
              label="Join this line with the next one"
              onClick={() => void correct({ kind: "merge", segmentId: segment.id }, "close")}
            >
              Join with next
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" label="Close the editor" onClick={onClose}>
          Close
        </Button>
      </HStack>
      {changed ? (
        <Text size="sm" color="secondary">
          Save the new words before splitting.
        </Text>
      ) : null}
      <HStack gap={2} wrap="wrap" align="end" hidden={segment.isDictated}>
        <Selector
          label="Speaker"
          value={speaker}
          options={[
            ...detail.speakers.map((s) => ({ value: s.id, label: s.name })),
            { value: NEW_SPEAKER, label: "New speaker…" },
          ]}
          onChange={(value) => {
            setSpeaker(value);
            if (value !== NEW_SPEAKER)
              void correct({ kind: "speaker", segmentId: segment.id, speakerId: value }, "close");
          }}
        />
        {speaker === NEW_SPEAKER ? (
          <>
            <TextInput
              label="Name of the new speaker"
              value={newName}
              onChange={setNewName}
              onEnter={() =>
                void correct({ kind: "speaker", segmentId: segment.id, newName }, "close")
              }
            />
            <Button
              size="sm"
              variant="primary"
              label="Give this line to the new speaker"
              isDisabled={newName.trim() === ""}
              onClick={() =>
                void correct({ kind: "speaker", segmentId: segment.id, newName }, "close")
              }
            >
              Add speaker
            </Button>
          </>
        ) : null}
      </HStack>
      {message ? <Banner status="warning" title={message} /> : null}
      {note ? <Banner status="info" title={note} /> : null}
      {history.length > 0 ? (
        <section aria-label="History of this line">
          <VStack gap={1}>
            <Text weight="semibold">History</Text>
            <ul className="hub-line-history" aria-label="History of this line">
              {history.map((item) => (
                <li key={item.id}>
                  <HStack gap={2} align="center" wrap="wrap">
                    <Text size="sm">
                      {KIND_TEXT[item.kind]}, {whenOf(item.createdAt)}. Before:{" "}
                      {item.original.length > 120
                        ? `${item.original.slice(0, 119)}…`
                        : item.original}
                    </Text>
                    <Button
                      size="sm"
                      variant="secondary"
                      label={`Take back: ${KIND_TEXT[item.kind].toLowerCase()}`}
                      isDisabled={!item.canRevert}
                      onClick={() => void revert(item)}
                    >
                      Take back
                    </Button>
                  </HStack>
                </li>
              ))}
            </ul>
          </VStack>
        </section>
      ) : null}
    </VStack>
  );
}
