import { useCallback, useEffect, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  SKILL_LENGTHS,
  hasNewBuiltInVersion,
  skillDraftSchema,
  type Skill,
  type SkillDraft,
  type SkillVersion,
} from "@murmur/shared";

const LENGTH_LABELS = { short: "Short", medium: "Medium", long: "Long" } as const;

const whenOf = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

const BLANK: SkillDraft = {
  name: "",
  description: "",
  sections: [],
  length: "medium",
  prompt: "",
  model: "fast",
};

const toDraft = (skill: Skill): SkillDraft => ({
  name: skill.name,
  description: skill.description,
  sections: skill.sections,
  length: skill.length,
  prompt: skill.prompt,
  model: skill.model,
});

/** A Skill you can read, copy and export; the built-in ones cannot be changed. */
function SkillView({
  skill,
  onDuplicate,
  onExport,
}: {
  skill: Skill;
  onDuplicate: () => void;
  onExport: () => void;
}) {
  return (
    <VStack gap={2}>
      <HStack gap={2} align="center" wrap="wrap">
        <Text weight="semibold">{skill.name}</Text>
        <Badge variant="neutral" label="Built-in" />
      </HStack>
      <Text color="secondary">{skill.description}</Text>
      <Text size="sm" color="secondary">
        Length: {LENGTH_LABELS[skill.length]}. Sections: {skill.sections.join(", ")}.
      </Text>
      <Text>{skill.prompt}</Text>
      <HStack gap={2}>
        <Button variant="secondary" label="Duplicate to edit" onClick={onDuplicate}>
          Duplicate to edit
        </Button>
        <Button variant="secondary" label="Export" onClick={onExport}>
          Export…
        </Button>
      </HStack>
      <Text size="sm" color="secondary">
        Built-in Skills are read-only. Duplicate one to make your own.
      </Text>
    </VStack>
  );
}

function Editor({
  skill,
  isNew,
  onSaved,
  onDuplicate,
  onExport,
  onDeleted,
  onCancelNew,
}: {
  skill: Skill | null;
  isNew: boolean;
  onSaved: (skill: Skill) => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDeleted: () => void;
  onCancelNew: () => void;
}) {
  const start = skill ? toDraft(skill) : BLANK;
  const [name, setName] = useState(start.name);
  const [description, setDescription] = useState(start.description);
  const [length, setLength] = useState(start.length);
  const [model, setModel] = useState(start.model);
  const [sections, setSections] = useState(start.sections.join("\n"));
  const [prompt, setPrompt] = useState(start.prompt);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [versions, setVersions] = useState<SkillVersion[]>([]);

  const id = skill?.id ?? null;
  const version = skill?.version ?? 0;
  useEffect(() => {
    if (!id) return;
    let alive = true;
    void window.murmur.skillVersions(id).then((list) => alive && setVersions(list));
    return () => {
      alive = false;
    };
  }, [id, version]);

  async function save() {
    setMessage(null);
    setSaved(false);
    const draft = {
      name,
      description,
      length,
      prompt,
      model,
      sections: sections
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    };
    const checked = skillDraftSchema.safeParse(draft);
    if (!checked.success) {
      const field = String(checked.error.issues[0]?.path[0] ?? "");
      setMessage(
        field === "name"
          ? "Give the Skill a name of up to 80 characters."
          : field === "sections"
            ? "Add one to twelve sections, one on each line, each up to 60 characters."
            : field === "prompt"
              ? "Write what the Skill should do, up to 4,000 characters."
              : field === "description"
                ? "The description can be up to 300 characters."
                : "Check the Skill and try again.",
      );
      return;
    }
    const result = await window.murmur.skillSave(id, checked.data);
    if (result.ok) {
      setSaved(true);
      onSaved(result.skill);
    } else {
      setMessage(result.message);
    }
  }

  async function restore(target: SkillVersion) {
    if (!id) return;
    setMessage(null);
    const result = await window.murmur.skillRestore(id, target.version);
    if (result.ok) {
      onSaved(result.skill);
    } else {
      setMessage(result.message);
    }
  }

  return (
    <VStack gap={2}>
      {skill && hasNewBuiltInVersion(skill) ? (
        <Banner
          status="info"
          title="New version"
          description="The built-in Skill this was copied from has changed. Duplicate it again to see the new version."
        />
      ) : null}
      <TextInput label="Name" value={name} onChange={setName} />
      <TextInput label="Description" value={description} onChange={setDescription} />
      <Selector
        label="Length"
        value={length}
        options={SKILL_LENGTHS.map((value) => ({ value, label: LENGTH_LABELS[value] }))}
        onChange={(value) => setLength(value as SkillDraft["length"])}
      />
      <Selector
        label="Model"
        description="The quality model is slower and needs its download. Without it the fast one writes this Skill."
        value={model}
        options={[
          { value: "fast", label: "Fast" },
          { value: "quality", label: "Quality" },
        ]}
        onChange={(value) => setModel(value as SkillDraft["model"])}
      />
      <TextArea
        label="Sections"
        description="The headings of the summary, one on each line, in order."
        rows={5}
        value={sections}
        onChange={setSections}
      />
      <TextArea
        label="What to write"
        description="Tell the model what the summary is for and what to put in each section."
        rows={8}
        value={prompt}
        onChange={setPrompt}
      />
      {message ? <Banner status="warning" title={message} /> : null}
      <HStack gap={2} wrap="wrap">
        <Button
          variant="primary"
          label={isNew ? "Create the Skill" : "Save"}
          onClick={() => void save()}
        >
          {isNew ? "Create Skill" : "Save"}
        </Button>
        {isNew ? (
          <Button variant="secondary" label="Cancel" onClick={onCancelNew}>
            Cancel
          </Button>
        ) : (
          <>
            <Button variant="secondary" label="Duplicate" onClick={onDuplicate}>
              Duplicate
            </Button>
            <Button variant="secondary" label="Export" onClick={onExport}>
              Export…
            </Button>
            {confirmDelete ? (
              <HStack gap={1}>
                <Button
                  variant="secondary"
                  label="Delete the Skill for good"
                  onClick={() => {
                    void window.murmur.skillDelete(skill!.id).then((result) => {
                      if (result.ok) onDeleted();
                      else setMessage(result.message);
                    });
                  }}
                >
                  Delete for good
                </Button>
                <Button variant="secondary" label="Keep it" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </HStack>
            ) : (
              <Button variant="secondary" label="Delete" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </>
        )}
      </HStack>
      {saved ? (
        <Text size="sm" color="secondary" role="status">
          Saved.
        </Text>
      ) : null}
      {!isNew && skill ? (
        <section aria-label="Earlier versions">
          <VStack gap={1}>
            <Text weight="semibold">
              Version {skill.version}
              {versions.length > 0 ? `, ${versions.length} earlier` : ""}
            </Text>
            {versions.length === 0 ? (
              <Text size="sm" color="secondary">
                Each save keeps the version before it. They show up here.
              </Text>
            ) : (
              <ul className="hub-skill-versions" aria-label="Earlier versions">
                {versions.map((earlier) => (
                  <li key={earlier.version}>
                    <HStack gap={2} align="center" wrap="wrap">
                      <Text size="sm">
                        Version {earlier.version}: {earlier.name}, replaced{" "}
                        {whenOf(earlier.createdAt)}
                      </Text>
                      <Button
                        variant="secondary"
                        label={`Go back to version ${earlier.version}`}
                        onClick={() => void restore(earlier)}
                      >
                        Go back to this
                      </Button>
                    </HStack>
                  </li>
                ))}
              </ul>
            )}
          </VStack>
        </section>
      ) : null}
    </VStack>
  );
}

/** NT-16: the Skills list with a place to read, create, edit, copy, export and import them. */
export function SkillsManager() {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSkills(await window.murmur.skillsList());
  }, []);
  useEffect(() => {
    void load().catch(() => setSkills([]));
  }, [load]);

  const current = skills?.find((skill) => skill.id === selected) ?? null;

  async function duplicate(id: string) {
    setMessage(null);
    const result = await window.murmur.skillDuplicate(id);
    if (result.ok) {
      await load();
      setSelected(result.skill.id);
    } else {
      setMessage(result.message);
    }
  }

  async function exportSkill(id: string) {
    setMessage(null);
    const result = await window.murmur.skillExport(id);
    if (!result.ok && "message" in result) setMessage(result.message);
  }

  async function importSkill() {
    setMessage(null);
    const result = await window.murmur.skillImport();
    if (result.ok) {
      await load();
      setSelected(result.skill.id);
    } else if ("message" in result) {
      setMessage(result.message);
    }
  }

  return (
    <VStack gap={3}>
      <HStack gap={2} align="center" wrap="wrap">
        <Button variant="primary" label="New Skill" onClick={() => setSelected("new")}>
          New Skill
        </Button>
        <Button variant="secondary" label="Import a Skill" onClick={() => void importSkill()}>
          Import…
        </Button>
        <Text size="sm" color="secondary">
          A Skill is the prompt and the sections that write a summary. Yours are also saved as
          Markdown files in the Skills folder.
        </Text>
      </HStack>
      {message ? <Banner status="warning" title={message} /> : null}
      <div className="hub-notetaker">
        <section aria-label="Skills">
          {skills === null ? (
            <Text color="secondary">Loading…</Text>
          ) : (
            <ul className="hub-meeting-list" aria-label="Skills">
              {skills.map((skill) => (
                <li key={skill.id}>
                  <button
                    type="button"
                    className="hub-meeting-item"
                    aria-current={skill.id === selected ? "true" : undefined}
                    onClick={() => setSelected(skill.id)}
                  >
                    <Text weight="semibold">{skill.name}</Text>
                    <Text size="sm" color="secondary">
                      {skill.description || skill.sections.join(", ")}
                    </Text>
                    <span>
                      <Badge
                        variant="neutral"
                        label={skill.builtIn ? "Built-in" : `Yours, version ${skill.version}`}
                      />
                      {hasNewBuiltInVersion(skill) ? (
                        <Badge variant="info" label="New version" />
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Skill">
          {selected === "new" ? (
            <Editor
              key="new"
              skill={null}
              isNew
              onSaved={(skill) => {
                void load().then(() => setSelected(skill.id));
              }}
              onDuplicate={() => undefined}
              onExport={() => undefined}
              onDeleted={() => undefined}
              onCancelNew={() => setSelected(null)}
            />
          ) : current && current.builtIn ? (
            <SkillView
              key={current.id}
              skill={current}
              onDuplicate={() => void duplicate(current.id)}
              onExport={() => void exportSkill(current.id)}
            />
          ) : current ? (
            <Editor
              key={`${current.id}-${current.version}`}
              skill={current}
              isNew={false}
              onSaved={(skill) => {
                void load().then(() => setSelected(skill.id));
              }}
              onDuplicate={() => void duplicate(current.id)}
              onExport={() => void exportSkill(current.id)}
              onDeleted={() => {
                setSelected(null);
                void load();
              }}
              onCancelNew={() => undefined}
            />
          ) : (
            <Text color="secondary">Choose a Skill to read it, or make a new one.</Text>
          )}
        </section>
      </div>
    </VStack>
  );
}
