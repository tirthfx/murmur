import { useEffect, useMemo, useRef, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { formatElapsed, type MeetingDetail, type MeetingSpeaker } from "@murmur/shared";
import { createSamplePlayer } from "./speaker-audio";

const AUDIO_GONE = "The audio of this meeting was deleted, so there is nothing to play.";

const linesText = (speaker: MeetingSpeaker) =>
  `${speaker.segments} ${speaker.segments === 1 ? "line" : "lines"} · ${formatElapsed(speaker.talkMs)} of talk`;

/**
 * NT-07, NT-08: who spoke, with how many lines and how long. The name plays a short sample of
 * the speaker from the stored audio; Rename gives the speaker a name for the whole meeting.
 */
export function SpeakersPanel({ detail }: { detail: MeetingDetail }) {
  const { meeting, speakers } = detail;
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const player = useMemo(() => createSamplePlayer(), []);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
      player.stop();
    },
    [player],
  );

  const audioGone = meeting.audioDeletedAt !== null;

  async function play(speaker: MeetingSpeaker) {
    setMessage(null);
    if (playing === speaker.id) {
      player.stop();
      return;
    }
    const clip = await window.murmur.meetingSpeakerClip(meeting.id, speaker.id);
    if (!clip.ok) {
      setMessage(
        clip.reason === "audio-deleted"
          ? AUDIO_GONE
          : clip.reason === "no-speech"
            ? `${speaker.name} has no lines to play yet.`
            : "The audio of this speaker could not be found.",
      );
      return;
    }
    setPlaying(speaker.id);
    try {
      await player.play(clip.bytes, clip.offsetSec, clip.playSec);
    } catch {
      if (alive.current) setMessage("The sample could not be played.");
    } finally {
      if (alive.current) setPlaying((now) => (now === speaker.id ? null : now));
    }
  }

  async function save(speaker: MeetingSpeaker) {
    const result = await window.murmur.meetingSpeakerRename(meeting.id, speaker.id, draft);
    if (result.ok) {
      setEditing(null);
      setMessage(null);
    } else {
      setMessage(result.message);
    }
  }

  if (speakers.length === 0) return null;
  return (
    <section aria-label="Speakers">
      <VStack gap={1}>
        <ul className="hub-speakers" aria-label="Speakers">
          {speakers.map((speaker) => (
            <li key={speaker.id} className="hub-speaker">
              {editing === speaker.id ? (
                <HStack gap={2} align="end" wrap="wrap">
                  <TextInput
                    label={`Name for ${speaker.defaultName}`}
                    value={draft}
                    onChange={setDraft}
                    onEnter={() => void save(speaker)}
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    label={`Save the name of ${speaker.defaultName}`}
                    onClick={() => void save(speaker)}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    label="Cancel renaming"
                    onClick={() => {
                      setEditing(null);
                      setMessage(null);
                    }}
                  >
                    Cancel
                  </Button>
                </HStack>
              ) : (
                <HStack gap={2} align="center" wrap="wrap">
                  <button
                    type="button"
                    className="hub-speaker-name"
                    disabled={audioGone}
                    title={audioGone ? AUDIO_GONE : "Play a short sample of this speaker"}
                    aria-label={
                      audioGone
                        ? `Play a sample of ${speaker.name} (the audio was deleted)`
                        : playing === speaker.id
                          ? `Stop the sample of ${speaker.name}`
                          : `Play a sample of ${speaker.name}`
                    }
                    onClick={() => void play(speaker)}
                  >
                    <span aria-hidden="true">{playing === speaker.id ? "■" : "▶"}</span>{" "}
                    {speaker.name}
                  </button>
                  <Text size="sm" color="secondary">
                    {linesText(speaker)}
                  </Text>
                  <Button
                    size="sm"
                    variant="ghost"
                    label={`Rename ${speaker.name}`}
                    onClick={() => {
                      setEditing(speaker.id);
                      setDraft(speaker.name);
                      setMessage(null);
                    }}
                  >
                    Rename
                  </Button>
                </HStack>
              )}
            </li>
          ))}
        </ul>
        {message ? <Banner status="warning" title={message} /> : null}
      </VStack>
    </section>
  );
}
