import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { Switch } from "@astryxdesign/core/Switch";
import { VStack } from "@astryxdesign/core/VStack";
import type { InstructModelStatus, SettingsPatch, SettingsView } from "@murmur/shared";
import { ShortcutField } from "./ShortcutField";

interface InstructSectionProps {
  view: SettingsView;
  onSaved: (view: SettingsView) => void;
  update: (patch: SettingsPatch) => void;
}

/** Instruct Mode's key and the context it may use (RW-11, RW-17). */
/** "5.0 GB" */
export function gigabytes(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/** The Quality model (RW-15): download it when asked, follow the progress, remove it. */
function QualityModelField() {
  const [status, setStatus] = useState<InstructModelStatus | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    let active = true;
    const read = () =>
      window.murmur.instructModelStatus().then(
        (next) => active && setStatus(next),
        () => {},
      );
    void read();
    // Follow a download while the page is open.
    const timer = window.setInterval(() => {
      if (status?.state === "downloading") void read();
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [status?.state]);
  if (!status) return null;
  const size = gigabytes(status.totalBytes);
  return (
    <VStack gap={1}>
      <Text weight="semibold">Quality model</Text>
      <Text size="sm" color="secondary">
        {status.label}, {size}. Slower than Fast but writes better drafts. Stays on this Mac.
      </Text>
      {status.state === "downloading" ? (
        <ProgressBar
          label="Quality model download"
          value={Math.round((status.doneBytes / status.totalBytes) * 100)}
          max={100}
        />
      ) : null}
      {status.message ? (
        <Text size="sm" role="status">
          {status.message}
        </Text>
      ) : null}
      <HStack gap={2}>
        {status.state === "missing" || status.state === "failed" ? (
          <Button
            size="sm"
            variant="secondary"
            label={`Download the Quality model (${size})`}
            onClick={() => void window.murmur.instructModelDownload().then(setStatus)}
          >
            {status.state === "failed" ? "Try again" : `Download (${size})`}
          </Button>
        ) : null}
        {status.state === "ready" ? (
          confirmRemove ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                label="Delete the Quality model files"
                onClick={() =>
                  void window.murmur.instructModelRemove().then((next) => {
                    setConfirmRemove(false);
                    setStatus(next);
                  })
                }
              >
                Remove {size}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                label="Keep the Quality model"
                onClick={() => setConfirmRemove(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              label="Remove the Quality model"
              onClick={() => setConfirmRemove(true)}
            >
              Remove…
            </Button>
          )
        ) : null}
      </HStack>
    </VStack>
  );
}

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
        <QualityModelField />
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
