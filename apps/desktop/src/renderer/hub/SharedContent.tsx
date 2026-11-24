import { useEffect, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import type {
  SharedNote,
  TeamPerson,
  TeamSharedFolder,
  TeamSharedSkill,
  TeamView,
} from "@murmur/shared";

const KIND_TEXT: Record<string, string> = {
  shared: "Named people",
  department: "A department",
  company: "The whole team",
};

const day = (ms: number) => new Date(ms).toLocaleDateString();

/** One Skill a team published: read-only, with a way to copy it into the person's own Skills. */
function SkillRow({ skill, showTeam }: { skill: TeamSharedSkill; showTeam: boolean }) {
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true);
    setSaid("");
    try {
      const result = await window.murmur.teamSkillAdd({ teamId: skill.teamId, skillId: skill.id });
      if (result.ok) setSaid(`Added to your Skills as “${result.skill.name}”.`);
      else if ("message" in result) setSaid(result.message);
    } catch {
      setSaid("That could not be added.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <li>
      <VStack gap={1}>
        <HStack gap={2} align="center" wrap="wrap">
          <Text size="sm" weight="semibold">
            {skill.name}
          </Text>
          <Badge variant="neutral" label={`Version ${skill.version}`} />
          {showTeam ? <Badge variant="neutral" label={skill.teamName} /> : null}
          <Button
            size="sm"
            variant="ghost"
            label={`Add ${skill.name} to my Skills`}
            isDisabled={busy}
            onClick={() => void add()}
          >
            Add to my Skills
          </Button>
        </HStack>
        {skill.description ? (
          <Text size="sm" color="secondary">
            {skill.description}
          </Text>
        ) : null}
        {said ? (
          <Text size="sm" role="status">
            {said}
          </Text>
        ) : null}
      </VStack>
    </li>
  );
}

/** One shared folder: its notes by title, each readable on request. */
function FolderRow({ folder, showTeam }: { folder: TeamSharedFolder; showTeam: boolean }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<SharedNote | null>(null);
  const [said, setSaid] = useState("");
  async function read(noteId: string) {
    setSaid("");
    setNote(null);
    try {
      const result = await window.murmur.teamNoteRead({
        teamId: folder.teamId,
        folderId: folder.id,
        noteId,
      });
      if (result.ok) setNote(result.value);
      else setSaid(result.message);
    } catch {
      setSaid("That note could not be read.");
    }
  }
  return (
    <li>
      <VStack gap={1}>
        <HStack gap={2} align="center" wrap="wrap">
          <Text size="sm" weight="semibold">
            {folder.name}
          </Text>
          <Badge variant="neutral" label={KIND_TEXT[folder.kind] ?? folder.kind} />
          {showTeam ? <Badge variant="neutral" label={folder.teamName} /> : null}
          <Text size="sm" color="secondary">
            {folder.items.length} {folder.items.length === 1 ? "note" : "notes"}
            {!folder.canWrite ? ", read only" : ""}
          </Text>
          <Button
            size="sm"
            variant="ghost"
            label={`${open ? "Hide" : "Show"} the notes in ${folder.name}`}
            onClick={() => setOpen(!open)}
          >
            {open ? "Hide" : "Show"}
          </Button>
        </HStack>
        {open ? (
          <VStack gap={1}>
            {folder.items.length === 0 ? (
              <Text size="sm" color="secondary">
                Nothing has been shared here yet. Share a meeting from its export panel.
              </Text>
            ) : (
              <ul className="hub-connector-list" aria-label={`Notes in ${folder.name}`}>
                {folder.items.map((item) => (
                  <li key={item.id}>
                    <HStack gap={2} align="center" wrap="wrap">
                      <Text size="sm">{item.title}</Text>
                      <Text size="sm" color="secondary">
                        {item.sharedBy ? `${item.sharedBy}, ` : ""}
                        {day(item.sharedAt)}
                      </Text>
                      <Button
                        size="sm"
                        variant="ghost"
                        label={`Read ${item.title}`}
                        onClick={() => void read(item.id)}
                      >
                        Read
                      </Button>
                    </HStack>
                  </li>
                ))}
              </ul>
            )}
            {said ? <Banner status="warning" title={said} /> : null}
            {note ? (
              <section aria-label={`The note ${note.title}`}>
                <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{note.body}</pre>
              </section>
            ) : null}
          </VStack>
        ) : null}
      </VStack>
    </li>
  );
}

/** A new folder for named people. Department and company folders are made in the admin console. */
function NewFolder({ view }: { view: TeamView }) {
  const [teamId, setTeamId] = useState(view.teams[0]?.id ?? "");
  const [name, setName] = useState("");
  const [people, setPeople] = useState<TeamPerson[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setChosen([]);
    if (!teamId) return;
    void window.murmur
      .teamPeople(teamId)
      .then((result) => {
        if (live && result.ok)
          setPeople(result.value.filter((person) => person.email !== view.user?.email));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [teamId, view.user?.email]);

  async function make() {
    setBusy(true);
    setSaid("");
    try {
      const result = await window.murmur.teamFolderCreate({ teamId, name, members: chosen });
      if (result.ok) {
        setSaid(`Made the folder “${result.value.name}”.`);
        setName("");
        setChosen([]);
      } else setSaid(result.message);
    } catch {
      setSaid("That folder could not be made.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <VStack gap={2}>
      <Text weight="semibold">New shared folder</Text>
      <HStack gap={2} align="end" wrap="wrap">
        <TextInput label="Folder name" value={name} onChange={setName} />
        {view.teams.length > 1 ? (
          <Selector
            label="Team"
            value={teamId}
            options={view.teams.map((team) => ({ value: team.id, label: team.name }))}
            onChange={(value) => setTeamId(String(value))}
          />
        ) : null}
      </HStack>
      {people.length > 0 ? (
        <VStack gap={1}>
          <Text size="sm" color="secondary">
            Who can see it (you always can):
          </Text>
          <HStack gap={3} wrap="wrap">
            {people.map((person) => (
              <Switch
                key={person.userId}
                label={person.name}
                value={chosen.includes(person.userId)}
                onChange={(on) =>
                  setChosen(
                    on ? [...chosen, person.userId] : chosen.filter((id) => id !== person.userId),
                  )
                }
              />
            ))}
          </HStack>
        </VStack>
      ) : null}
      {said ? (
        <Text size="sm" role="status">
          {said}
        </Text>
      ) : null}
      <div>
        <Button
          size="sm"
          variant="secondary"
          label="Make the shared folder"
          isDisabled={busy || name.trim() === "" || !teamId}
          onClick={() => void make()}
        >
          Make the folder
        </Button>
      </div>
    </VStack>
  );
}

/**
 * What the teams share besides the dictionary and snippets (NT-16, NT-17): Skills to copy into
 * the person's own, and folders of notes that people chose to share, as text. Skills are
 * read-only here; publishing is in the admin console.
 */
export function SharedContent({ view }: { view: TeamView }) {
  const { skills, folders } = view.shared;
  const showTeam = view.teams.length > 1;
  return (
    <VStack gap={3}>
      <VStack gap={1}>
        <Text weight="semibold">Skills your teams share</Text>
        {skills.length === 0 ? (
          <Text size="sm" color="secondary">
            No Skill is shared with you yet.
          </Text>
        ) : (
          <ul className="hub-connector-list" aria-label="Skills your teams share">
            {skills.map((skill) => (
              <SkillRow key={`${skill.teamId}/${skill.id}`} skill={skill} showTeam={showTeam} />
            ))}
          </ul>
        )}
      </VStack>

      <VStack gap={1}>
        <Text weight="semibold">Folders your teams share</Text>
        {folders.length === 0 ? (
          <Text size="sm" color="secondary">
            No folder is shared with you yet.
          </Text>
        ) : (
          <ul className="hub-connector-list" aria-label="Folders your teams share">
            {folders.map((folder) => (
              <FolderRow
                key={`${folder.teamId}/${folder.id}`}
                folder={folder}
                showTeam={showTeam}
              />
            ))}
          </ul>
        )}
      </VStack>

      {view.teams.length > 0 ? <NewFolder view={view} /> : null}
    </VStack>
  );
}
