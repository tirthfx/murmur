import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  PRESET_LABELS,
  PRESET_SWITCHES,
  PRIVACY_PRESETS,
  presetOf,
  privacyStatement,
  type PrivacyPreset,
  type RetentionView,
  type Settings,
  type SettingsPatch,
  type StorageView,
} from "@murmur/shared";

const AUDIO_CHOICES = [
  ["24h", "A day"],
  ["never", "Not at all"],
  ["keep", "Until I delete them"],
] as const;

const HISTORY_CHOICES = [
  [null, "Forever"],
  [365, "1 year"],
  [30, "30 days"],
  [7, "7 days"],
] as const;

const RETENTION_NAMES: Record<string, string> = {
  historyText: "dictations past their time",
  audio: "recordings",
  instructThreads: "Instruct threads",
  learnedCandidates: "learned word suggestions",
  voiceSamples: "voice samples",
};

function megabytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const when = (epoch: number) =>
  new Date(epoch).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A row of buttons acting as one choice. */
function Choice<T extends string | number | null>({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <VStack gap={1}>
      <Text weight="semibold">{label}</Text>
      <HStack gap={1} role="radiogroup" aria-label={label} wrap="wrap">
        {options.map(([option, text]) => (
          <Button
            key={String(option)}
            size="sm"
            variant={value === option ? "secondary" : "ghost"}
            label={text}
            role="radio"
            aria-checked={value === option}
            isDisabled={disabled ?? false}
            onClick={() => onChange(option)}
          >
            {text}
          </Button>
        ))}
      </HStack>
    </VStack>
  );
}

/** Settings, Data and Privacy (HB-21, HB-48 to HB-50, HB-52). */
export function DataPrivacySection({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: SettingsPatch) => void;
}) {
  const [storage, setStorage] = useState<StorageView | null>(null);
  const [retention, setRetention] = useState<RetentionView | null>(null);
  const [confirmStrict, setConfirmStrict] = useState(false);
  const privacy = settings.privacy;
  const strict = privacy.strictLocal;
  const statement = privacyStatement(strict);
  const preset = presetOf({
    privacy: {
      storeHistory: privacy.storeHistory,
      audio: privacy.audio,
      historyDays: privacy.historyDays,
    },
    contextAwareness: settings.contextAwareness,
    learnCorrections: settings.learnCorrections,
    voiceProfile: settings.voiceProfile.enabled,
  });

  useEffect(() => {
    void window.murmur.storageView().then(setStorage, () => {});
    void window.murmur.retentionView().then(setRetention, () => {});
  }, []);

  const setPrivacy = (change: Partial<Settings["privacy"]>) =>
    update({ privacy: { ...privacy, ...change } });

  const applyPreset = (name: PrivacyPreset) => {
    const want = PRESET_SWITCHES[name];
    update({
      privacy: { ...privacy, ...want.privacy },
      contextAwareness: want.contextAwareness,
      learnCorrections: want.learnCorrections,
      voiceProfile: { ...settings.voiceProfile, enabled: want.voiceProfile },
    });
  };

  const toggleStrict = () => {
    if (!confirmStrict) {
      setConfirmStrict(true);
      return;
    }
    setConfirmStrict(false);
    if (strict) {
      setPrivacy({ strictLocal: false });
    } else {
      update({
        privacy: { ...privacy, strictLocal: true, audio: "never" },
        learnCorrections: false,
        voiceProfile: { ...settings.voiceProfile, enabled: false },
      });
    }
  };

  const removed = Object.entries(retention?.removed ?? {}).filter(([, count]) => count > 0);

  return (
    <VStack gap={4}>
      <section aria-labelledby="leaves-heading" data-setting="privacy" className="hub-setting-row">
        <VStack gap={1}>
          <Heading level={3} id="leaves-heading">
            What leaves this Mac
          </Heading>
          <Text weight="semibold">{statement.headline}</Text>
          {statement.details.map((line) => (
            <Text key={line} size="sm" color="secondary">
              {line}
            </Text>
          ))}
        </VStack>
      </section>

      <section data-setting="privacy-modes" className="hub-setting-row">
        <VStack gap={3}>
          <Heading level={3}>Privacy mode</Heading>
          <Choice
            label="Preset"
            options={PRIVACY_PRESETS.map((name) => [name, PRESET_LABELS[name]] as const)}
            value={preset === "custom" ? null : preset}
            disabled={strict}
            onChange={(name) => name && applyPreset(name)}
          />
          <Text size="sm" color="secondary" data-testid="privacy-preset">
            Now: {PRESET_LABELS[preset]}. Changing a switch below makes it Custom.
          </Text>
          <Switch
            label="Keep dictations in History"
            description="Off: nothing you dictate is written to History. Insights keep word counts only."
            value={privacy.storeHistory}
            onChange={(storeHistory) => setPrivacy({ storeHistory })}
          />
          <Choice
            label="Keep recordings of successful dictations"
            options={AUDIO_CHOICES}
            value={strict ? "never" : privacy.audio}
            disabled={strict}
            onChange={(audio) => setPrivacy({ audio })}
          />
          <Text size="sm" color="secondary">
            A failed dictation's recording is always kept 7 days, so it can be retried.
          </Text>
          <Switch
            label="Read the text around the cursor"
            value={settings.contextAwareness}
            onChange={(contextAwareness) => update({ contextAwareness })}
          />
          <Switch
            label="Learn from my corrections"
            value={settings.learnCorrections}
            isDisabled={strict}
            onChange={(learnCorrections) => update({ learnCorrections })}
          />
          <Switch
            label="Voice Profile"
            value={settings.voiceProfile.enabled}
            isDisabled={strict}
            onChange={(enabled) => update({ voiceProfile: { ...settings.voiceProfile, enabled } })}
          />
        </VStack>
      </section>

      <section data-setting="retention" className="hub-setting-row">
        <VStack gap={2}>
          <Heading level={3}>Retention</Heading>
          <Choice
            label="Keep dictation text"
            options={HISTORY_CHOICES}
            value={privacy.historyDays}
            onChange={(historyDays) => setPrivacy({ historyDays })}
          />
          <Text size="sm" color="secondary">
            Instruct threads keep their text 30 days, learned word suggestions 90 days and voice
            samples 30 days. Dictionary, Snippets, Styles, Memory and notes are never removed by
            these rules.
          </Text>
          <Text size="sm" color="secondary" data-testid="retention-status">
            {retention?.lastRunAt
              ? `Last run ${when(retention.lastRunAt)}; next ${when(retention.nextRunAt!)}. ${
                  removed.length > 0
                    ? `Removed ${removed
                        .map(([name, count]) => `${count} ${RETENTION_NAMES[name] ?? name}`)
                        .join(", ")}.`
                    : "Nothing was due."
                }`
              : "Runs once a day."}
          </Text>
          <div>
            <Button
              size="sm"
              variant="secondary"
              label="Run the retention rules now"
              onClick={() => void window.murmur.retentionRun().then(setRetention)}
            >
              Run now
            </Button>
          </div>
        </VStack>
      </section>

      <section data-setting="storage" className="hub-setting-row">
        <VStack gap={2}>
          <Heading level={3}>Local storage</Heading>
          {storage ? (
            <>
              <Text size="sm">{storage.folder}</Text>
              <ul className="hub-storage-list" aria-label="Storage by part">
                {storage.parts.map((part) => (
                  <li key={part.name}>
                    {part.name}: {megabytes(part.bytes)}
                  </li>
                ))}
              </ul>
              <div>
                <Button
                  size="sm"
                  variant="secondary"
                  label="Show the data folder in Finder"
                  onClick={() => void window.murmur.storageOpen()}
                >
                  Show in Finder
                </Button>
              </div>
            </>
          ) : null}
        </VStack>
      </section>

      <section data-setting="strict-local" className="hub-setting-row">
        <VStack gap={2}>
          <Heading level={3}>Strict local mode</Heading>
          <Text size="sm" color="secondary">
            No network connection at all (download models first), recordings deleted right after
            each dictation, and no learning or Voice Profile. This is a local setting, not a
            certification.
          </Text>
          <Text weight="semibold" data-testid="strict-state">
            {strict ? "Strict local mode is on." : "Strict local mode is off."}
          </Text>
          <HStack gap={2}>
            <Button
              size="sm"
              variant={confirmStrict ? "destructive" : "secondary"}
              label={
                confirmStrict
                  ? strict
                    ? "Confirm turning strict local mode off"
                    : "Confirm turning strict local mode on"
                  : strict
                    ? "Turn strict local mode off"
                    : "Turn strict local mode on"
              }
              onClick={toggleStrict}
            >
              {confirmStrict ? "Confirm" : strict ? "Turn off" : "Turn on"}
            </Button>
            {confirmStrict ? (
              <Button
                size="sm"
                variant="ghost"
                label="Cancel"
                onClick={() => setConfirmStrict(false)}
              >
                Cancel
              </Button>
            ) : null}
          </HStack>
        </VStack>
      </section>
    </VStack>
  );
}
