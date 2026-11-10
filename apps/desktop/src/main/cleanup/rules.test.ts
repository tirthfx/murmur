import { describe, expect, it } from "vitest";
import { CLEANUP_LEVELS, cleanRules } from "./rules";

const standard = (text: string) => cleanRules(text, "standard");

describe("cleanup rules: issue and spec examples", () => {
  it.each([
    ["Um, so I think, uh, we should go.", "So I think we should go."],
    ["at two, actually three", "At three"],
    ["Let's meet at two, actually three.", "Let's meet at three."],
    ["send it to Sam no wait to Priya", "Send it to Priya"],
    ["let's meet Tuesday sorry Wednesday", "Let's meet Wednesday"],
    ["Let's meet Tuesday, sorry, Wednesday.", "Let's meet Wednesday."],
    ["I I think so.", "I think so."],
    ["Send the report today. Scratch that. Send it tomorrow.", "Send it tomorrow."],
    ["First point. Send the report today. Scratch that.", "First point."],
  ])("%s → %s", (input, output) => {
    expect(standard(input)).toBe(output);
  });

  it('keeps "like" at every level', () => {
    for (const level of CLEANUP_LEVELS) {
      expect(cleanRules("I like the plan", level)).toBe("I like the plan");
    }
  });

  it('keeps "actually" used as an adverb', () => {
    expect(standard("It actually works.")).toBe("It actually works.");
    expect(standard("I actually think it's fine, really.")).toBe(
      "I actually think it's fine, really.",
    );
  });

  it('keeps "sorry" as an apology', () => {
    expect(standard("I'm sorry for the delay.")).toBe("I'm sorry for the delay.");
    expect(standard("Sorry, I'm late.")).toBe("Sorry, I'm late.");
    expect(standard("We are so sorry about that.")).toBe("We are so sorry about that.");
  });

  it("keeps a cue with nothing before it", () => {
    expect(standard("Actually, that works.")).toBe("Actually, that works.");
    expect(standard("I mean it.")).toBe("I mean it.");
    expect(standard("Scratch that.")).toBe("Scratch that.");
  });

  it('only "Scratch that" removes a whole sentence, and only the one before it', () => {
    expect(standard("One. Two. Scratch that. Three.")).toBe("One. Three.");
  });
});

describe("cleanup rules: fillers and repeats", () => {
  it("removes every filler form and tidies the punctuation around it", () => {
    expect(standard("Hmm, we could, er, try it.")).toBe("We could try it.");
    expect(standard("We should go uh.")).toBe("We should go.");
    expect(standard("erm the plan is ready")).toBe("The plan is ready");
    expect(standard("Ahh, the uhm report.")).toBe("The report.");
  });

  it("does not take filler-like parts out of real words", () => {
    expect(standard("The umbrella and the error are here.")).toBe(
      "The umbrella and the error are here.",
    );
  });

  it("collapses repeated words but not repeated words split by punctuation", () => {
    expect(standard("the the report is is ready")).toBe("The report is ready");
    expect(standard("No, no.")).toBe("No, no.");
  });
});

describe("cleanup rules: levels", () => {
  it("off and light only fix spacing and capitals, keeping every word", () => {
    for (const level of ["off", "light"] as const) {
      expect(cleanRules("um so  i think , uh, we go. it works", level)).toBe(
        "Um so I think, uh, we go. It works",
      );
    }
  });

  it("capitalises sentence starts and the word I", () => {
    expect(standard("hello. this is a test, and i'm sure i agree! ok? yes")).toBe(
      "Hello. This is a test, and I'm sure I agree! Ok? Yes",
    );
  });

  it("keeps acronyms and empty input", () => {
    expect(standard("the API and the URL")).toBe("The API and the URL");
    expect(standard("   ")).toBe("");
    expect(standard("um")).toBe("");
  });
});
