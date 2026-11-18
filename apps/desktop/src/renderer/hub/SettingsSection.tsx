import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { Heading } from "@astryxdesign/core/Heading";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { VStack } from "@astryxdesign/core/VStack";
import {
  planAllows,
  SETTINGS_CLEANUP_LEVELS,
  SOUND_NAMES,
  type SettingsPatch,
  type SettingsView,
} from "@murmur/shared";
import { CommandModeSection } from "./CommandModeSection";
import { FocusSection } from "./FocusSection";
import { PlanField } from "./PlanField";
import { ExperimentalSection } from "./ExperimentalSection";
import { InstructSection } from "./InstructSection";
import { LanguagesField } from "./LanguagesField";
import { MouseButtonField } from "./MouseButtonField";
import { ShortcutField } from "./ShortcutField";
import { MicCheckSection } from "./MicCheckSection";
import { PermissionsSection } from "./PermissionsSection";
import { GeneralSection } from "./GeneralSection";
import type { SettingsPageId } from "./settings-pages";

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

/** One setting's row: search (HB-12) scrolls to it by its id. */
function Row({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div data-setting={id} className="hub-setting-row">
      {children}
    </div>
  );
}

/**
 * The settings on one Settings page (HB-12 to HB-21). Every change applies at once; nothing
 * needs a restart.
 */
export function SettingsSection({
  page,
  onRunSetup,
}: {
  page: SettingsPageId;
  onRunSetup: () => void;
}) {
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

  const pages: Record<SettingsPageId, () => ReactNode> = {
    general: () => (
      <>
        <GeneralSection
          openHubOnLaunch={settings.openHubOnLaunch}
          onOpenHubOnLaunch={(openHubOnLaunch) => update({ openHubOnLaunch })}
        />
        <Row id="permissions">
          <PermissionsSection />
        </Row>
        <Row id="setup">
          <section className="hub-permissions" aria-labelledby="setup-heading">
            <Heading level={2} id="setup-heading">
              Setup
            </Heading>
            <Text size="sm" color="secondary">
              Go through the first-run steps again: permissions, the speech model, the shortcut and
              a test dictation.
            </Text>
            <div>
              <Button variant="secondary" label="Run setup again" onClick={onRunSetup}>
                Run setup again
              </Button>
            </div>
          </section>
        </Row>
      </>
    ),
    system: () => (
      <>
        <Row id="cleanup">
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
        </Row>
        <Row id="press-enter">
          <Switch
            label="Say “press enter” to press Return"
            description="Only at the end of a dictation. The words are left out of the text."
            value={settings.pressEnterCommand}
            onChange={(pressEnterCommand) => update({ pressEnterCommand })}
          />
        </Row>
        <Row id="context">
          <Switch
            label="Use the text around the cursor"
            description="Helps spell names and terms already on screen. Read when dictation starts, kept only until the text is inserted, never saved. Password fields are never read."
            value={settings.contextAwareness}
            onChange={(contextAwareness) => update({ contextAwareness })}
          />
        </Row>
        <Row id="typing-reminder">
          <Switch
            label="Suggest dictating after a lot of typing"
            description="After more than 60 typed words in two minutes, at most once an hour. Only words are counted, never what you type."
            value={settings.typingReminder.enabled}
            onChange={(enabled) => update({ typingReminder: { enabled, snoozedUntil: null } })}
          />
        </Row>
        <Row id="sounds">
          <VStack gap={2}>
            <Heading level={3}>Sounds</Heading>
            {SOUND_NAMES.map((name) => (
              <Switch
                key={name}
                label={SOUND_LABELS[name]}
                value={settings.sounds[name]}
                onChange={(on) => update({ sounds: { ...settings.sounds, [name]: on } })}
              />
            ))}
          </VStack>
        </Row>
        <Row id="mute">
          <Switch
            label="Mute other audio while dictating"
            description="Silences the Mac's output while recording and turns it back on afterwards."
            value={settings.muteWhileDictating}
            onChange={(muteWhileDictating) => update({ muteWhileDictating })}
          />
        </Row>
        <Row id="instruct">
          <InstructSection view={view} onSaved={setView} update={update} />
        </Row>
      </>
    ),
    shortcuts: () => (
      <>
        <Row id="hold">
          <ShortcutField
            slot="hold"
            title="Push to talk"
            description="Hold to dictate, release to insert."
            label={view.shortcutLabels.hold}
            canClear={false}
            onSaved={setView}
          />
        </Row>
        <Row id="hands-free">
          <ShortcutField
            slot="handsFree"
            title="Hands-free"
            description="Start and stop dictation without holding a key."
            label={view.shortcutLabels.handsFree}
            canClear={settings.handsFreeShortcut !== null}
            onSaved={setView}
          />
        </Row>
        <Row id="rewrite">
          <ShortcutField
            slot="rewrite"
            title="Rewrite"
            description="Select text in any app, press this and pick a Rewrite."
            label={view.shortcutLabels.rewrite}
            canClear={settings.rewriteShortcut !== null}
            clear={{ label: "Turn off the Rewrite shortcut", text: "Turn off" }}
            onSaved={setView}
          />
        </Row>
        <Row id="mouse-hold">
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
        </Row>
        <Row id="mouse-hands-free">
          <MouseButtonField
            title="Hands-free (mouse)"
            description="Press an extra mouse button to start, and again to stop."
            button={settings.mouseButtons.handsFree}
            onChange={(handsFree) => {
              const hold =
                settings.mouseButtons.hold === handsFree ? null : settings.mouseButtons.hold;
              update({ mouseButtons: { hold, handsFree } });
            }}
          />
        </Row>
        <Text size="sm" color="secondary">
          The Instruct, Command Mode and Focus shortcuts are with their settings, on the System and
          Experimental pages. Each Rewrite&apos;s own shortcut is on the Rewrites page.
        </Text>
      </>
    ),
    languages: () => (
      <Row id="languages">
        <LanguagesField
          languages={settings.languages}
          onChange={(languages) => update({ languages })}
        />
      </Row>
    ),
    microphone: () => (
      <>
        <Row id="microphone">
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
        </Row>
        <Row id="whisper">
          <Switch
            label="Whisper mode"
            description="For very quiet speech: more gain, and softer sounds still count as speech. May pick up more background noise."
            value={settings.whisperMode}
            onChange={(whisperMode) => update({ whisperMode })}
          />
        </Row>
        <Row id="mic-check">
          <MicCheckSection />
        </Row>
      </>
    ),
    experimental: () => (
      <>
        <Row id="experimental">
          <ExperimentalSection
            experimental={settings.experimental}
            onChange={(experimental) => update({ experimental })}
            plan={settings.plan}
          />
        </Row>
        {settings.experimental.commandMode && planAllows(settings.plan, "commandMode") ? (
          <Row id="command-mode">
            <CommandModeSection view={view} onSaved={setView} update={update} />
          </Row>
        ) : null}
        {settings.experimental.focusMode && planAllows(settings.plan, "focusMode") ? (
          <Row id="focus-mode">
            <FocusSection view={view} onSaved={setView} />
          </Row>
        ) : null}
      </>
    ),
    plans: () => (
      <Row id="plan">
        <PlanField plan={settings.plan} onChange={(plan) => update({ plan })} />
      </Row>
    ),
    privacy: () => (
      <Row id="privacy">
        <section className="hub-permissions" aria-labelledby="privacy-heading">
          <VStack gap={2}>
            <Heading level={3} id="privacy-heading">
              What leaves this Mac
            </Heading>
            <Text>Nothing leaves this Mac.</Text>
            <Text size="sm" color="secondary">
              The one exception is a model download that you start, during setup or from these
              pages. Dictation, cleanup, Rewrites and everything you save stay on this Mac.
            </Text>
          </VStack>
        </section>
      </Row>
    ),
  };

  return (
    <VStack gap={4} className="hub-settings">
      {pages[page]()}
      {problem ? <Banner status="error" title={problem} /> : null}
    </VStack>
  );
}
