import { useEffect, useState } from "react";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { RetentionLogEntry } from "@murmur/shared";

const KINDS: Record<RetentionLogEntry["kind"], string> = {
  audio: "Recording",
  transcript: "Transcript",
};

const day = (at: number) => new Date(at).toLocaleDateString(undefined, { dateStyle: "medium" });

/** NT-22: what the retention rules have deleted, so nothing disappears unexplained. */
export function RetentionLog() {
  const [entries, setEntries] = useState<RetentionLogEntry[]>([]);

  useEffect(() => {
    let alive = true;
    void window.murmur.meetingRetentionLog().then((found) => alive && setEntries(found));
    return () => {
      alive = false;
    };
  }, []);

  if (entries.length === 0) return null;
  return (
    <VStack gap={1}>
      <Text weight="semibold">Deleted by these rules</Text>
      <ul className="hub-storage-list" aria-label="Deleted by retention">
        {entries.map((entry) => (
          <li key={`${entry.meetingId}-${entry.kind}`}>
            {KINDS[entry.kind]} of “{entry.title}”, {day(entry.at)}
          </li>
        ))}
      </ul>
    </VStack>
  );
}
