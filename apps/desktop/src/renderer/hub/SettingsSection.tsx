import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { VStack } from "@astryxdesign/core/VStack";
import {
  planAllows,
  CONSENT_NOTICES,
  DEFAULT_MEETING_MATCHERS,
  MEETING_LANGUAGES,
  type ConsentNotice,
  APP_LANGUAGES,
  APP_LANGUAGE_NAMES,
  SETTINGS_CLEANUP_LEVELS,
  SOUND_NAMES,
  type MeetingFolder,
  type Skill,
  type SettingsPatch,
  type SettingsView,
} from "@murmur/shared";
import { CommandModeSection } from "./CommandModeSection";
import { FocusSection } from "./FocusSection";
import { PlansSection } from "./PlansSection";
import { ExperimentalSection } from "./ExperimentalSection";
import { InstructSection } from "./InstructSection";
import { LanguagesField } from "./LanguagesField";
import { MouseButtonField } from "./MouseButtonField";
import { ShortcutField } from "./ShortcutField";
import { MicCheckSection } from "./MicCheckSection";
import { PermissionsSection } from "./PermissionsSection";
import { GeneralSection } from "./GeneralSection";
import { DataPrivacySection } from "./DataPrivacySection";
import { TestingSection } from "./TestingSection";
import { ExportDeleteSection } from "./ExportDeleteSection";
import type { SettingsPageId } from "./settings-pages";

const CONSENT_LABELS: Record<ConsentNotice, string> = {
  first: "The first time only",
  always: "Before every recording",
  off: "Never",
};

const SOUND_LABELS: Record<(typeof SOUND_NAMES)[number], string> = {
  start: "Start sound",
  lock: "Hands-free sound",
  success: "Done sound",
  error: "Error sound",
  cancel: "Cancel sound",
};

const NOTIFICATION_SWITCHES: [keyof SettingsView["settings"]["notifications"], string][] = [
  ["dictationFailed", "A dictation did not go in"],
  ["modelDownload", "The speech model finished or failed to download"],
  ["focusEnded", "Focus Mode ended"],
  ["milestone", "A milestone was reached"],
  ["weeklySummary", "Weekly summary of words and streak"],
];

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
  onView,
}: {
  page: SettingsPageId;
  onRunSetup: () => void;
  /** Told each time the settings are read or saved (the page list follows developer mode). */
  onView?: (view: SettingsView) => void;
}) {
  const [view, setViewState] = useState<SettingsView | null>(null);
  const setView = useCallback(
    (next: SettingsView) => {
      setViewState(next);
      onView?.(next);
    },
    [onView],
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [folders, setFolders] = useState<MeetingFolder[]>([]);
  useEffect(() => {
    void window.murmur.foldersList().then(setFolders);
  }, []);
  useEffect(() => {
    let alive = true;
    void window.murmur.skillsList().then((list) => alive && setSkills(list));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    window.murmur.getSettings().then(
      (value) => active && setView(value),
      () => active && setProblem("Settings could not be read."),
    );
    return () => {
      active = false;
    };
  }, [setView]);

  const update = useCallback(
    (patch: SettingsPatch) => {
      window.murmur
        .updateSettings(patch)
        .then(setView, () => setProblem("The setting could not be saved."));
    },
    [setView],
  );

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
    testing: () => <TestingSection settings={settings} update={update} onRunSetup={onRunSetup} />,
    general: () => (
      <>
        <GeneralSection
          openHubOnLaunch={settings.openHubOnLaunch}
          onOpenHubOnLaunch={(openHubOnLaunch) => update({ openHubOnLaunch })}
          profile={settings.profile}
          onProfile={(profile) => update({ profile })}
          theme={settings.theme}
          onTheme={(theme) => update({ theme })}
          developerMode={settings.devMode.enabled}
          onDeveloperMode={() => update({ devMode: { ...settings.devMode, enabled: true } })}
        />
        <Row id="app-language">
          <Selector
            label="App language"
            description="The language of Murmur's own text. More languages can come later; dictation languages are separate."
            options={APP_LANGUAGES.map((code) => ({
              value: code,
              label: APP_LANGUAGE_NAMES[code],
            }))}
            value={settings.language}
            onChange={(language) => update({ language: language as typeof settings.language })}
          />
        </Row>
        <Row id="notifications">
          <VStack gap={2}>
            <Heading level={3}>Notifications</Heading>
            <Text size="sm" color="secondary">
              macOS notifications. They never show what you dictated; clicking one opens the Hub.
              macOS asks once for permission the first time one is shown.
            </Text>
            {NOTIFICATION_SWITCHES.map(([key, label]) => (
              <Switch
                key={key}
                label={label}
                value={settings.notifications[key]}
                onChange={(on) =>
                  update({ notifications: { ...settings.notifications, [key]: on } })
                }
              />
            ))}
          </VStack>
        </Row>
        <Row id="referral">
          <VStack gap={2}>
            <Heading level={3}>Referrals</Heading>
            <Text size="sm" color="secondary">
              Referral rewards are not available in Murmur. The code is made on this Mac and the
              count is kept by hand; nothing is sent and no one is told.
            </Text>
            <Text weight="semibold" data-testid="referral-code">
              Your code: {settings.referral.code || "…"}
            </Text>
            <HStack gap={2} align="center">
              <Text>Invitations: {settings.referral.invites}</Text>
              <Button
                size="sm"
                variant="ghost"
                label="One invitation fewer"
                isDisabled={settings.referral.invites === 0}
                onClick={() =>
                  update({
                    referral: { ...settings.referral, invites: settings.referral.invites - 1 },
                  })
                }
              >
                −
              </Button>
              <Button
                size="sm"
                variant="ghost"
                label="One invitation more"
                onClick={() =>
                  update({
                    referral: { ...settings.referral, invites: settings.referral.invites + 1 },
                  })
                }
              >
                +
              </Button>
            </HStack>
          </VStack>
        </Row>
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
        <Row id="scratchpad">
          <VStack gap={2}>
            <Switch
              label="Scratchpad"
              description="Notes in their own window. When off, its page and shortcut are hidden; notes are kept."
              value={settings.scratchpad.enabled}
              onChange={(enabled) => update({ scratchpad: { ...settings.scratchpad, enabled } })}
            />
            <Switch
              label="Open notes in a new tab"
              description="When off, a note replaces the one shown."
              value={settings.scratchpad.newTab}
              isDisabled={!settings.scratchpad.enabled}
              onChange={(newTab) => update({ scratchpad: { ...settings.scratchpad, newTab } })}
            />
          </VStack>
        </Row>
        <Row id="meeting-notice">
          <VStack gap={2}>
            <Selector
              label="Recording notice"
              options={CONSENT_NOTICES.map((value) => ({
                value,
                label: CONSENT_LABELS[value],
              }))}
              value={settings.notetaker.consent.notice}
              onChange={(notice) =>
                update({
                  notetaker: {
                    ...settings.notetaker,
                    consent: { ...settings.notetaker.consent, notice: notice as ConsentNotice },
                  },
                })
              }
            />
            <Text size="sm" color="secondary">
              A reminder to tell the other people when you record a meeting. With “Before every
              recording”, nothing is recorded until you press OK. The red recording dot is always
              shown. Murmur does not give legal advice.
            </Text>
          </VStack>
        </Row>
        <Row id="meeting-detect">
          <VStack gap={2}>
            <Heading level={3}>Meeting detection</Heading>
            <Text size="sm" color="secondary">
              Looks for a call in Zoom, Google Meet and Microsoft Teams and asks if you want to
              record it. Only the call apps are looked at, only on this Mac, and nothing is recorded
              until you say so (unless you turn on the switch below). Reading a browser tab needs
              the Accessibility permission.
            </Text>
            <Switch
              label="Detect meetings"
              value={settings.notetaker.detect.enabled}
              onChange={(enabled) =>
                update({
                  notetaker: {
                    ...settings.notetaker,
                    detect: { ...settings.notetaker.detect, enabled },
                  },
                })
              }
            />
            {DEFAULT_MEETING_MATCHERS.map((matcher) => (
              <Switch
                key={matcher.id}
                label={matcher.name}
                value={settings.notetaker.detect.apps[matcher.id] !== false}
                isDisabled={!settings.notetaker.detect.enabled}
                onChange={(on) =>
                  update({
                    notetaker: {
                      ...settings.notetaker,
                      detect: {
                        ...settings.notetaker.detect,
                        apps: { ...settings.notetaker.detect.apps, [matcher.id]: on },
                      },
                    },
                  })
                }
              />
            ))}
            <Switch
              label="Record detected meetings without asking"
              description="Recording starts when a call is detected. The recording notice still applies."
              value={settings.notetaker.detect.autoRecord}
              isDisabled={!settings.notetaker.detect.enabled}
              onChange={(autoRecord) =>
                update({
                  notetaker: {
                    ...settings.notetaker,
                    detect: { ...settings.notetaker.detect, autoRecord },
                  },
                })
              }
            />
            {settings.notetaker.detect.neverApps.map((id) => (
              <HStack key={id} gap={2}>
                <Text size="sm">
                  Never asked for{" "}
                  {DEFAULT_MEETING_MATCHERS.find((matcher) => matcher.id === id)?.name ?? id}
                </Text>
                <Button
                  variant="secondary"
                  size="sm"
                  label={`Ask again for ${id}`}
                  onClick={() =>
                    update({
                      notetaker: {
                        ...settings.notetaker,
                        detect: {
                          ...settings.notetaker.detect,
                          neverApps: settings.notetaker.detect.neverApps.filter(
                            (other) => other !== id,
                          ),
                        },
                      },
                    })
                  }
                >
                  Ask again
                </Button>
              </HStack>
            ))}
          </VStack>
        </Row>
        <Row id="meeting-summary">
          <VStack gap={2}>
            <Heading level={3}>Meeting summaries</Heading>
            <Text size="sm" color="secondary">
              A summary is written on this Mac with the local language model when a recording has
              been transcribed. Every bullet links to the line it came from, or says it has no
              source.
            </Text>
            <Switch
              label="Write a summary after each meeting"
              value={settings.notetaker.summary.auto}
              onChange={(auto) =>
                update({
                  notetaker: {
                    ...settings.notetaker,
                    summary: { ...settings.notetaker.summary, auto },
                  },
                })
              }
            />
            <Selector
              label="Length"
              options={[
                { value: "short", label: "Short" },
                { value: "medium", label: "Medium" },
                { value: "long", label: "Long" },
              ]}
              value={settings.notetaker.summary.length}
              onChange={(length) =>
                update({
                  notetaker: {
                    ...settings.notetaker,
                    summary: {
                      ...settings.notetaker.summary,
                      length: length as SettingsView["settings"]["notetaker"]["summary"]["length"],
                    },
                  },
                })
              }
            />
            <Selector
              label="Skill for summaries"
              options={skills.map((skill) => ({ value: skill.id, label: skill.name }))}
              value={settings.notetaker.skills.default}
              onChange={(value) =>
                update({ notetaker: { ...settings.notetaker, skills: { default: value } } })
              }
            />
          </VStack>
        </Row>
        <Row id="meeting-tasks">
          <VStack gap={2}>
            <Heading level={3}>Tasks from meetings</Heading>
            <Text size="sm" color="secondary">
              After the summary, the local language model suggests tasks. They wait in My Tasks as
              Suggested until you accept them; none is ever accepted for you.
            </Text>
            <Switch
              label="Suggest tasks after each meeting"
              value={settings.notetaker.tasks.extract}
              onChange={(extract) =>
                update({
                  notetaker: {
                    ...settings.notetaker,
                    tasks: { ...settings.notetaker.tasks, extract },
                  },
                })
              }
            />
            <Selector
              label="My Tasks shows"
              options={[
                { value: "me-or-named", label: "Tasks for me or for a named person" },
                { value: "all", label: "All tasks, including ones nobody was named for" },
              ]}
              value={settings.notetaker.tasks.ownerRule}
              onChange={(ownerRule) =>
                update({
                  notetaker: {
                    ...settings.notetaker,
                    tasks: {
                      ...settings.notetaker.tasks,
                      ownerRule:
                        ownerRule as SettingsView["settings"]["notetaker"]["tasks"]["ownerRule"],
                    },
                  },
                })
              }
            />
          </VStack>
        </Row>
        <Row id="meeting-ask">
          <VStack gap={2}>
            <Heading level={3}>Ask across meetings</Heading>
            <Text size="sm" color="secondary">
              Questions are answered on this Mac from your own meetings only, and every answer cites
              its sources. If the meetings do not say, Ask says so.
            </Text>
            <Selector
              label="A new question looks in"
              options={[
                { value: "all", label: "All meetings" },
                { value: "week", label: "The last 7 days" },
                { value: "month", label: "The last 30 days" },
              ]}
              value={settings.notetaker.ask.defaultScope}
              onChange={(defaultScope) =>
                update({
                  notetaker: {
                    ...settings.notetaker,
                    ask: {
                      ...settings.notetaker.ask,
                      defaultScope:
                        defaultScope as SettingsView["settings"]["notetaker"]["ask"]["defaultScope"],
                    },
                  },
                })
              }
            />
            <Switch
              label="Look in my own notes too"
              value={settings.notetaker.ask.includeNotes}
              onChange={(includeNotes) =>
                update({
                  notetaker: {
                    ...settings.notetaker,
                    ask: { ...settings.notetaker.ask, includeNotes },
                  },
                })
              }
            />
          </VStack>
        </Row>
        <Row id="meeting-folders">
          <VStack gap={2}>
            <Heading level={3}>Meeting folders</Heading>
            <Text size="sm" color="secondary">
              Folders are made and managed on the Notetaker page. A meeting in no folder is in the
              Inbox, and deleting a folder never deletes its meetings.
            </Text>
            <Selector
              label="A new meeting goes to"
              options={[
                { value: "inbox", label: "The Inbox" },
                ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
              ]}
              value={settings.notetaker.folders.defaultFolder}
              onChange={(defaultFolder) =>
                update({
                  notetaker: {
                    ...settings.notetaker,
                    folders: { ...settings.notetaker.folders, defaultFolder },
                  },
                })
              }
            />
            <Switch
              label="Suggest a folder for a meeting in the Inbox"
              description="From its title and where earlier meetings went. Nothing is moved without a click."
              value={settings.notetaker.folders.suggest}
              onChange={(suggest) =>
                update({
                  notetaker: {
                    ...settings.notetaker,
                    folders: { ...settings.notetaker.folders, suggest },
                  },
                })
              }
            />
          </VStack>
        </Row>
        <Row id="meeting-language">
          <VStack gap={2}>
            <Heading level={3}>Meeting languages</Heading>
            <Text size="sm" color="secondary">
              A new meeting starts with these. Each meeting can be changed on its Transcript tab,
              and a finished meeting is then transcribed again from its saved audio.
            </Text>
            <Selector
              label="A new meeting is transcribed in"
              options={[
                { value: "auto", label: "Detect automatically" },
                ...MEETING_LANGUAGES.map((item) => ({ value: item.code, label: item.label })),
              ]}
              value={settings.notetaker.language.default}
              onChange={(value) =>
                update({
                  notetaker: {
                    ...settings.notetaker,
                    language: {
                      default:
                        value as SettingsView["settings"]["notetaker"]["language"]["default"],
                    },
                  },
                })
              }
            />
            <Switch
              label="Write new transcripts in English"
              description="Uses the speech model's translate task. The transcript only: a summary has its own language."
              value={settings.notetaker.translate.transcriptToEnglish}
              onChange={(transcriptToEnglish) =>
                update({
                  notetaker: { ...settings.notetaker, translate: { transcriptToEnglish } },
                })
              }
            />
            <Selector
              label="Summaries are written in"
              options={[
                { value: "meeting", label: "The language of the meeting" },
                ...MEETING_LANGUAGES.map((item) => ({ value: item.code, label: item.label })),
              ]}
              value={settings.notetaker.summary.language}
              onChange={(value) =>
                update({
                  notetaker: {
                    ...settings.notetaker,
                    summary: {
                      ...settings.notetaker.summary,
                      language:
                        value as SettingsView["settings"]["notetaker"]["summary"]["language"],
                    },
                  },
                })
              }
            />
            <Selector
              label="Keep a transcript that was transcribed again for"
              options={[
                { value: "7", label: "7 days" },
                { value: "30", label: "30 days" },
                { value: "90", label: "90 days" },
                { value: "365", label: "A year" },
              ]}
              value={String(settings.notetaker.rerun.keepPreviousVersionDays)}
              onChange={(value) =>
                update({
                  notetaker: {
                    ...settings.notetaker,
                    rerun: { keepPreviousVersionDays: Number(value) },
                  },
                })
              }
            />
          </VStack>
        </Row>
        <Row id="meeting-corrections">
          <VStack gap={2}>
            <Heading level={3}>Transcript corrections</Heading>
            <Text size="sm" color="secondary">
              Fix a line, its speaker, or split or join lines on the Transcript tab. The original is
              kept until you take the change back. Summaries and Ask use the corrected words.
            </Text>
            <Switch
              label="Offer words I change again and again to the Dictionary"
              description="They are added for you to review on the Dictionary page. Needs “Learn from my corrections” in Personalization."
              value={settings.notetaker.corrections.suggestDictionary}
              onChange={(suggestDictionary) =>
                update({
                  notetaker: {
                    ...settings.notetaker,
                    corrections: { ...settings.notetaker.corrections, suggestDictionary },
                  },
                })
              }
            />
          </VStack>
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
        <Row id="scratchpad-shortcut">
          <ShortcutField
            slot="scratchpad"
            title="Scratchpad"
            description="Opens the Scratchpad window."
            label={view.shortcutLabels.scratchpad}
            canClear={settings.scratchpadShortcut !== null}
            clear={{ label: "Turn off the Scratchpad shortcut", text: "Turn off" }}
            onSaved={setView}
          />
        </Row>
        <Row id="meeting-shortcut">
          <ShortcutField
            slot="meeting"
            title="Meeting recording"
            description="Starts recording a meeting. Press it again to stop."
            label={view.shortcutLabels.meeting}
            canClear={settings.meetingShortcut !== null}
            clear={{ label: "Turn off the meeting recording shortcut", text: "Turn off" }}
            onSaved={setView}
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
        <PlansSection tier={settings.plan} onTier={(plan) => update({ plan })} />
      </Row>
    ),
    privacy: () => (
      <>
        <DataPrivacySection settings={settings} update={update} />
        <ExportDeleteSection />
      </>
    ),
  };

  return (
    <VStack gap={4} className="hub-settings">
      {pages[page]()}
      {problem ? <Banner status="error" title={problem} /> : null}
    </VStack>
  );
}
