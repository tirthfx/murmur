import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { Selector } from "@astryxdesign/core/Selector";
import { DEFAULT_EXPORT_OPTIONS, type MeetingExportOptions } from "@murmur/shared";
import { useTeamView } from "./ShareWithTeam";

const PARTS: { key: keyof MeetingExportOptions; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "transcript", label: "Transcript" },
  { key: "tasks", label: "Tasks" },
  { key: "notes", label: "My notes" },
];

/**
 * NT-17: puts a meeting's summary and tasks, as text, into a folder the person's team shares.
 * It is shown only while signed in to a team that has a folder the person may add to. The
 * transcript, the person's own notes and the audio are never sent.
 */
function ShareToFolder({ meetingId }: { meetingId: string }) {
  const view = useTeamView();
  const writable = (view?.shared.folders ?? []).filter((folder) => folder.canWrite);
  const [key, setKey] = useState("");
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  if (!view || view.state !== "signed_in" || writable.length === 0) return null;
  const chosen = writable.find((folder) => `${folder.teamId}/${folder.id}` === key) ?? writable[0]!;

  async function share() {
    setBusy(true);
    setSaid("");
    try {
      const result = await window.murmur.teamShareMeeting({
        meetingId,
        teamId: chosen.teamId,
        folderId: chosen.id,
      });
      setSaid(result.ok ? `Shared into ${chosen.name}.` : result.message);
    } catch {
      setSaid("That could not be shared.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <VStack gap={1}>
      <Text weight="semibold">Share with your team</Text>
      <HStack gap={2} align="end" wrap="wrap">
        <Selector
          label="Folder"
          value={`${chosen.teamId}/${chosen.id}`}
          options={writable.map((folder) => ({
            value: `${folder.teamId}/${folder.id}`,
            label: view.teams.length > 1 ? `${folder.name} (${folder.teamName})` : folder.name,
          }))}
          onChange={(value) => setKey(String(value))}
        />
        <Button
          variant="secondary"
          label="Share the summary and tasks into the folder"
          isDisabled={busy}
          onClick={() => void share()}
        >
          Share
        </Button>
      </HStack>
      <Text size="sm" color="secondary">
        The summary and the tasks go in, as text. The transcript, your own notes and the audio stay
        on this Mac.
      </Text>
      {said ? (
        <Text size="sm" role="status">
          {said}
        </Text>
      ) : null}
    </VStack>
  );
}

/**
 * NT-18: a meeting as one web page that opens offline in any browser. The owner chooses what
 * goes in it; the audio never does, and the panel says so. A link that other people can open
 * needs the team server, which comes later.
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
          The file is a web page that opens offline in any browser. The audio is not included. A
          link that others can open needs the team server, which comes later.
        </Text>
        {message ? <Banner status={message.status} title={message.text} /> : null}
        <ShareToFolder meetingId={meetingId} />
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
