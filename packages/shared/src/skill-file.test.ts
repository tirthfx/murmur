import { describe, expect, it } from "vitest";
import { BUILT_IN_SKILLS } from "./skills";
import { formatSkillFile, parseSkillFile, skillFileName } from "./skill-file";

const GOOD = `---
name: Customer call notes
description: Problems, asks and commitments.
length: long
sections:
  - Problems raised
  - What they asked for
---
Write notes of a call with a customer.
`;

describe("parseSkillFile", () => {
  it("reads the front matter and the prompt", () => {
    expect(parseSkillFile(GOOD)).toEqual({
      ok: true,
      draft: {
        name: "Customer call notes",
        description: "Problems, asks and commitments.",
        length: "long",
        sections: ["Problems raised", "What they asked for"],
        prompt: "Write notes of a call with a customer.",
      },
    });
  });

  it("reads inline lists, quotes, comments, CRLF and a byte order mark", () => {
    const text = `\uFEFF---\r\n# a comment\r\nname: "Plan: next week"\r\nsections: [One, 'Two', "Three"]\r\nversion: 4\r\nmodel: anything\r\n---\r\nDo it.`;
    expect(parseSkillFile(text)).toMatchObject({
      ok: true,
      draft: {
        name: "Plan: next week",
        sections: ["One", "Two", "Three"],
        length: "medium",
        description: "",
        prompt: "Do it.",
      },
    });
  });

  it.each([
    ["no opening dashes", "name: x\n---\nbody", 1],
    ["no closing dashes", "---\nname: x\nsections:\n  - A\n", 5],
    ["a line that is not key: value", "---\nname: x\nthis is wrong\n---\nbody", 3],
    ["an unknown field", "---\nname: x\ncolour: red\n---\nbody", 3],
    ["a repeated field", "---\nname: x\nname: y\n---\nbody", 3],
    ["a bad length", "---\nname: x\nlength: huge\nsections: [A]\n---\nbody", 3],
    ["a list item with no list", "---\nname: x\n  - A\n---\nbody", 3],
    ["a sections value that is not a list", "---\nname: x\nsections: A, B\n---\nbody", 3],
    ["no sections", "---\nname: x\n---\nbody", 3],
    ["no name", "---\ndescription: y\nsections: [A]\n---\nbody", 2],
    ["an empty prompt", "---\nname: x\nsections: [A]\n---\n  \n", 4],
    ["an open quote", '---\nname: "x\nsections: [A]\n---\nbody', 2],
    ["a bad version", "---\nname: x\nversion: two\nsections: [A]\n---\nbody", 3],
  ])("names the line for %s", (_label, text, line) => {
    const result = parseSkillFile(text);
    expect(result).toMatchObject({ ok: false, line });
    if (!result.ok) expect(result.message.length).toBeGreaterThan(10);
  });

  it("names the line of a section that is too long", () => {
    const result = parseSkillFile(
      `---\nname: x\nsections:\n  - ok\n  - ${"y".repeat(61)}\n---\nbody`,
    );
    expect(result).toMatchObject({ ok: false, line: 5 });
  });

  it("names the line of a name that is too long", () => {
    const result = parseSkillFile(`---\nname: ${"n".repeat(81)}\nsections: [A]\n---\nbody`);
    expect(result).toMatchObject({ ok: false, line: 2 });
  });
});

describe("formatSkillFile", () => {
  it("round-trips every built-in Skill", () => {
    for (const skill of BUILT_IN_SKILLS) {
      const parsed = parseSkillFile(formatSkillFile(skill));
      expect(parsed).toEqual({
        ok: true,
        draft: {
          name: skill.name,
          description: skill.description,
          sections: skill.sections,
          length: skill.length,
          prompt: skill.prompt,
        },
      });
    }
  });

  it("quotes values that would be read wrongly", () => {
    const skill = {
      name: "Ask: why?",
      description: "# not a comment",
      sections: ["- dash", "[bracket]", "plain"],
      length: "short" as const,
      prompt: "---\nthree dashes inside the prompt are fine after the front matter",
      version: 2,
    };
    const parsed = parseSkillFile(formatSkillFile(skill));
    expect(parsed).toMatchObject({
      ok: true,
      draft: { name: skill.name, description: skill.description, sections: skill.sections },
    });
  });
});

describe("skillFileName", () => {
  it("makes a plain file name", () => {
    expect(skillFileName("Customer call notes!")).toBe("customer-call-notes.md");
    expect(skillFileName("???")).toBe("skill.md");
    expect(skillFileName("Café plan")).toBe("cafe-plan.md".replace("cafe", "cafe"));
  });
});
