import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import type { DictionaryEntry } from "@murmur/shared";

/** Seconds a clip can last; main stops by itself at the same time. */
export const CLIP_SECONDS = 3;

/** Record, play and delete a pronunciation clip for one entry (PZ-06, experimental). */
export function ClipControls({
  entry,
  onChanged,
}: {
  entry: DictionaryEntry;
  onChanged: () => void;
}) {
  const [left, setLeft] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  async function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setLeft(null);
    const result = await window.murmur.dictionaryClipStop();
    setMessage(result.ok ? null : result.message);
    onChanged();
  }

  async function record() {
    setMessage(null);
    const started = await window.murmur.dictionaryClipStart(entry.id);
    if (!started.ok) {
      setMessage(started.message);
      return;
    }
    let seconds = CLIP_SECONDS;
    setLeft(seconds);
    timer.current = setInterval(() => {
      seconds -= 1;
      if (seconds <= 0) void stop();
      else setLeft(seconds);
    }, 1000);
  }

  async function play() {
    const url = await window.murmur.dictionaryClipPlay(entry.id);
    if (!url) {
      setMessage("The clip could not be found.");
      return;
    }
    await new Audio(url).play().catch(() => setMessage("The clip could not be played."));
  }

  return (
    <HStack gap={1} align="center">
      {left !== null ? (
        <Button
          size="sm"
          variant="secondary"
          label={`Stop recording ${entry.term}`}
          onClick={() => void stop()}
        >
          {`Stop (${left} s)`}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          label={`Record how you say ${entry.term}`}
          onClick={() => void record()}
        >
          {entry.hasClip ? "Record again" : "Record"}
        </Button>
      )}
      {entry.hasClip && left === null ? (
        <>
          <Button
            size="sm"
            variant="ghost"
            label={`Play ${entry.term}`}
            onClick={() => void play()}
          >
            Play
          </Button>
          <Button
            size="sm"
            variant="ghost"
            label={`Delete the clip for ${entry.term}`}
            onClick={async () => {
              await window.murmur.dictionaryClipDelete(entry.id);
              onChanged();
            }}
          >
            Delete clip
          </Button>
        </>
      ) : null}
      {message ? (
        <Text size="sm" color="secondary" role="status">
          {message}
        </Text>
      ) : null}
    </HStack>
  );
}
