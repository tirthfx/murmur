import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { SettingsView } from "@murmur/shared";

type Experimental = SettingsView["settings"]["experimental"];

interface ExperimentalSectionProps {
  experimental: Experimental;
  onChange: (experimental: Experimental) => void;
}

/** How long "Search for ring" runs (DC-15). */
export const RING_SEARCH_SECONDS = 30;

/**
 * Options that are still being tried out (HB-18). All are off by default. Nothing here asks
 * macOS for a new permission.
 */
export function ExperimentalSection({ experimental, onChange }: ExperimentalSectionProps) {
  const [mediaAvailable, setMediaAvailable] = useState<boolean | null>(null);
  const [searchLeft, setSearchLeft] = useState<number | null>(null);
  const [searchDone, setSearchDone] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    window.murmur.getMediaPlayback().then(
      (playback) => active && setMediaAvailable(playback?.available ?? false),
      () => active && setMediaAvailable(false),
    );
    return () => {
      active = false;
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, []);

  const set = (patch: Partial<Experimental>) => onChange({ ...experimental, ...patch });

  const search = () => {
    setSearchDone(false);
    setSearchLeft(RING_SEARCH_SECONDS);
    timer.current = window.setInterval(() => {
      setSearchLeft((left) => {
        if (left === null || left <= 1) {
          if (timer.current !== null) window.clearInterval(timer.current);
          timer.current = null;
          setSearchDone(true);
          return null;
        }
        return left - 1;
      });
    }, 1000);
  };

  return (
    <section className="hub-permissions" aria-labelledby="experimental-heading">
      <Heading level={2} id="experimental-heading">
        Experimental
      </Heading>
      <Text size="sm" color="secondary">
        Still being tried out. They may change or go away.
      </Text>
      <VStack gap={3}>
        <Switch
          label="Split into messages"
          description="In chat apps: a pause of two seconds or more starts a new message, and each message is sent with Return. Only for apps where Return sends."
          value={experimental.splitMessages}
          onChange={(splitMessages) => set({ splitMessages })}
        />
        <Switch
          label="Pause media while dictating"
          description={
            mediaAvailable === false
              ? "Not available on this Mac: the system does not tell Murmur what is playing."
              : "Pauses music or video when dictation starts and resumes it afterwards, but only what Murmur paused."
          }
          value={experimental.pauseMedia && mediaAvailable !== false}
          isDisabled={mediaAvailable === false}
          onChange={(pauseMedia) => set({ pauseMedia })}
        />
        <Switch
          label="Switch microphone when a headset is put on"
          description="No connected headset reports whether it is worn, and Murmur does not support any yet."
          value={false}
          isDisabled
          onChange={() => {}}
        />
        <Switch
          label="Import from a file"
          description="Adds an import section to the Dictionary and Snippets pages, for lists in text, CSV or Markdown files."
          value={experimental.bulkImport}
          onChange={(bulkImport) => set({ bulkImport })}
        />
        <Switch
          label="Learn from sent mail"
          description="Learn how you write email from messages you have sent."
          value={false}
          isDisabled
          disabledMessage="Needs a mail connector, which Murmur does not have yet."
          onChange={() => {}}
        />
        <Text size="sm" color="secondary">
          Learning from sent mail needs a mail connector, which Murmur does not have yet.
        </Text>
        <Switch
          label="Bluetooth ring microphone"
          description="Start and stop dictation from a ring worn on a finger."
          value={experimental.ringMicrophone}
          onChange={(ringMicrophone) => {
            setSearchDone(false);
            set({ ringMicrophone });
          }}
        />
        {experimental.ringMicrophone ? (
          <VStack gap={1}>
            <div>
              <Button
                size="sm"
                variant="secondary"
                label="Search for ring"
                isDisabled={searchLeft !== null}
                onClick={search}
              >
                {searchLeft !== null ? `Searching… ${searchLeft} s` : "Search for ring"}
              </Button>
            </div>
            {searchDone ? (
              <Text size="sm" color="secondary" role="status">
                No ring found. No ring model is supported yet.
              </Text>
            ) : null}
          </VStack>
        ) : null}
      </VStack>
    </section>
  );
}
