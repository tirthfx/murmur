import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { formatElapsed, type TranscriptImportPreview } from "@murmur/shared";

const pad = (n: number) => String(n).padStart(2, "0");
/** `2026-11-21 10:00` in the local time zone. */
const written = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** The moment a `YYYY-MM-DD HH:MM` is, or null. */
export function readDate(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(text.trim());
  if (!match) return null;
  const [, y, m, d, h, min] = match;
  const at = new Date(Number(y), Number(m) - 1, Number(d), Number(h ?? 0), Number(min ?? 0));
  return at.getMonth() === Number(m) - 1 && at.getDate() === Number(d) ? at.getTime() : null;
}

/**
 * What an import is described as, with the title and the date the owner can change, and the
 * checks for a duplicate. Nothing is made until Import is clicked. A file (NT-21) and a meeting
 * from Zoom or Fireflies (CN-09, CN-10) use this same form, so the preview and the duplicate checks
 * are the same.
 */
export function ImportPreview({
  preview,
  onImported,
}: {
  preview: TranscriptImportPreview;
  onImported: (meetingId: string) => void;
}) {
  const [title, setTitle] = useState(preview.title);
  const [date, setDate] = useState(written(preview.startedAt));
  const [message, setMessage] = useState<string | null>(null);
  const [anyway, setAnyway] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    const startedAt = readDate(date);
    if (startedAt === null) return setMessage("Write the date as YYYY-MM-DD HH:MM.");
    if (title.trim() === "") return setMessage("Give the meeting a title.");
    setMessage(null);
    setBusy(true);
    try {
      const result = await window.murmur.meetingImportConfirm({
        token: preview.token,
        title: title.trim(),
        startedAt,
      });
      if (result.ok) onImported(result.meetingId);
      else setMessage(result.message);
    } finally {
      setBusy(false);
    }
  }

  const duplicate = preview.duplicate;
  // The same file or the same recording is never imported twice; a meeting with the same title
  // at the same time can be, after the owner says so.
  const blocked =
    duplicate?.reason === "same-file" ||
    duplicate?.reason === "same-recording" ||
    (duplicate !== null && !anyway);

  return (
    <VStack gap={2}>
      {message ? <Banner status="warning" title={message} /> : null}
      <Text size="sm" color="secondary">
        {preview.fileName}: {preview.formatName}. 1 meeting, {preview.lines}{" "}
        {preview.lines === 1 ? "line" : "lines"}, {formatElapsed(preview.durationMs)}.
      </Text>
      <Text size="sm">
        Speakers:{" "}
        {preview.speakers.length > 0 ? preview.speakers.join(", ") : "none named in the file"}.
      </Text>
      {preview.timesEstimated ? (
        <Banner
          status="info"
          title="This file has no times. They are estimated from the length of each line."
        />
      ) : null}
      {duplicate ? (
        <Banner
          status="warning"
          title={
            duplicate.reason === "same-file"
              ? `This file is already imported as “${duplicate.title}”.`
              : duplicate.reason === "same-recording"
                ? `This meeting is already imported as “${duplicate.title}”.`
                : `A meeting called “${duplicate.title}” started at about the same time.`
          }
          {...(duplicate.reason === "same-title"
            ? {
                endContent: (
                  <Button
                    size="sm"
                    variant="secondary"
                    label="Import it anyway"
                    onClick={() => setAnyway(true)}
                  >
                    Import anyway
                  </Button>
                ),
              }
            : {})}
        />
      ) : null}
      <HStack gap={2} align="end" wrap="wrap">
        <TextInput label="Title" value={title} onChange={setTitle} />
        <TextInput
          label="Date and time"
          placeholder="YYYY-MM-DD HH:MM"
          value={date}
          onChange={setDate}
        />
      </HStack>
      <div>
        <Button
          variant="primary"
          label="Import this transcript"
          isDisabled={blocked || busy}
          onClick={() => void confirm()}
        >
          Import
        </Button>
      </div>
    </VStack>
  );
}

/**
 * NT-21: bring in a transcript file (WebVTT, SubRip, plain text, JSON) as a meeting. The file is
 * read first and described (format, date, length, speakers); nothing is made until it is
 * confirmed. The meeting has no audio, and its speakers and times come from the file.
 */
export function ImportPanel({
  onImported,
  onClose,
}: {
  onImported: (meetingId: string) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<TranscriptImportPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function choose() {
    setMessage(null);
    if (preview) void window.murmur.meetingImportCancel(preview.token);
    const result = await window.murmur.meetingImportPreview();
    if (result.ok) {
      setPreview(result.preview);
    } else if ("message" in result) {
      setPreview(null);
      setMessage(result.message);
    }
  }

  return (
    <section aria-label="Import a transcript">
      <VStack gap={2}>
        <Text weight="semibold">Import a transcript</Text>
        <Text size="sm" color="secondary">
          Choose a WebVTT (.vtt), SubRip (.srt), plain text (“Speaker: text” lines) or JSON file,
          for example a Zoom transcript. It becomes a meeting with no audio.
        </Text>
        <HStack gap={2}>
          <Button
            variant="secondary"
            label="Choose a transcript file"
            onClick={() => void choose()}
          >
            Choose a file…
          </Button>
          <Button
            variant="ghost"
            label="Close the import panel"
            onClick={() => {
              if (preview) void window.murmur.meetingImportCancel(preview.token);
              onClose();
            }}
          >
            Close
          </Button>
        </HStack>
        {message ? <Banner status="warning" title={message} /> : null}
        {preview ? (
          <ImportPreview
            key={preview.token}
            preview={preview}
            onImported={(meetingId) => {
              setPreview(null);
              onImported(meetingId);
            }}
          />
        ) : null}
      </VStack>
    </section>
  );
}
