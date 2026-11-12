import { useEffect, useRef, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Kbd } from "@astryxdesign/core/Kbd";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { SettingsView, ShortcutSlot } from "@murmur/shared";
import { ShortcutCapture } from "./shortcut-capture";

interface ShortcutFieldProps {
  slot: ShortcutSlot;
  title: string;
  description: string;
  label: string;
  /** Hands-free can go back to the double tap; the Rewrite shortcut can be turned off. */
  canClear: boolean;
  /** What clearing does, as a button: accessible label and visible text. */
  clear?: { label: string; text: string };
  onSaved: (view: SettingsView) => void;
}

/** Shows a shortcut and records a new one from the keyboard. */
export function ShortcutField({
  slot,
  title,
  description,
  label,
  canClear,
  clear: clearButton = { label: "Use a double tap for hands-free", text: "Use double tap" },
  onSaved,
}: ShortcutFieldProps) {
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const capture = useRef(new ShortcutCapture());

  useEffect(() => {
    if (!recording) return;
    void window.murmur.captureShortcut(true);
    const finish = (key: Parameters<typeof window.murmur.setShortcut>[1] | undefined) => {
      setRecording(false);
      void window.murmur.captureShortcut(false);
      if (key === undefined) return;
      window.murmur.setShortcut(slot, key).then(
        (result) => {
          if (result.ok) {
            setMessage(null);
            onSaved(result.view);
          } else setMessage(result.message);
        },
        () => setMessage("The shortcut could not be saved."),
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      const step = capture.current.keyDown(event);
      if (step.kind === "cancel") finish(undefined);
      if (step.kind === "done") finish(step.key);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      const step = capture.current.keyUp(event);
      if (step.kind === "done") finish(step.key);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [recording, slot, onSaved]);

  const clear = () => {
    window.murmur.setShortcut(slot, null).then(
      (result) => (result.ok ? onSaved(result.view) : setMessage(result.message)),
      () => setMessage("The shortcut could not be saved."),
    );
  };

  return (
    <VStack gap={1}>
      <HStack gap={3} align="center" justify="between">
        <VStack gap={0}>
          <Text weight="semibold">{title}</Text>
          <Text size="sm" color="secondary">
            {description}
          </Text>
        </VStack>
        <HStack gap={2} align="center">
          {recording ? (
            <Text size="sm" data-testid={`${slot}-recording`}>
              Press the new shortcut (Escape cancels)
            </Text>
          ) : (
            <Kbd keys={label} data-testid={`${slot}-label`} />
          )}
          <Button
            size="sm"
            variant="secondary"
            label={`Change the ${title} shortcut`}
            isDisabled={recording}
            onClick={() => setRecording(true)}
          >
            Change
          </Button>
          {canClear && !recording ? (
            <Button size="sm" variant="ghost" label={clearButton.label} onClick={clear}>
              {clearButton.text}
            </Button>
          ) : null}
        </HStack>
      </HStack>
      {message ? <Banner status="error" title={message} /> : null}
    </VStack>
  );
}
