import { Heading } from "@astryxdesign/core/Heading";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { Switch } from "@astryxdesign/core/Switch";
import { VStack } from "@astryxdesign/core/VStack";
import { lockedText, planAllows, type SettingsPatch, type SettingsView } from "@murmur/shared";
import { Models } from "./ModelRow";
import { ShortcutField } from "./ShortcutField";

interface InstructSectionProps {
  view: SettingsView;
  onSaved: (view: SettingsView) => void;
  update: (patch: SettingsPatch) => void;
}

/** Instruct Mode's key and the context it may use (RW-11, RW-17). */
export function InstructSection({ view, onSaved, update }: InstructSectionProps) {
  const options = view.settings.instruct;
  const set = (patch: Partial<SettingsView["settings"]["instruct"]>) =>
    update({ instruct: { ...options, ...patch } });
  return (
    <section className="hub-permissions" aria-labelledby="instruct-heading">
      <VStack gap={3}>
        <Heading level={2} id="instruct-heading">
          Instruct Mode
        </Heading>
        <ShortcutField
          slot="instruct"
          title="Instruct"
          description="Hold, say what you want written, and let go. The draft appears in a panel near the Bar to insert or copy. Murmur only drafts: it never sends or schedules anything."
          label={view.shortcutLabels.instruct}
          canClear={view.settings.instructShortcut !== null}
          clear={{ label: "Turn off the Instruct key", text: "Turn off" }}
          onSaved={onSaved}
        />
        <Selector
          label="Model"
          description="For new threads. The panel can switch for the next request. Quality is used once it is downloaded."
          value={options.model}
          options={[
            { value: "fast", label: "Fast: the cleanup model" },
            { value: "quality", label: "Quality: a larger model" },
          ]}
          onChange={(model) => set({ model: model === "quality" ? "quality" : "fast" })}
        />
        {planAllows(view.settings.plan, "qualityModel") ? null : (
          <Text size="sm" color="secondary">
            Quality: {lockedText()}
          </Text>
        )}
        <Models only="quality" />
        <Switch
          label="Use the field's text"
          description={
            view.settings.contextAwareness
              ? "The text around the caret helps the draft fit, for example the message you are replying to."
              : "Needs context awareness, which is off."
          }
          value={options.fieldContext && view.settings.contextAwareness}
          isDisabled={!view.settings.contextAwareness}
          onChange={(fieldContext) => set({ fieldContext })}
        />
        <Switch
          label="Use Memory"
          description="Facts you saved in Memory that match the request."
          value={options.memory}
          onChange={(memory) => set({ memory })}
        />
        <Switch
          label="Use writing samples"
          description="Your own writing as a guide to tone, in email apps."
          value={options.samples}
          onChange={(samples) => set({ samples })}
        />
      </VStack>
    </section>
  );
}
