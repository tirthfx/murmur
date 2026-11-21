import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  AUDIO_RETENTION,
  AUDIO_RETENTION_TEXT,
  TRANSCRIPT_RETENTION,
  TRANSCRIPT_RETENTION_TEXT,
  type AudioRetention,
  type FolderResult,
  type MeetingFolder,
  type Skill,
  type TranscriptRetention,
} from "@murmur/shared";

const NONE = "__none";

/**
 * NT-17, NT-18: the personal folders. A folder holds meetings (the Inbox holds the others);
 * deleting one keeps its meetings. A folder can name the Skill that writes its summaries and a
 * place on this Mac where a shareable file of each meeting is written once it is ready: a synced
 * folder there is how a file reaches other people without a server.
 */
export function FoldersManager({
  folders,
  onChange,
}: {
  folders: MeetingFolder[];
  /** The folders changed (the list is loaded again). */
  onChange: () => void;
}) {
  const [name, setName] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void window.murmur.skillsList().then(setSkills);
  }, []);

  async function run(call: Promise<FolderResult>, then?: () => void) {
    setMessage(null);
    const result = await call;
    if (!result.ok) return setMessage(result.message);
    then?.();
    onChange();
  }

  return (
    <VStack gap={3}>
      <HStack gap={2} align="end" wrap="wrap">
        <TextInput
          label="New folder"
          value={name}
          onChange={setName}
          onEnter={() => void run(window.murmur.folderCreate(name), () => setName(""))}
        />
        <Button
          variant="primary"
          label="Create the folder"
          isDisabled={name.trim() === ""}
          onClick={() => void run(window.murmur.folderCreate(name), () => setName(""))}
        >
          Create folder
        </Button>
      </HStack>
      {message ? <Banner status="warning" title={message} /> : null}
      {folders.length === 0 ? (
        <Text color="secondary">
          Every meeting is in the Inbox. Make a folder to sort them, and move a meeting from its
          page.
        </Text>
      ) : (
        <ul className="hub-folders" aria-label="Folders">
          {folders.map((folder) => (
            <li key={folder.id} className="hub-folder">
              <VStack gap={2}>
                {renaming === folder.id ? (
                  <HStack gap={2} align="end" wrap="wrap">
                    <TextInput
                      label={`New name for ${folder.name}`}
                      value={draft}
                      onChange={setDraft}
                      onEnter={() =>
                        void run(window.murmur.folderRename(folder.id, draft), () =>
                          setRenaming(null),
                        )
                      }
                    />
                    <Button
                      size="sm"
                      variant="primary"
                      label={`Save the name of ${folder.name}`}
                      onClick={() =>
                        void run(window.murmur.folderRename(folder.id, draft), () =>
                          setRenaming(null),
                        )
                      }
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      label="Cancel renaming"
                      onClick={() => setRenaming(null)}
                    >
                      Cancel
                    </Button>
                  </HStack>
                ) : (
                  <HStack gap={2} align="center" wrap="wrap">
                    <Text weight="semibold">{folder.name}</Text>
                    <Text size="sm" color="secondary">
                      {folder.meetings} {folder.meetings === 1 ? "meeting" : "meetings"}
                    </Text>
                    <Button
                      size="sm"
                      variant="ghost"
                      label={`Rename ${folder.name}`}
                      onClick={() => {
                        setRenaming(folder.id);
                        setDraft(folder.name);
                        setMessage(null);
                      }}
                    >
                      Rename
                    </Button>
                    {confirmDelete === folder.id ? (
                      <HStack gap={1}>
                        <Button
                          size="sm"
                          variant="destructive"
                          label={`Delete ${folder.name} and keep its meetings`}
                          onClick={() =>
                            void run(window.murmur.folderDelete(folder.id), () =>
                              setConfirmDelete(null),
                            )
                          }
                        >
                          Delete, keep the meetings
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          label="Keep the folder"
                          onClick={() => setConfirmDelete(null)}
                        >
                          Cancel
                        </Button>
                      </HStack>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        label={`Delete ${folder.name}`}
                        onClick={() => setConfirmDelete(folder.id)}
                      >
                        Delete…
                      </Button>
                    )}
                  </HStack>
                )}
                {confirmDelete === folder.id ? (
                  <Text size="sm" color="secondary">
                    {folder.meetings === 0
                      ? "The folder is empty."
                      : `Its ${folder.meetings} ${folder.meetings === 1 ? "meeting goes" : "meetings go"} to the Inbox. Nothing else is deleted.`}
                  </Text>
                ) : null}
                <HStack gap={3} align="end" wrap="wrap">
                  <Selector
                    label={`Skill for summaries in ${folder.name}`}
                    value={folder.defaultSkillId ?? NONE}
                    options={[
                      { value: NONE, label: "The one in Settings" },
                      ...skills.map((skill) => ({ value: skill.id, label: skill.name })),
                    ]}
                    onChange={(value) =>
                      void run(
                        window.murmur.folderUpdate(folder.id, {
                          defaultSkillId: value === NONE ? null : value,
                        }),
                      )
                    }
                  />
                  <Selector
                    label={`Keep the audio of ${folder.name}`}
                    value={folder.retentionAudio ?? NONE}
                    options={[
                      { value: NONE, label: "As in Settings" },
                      ...AUDIO_RETENTION.map((value) => ({
                        value,
                        label: AUDIO_RETENTION_TEXT[value],
                      })),
                    ]}
                    onChange={(value) =>
                      void run(
                        window.murmur.folderUpdate(folder.id, {
                          retentionAudio: value === NONE ? null : (value as AudioRetention),
                        }),
                      )
                    }
                  />
                  <Selector
                    label={`Keep the transcript of ${folder.name}`}
                    value={folder.retentionTranscript ?? NONE}
                    options={[
                      { value: NONE, label: "As in Settings" },
                      ...TRANSCRIPT_RETENTION.map((value) => ({
                        value,
                        label: TRANSCRIPT_RETENTION_TEXT[value],
                      })),
                    ]}
                    onChange={(value) =>
                      void run(
                        window.murmur.folderUpdate(folder.id, {
                          retentionTranscript:
                            value === NONE ? null : (value as TranscriptRetention),
                        }),
                      )
                    }
                  />
                  <VStack gap={1}>
                    <Text size="sm" color="secondary">
                      {folder.autoExportPath
                        ? `A file of each meeting is written to ${folder.autoExportPath}`
                        : "No file is written after a meeting."}
                    </Text>
                    <HStack gap={1}>
                      <Button
                        size="sm"
                        variant="secondary"
                        label={`Choose where a file of each meeting in ${folder.name} is written`}
                        onClick={() => void run(window.murmur.folderChooseExport(folder.id))}
                      >
                        Choose a place…
                      </Button>
                      {folder.autoExportPath ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          label={`Stop writing files for ${folder.name}`}
                          onClick={() => void run(window.murmur.folderClearExport(folder.id))}
                        >
                          Stop
                        </Button>
                      ) : null}
                    </HStack>
                  </VStack>
                </HStack>
              </VStack>
            </li>
          ))}
        </ul>
      )}
    </VStack>
  );
}
