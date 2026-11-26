import { describe, expect, it } from "vitest";
import type { Snippet } from "@murmur/shared";
import type { DictionaryRules } from "../dictionary/dictionary-store";
import { createSharedVocabulary, expandVariables, type SharedSet } from "./shared-vocabulary";

const personalRules = (): DictionaryRules => ({
  promptTerms: ["Kubernetes"],
  starredCount: 1,
  spellings: [{ id: "p1", term: "Kubernetes" }],
  replacements: [{ id: "p2", term: "pg", replacement: "Postgres (mine)", caseSensitive: false }],
});

const set = (overrides: Partial<SharedSet> = {}): SharedSet => ({
  teamName: "Acme",
  me: "Ada",
  dictionary: [],
  snippets: [],
  ...overrides,
});

const snippet = (id: string, trigger: string): Snippet => ({
  id,
  trigger,
  format: "plain",
  plain: "mine",
  rich: null,
  useCount: 0,
  createdAt: 1,
  updatedAt: 1,
});

describe("shared dictionary", () => {
  it("changes nothing when there is nothing shared", () => {
    const vocabulary = createSharedVocabulary();
    const rules = personalRules();
    expect(vocabulary.rules(rules)).toBe(rules);
    expect(vocabulary.counts()).toEqual({ dictionary: 0, snippets: 0 });
  });

  it("adds the team's terms and replacements after the personal ones", () => {
    const vocabulary = createSharedVocabulary();
    vocabulary.set([
      set({
        dictionary: [
          { id: "s1", term: "Acme", replacement: "Acme Inc.", pronunciation: "" },
          { id: "s2", term: "Murmur", replacement: null, pronunciation: "" },
        ],
      }),
    ]);
    const rules = vocabulary.rules(personalRules());
    expect(rules.replacements.map((r) => [r.id, r.term, r.replacement])).toEqual([
      ["p2", "pg", "Postgres (mine)"],
      ["team:s1", "Acme", "Acme Inc."],
    ]);
    expect(rules.spellings.map((r) => r.id)).toEqual(["p1", "team:s2"]);
    expect(rules.promptTerms).toEqual(["Kubernetes", "Murmur"]);
    expect(vocabulary.counts().dictionary).toBe(2);
  });

  it("lets a personal entry win over a shared one for the same term, ignoring capitals", () => {
    const vocabulary = createSharedVocabulary();
    vocabulary.set([
      set({
        dictionary: [
          { id: "s1", term: "PG", replacement: "PostgreSQL (team)", pronunciation: "" },
          { id: "s2", term: "kubernetes", replacement: "K8s", pronunciation: "" },
        ],
      }),
    ]);
    const rules = vocabulary.rules(personalRules());
    // "pg" is a personal replacement, and "Kubernetes" a personal spelling: the shared ones are dropped.
    expect(rules.replacements.map((r) => r.id)).toEqual(["p2"]);
    expect(rules.spellings.map((r) => r.id)).toEqual(["p1"]);
    // Only the personal entries are in the speech prompt.
    expect(rules.promptTerms).toEqual(["Kubernetes"]);
  });

  it("uses the first team's entry when two teams share a term", () => {
    const vocabulary = createSharedVocabulary();
    vocabulary.set([
      set({
        teamName: "A",
        dictionary: [{ id: "a", term: "Foo", replacement: "from A", pronunciation: "" }],
      }),
      set({
        teamName: "B",
        dictionary: [{ id: "b", term: "foo", replacement: "from B", pronunciation: "" }],
      }),
    ]);
    expect(vocabulary.rules(personalRules()).replacements.map((r) => r.replacement)).toEqual([
      "Postgres (mine)",
      "from A",
    ]);
    vocabulary.clear();
    expect(vocabulary.counts()).toEqual({ dictionary: 0, snippets: 0 });
  });
});

describe("shared snippets", () => {
  const shared = (trigger: string, expansion: string, format: "plain" | "markdown" = "plain") => ({
    id: trigger,
    trigger,
    expansion,
    format,
    locked: false,
  });

  it("are added after the personal ones, and a personal trigger wins", () => {
    const vocabulary = createSharedVocabulary();
    vocabulary.set([set({ snippets: [shared("sig", "Best, Ada"), shared("Mine!", "team text")] })]);
    const list = vocabulary.snippets([snippet("p1", "mine")]);
    expect(list.map((s) => s.id)).toEqual(["p1", "team:sig"]);
    expect(list[1]).toMatchObject({
      trigger: "sig",
      plain: "Best, Ada",
      format: "plain",
      rich: null,
    });
    expect(vocabulary.counts().snippets).toBe(2);
  });

  it("fill in the date, the person's name and the team's name", () => {
    const vocabulary = createSharedVocabulary(() => new Date(2026, 10, 22, 9, 0).getTime());
    vocabulary.set([
      set({ snippets: [shared("hello", "Hi from {{me}} at {{ team }} on {{DATE}}")] }),
    ]);
    expect(vocabulary.snippets([])[0]!.plain).toBe("Hi from Ada at Acme on 2026-11-22");
    expect(expandVariables("{{shell}} {{me}}", { date: "d", me: "m", team: "t" })).toBe(
      "{{shell}} m",
    );
  });

  it("keep their formatting when they are markdown", () => {
    const vocabulary = createSharedVocabulary();
    vocabulary.set([set({ snippets: [shared("bold", "**Thanks**, all", "markdown")] })]);
    const [entry] = vocabulary.snippets([]);
    expect(entry).toMatchObject({ format: "rich_json", plain: "Thanks, all" });
    expect(entry!.rich).not.toBeNull();
  });

  it("are not added twice when two teams use the same trigger", () => {
    const vocabulary = createSharedVocabulary();
    vocabulary.set([
      set({ snippets: [shared("sig", "A")] }),
      set({ teamName: "B", snippets: [shared("SIG", "B")] }),
    ]);
    expect(vocabulary.snippets([]).map((s) => s.plain)).toEqual(["A"]);
  });
});

describe("a shared pronunciation hint (TM-06)", () => {
  it("writes the term when the hint is heard, unless the person has a rule for it", () => {
    const shared = createSharedVocabulary();
    shared.set([
      {
        teamName: "Design",
        me: "Ada",
        dictionary: [
          { id: "1", term: "Siobhan", replacement: null, pronunciation: "shivawn" },
          { id: "2", term: "Nguyen", replacement: null, pronunciation: "" },
        ],
        snippets: [],
      },
    ]);
    const empty = { promptTerms: [], starredCount: 0, spellings: [], replacements: [] };
    expect(shared.rules(empty).replacements).toEqual([
      { id: "team:1:heard", term: "shivawn", replacement: "Siobhan", caseSensitive: false },
    ]);
    const own = {
      ...empty,
      replacements: [{ id: "p", term: "Shivawn", replacement: "x", caseSensitive: false }],
    };
    expect(shared.rules(own).replacements).toHaveLength(1);
  });
});
