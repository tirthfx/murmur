import { safeHref, type RichBlock, type RichDoc, type RichInline } from "@murmur/shared";

// Reads what the snippet editor (a contentEditable box) holds into the snippet document
// model. Anything the model has no place for (fonts, colours, scripts) is dropped. Images
// are kept only where allowed (Scratchpad notes) and only as stored image ids.

interface Marks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  href?: string;
}

const BLOCK_TAGS = new Set(["DIV", "P", "H1", "H2", "H3", "H4", "BLOCKQUOTE", "PRE"]);

function sameMarks(a: RichInline, b: RichInline): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    (a.href ?? "") === (b.href ?? "")
  );
}

function withMarks(text: string, marks: Marks): RichInline {
  const inline: RichInline = { text };
  if (marks.bold) inline.bold = true;
  if (marks.italic) inline.italic = true;
  if (marks.underline) inline.underline = true;
  if (marks.href) inline.href = marks.href;
  return inline;
}

/** Joins neighbours with the same marks and drops empty runs. */
function tidy(inlines: RichInline[]): RichInline[] {
  const out: RichInline[] = [];
  for (const inline of inlines) {
    if (inline.text === "") continue;
    const last = out.at(-1);
    if (last && sameMarks(last, inline)) last.text += inline.text;
    else out.push({ ...inline });
  }
  // A line break at the very end is how the editor keeps an empty line open; drop it.
  const last = out.at(-1);
  if (last) {
    last.text = last.text.replace(/\n$/, "");
    if (last.text === "") out.pop();
  }
  return out;
}

function inlinesOf(node: Node, marks: Marks): RichInline[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return [withMarks((node.textContent ?? "").replace(/\u00a0/g, " "), marks)];
  }
  if (!(node instanceof HTMLElement)) return [];
  const tag = node.tagName;
  if (tag === "BR") return [withMarks("\n", marks)];
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "IMG") return [];
  const next: Marks = { ...marks };
  if (tag === "B" || tag === "STRONG" || /bold|[6-9]00/.test(node.style.fontWeight))
    next.bold = true;
  if (tag === "I" || tag === "EM" || node.style.fontStyle === "italic") next.italic = true;
  if (tag === "U" || node.style.textDecoration.includes("underline")) next.underline = true;
  if (tag === "A") {
    const href = safeHref(node.getAttribute("href") ?? undefined);
    if (href) next.href = href;
  }
  const inner = [...node.childNodes].flatMap((child) => inlinesOf(child, next));
  // A nested block inside an inline run starts a new line.
  return BLOCK_TAGS.has(tag) ? [...inner, withMarks("\n", marks)] : inner;
}

const IMAGE_ID = /^[\w-]{1,64}$/;

/** Stored images inside an element, in order (HB-30). */
function imagesIn(node: HTMLElement): string[] {
  const own = node.tagName === "IMG" ? [node] : [...node.querySelectorAll("img")];
  return own
    .map((img) => img.getAttribute("data-image-id") ?? "")
    .filter((id) => IMAGE_ID.test(id));
}

/** The editor's content as a document. With `images`, stored images are kept as blocks. */
export function domToRich(
  root: HTMLElement,
  options: { images?: boolean; headings?: boolean } = {},
): RichDoc {
  const blocks: RichBlock[] = [];
  const pushImages = (node: HTMLElement) => {
    if (!options.images) return;
    for (const imageId of imagesIn(node)) blocks.push({ type: "image", imageId });
  };
  let loose: RichInline[] = [];
  const flush = () => {
    if (loose.length > 0) {
      blocks.push({ type: "paragraph", inlines: tidy(loose) });
      loose = [];
    }
  };
  for (const child of root.childNodes) {
    if (child instanceof HTMLElement && (child.tagName === "UL" || child.tagName === "OL")) {
      flush();
      const items = [...child.children]
        .filter((item) => item.tagName === "LI")
        .map((item) => tidy(inlinesOf(item, {})));
      blocks.push({ type: child.tagName === "UL" ? "bullet" : "numbered", items });
    } else if (child instanceof HTMLElement && child.tagName === "IMG") {
      flush();
      pushImages(child);
    } else if (
      options.headings &&
      child instanceof HTMLElement &&
      (child.tagName === "H1" || child.tagName === "H2" || child.tagName === "H3")
    ) {
      flush();
      blocks.push({
        type: "heading",
        level: Number(child.tagName[1]) as 1 | 2 | 3,
        inlines: tidy([...child.childNodes].flatMap((node) => inlinesOf(node, {}))),
      });
    } else if (child instanceof HTMLElement && BLOCK_TAGS.has(child.tagName)) {
      flush();
      const inlines = tidy([...child.childNodes].flatMap((node) => inlinesOf(node, {})));
      // A paragraph holding only an image is just the image.
      if (inlines.length > 0 || imagesIn(child).length === 0 || !options.images) {
        blocks.push({ type: "paragraph", inlines });
      }
      pushImages(child);
    } else {
      loose.push(...inlinesOf(child, {}));
    }
  }
  flush();
  // Empty paragraphs at the end are left over from editing.
  while (blocks.length > 0) {
    const last = blocks.at(-1)!;
    if (last.type === "paragraph" && last.inlines.length === 0) blocks.pop();
    else break;
  }
  // A loose run with line breaks becomes one paragraph per line.
  return {
    blocks: blocks.flatMap((block) => {
      if (
        block.type !== "paragraph" ||
        !block.inlines.some((inline) => inline.text.includes("\n"))
      ) {
        return [block];
      }
      const lines: RichInline[][] = [[]];
      for (const inline of block.inlines) {
        inline.text.split("\n").forEach((part, index) => {
          if (index > 0) lines.push([]);
          if (part) lines.at(-1)!.push({ ...inline, text: part });
        });
      }
      return lines.map((inlines) => ({ type: "paragraph" as const, inlines }));
    }),
  };
}
