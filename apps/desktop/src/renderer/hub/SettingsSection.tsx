import { useCallback, useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Heading } from "@astryxdesign/core/Heading";
import { Selector } from "@astryxdesign/core/Selector";
import { VStack } from "@astryxdesign/core/VStack";
import {
  SETTINGS_CLEANUP_LEVELS,
  SPEECH_LANGUAGES,
  type SettingsPatch,
  type SettingsView,
} from "@murmur/shared";
import { ShortcutField } from "./ShortcutField";

const CLEANUP_LABELS: Record<(typeof SETTINGS_CLEANUP_LEVELS)[number], string> = {
  off: "Off: the words as heard",
  light: "Light: punctuation and capitals",
  standard: "Standard: also fillers and corrections",
  full: "Full: also smooth long sentences",
};

/** Dictation settings. Every change applies at once; nothing needs a restart. */
export function SettingsSection() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    window.murmur.getSettings().then(
      (value) => active && setView(value),
      () => active && setProblem("Settings could not be read."),
    );
    return () => {
      active = false;
    };
  }, []);

  const update = useCallback((patch: SettingsPatch) => {
    window.murmur
      .updateSettings(patch)
      .then(setView, () => setProblem("The setting could not be saved."));
  }, []);

  if (!view) {
    return problem ? <Banner status="error" title={problem} /> : null;
  }
  const { settings } = view;
  const devices = view.devices ?? [];
  const known = devices.some((device) => device.id === settings.inputDevice);
  const microphoneOptions = [
    { value: "auto", label: "System default" },
    ...devices.map((device) => ({ value: device.id, label: device.name })),
    ...(settings.inputDevice !== "auto" && !known
      ? [{ value: settings.inputDevice, label: "Saved microphone (not connected)" }]
      : []),
  ];

  return (
    <VStack gap={4} className="hub-settings">
      <Heading level={2}>Dictation</Heading>
      <ShortcutField
        slot="hold"
        title="Push to talk"
        description="Hold to dictate, release to insert."
        label={view.shortcutLabels.hold}
        canClear={false}
        onSaved={setView}
      />
      <ShortcutField
        slot="handsFree"
        title="Hands-free"
        description="Start and stop dictation without holding a key."
        label={view.shortcutLabels.handsFree}
        canClear={settings.handsFreeShortcut !== null}
        onSaved={setView}
      />
      <Selector
        label="Microphone"
        description={
          view.devices
            ? "Used from the next dictation."
            : "The device list appears when the helper is running."
        }
        options={microphoneOptions}
        value={settings.inputDevice}
        onChange={(inputDevice) => update({ inputDevice })}
      />
      <Selector
        label="Language"
        description="Fixed: only this language is sent to the speech model."
        options={SPEECH_LANGUAGES.map((language) => ({
          value: language.code,
          label: language.label,
        }))}
        value={settings.language}
        onChange={(language) =>
          update({ language: language as SettingsView["settings"]["language"] })
        }
      />
      <Selector
        label="Cleanup"
        options={SETTINGS_CLEANUP_LEVELS.map((level) => ({
          value: level,
          label: CLEANUP_LABELS[level],
        }))}
        value={settings.cleanupLevel}
        onChange={(cleanupLevel) =>
          update({ cleanupLevel: cleanupLevel as SettingsView["settings"]["cleanupLevel"] })
        }
      />
      {problem ? <Banner status="error" title={problem} /> : null}
    </VStack>
  );
}
