import { describe, expect, it } from "vitest";
import { markdownTitle, markdownToRich, richToMarkdown } from "./markdown";
import { richToPlain, type RichDoc } from "./snippets";

const doc: RichDoc = {
  blocks: [
    { type: "heading", level: 1, inlines: [{ text: "Trip plan" }] },
    {
      type: "paragraph",
      inlines: [
        { text: "Pack " },
        { text: "light", bold: true },
        { text: " and read " },
        { text: "the guide", href: "https://example.com/guide" },
        { text: "." },
      ],
    },
    { type: "heading", level: 2, inlines: [{ text: "To buy" }] },
    { type: "bullet", items: [[{ text: "maps" }], [{ text: "a hat", italic: true }]] },
    { type: "numbered", items: [[{ text: "book" }], [{ text: "go" }]] },
    { type: "image", imageId: "img-1" },
  ],
};

describe("Markdown", () => {
  it("writes headings, lists, marks and links", () => {
    expect(richToMarkdown(doc)).toBe(
      "# Trip plan\n\nPack **light** and read [the guide](https://example.com/guide).\n\n## To buy\n\n- maps\n- *a hat*\n\n1. book\n2. go\n",
    );
  });

  it("writes an image reference when given one", () => {
    expect(richToMarkdown(doc, (id) => `images/${id}.jpg`)).toContain("![Image](images/img-1.jpg)");
  });

  it("re-imports with its text and headings intact", () => {
    const back = markdownToRich(richToMarkdown(doc));
    expect(back.blocks.filter((block) => block.type === "heading")).toEqual([
      { type: "heading", level: 1, inlines: [{ text: "Trip plan" }] },
      { type: "heading", level: 2, inlines: [{ text: "To buy" }] },
    ]);
    const withoutImage = { blocks: doc.blocks.filter((block) => block.type !== "image") };
    expect(back).toEqual(withoutImage);
    expect(richToPlain(back)).toBe(richToPlain(withoutImage));
  });

  it("escapes characters that would change meaning", () => {
    const md = richToMarkdown({
      blocks: [{ type: "paragraph", inlines: [{ text: "2*3 [x] _y_" }] }],
    });
    expect(md).toBe("2\\*3 \\[x\\] \\_y\\_\n");
    expect(richToPlain(markdownToRich(md))).toBe("2*3 [x] _y_");
  });

  it("keeps unsafe links out", () => {
    const back = markdownToRich("[click](javascript:alert(1))");
    expect(JSON.stringify(back)).not.toContain("javascript");
  });

  it("titles an import by its first heading, else the file name", () => {
    expect(markdownTitle("text\n## **Plan**\n", "x.md")).toBe("Plan");
    expect(markdownTitle("just text", "Ideas.md")).toBe("Ideas");
  });
});
