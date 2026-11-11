import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { buttonFromBrowser, mouseButtonLabel } from "./mouse-buttons";

interface MouseButtonFieldProps {
  title: string;
  description: string;
  button: number | null;
  /** Saves the new button, or null to clear it. */
  onChange: (button: number | null) => void;
}

/** Shows a mouse binding and records a new one by pressing the button in this window. */
export function MouseButtonField({ title, description, button, onChange }: MouseButtonFieldProps) {
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    // The old bindings must not start a dictation while the new button is pressed.
    void window.murmur.captureShortcut(true);
    const finish = () => {
      setRecording(false);
      void window.murmur.captureShortcut(false);
    };
    const onMouseDown = (event: MouseEvent) => {
      const chosen = buttonFromBrowser(event.button);
      if (chosen === null) {
        // Left and right clicks still work normally, including on Cancel.
        if (event.button === 2) setMessage("Left and right buttons cannot be used.");
        return;
      }
      event.preventDefault();
      setMessage(null);
      finish();
      onChange(chosen);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
    };
    const blockMenu = (event: Event) => event.preventDefault();
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("auxclick", blockMenu, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("auxclick", blockMenu, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [recording, onChange]);

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
          <Text size="sm" data-testid={`${title}-mouse`}>
            {recording ? "Press the mouse button (Escape cancels)" : mouseButtonLabel(button)}
          </Text>
          <Button
            size="sm"
            variant="secondary"
            label={`Set the ${title} mouse button`}
            isDisabled={recording}
            onClick={() => setRecording(true)}
          >
            Set
          </Button>
          {button !== null && !recording ? (
            <Button
              size="sm"
              variant="ghost"
              label={`Clear the ${title} mouse button`}
              onClick={() => onChange(null)}
            >
              Clear
            </Button>
          ) : null}
        </HStack>
      </HStack>
      {message ? (
        <Text size="sm" color="secondary" role="status">
          {message}
        </Text>
      ) : null}
    </VStack>
  );
}
