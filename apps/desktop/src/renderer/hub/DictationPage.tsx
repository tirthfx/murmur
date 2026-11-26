import { useCallback, useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  HISTORY_STATUS_LABELS,
  SETTINGS_CLEANUP_LEVELS,
  type DictationState,
  type HistoryRow,
  type SettingsView,
  type SetupStatus,
} from "@murmur/shared";

/** HB-03: the working list shows this many recent dictations; History has the rest. */
export const DICTATION_ROWS = 50;

const STATE_TEXT: Record<DictationState, string> = {
  idle: "Ready",
  listening: "Listening",
  processing: "Working on it",
  attention: "Needs a look on the Bar",
};

const CLEANUP_TEXT: Record<(typeof SETTINGS_CLEANUP_LEVELS)[number], string> = {
  off: "Off",
  light: "Light",
  standard: "Standard",
  full: "Full",
};

function Row({
  row,
  onChanged,
  onMessage,
}: {
  row: HistoryRow;
  onChanged: () => void;
  onMessage: (message: string, error?: boolean) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const app = row.appName ?? row.appBundleId ?? "Unknown app";
  const firstLine = row.finalText?.split("\n")[0] ?? "";
  const canRetry = (row.status === "failed" || row.status === "interrupted") && row.hasAudio;

  async function copy(text: string | null, what: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      onMessage(`${what} copied.`);
    } catch {
      onMessage("The text could not be copied.", true);
    }
  }

  async function retry() {
    setRetrying(true);
    try {
      const result = await window.murmur.historyRetry(row.id);
      if (result.ok) onMessage("Transcribed again and copied to the clipboard.");
      else onMessage(result.message, true);
      onChanged();
    } finally {
      setRetrying(false);
    }
  }

  async function remove() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await window.murmur.historyDelete([row.id]);
    onChanged();
  }

  return (
    <li className="hub-history-row">
      <VStack gap={1}>
        <Text size="sm" color="secondary">
          {[
            new Date(row.createdAt).toLocaleTimeString(undefined, { timeStyle: "short" }),
            app,
            HISTORY_STATUS_LABELS[row.status],
            row.language?.toUpperCase(),
            `${Math.round(row.durationMs / 1000)} s`,
            `${row.wordCount} ${row.wordCount === 1 ? "word" : "words"}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        <Text>{firstLine || <em>No text</em>}</Text>
        <HStack gap={1} wrap="wrap">
          <Button
            size="sm"
            variant="ghost"
            label="Copy the final text"
            isDisabled={!row.finalText}
            onClick={() => void copy(row.finalText, "Text")}
          >
            Copy
          </Button>
          <Button
            size="sm"
            variant="ghost"
            label="Copy the text as heard"
            isDisabled={!row.rawText}
            onClick={() => void copy(row.rawText, "Raw text")}
          >
            Copy raw
          </Button>
          {canRetry ? (
            <Button
              size="sm"
              variant="ghost"
              label="Copy the audio file location"
              onClick={() => void window.murmur.historyCopyAudioPath(row.id)}
            >
              Copy file location
            </Button>
          ) : null}
          {canRetry ? (
            <Button
              size="sm"
              variant="secondary"
              label="Transcribe this recording again"
              isDisabled={retrying}
              onClick={() => void retry()}
            >
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={confirming ? "destructive" : "ghost"}
            label={confirming ? "Confirm deleting this dictation" : "Delete this dictation"}
            onClick={() => void remove()}
            onBlur={() => setConfirming(false)}
          >
            {confirming ? "Delete for good" : "Delete"}
          </Button>
        </HStack>
      </VStack>
    </li>
  );
}

/** Dictation (HB-03): what is happening now, and the recent dictations to act on. */
export function DictationPage() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<DictationState>("idle");
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await window.murmur.historyPage({});
      setRows(page.rows.slice(0, DICTATION_ROWS));
    } catch {
      setMessage({ text: "Recent dictations could not be read.", error: true });
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    void window.murmur.dictationState().then(setState, () => {});
    void window.murmur.getSettings().then(setSettings, () => {});
    void window.murmur.getSetupStatus().then(setSetup, () => {});
    // A finished dictation adds a row: read again when the state goes back to idle.
    return window.murmur.onDictationState((next) => {
      setState(next);
      if (next === "idle") void load();
    });
  }, [load]);

  const s = settings?.settings;
  const microphone =
    !s || s.inputDevice === "auto"
      ? "Automatic"
      : (settings?.devices?.find((device) => device.id === s.inputDevice)?.name ??
        "Saved microphone (not connected)");
  const languages =
    !s || s.languages.length === 0
      ? "Detected automatically"
      : s.languages.map((language) => language.toUpperCase()).join(", ");

  return (
    <VStack gap={4}>
      <div className="hub-insights-grid" aria-label="Dictation now">
        <div className="hub-insights-card" role="group" aria-label="Status">
          <Text size="sm" color="secondary">
            Status
          </Text>
          <Text weight="semibold" data-testid="dictation-state">
            {STATE_TEXT[state]}
          </Text>
        </div>
        <div className="hub-insights-card" role="group" aria-label="Microphone">
          <Text size="sm" color="secondary">
            Microphone
          </Text>
          <Text weight="semibold">{microphone}</Text>
        </div>
        <div className="hub-insights-card" role="group" aria-label="Language">
          <Text size="sm" color="secondary">
            Language
          </Text>
          <Text weight="semibold">{languages}</Text>
        </div>
        <div className="hub-insights-card" role="group" aria-label="Speech model">
          <Text size="sm" color="secondary">
            Speech model
          </Text>
          <Text weight="semibold">{setup ? setup.model.label : "…"}</Text>
        </div>
      </div>
      {s ? (
        <div>
          <Selector
            label="Cleanup"
            description="The same setting as in Settings, System."
            options={SETTINGS_CLEANUP_LEVELS.map((level) => ({
              value: level,
              label: CLEANUP_TEXT[level],
            }))}
            value={s.cleanupLevel}
            onChange={(cleanupLevel) =>
              void window.murmur
                .updateSettings({
                  cleanupLevel: cleanupLevel as SettingsView["settings"]["cleanupLevel"],
                })
                .then(setSettings)
            }
          />
        </div>
      ) : null}

      {message ? (
        message.error ? (
          <Banner status="error" title={message.text} />
        ) : (
          <Text size="sm" color="secondary" role="status">
            {message.text}
          </Text>
        )
      ) : null}

      {loaded && rows.length === 0 ? (
        <Text color="secondary">No dictations yet. Hold the push-to-talk key to start one.</Text>
      ) : (
        <ul className="hub-history-list" aria-label="Recent dictations">
          {rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              onChanged={() => void load()}
              onMessage={(text, error = false) => setMessage({ text, error })}
            />
          ))}
        </ul>
      )}
      <Text size="sm" color="secondary">
        The {DICTATION_ROWS} most recent. Search and older dictations are on the History page.
      </Text>
    </VStack>
  );
}
