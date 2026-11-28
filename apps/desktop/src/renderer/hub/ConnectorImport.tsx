import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  FIREFLIES_ID,
  IMPORT_RANGE_DAYS,
  formatElapsed,
  type ConnectorAccount,
  type ConnectorSettings,
  type ConnectorView,
  type ImportableRecording,
  type TranscriptImportPreview,
} from "@murmur/shared";
import { ImportPreview } from "./ImportPanel";

/** A Fireflies key, asked once. It goes to the Keychain and is never shown again. */
export function KeyForm({
  connector,
  onResult,
}: {
  connector: ConnectorView;
  onResult: (result: { ok: boolean; message?: string }) => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const result = await window.murmur.connectorConnectKey(connector.id, key);
      // The key is cleared whether or not it was accepted: it is not kept in the window.
      setKey("");
      onResult(result);
    } finally {
      setBusy(false);
    }
  }

  return (
    <HStack gap={2} align="end" wrap="wrap">
      <TextInput
        label={`${connector.name} API key`}
        description="From your Fireflies account settings. It is kept in the Mac's Keychain."
        type="password"
        value={key}
        onChange={setKey}
      />
      <Button
        size="sm"
        variant="primary"
        label={`Save the ${connector.name} key`}
        isDisabled={busy || key.trim() === ""}
        onClick={() => void save()}
      >
        Save the key
      </Button>
    </HStack>
  );
}

const when = (at: number) => new Date(at).toLocaleString();

/**
 * Meetings of a Zoom or Fireflies account (CN-09, CN-10): the owner lists what is there for a date
 * range, picks one, and sees the same preview as for a file. Nothing is downloaded until a meeting
 * is picked, and nothing is made until the preview is confirmed.
 */
export function ConnectorImport({
  connector,
  account,
  settings,
  save,
  onImported,
}: {
  connector: ConnectorView;
  account: ConnectorAccount;
  settings: ConnectorSettings;
  save: (patch: Partial<ConnectorSettings>) => Promise<void>;
  onImported: (meetingId: string) => void;
}) {
  const [recordings, setRecordings] = useState<ImportableRecording[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [preview, setPreview] = useState<TranscriptImportPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fireflies = connector.id === FIREFLIES_ID;
  const rangeDays = fireflies ? settings.fireflies.rangeDays : settings.zoom.rangeDays;

  async function list() {
    setLoading(true);
    setMessage(null);
    try {
      const result = await window.murmur.connectorRecordings(account.id);
      if (result.ok) setRecordings(result.recordings);
      else setMessage(result.message);
    } finally {
      setLoading(false);
    }
  }

  async function pick(recording: ImportableRecording) {
    if (preview) void window.murmur.meetingImportCancel(preview.token);
    setPreview(null);
    setMessage(null);
    setPicking(recording.remoteId);
    try {
      const result = await window.murmur.connectorImportPrepare(account.id, recording.remoteId);
      if (result.ok) setPreview(result.preview);
      else if ("message" in result) setMessage(result.message);
    } finally {
      setPicking(null);
    }
  }

  return (
    <VStack gap={2}>
      <Text weight="semibold">Import meetings from {connector.name}</Text>
      <Text size="sm" color="secondary">
        {fireflies
          ? "Brings in a transcript with its speakers and times, and Fireflies’ own summary if you keep it."
          : "Brings in a cloud recording’s transcript file. Audio is not downloaded."}{" "}
        Nothing is imported until you pick a meeting and confirm.
      </Text>
      <HStack gap={2} align="end" wrap="wrap">
        <Selector
          label="Look back"
          value={String(rangeDays)}
          options={[...new Set<number>([...IMPORT_RANGE_DAYS, rangeDays])]
            .sort((a, b) => a - b)
            .map((days) => ({ value: String(days), label: `${days} days` }))}
          onChange={(value) =>
            void save(
              fireflies
                ? { fireflies: { ...settings.fireflies, rangeDays: Number(value) } }
                : { zoom: { ...settings.zoom, rangeDays: Number(value) } },
            )
          }
        />
        <Button
          size="sm"
          variant="secondary"
          label={`List the meetings in ${connector.name}`}
          isDisabled={loading}
          onClick={() => void list()}
        >
          {loading ? "Looking…" : recordings ? "List again" : "List meetings"}
        </Button>
      </HStack>
      {fireflies ? (
        <Switch
          label="Keep Fireflies’ summary with an imported meeting"
          description="It is kept as a separate summary, marked as imported, and Murmur’s own summary does not replace it by itself."
          value={settings.fireflies.importProviderSummary}
          onChange={(importProviderSummary) =>
            void save({ fireflies: { ...settings.fireflies, importProviderSummary } })
          }
        />
      ) : null}
      <Switch
        label={`Import new meetings from ${connector.name} by itself`}
        description="Looked for once an hour. A meeting that looks like one already here is left for you."
        value={(fireflies ? settings.fireflies : settings.zoom).autoImport}
        onChange={(autoImport) =>
          void save(
            fireflies
              ? { fireflies: { ...settings.fireflies, autoImport } }
              : { zoom: { ...settings.zoom, autoImport } },
          )
        }
      />
      {message ? <Banner status="warning" title={message} /> : null}
      {recordings ? (
        recordings.length === 0 ? (
          <Text size="sm" color="secondary">
            No meetings in the last {rangeDays} days.
          </Text>
        ) : (
          <ul className="hub-connector-list" aria-label={`Meetings in ${connector.name}`}>
            {recordings.map((recording) => (
              <li key={recording.remoteId}>
                <HStack gap={2} align="center" wrap="wrap">
                  <Text weight="semibold">{recording.title}</Text>
                  <Text size="sm" color="secondary">
                    {when(recording.startedAt)}
                    {recording.durationMs ? `, ${formatElapsed(recording.durationMs)}` : ""}
                  </Text>
                  {recording.imported ? <Badge variant="success" label="Imported" /> : null}
                  {recording.hasTranscript ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      label={`Import “${recording.title}”`}
                      isDisabled={picking !== null}
                      onClick={() => void pick(recording)}
                    >
                      {picking === recording.remoteId ? "Fetching…" : "Import…"}
                    </Button>
                  ) : (
                    <Text size="sm" color="secondary">
                      No transcript file
                    </Text>
                  )}
                </HStack>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {preview ? (
        <ImportPreview
          key={preview.token}
          preview={preview}
          onImported={(meetingId) => {
            setPreview(null);
            setRecordings((list) =>
              list
                ? list.map((entry) =>
                    entry.title === preview.title ? { ...entry, imported: true } : entry,
                  )
                : list,
            );
            onImported(meetingId);
            void list();
          }}
        />
      ) : null}
    </VStack>
  );
}
