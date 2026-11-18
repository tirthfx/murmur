import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { NOTE_LIMITS, type Note, type NoteVersion, type NoteVersionText } from "@murmur/shared";
import { wordDiff } from "../rewrite/word-diff";

const when = (epoch: number) =>
  new Date(epoch).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A version against the note now, word by word. */
function Compare({ version, current }: { version: NoteVersionText; current: string }) {
  const diff = useMemo(() => wordDiff(version.plain, current), [version.plain, current]);
  return (
    <VStack gap={1}>
      <Text size="sm" color="secondary">
        From the version of {when(version.createdAt)} to now ({diff.removed} removed, {diff.added}{" "}
        added):
      </Text>
      {diff.parts ? (
        <p className="hub-history-diff" aria-label="Changes since this version">
          {diff.parts.map((part, index) =>
            part.kind === "added" ? (
              <ins key={index} className="diff-added">
                {part.text}
              </ins>
            ) : part.kind === "removed" ? (
              <del key={index} className="diff-removed">
                {part.text}
              </del>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )}
        </p>
      ) : (
        <Text size="sm" color="secondary">
          Too long to show word by word.
        </Text>
      )}
    </VStack>
  );
}

/**
 * Note versions (HB-28): save one with a label, list them, compare one with the note now,
 * and restore one (which keeps the current text as a version first).
 */
export function NoteVersions({
  note,
  currentPlain,
  beforeChange,
  onRestored,
}: {
  note: Note;
  /** The text in the editor now, for Compare. */
  currentPlain: string;
  /** Saves pending typing first, so a version holds what is on screen. */
  beforeChange: () => Promise<void>;
  onRestored: (note: Note) => void;
}) {
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [label, setLabel] = useState("");
  const [comparing, setComparing] = useState<NoteVersionText | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setVersions(await window.murmur.noteVersions(note.id));
  }, [note.id]);

  useEffect(() => {
    setComparing(null);
    void load();
  }, [load]);

  async function save() {
    await beforeChange();
    const saved = await window.murmur.noteVersionSave({
      noteId: note.id,
      label: label.trim() || null,
      reason: "manual",
    });
    setMessage(saved ? "Version saved." : "Nothing changed since the last version.");
    setLabel("");
    await load();
  }

  async function restore(version: NoteVersion) {
    await beforeChange();
    const restored = await window.murmur.noteVersionRestore(version.id);
    if (!restored) {
      setMessage("That version is no longer there.");
      return;
    }
    setMessage(`Restored the version of ${when(version.createdAt)}.`);
    setComparing(null);
    onRestored(restored);
    await load();
  }

  async function compare(version: NoteVersion) {
    setComparing(await window.murmur.noteVersionText(version.id));
  }

  return (
    <section className="scratchpad-versions" aria-label="Versions">
      <VStack gap={2}>
        <HStack gap={2} align="end" wrap="wrap">
          <TextInput
            label="Version label (optional)"
            value={label}
            onChange={(value) => setLabel(value.slice(0, NOTE_LIMITS.versionLabel))}
            onEnter={() => void save()}
          />
          <Button variant="secondary" label="Save a version now" onClick={() => void save()}>
            Save version
          </Button>
        </HStack>
        {message ? (
          <Text size="sm" color="secondary" role="status">
            {message}
          </Text>
        ) : null}
        {versions.length === 0 ? (
          <Text size="sm" color="secondary">
            No versions yet. One is saved every five minutes while you write, and when you close the
            note.
          </Text>
        ) : (
          <ul className="scratchpad-version-list" aria-label="Saved versions">
            {versions.map((version) => (
              <li key={version.id}>
                <HStack gap={2} align="center" justify="between" wrap="wrap">
                  <Text size="sm">
                    {when(version.createdAt)}
                    {version.label ? ` · ${version.label}` : ""} · {version.words}{" "}
                    {version.words === 1 ? "word" : "words"}
                  </Text>
                  <HStack gap={1}>
                    <Button
                      size="sm"
                      variant="ghost"
                      label={`Compare the version of ${when(version.createdAt)} with now`}
                      onClick={() => void compare(version)}
                    >
                      Compare
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      label={`Restore the version of ${when(version.createdAt)}`}
                      onClick={() => void restore(version)}
                    >
                      Restore
                    </Button>
                  </HStack>
                </HStack>
              </li>
            ))}
          </ul>
        )}
        {comparing ? <Compare version={comparing} current={currentPlain} /> : null}
        <Text size="xsm" color="secondary">
          The newest {NOTE_LIMITS.versions} versions are kept. Restoring keeps the current text as a
          version too.
        </Text>
      </VStack>
    </section>
  );
}
