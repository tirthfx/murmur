import { describe, expect, it } from "vitest";
import { detectCategory } from "./detect";

describe("style detection", () => {
  it("reads a greeting at the start of an empty field as Email", () => {
    expect(detectCategory("", "Hi Sam, the report is attached.")).toEqual({
      category: "email",
      confidence: 0.8,
    });
    expect(detectCategory("Dear Ms Rao,\n\n", "Thank you for the quick reply.")?.category).toBe(
      "email",
    );
    // In a field that already has text, the field's start counts, not what was said.
    expect(detectCategory("lol same", "Hi Sam, see you")).toBeNull();
  });

  it("reads emoji and short lines as Personal", () => {
    expect(detectCategory("haha 😂", "see you soon")?.category).toBe("personal");
    expect(detectCategory("ok\nsure\nwhen?\n", "tomorrow 🙌 works 👍")?.category).toBe("personal");
  });

  it("is unsure, and returns nothing, without clear signals", () => {
    expect(detectCategory("", "The build is green again.")).toBeNull();
    expect(detectCategory("", "hi sam, lunch?")).toBeNull();
    expect(detectCategory("", "Best,")).toBeNull();
  });
});
