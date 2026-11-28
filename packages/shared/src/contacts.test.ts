import { describe, expect, it } from "vitest";
import {
  contactDraftSchema,
  mentionQuery,
  mentionToken,
  readableMentions,
  removeMentions,
  renameMentions,
} from "./contacts";

const priya = { id: "ab12", name: "Priya Rao" };
const text = `Ask ${mentionToken(priya)} and ${mentionToken({ id: "cd34", name: "Sam" })}.`;

describe("mentions (NT-12)", () => {
  it("renames and removes them, keeping the text around", () => {
    expect(readableMentions(renameMentions(text, "ab12", "Priya R"))).toBe(
      "Ask @Priya R and @Sam.",
    );
    expect(readableMentions(removeMentions(text, "ab12"))).toBe("Ask Priya Rao and @Sam.");
  });

  it("reads the name being typed after @", () => {
    expect(mentionQuery("hello @Pri", 10)).toEqual({ start: 6, query: "Pri" });
    expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQuery("(@Priya Rao", 11)).toEqual({ start: 1, query: "Priya Rao" });
    expect(mentionQuery("mail me@example.com", 19)).toBeNull();
    expect(mentionQuery(text, text.length)).toBeNull();
  });

  it("refuses a name that would break a mention", () => {
    expect(contactDraftSchema.safeParse({ name: "a|b", email: null }).success).toBe(false);
    expect(contactDraftSchema.parse({ name: " Sam ", email: "SAM@Example.com" })).toEqual({
      name: "Sam",
      email: "sam@example.com",
    });
  });
});
