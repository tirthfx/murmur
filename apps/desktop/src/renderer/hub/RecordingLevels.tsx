import { useEffect, useState } from "react";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import type { MeetingChannel } from "@murmur/shared";
import { meterPercent } from "./MicCheckSection";

const LABELS: Record<MeetingChannel, string> = {
  mic: "Your microphone",
  system: "The Mac's sound",
};

/** NT-04: one meter for each channel being recorded, so a silent one is seen at once. */
export function RecordingLevels({ channels }: { channels: readonly MeetingChannel[] }) {
  const [levels, setLevels] = useState<Partial<Record<MeetingChannel, number>>>({});

  useEffect(
    () =>
      window.murmur.onMeetingLevel(({ channel, rmsDb }) =>
        setLevels((current) => ({ ...current, [channel]: rmsDb })),
      ),
    [],
  );

  return (
    <HStack gap={4} wrap="wrap">
      {channels.map((channel) => {
        const percent = meterPercent(levels[channel] ?? null);
        return (
          <div key={channel} className="hub-recording-level">
            <Text size="xsm" color="secondary">
              {LABELS[channel]}
            </Text>
            <div
              className="hub-meter"
              role="meter"
              aria-label={`${LABELS[channel]} level`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div className="hub-meter-fill" style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      })}
    </HStack>
  );
}
