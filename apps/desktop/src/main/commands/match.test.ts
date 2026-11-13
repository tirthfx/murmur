import { describe, expect, it } from "vitest";
import { COMMANDS, type CommandId } from "@murmur/shared";
import { afterWakePhrase, findLanguage, matchCommand, normalise } from "./match";

/** 60 phrases as people say them, not the catalogue's own examples (RW-09: 90% or more). */
const TEST_SET: [string, CommandId][] = [
  ["Make this shorter, please.", "shorter"],
  ["can you shorten that", "shorter"],
  ["cut it down", "shorter"],
  ["make it more concise", "shorter"],
  ["Make it clearer.", "clearer"],
  ["could you simplify this", "clearer"],
  ["make that easier to understand", "clearer"],
  ["Turn it into a list.", "list"],
  ["bullet points please", "list"],
  ["make this a numbered list", "list"],
  ["make it more formal", "formal"],
  ["sound professional", "formal"],
  ["make it friendlier", "friendly"],
  ["make this a bit more casual", "friendly"],
  ["less formal please", "friendly"],
  ["Translate this to Spanish.", "translate"],
  ["translate into french", "translate"],
  ["put this in German", "translate"],
  ["say that in Japanese", "translate"],
  ["fix the grammar", "grammar"],
  ["check the spelling", "grammar"],
  ["fix any typos", "grammar"],
  ["proofread it", "grammar"],
  ["fix it up", "grammar"],
  ["Uppercase that.", "uppercase"],
  ["all caps", "uppercase"],
  ["make it upper case", "uppercase"],
  ["lowercase this", "lowercase"],
  ["make that lower case", "lowercase"],
  ["capitalize that", "capitalise"],
  ["title case please", "capitalise"],
  ["Delete that.", "delete"],
  ["remove it", "delete"],
  ["get rid of this", "delete"],
  ["scratch that", "delete"],
  ["new line", "new_line"],
  ["Next line.", "new_line"],
  ["new paragraph", "new_paragraph"],
  ["start a new paragraph", "new_paragraph"],
  ["Bold that.", "bold"],
  ["make it bold", "bold"],
  ["put that in bold", "bold"],
  ["italicize it", "italic"],
  ["make that italic", "italic"],
  ["select all", "select_all"],
  ["select everything", "select_all"],
  ["undo that", "undo"],
  ["undo", "undo"],
  ["take it back", "undo"],
  ["press enter", "press_enter"],
  ["hit return", "press_enter"],
  ["Enter.", "press_enter"],
  ["add a summary below", "summary"],
  ["summarize this", "summary"],
  ["give me the gist", "summary"],
  ["TL;DR", "summary"],
  ["list the questions", "questions"],
  ["what questions are in here", "questions"],
  ["pull out the questions", "questions"],
  ["okay so could you make it shorter thanks", "shorter"],
];

describe("matchCommand", () => {
  it("maps the 60-phrase test set with at least 90% accuracy", () => {
    expect(TEST_SET).toHaveLength(60);
    const wrong = TEST_SET.filter(([phrase, id]) => matchCommand(phrase)?.id !== id);
    expect(wrong).toEqual([]);
    expect(1 - wrong.length / TEST_SET.length).toBeGreaterThanOrEqual(0.9);
  });

  it("maps every example phrase in the catalogue to its own command", () => {
    for (const command of COMMANDS) {
      for (const phrase of command.phrases) {
        expect(matchCommand(phrase)?.id, phrase).toBe(command.id);
      }
    }
  });

  it("names the language for translate, or none", () => {
    expect(matchCommand("translate to Hindi")).toEqual({ id: "translate", language: "Hindi" });
    expect(matchCommand("translate this into Mandarin")).toEqual({
      id: "translate",
      language: "Chinese",
    });
    expect(matchCommand("translate this")).toEqual({ id: "translate", language: null });
    expect(findLanguage("no language here")).toBeNull();
  });

  it("leaves what is not a command to the model", () => {
    expect(matchCommand("what's the weather like")).toBeNull();
    expect(matchCommand("")).toBeNull();
    expect(matchCommand("please")).toBeNull();
    expect(
      matchCommand(
        "I was thinking that maybe we could go over the budget again on Thursday if that suits everyone",
      ),
    ).toBeNull();
  });

  it("drops polite padding", () => {
    expect(normalise("Okay, could you please make it shorter? Thanks!")).toBe("make it shorter");
  });
});

describe("afterWakePhrase", () => {
  it("returns what follows the wake phrase", () => {
    expect(afterWakePhrase("Hey Murmur, make this a list.", "Hey Murmur")).toBe(
      "make this a list.",
    );
    expect(afterWakePhrase("hey murmer make it shorter", "Hey Murmur")).toBe("make it shorter");
    expect(afterWakePhrase("Hey, Murmur.", "Hey Murmur")).toBe("");
  });

  it("is null when the text does not start with it", () => {
    expect(afterWakePhrase("I said hey Murmur to it", "Hey Murmur")).toBeNull();
    expect(afterWakePhrase("Hey Mormon", "Hey Murmur")).toBeNull();
    expect(afterWakePhrase("Hey", "Hey Murmur")).toBeNull();
    expect(afterWakePhrase("Hello there", "")).toBeNull();
  });

  it("works with another wake phrase", () => {
    expect(afterWakePhrase("Computer: bold that", "computer")).toBe("bold that");
  });
});
