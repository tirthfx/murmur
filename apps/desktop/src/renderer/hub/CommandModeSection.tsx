import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  COMMAND_WAKE_PHRASE_LIMITS,
  COMMANDS,
  settingsSchema,
  type SettingsPatch,
  type SettingsView,
} from "@murmur/shared";
import { ShortcutField } from "./ShortcutField";

interface CommandModeSectionProps {
  view: SettingsView;
  onSaved: (view: SettingsView) => void;
  update: (patch: SettingsPatch) => void;
}

const wakePhraseSchema = settingsSchema.shape.commandMode.shape.wakePhrase;

/** Command Mode's key, wake phrase and the commands it knows (RW-08, RW-09). */
export function CommandModeSection({ view, onSaved, update }: CommandModeSectionProps) {
  const options = view.settings.commandMode;
  const [phrase, setPhrase] = useState(options.wakePhrase);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => setPhrase(options.wakePhrase), [options.wakePhrase]);

  const savePhrase = () => {
    const checked = wakePhraseSchema.safeParse(phrase);
    if (!checked.success) {
      setProblem(
        `Use ${COMMAND_WAKE_PHRASE_LIMITS.min} to ${COMMAND_WAKE_PHRASE_LIMITS.max} letters, numbers and spaces.`,
      );
      return;
    }
    setProblem(null);
    update({ commandMode: { ...options, wakePhrase: checked.data } });
  };

  return (
    <section className="hub-permissions" aria-labelledby="command-mode-heading">
      <VStack gap={3}>
        <Heading level={2} id="command-mode-heading">
          Command Mode
        </Heading>
        <ShortcutField
          slot="command"
          title="Command Mode key"
          description="Select text, hold this key on its own, say a command and let go. Pressed together with another key it does nothing, so Command shortcuts work as before."
          label={view.shortcutLabels.command}
          canClear={view.settings.commandShortcut !== null}
          clear={{ label: "Turn off the Command Mode key", text: "Turn off" }}
          onSaved={onSaved}
        />
        <Switch
          label="Wake phrase"
          description="Start a dictation with the wake phrase and the rest is taken as a command instead of text."
          value={options.wakePhraseEnabled}
          onChange={(wakePhraseEnabled) =>
            update({ commandMode: { ...options, wakePhraseEnabled } })
          }
        />
        {options.wakePhraseEnabled ? (
          <HStack gap={2} align="end">
            <TextInput
              label="Wake phrase"
              value={phrase}
              onChange={setPhrase}
              onEnter={savePhrase}
              {...(problem ? { status: { type: "error" as const, message: problem } } : {})}
            />
            <Button
              size="sm"
              variant="secondary"
              label="Save the wake phrase"
              isDisabled={phrase.trim() === options.wakePhrase}
              onClick={savePhrase}
            >
              Save
            </Button>
          </HStack>
        ) : null}
        <VStack gap={1}>
          <Text weight="semibold">Commands</Text>
          <Text size="sm" color="secondary">
            Say one of these, or something close. Raw speech is never typed in Command Mode.
          </Text>
          <ul className="hub-dictionary-list" aria-label="Commands">
            {COMMANDS.map((command) => (
              <li key={command.id}>
                <Text size="sm" weight="semibold">
                  {command.label}
                </Text>{" "}
                <Text size="sm" color="secondary">
                  “{command.phrases[0]}”, “{command.phrases[1]}”
                </Text>
              </li>
            ))}
          </ul>
        </VStack>
      </VStack>
    </section>
  );
}
