import { useCallback, useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Heading } from "@astryxdesign/core/Heading";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { VStack } from "@astryxdesign/core/VStack";
import {
  SETTINGS_CLEANUP_LEVELS,
  SOUND_NAMES,
  type SettingsPatch,
  type SettingsView,
} from "@murmur/shared";
import { CommandModeSection } from "./CommandModeSection";
import { ExperimentalSection } from "./ExperimentalSection";
import { LanguagesField } from "./LanguagesField";
import { MouseButtonField } from "./MouseButtonField";
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
    { value: "auto", label: "Automatic" },
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
      <ShortcutField
        slot="rewrite"
        title="Rewrite"
        description="Select text in any app, press this and pick a Rewrite."
        label={view.shortcutLabels.rewrite}
        canClear={settings.rewriteShortcut !== null}
        clear={{ label: "Turn off the Rewrite shortcut", text: "Turn off" }}
        onSaved={setView}
      />
      <MouseButtonField
        title="Push to talk (mouse)"
        description="Hold an extra mouse button to dictate. The button also keeps doing what it did before."
        button={settings.mouseButtons.hold}
        onChange={(hold) => {
          const handsFree =
            settings.mouseButtons.handsFree === hold ? null : settings.mouseButtons.handsFree;
          update({ mouseButtons: { hold, handsFree } });
        }}
      />
      <MouseButtonField
        title="Hands-free (mouse)"
        description="Press an extra mouse button to start, and again to stop."
        button={settings.mouseButtons.handsFree}
        onChange={(handsFree) => {
          const hold = settings.mouseButtons.hold === handsFree ? null : settings.mouseButtons.hold;
          update({ mouseButtons: { hold, handsFree } });
        }}
      />
      <Selector
        label="Microphone"
        description={
          view.devices
            ? "Used from the next dictation. Automatic follows the system default, but never picks a virtual input over a real microphone, or the built-in microphone while the lid is closed."
            : "The device list appears when the helper is running."
        }
        options={microphoneOptions}
        value={settings.inputDevice}
        onChange={(inputDevice) => update({ inputDevice })}
      />
      <LanguagesField
        languages={settings.languages}
        onChange={(languages) => update({ languages })}
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
      <Switch
        label="Suggest dictating after a lot of typing"
        description="After more than 60 typed words in two minutes, at most once an hour. Only words are counted, never what you type."
        value={settings.typingReminder.enabled}
        onChange={(enabled) => update({ typingReminder: { enabled, snoozedUntil: null } })}
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
        label="Whisper mode"
        description="For very quiet speech: more gain, and softer sounds still count as speech. May pick up more background noise."
        value={settings.whisperMode}
        onChange={(whisperMode) => update({ whisperMode })}
      />
      <Switch
        label="Mute other audio while dictating"
        description="Silences the Mac's output while recording and turns it back on afterwards."
        value={settings.muteWhileDictating}
        onChange={(muteWhileDictating) => update({ muteWhileDictating })}
      />
      <ExperimentalSection
        experimental={settings.experimental}
        onChange={(experimental) => update({ experimental })}
      />
      {settings.experimental.commandMode ? (
        <CommandModeSection view={view} onSaved={setView} update={update} />
      ) : null}
      {problem ? <Banner status="error" title={problem} /> : null}
    </VStack>
  );
}
