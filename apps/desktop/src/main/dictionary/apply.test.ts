import { describe, expect, it } from "vitest";
import {
  applyReplacements,
  keepSpellings,
  PROMPT_TERM_CHARS,
  speechPromptWithTerms,
  type ReplacementRule,
} from "./apply";

const rule = (id: string, term: string, replacement: string, caseSensitive = false) =>
  ({ id, term, replacement, caseSensitive }) satisfies ReplacementRule;

describe("replacements", () => {
  it("replaces whole words only, any case", () => {
    const rules = [rule("a", "k8s", "Kubernetes")];
    expect(applyReplacements("Deploy to K8s today", rules)).toEqual({
      text: "Deploy to Kubernetes today",
      used: ["a"],
    });
    expect(applyReplacements("k8sy is not it", rules)).toEqual({
      text: "k8sy is not it",
      used: [],
    });
  });

  it("never replaces one rule's output with another", () => {
    const rules = [rule("a", "k8s", "Kubernetes"), rule("b", "Kubernetes", "K-word")];
    expect(applyReplacements("k8s", rules).text).toBe("Kubernetes");
  });

  it("takes the first listed rule where two match", () => {
    const rules = [rule("new", "my email", "me@example.com"), rule("old", "my email", "old@x.org")];
    expect(applyReplacements("send my  email", rules)).toEqual({
      text: "send me@example.com",
      used: ["new"],
    });
  });

  it("matches a case-sensitive rule only in its own case", () => {
    const rules = [rule("a", "API", "A.P.I.", true)];
    expect(applyReplacements("the API and the api", rules).text).toBe("the A.P.I. and the api");
  });

  it("handles words with symbols and letters outside English", () => {
    expect(applyReplacements("c++ rocks", [rule("a", "c++", "C++")]).text).toBe("C++ rocks");
    expect(applyReplacements("नमस्ते दोस्त", [rule("a", "दोस्त", "मित्र")]).text).toBe(
      "नमस्ते मित्र",
    );
  });
});

describe("spellings", () => {
  it("writes a term the way it was saved", () => {
    expect(
      keepSpellings("deploy with kubernetes and GITHUB", [
        { id: "k", term: "Kubernetes" },
        { id: "g", term: "GitHub" },
      ]),
    ).toEqual({ text: "deploy with Kubernetes and GitHub", used: ["k", "g"] });
  });

  it("prefers the longer term and leaves parts of words alone", () => {
    const terms = [
      { id: "g", term: "GitHub" },
      { id: "ga", term: "GitHub Actions" },
    ];
    expect(keepSpellings("github actions run; githubby", terms).text).toBe(
      "GitHub Actions run; githubby",
    );
  });
});

describe("speech prompt", () => {
  it("puts terms first and the screen text last", () => {
    expect(speechPromptWithTerms(["Kubernetes", "Priya"], "Hello there")).toBe(
      "Kubernetes, Priya. Hello there",
    );
    expect(speechPromptWithTerms([], "Hello there")).toBe("Hello there");
    expect(speechPromptWithTerms(["Kubernetes"], "")).toBe("Kubernetes.");
  });

  it("keeps the terms within their share and shortens the screen text", () => {
    const terms = Array.from({ length: 200 }, (_, index) => `Term${index}`);
    const prompt = speechPromptWithTerms(terms, "word ".repeat(200).trim());
    const [list] = prompt.split(". ");
    expect(list!.length).toBeLessThanOrEqual(PROMPT_TERM_CHARS);
    expect(list!.startsWith("Term0, Term1")).toBe(true);
    expect(prompt.length).toBeLessThan(PROMPT_TERM_CHARS + 310);
  });
});
