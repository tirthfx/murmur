import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  MEETING_LANGUAGES,
  type MeetingDetail,
  type MeetingLanguageInput,
  type TranscriptVersionInfo,
} from "@murmur/shared";

const AUTO = "auto";

const languageName = (code: string | null) =>
  code === null
    ? "detected automatically"
    : (MEETING_LANGUAGES.find((language) => language.code === code)?.label ?? code);

const dayOf = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * NT-20, NT-23: the language a meeting is transcribed in, whether the words are written in
 * English, and transcribing it again from the saved audio. Changing a finished meeting's
 * language is never an edit in place: it asks first, then queues a new transcript and keeps the
 * old one for a while, so it can be put back.
 */
export function LanguagePanel({ detail }: { detail: MeetingDetail }) {
  const { meeting } = detail;
  const recording = meeting.status === "recording";
  const [language, setLanguage] = useState<string>(meeting.language ?? AUTO);
  const [translate, setTranslate] = useState(meeting.translate);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [keepDays, setKeepDays] = useState(30);

  useEffect(() => {
    setLanguage(meeting.language ?? AUTO);
    setTranslate(meeting.translate);
  }, [meeting.language, meeting.translate]);
  useEffect(() => {
    void window.murmur.getSettings().then((view) => {
      setKeepDays(view.settings.notetaker.rerun.keepPreviousVersionDays);
    });
  }, []);

  const chosen = (): MeetingLanguageInput => ({
    language: language === AUTO ? null : (language as MeetingLanguageInput["language"]),
    translate,
  });
  const changed = (meeting.language ?? AUTO) !== language || meeting.translate !== translate;

  async function apply(next: { language: string; translate: boolean }) {
    // A meeting still recording takes the change for the rest of it, at once.
    if (!recording) return;
    setMessage(null);
    const result = await window.murmur.meetingSetLanguage(meeting.id, {
      language: next.language === AUTO ? null : (next.language as MeetingLanguageInput["language"]),
      translate: next.translate,
    });
    if (!result.ok) setMessage(result.message);
  }

  async function rerun() {
    setMessage(null);
    const result = await window.murmur.meetingRerun(meeting.id, chosen());
    setConfirming(false);
    if (!result.ok) setMessage(result.message);
  }

  async function restore(version: TranscriptVersionInfo) {
    setMessage(null);
    const result = await window.murmur.meetingVersionRestore(meeting.id, version.id);
    if (!result.ok) setMessage(result.message);
  }

  const blocked = detail.rerunBlocked;

  return (
    <section aria-label="Language">
      <VStack gap={2}>
        <HStack gap={3} align="end" wrap="wrap">
          <Selector
            label="Language"
            value={language}
            options={[
              { value: AUTO, label: "Detect automatically" },
              ...MEETING_LANGUAGES.map((item) => ({ value: item.code, label: item.label })),
            ]}
            onChange={(value) => {
              setLanguage(value);
              void apply({ language: value, translate });
            }}
          />
          <Switch
            label="Write the transcript in English"
            value={translate}
            onChange={(value) => {
              setTranslate(value);
              void apply({ language, translate: value });
            }}
          />
          {recording ? null : (
            <Button
              size="sm"
              variant={changed ? "primary" : "secondary"}
              label="Transcribe this meeting again"
              isDisabled={blocked !== null}
              onClick={() => setConfirming(true)}
            >
              Transcribe again…
            </Button>
          )}
        </HStack>
        {meeting.language === null && detail.detectedLanguage ? (
          <Text size="sm" color="secondary">
            Heard: {languageName(detail.detectedLanguage)}.
          </Text>
        ) : null}
        {recording ? (
          <Text size="sm" color="secondary">
            A change applies to the rest of this recording.
          </Text>
        ) : blocked ? (
          <Text size="sm" color="secondary" role="status">
            {blocked}
          </Text>
        ) : changed && !confirming ? (
          <Text size="sm" color="secondary">
            Choose “Transcribe again” to use the new setting: it does not change the transcript by
            itself.
          </Text>
        ) : null}
        {confirming ? (
          <Banner
            status="warning"
            title={`Transcribe again${language === AUTO ? "" : ` in ${languageName(language)}`}${translate ? ", written in English" : ""}?`}
            description={`This replaces the transcript and writes a new summary version from the saved audio. Your notes, your tasks (done tasks stay done) and the speaker names are kept, and so are the earlier summaries. The transcript now, with its corrections, is kept for ${keepDays} days and can be put back.`}
            endContent={
              <HStack gap={1}>
                <Button
                  size="sm"
                  variant="primary"
                  label="Transcribe again"
                  onClick={() => void rerun()}
                >
                  Transcribe again
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  label="Cancel"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </Button>
              </HStack>
            }
          />
        ) : null}
        {message ? <Banner status="warning" title={message} /> : null}
        {detail.transcriptVersions.length > 0 ? (
          <section aria-label="Earlier transcripts">
            <VStack gap={1}>
              <Text weight="semibold">Earlier transcripts</Text>
              <ul className="hub-versions" aria-label="Earlier transcripts">
                {detail.transcriptVersions.map((version) => (
                  <li key={version.id}>
                    <HStack gap={2} align="center" wrap="wrap">
                      <Text size="sm">
                        {languageName(version.language)}
                        {version.translate ? ", in English" : ""} · {version.lines}{" "}
                        {version.lines === 1 ? "line" : "lines"} · replaced{" "}
                        {dayOf(version.replacedAt)} · kept until {dayOf(version.expiresAt)}
                      </Text>
                      <Button
                        size="sm"
                        variant="secondary"
                        label={`Put back the transcript replaced on ${dayOf(version.replacedAt)}`}
                        isDisabled={meeting.status !== "ready" && meeting.status !== "failed"}
                        onClick={() => void restore(version)}
                      >
                        Put back
                      </Button>
                    </HStack>
                  </li>
                ))}
              </ul>
            </VStack>
          </section>
        ) : null}
      </VStack>
    </section>
  );
}
