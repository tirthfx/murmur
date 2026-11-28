import { useEffect, useState } from "react";
import { Selector } from "@astryxdesign/core/Selector";
import { ASK_LIMITS, type Skill } from "@murmur/shared";

const NONE = "";

/** NT-16: a Skill as a question to start from: its name and what it is for, ready to change. */
export function SkillQuestion({ onPick }: { onPick: (question: string) => void }) {
  const [skills, setSkills] = useState<Skill[]>([]);

  useEffect(() => {
    let alive = true;
    void window.murmur.skillsList().then((list) => alive && setSkills(list));
    return () => {
      alive = false;
    };
  }, []);

  if (skills.length === 0) return null;
  return (
    <Selector
      label="Start from a Skill"
      value={NONE}
      options={[
        { value: NONE, label: "Choose a Skill…" },
        ...skills.map((skill) => ({ value: skill.id, label: skill.name })),
      ]}
      onChange={(id) => {
        const skill = skills.find((candidate) => candidate.id === id);
        if (skill) onPick(`${skill.name}: ${skill.description}`.slice(0, ASK_LIMITS.question));
      }}
    />
  );
}
