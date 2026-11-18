// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { richToHtml } from "@murmur/shared";
import { domToRich } from "./rich-text";

const read = (html: string) => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return domToRich(root);
};

describe("reading the snippet editor", () => {
  it("keeps bold, italic, underline and safe links, one paragraph per line", () => {
    expect(
      read(
        'Hi <b>there</b><div><i>Best</i>, <a href="https://example.com">site</a></div><div><br></div><div><u>x</u></div>',
      ),
    ).toEqual({
      blocks: [
        { type: "paragraph", inlines: [{ text: "Hi " }, { text: "there", bold: true }] },
        {
          type: "paragraph",
          inlines: [
            { text: "Best", italic: true },
            { text: ", " },
            { text: "site", href: "https://example.com" },
          ],
        },
        { type: "paragraph", inlines: [] },
        { type: "paragraph", inlines: [{ text: "x", underline: true }] },
      ],
    });
  });

  it("reads lists and drops unsafe links and scripts", () => {
    expect(
      read('<ul><li>one</li><li><a href="javascript:alert(1)">two</a></li></ul><script>x</script>'),
    ).toEqual({
      blocks: [{ type: "bullet", items: [[{ text: "one" }], [{ text: "two" }]] }],
    });
  });

  it("reads back what it writes", () => {
    const doc = {
      blocks: [
        { type: "paragraph" as const, inlines: [{ text: "Bold", bold: true }, { text: " text" }] },
        { type: "numbered" as const, items: [[{ text: "first" }], [{ text: "second" }]] },
      ],
    };
    expect(read(richToHtml(doc))).toEqual(doc);
  });
});

describe("images in notes (HB-30)", () => {
  function box(html: string): HTMLElement {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div;
  }

  it("keeps stored images as blocks only when allowed", () => {
    const html =
      '<p>Before</p><p><img data-image-id="img-1" src="data:image/png;base64,AA"></p><p>After</p>';
    expect(domToRich(box(html), { images: true }).blocks).toEqual([
      { type: "paragraph", inlines: [{ text: "Before" }] },
      { type: "image", imageId: "img-1" },
      { type: "paragraph", inlines: [{ text: "After" }] },
    ]);
    expect(domToRich(box(html)).blocks.some((block) => block.type === "image")).toBe(false);
  });

  it("drops images that are not stored ones", () => {
    const html = '<img src="https://example.com/x.png"><img data-image-id="../bad">';
    expect(domToRich(box(html), { images: true }).blocks).toEqual([]);
  });
});
