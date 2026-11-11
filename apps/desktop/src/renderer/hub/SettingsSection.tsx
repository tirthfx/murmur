import { useCallback, useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Heading } from "@astryxdesign/core/Heading";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { VStack } from "@astryxdesign/core/VStack";
import {
  SETTINGS_CLEANUP_LEVELS,
  SOUND_NAMES,
  SPEECH_LANGUAGES,
  type SettingsPatch,
  type SettingsView,
} from "@murmur/shared";
import { ShortcutField } from "./ShortcutField";

const SOUND_LABELS: Record<(typeof SOUND_NAMES)[number], string> = {
  start: "Start sound",
  lock: "Hands-free sound",
  success: "Done sound",
  error: "Error sound",
  cancel: "Cancel sound",
};

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
      <Switch
        label="Say “press enter” to press Return"
        description="Only at the end of a dictation. The words are left out of the text."
        value={settings.pressEnterCommand}
        onChange={(pressEnterCommand) => update({ pressEnterCommand })}
      />
      <Switch
        label="Use the text around the cursor"
        description="Helps spell names and terms already on screen. Read when dictation starts, kept only until the text is inserted, never saved. Password fields are never read."
        value={settings.contextAwareness}
        onChange={(contextAwareness) => update({ contextAwareness })}
      />
      <Heading level={2}>Sounds and audio</Heading>
      {SOUND_NAMES.map((name) => (
        <Switch
          key={name}
          label={SOUND_LABELS[name]}
          value={settings.sounds[name]}
          onChange={(on) => update({ sounds: { ...settings.sounds, [name]: on } })}
        />
      ))}
      <Switch
        label="Mute other audio while dictating"
        description="Silences the Mac's output while recording and turns it back on afterwards."
        value={settings.muteWhileDictating}
        onChange={(muteWhileDictating) => update({ muteWhileDictating })}
      />
      {problem ? <Banner status="error" title={problem} /> : null}
    </VStack>
  );
}
