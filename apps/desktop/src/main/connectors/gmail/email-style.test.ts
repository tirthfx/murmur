import { describe, expect, it } from "vitest";
import { describeEmailStyle } from "@murmur/shared";
import { learnEmailStyle, ownLines } from "./email-style";

const mail = (name: string, body: string) => `Hi ${name},\n\n${body}\n\nBest,\nSam`;

describe("learning how email is written (PZ-23)", () => {
  it("leaves out the quoted mail and the signature", () => {
    expect(ownLines("Sure.\n\nOn Mon, 3 Nov, Dana wrote:\n> Hello")).toEqual(["Sure."]);
    expect(ownLines("Sure.\n-- \nSam, Acme")).toEqual(["Sure."]);
    expect(ownLines("> old")).toEqual([]);
  });

  it("finds the usual opening, sign-off and length", () => {
    const style = learnEmailStyle(
      [
        mail("Priya", "The plan is ready for you."),
        mail("Dana", "Tuesday works."),
        mail("Lee", "I will send the numbers tomorrow morning."),
        "ok",
      ],
      5,
    );
    expect(style).toEqual({
      greeting: "Hi {name},",
      signOff: "Best,",
      words: 10,
      messages: 4,
      learnedAt: 5,
    });
    expect(describeEmailStyle(style!)).toBe(
      "Open with “Hi {name},”. Sign off with “Best,”. Messages are usually about 10 words.",
    );
  });

  it("keeps a group opening as it is and says when there is no habit", () => {
    const style = learnEmailStyle(["Hello all,\nNews.", "Hello All,\nMore.", "Done."], 1);
    expect(style?.greeting).toBe("Hello all,");
    expect(style?.signOff).toBeNull();
    expect(describeEmailStyle(style!)).toContain("No usual sign-off.");
  });

  it("does not guess from too little", () => {
    expect(learnEmailStyle(["Hi,\nOne.", "Two."], 1)).toBeNull();
    expect(learnEmailStyle([], 1)).toBeNull();
  });
});
