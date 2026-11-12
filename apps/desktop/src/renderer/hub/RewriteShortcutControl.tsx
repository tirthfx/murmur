import { useEffect, useRef, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Kbd } from "@astryxdesign/core/Kbd";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { CapturedKey, Rewrite } from "@murmur/shared";
import { ShortcutCapture } from "./shortcut-capture";

/**
 * A Rewrite's own shortcut (RW-04): record, change or remove it, and choose whether it
 * replaces the text at once or shows the result first.
 */
export function RewriteShortcutControl({
  rewrite,
  onChanged,
}: {
  rewrite: Rewrite;
  onChanged: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const capture = useRef(new ShortcutCapture());

  const save = (key: CapturedKey | null) =>
    window.murmur.rewritesSetShortcut(rewrite.id, key).then(
      (result) => {
        if (result.ok) {
          setMessage(null);
          onChanged();
        } else setMessage(result.message);
      },
      () => setMessage("The shortcut could not be saved."),
    );

  useEffect(() => {
    if (!recording) return;
    // While recording, no shortcut runs, so pressing an existing one does not act.
    void window.murmur.captureShortcut(true);
    const finish = (key: CapturedKey | undefined) => {
      setRecording(false);
      void window.murmur.captureShortcut(false);
      if (key !== undefined) void save(key);
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
  }, [recording, rewrite.id]);

  return (
    <VStack gap={1}>
      <HStack gap={2} align="center" wrap="wrap">
        {recording ? (
          <Text size="sm">Press the new shortcut (Escape cancels)</Text>
        ) : rewrite.shortcutLabel ? (
          <Kbd keys={rewrite.shortcutLabel} />
        ) : (
          <Text size="sm" color="secondary">
            No shortcut
          </Text>
        )}
        <Button
          size="sm"
          variant="ghost"
          label={`${rewrite.shortcut ? "Change" : "Set"} the shortcut for ${rewrite.name}`}
          isDisabled={recording}
          onClick={() => setRecording(true)}
        >
          {rewrite.shortcut ? "Change shortcut" : "Set shortcut"}
        </Button>
        {rewrite.shortcut && !recording ? (
          <Button
            size="sm"
            variant="ghost"
            label={`Remove the shortcut for ${rewrite.name}`}
            onClick={() => void save(null)}
          >
            Remove
          </Button>
        ) : null}
        {rewrite.shortcut ? (
          <Switch
            label="Apply directly"
            description="Replace the text at once; off shows the result first."
            value={rewrite.applyDirectly}
            onChange={async (applyDirectly) => {
              await window.murmur.rewritesSetApplyDirectly(rewrite.id, applyDirectly);
              onChanged();
            }}
          />
        ) : null}
      </HStack>
      {message ? <Banner status="error" title={message} /> : null}
    </VStack>
  );
}
