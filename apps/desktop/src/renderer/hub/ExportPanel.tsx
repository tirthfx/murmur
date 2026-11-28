import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { DEFAULT_EXPORT_OPTIONS, type MeetingExportOptions } from "@murmur/shared";

const PARTS: { key: keyof MeetingExportOptions; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "transcript", label: "Transcript" },
  { key: "tasks", label: "Tasks" },
  { key: "notes", label: "My notes" },
  { key: "audio", label: "Audio" },
];

/**
 * NT-18: a meeting as one web page that opens offline in any browser. The owner chooses what
 * goes in it; the audio only when asked, and the panel says which.
 */
export function ExportPanel({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const [options, setOptions] = useState<MeetingExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [message, setMessage] = useState<{ status: "info" | "warning"; text: string } | null>(null);
  const nothing = !Object.values(options).some(Boolean);

  async function save() {
    setMessage(null);
    const result = await window.murmur.meetingExport(meetingId, options);
    if (result.ok) setMessage({ status: "info", text: `Saved to ${result.path}` });
    else if ("message" in result) setMessage({ status: "warning", text: result.message });
  }

  return (
    <section aria-label="Export">
      <VStack gap={2}>
        <Text weight="semibold">Export a shareable file</Text>
        <HStack gap={3} wrap="wrap">
          {PARTS.map((part) => (
            <Switch
              key={part.key}
              label={part.label}
              value={options[part.key]}
              onChange={(value) => setOptions({ ...options, [part.key]: value })}
            />
          ))}
        </HStack>
        <Text size="sm" color="secondary">
          {options.audio
            ? "The file is a .murmur-meeting archive: unzip it and open index.html, which opens offline in any browser. It holds the recording."
            : "The file is a web page that opens offline in any browser. The audio is not included."}
        </Text>
        {message ? <Banner status={message.status} title={message.text} /> : null}
        <HStack gap={2}>
          <Button
            variant="primary"
            label="Choose where to save the file"
            isDisabled={nothing}
            onClick={() => void save()}
          >
            Save as…
          </Button>
          <Button variant="secondary" label="Close the export panel" onClick={onClose}>
            Close
          </Button>
        </HStack>
      </VStack>
    </section>
  );
}
