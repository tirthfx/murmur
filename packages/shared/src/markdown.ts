import { safeHref, type RichBlock, type RichDoc, type RichInline } from "./snippets";

/**
 * Markdown for Scratchpad notes (HB-27, HB-33): "Copy as Markdown", export and import of one
 * note. Headings, paragraphs, lists, bold, italic and links survive a round trip; underline
 * has no Markdown form and is kept as plain text.
 */

/** Characters that would change meaning in Markdown text. */
function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, "\\$1");
}

function inlineMarkdown(inline: RichInline): string {
  let text = escapeMarkdown(inline.text);
  // Marks wrap the words, not the spaces around them.
  const lead = text.match(/^\s*/)![0];
  const trail = text.slice(lead.length).match(/\s*$/)![0];
  let core = text.slice(lead.length, text.length - trail.length);
  if (core !== "") {
    if (inline.bold) core = `**${core}**`;
    if (inline.italic) core = `*${core}*`;
    const href = safeHref(inline.href);
    if (href) core = `[${core}](${href.replace(/[()\s]/g, encodeURIComponent)})`;
  }
  text = lead + core + trail;
  return text;
}

const runs = (inlines: readonly RichInline[]) => inlines.map(inlineMarkdown).join("");

/** `image` gives the reference for an image block, or null to leave it out. */
export function richToMarkdown(
  doc: RichDoc,
  image: (imageId: string) => string | null = () => null,
): string {
  const parts: string[] = [];
  for (const block of doc.blocks) {
    if (block.type === "heading") parts.push(`${"#".repeat(block.level)} ${runs(block.inlines)}`);
    else if (block.type === "paragraph") parts.push(runs(block.inlines));
    else if (block.type === "image") {
      const ref = image(block.imageId);
      if (ref) parts.push(`![Image](${ref})`);
    } else {
      parts.push(
        block.items
          .map((item, index) =>
            block.type === "bullet" ? `- ${runs(item)}` : `${index + 1}. ${runs(item)}`,
          )
          .join("\n"),
      );
    }
  }
  // Empty paragraphs keep their place as blank lines.
  return `${parts
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

/** Inline Markdown: **bold**, *italic* or _italic_, [text](link), and \-escapes. */
export function markdownInlines(text: string): RichInline[] {
  const out: RichInline[] = [];
  const push = (inline: RichInline) => {
    if (inline.text) out.push(inline);
  };
  let i = 0;
  let plain = "";
  const flushPlain = () => {
    push({ text: plain });
    plain = "";
  };
  while (i < text.length) {
    const rest = text.slice(i);
    if (rest[0] === "\\" && rest.length > 1) {
      plain += rest[1];
      i += 2;
      continue;
    }
    const bold = /^\*\*(.+?)\*\*/.exec(rest);
    if (bold) {
      flushPlain();
      for (const inner of markdownInlines(bold[1]!)) push({ ...inner, bold: true });
      i += bold[0].length;
      continue;
    }
    const italic = /^(\*|_)(?!\s)(.+?)\1/.exec(rest);
    if (italic) {
      flushPlain();
      for (const inner of markdownInlines(italic[2]!)) push({ ...inner, italic: true });
      i += italic[0].length;
      continue;
    }
    const link = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      flushPlain();
      const href = safeHref(decodeURIComponentSafe(link[2]!));
      for (const inner of markdownInlines(link[1]!)) push(href ? { ...inner, href } : inner);
      i += link[0].length;
      continue;
    }
    const image = /^!\[[^\]]*\]\([^)]*\)/.exec(rest);
    if (image) {
      // Images in imported Markdown are left out: notes only hold images stored here.
      i += image[0].length;
      continue;
    }
    plain += rest[0];
    i += 1;
  }
  flushPlain();
  return out;
}

function decodeURIComponentSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** A Markdown document as a note body. Lines join into paragraphs until a blank line. */
export function markdownToRich(markdown: string): RichDoc {
  const blocks: RichBlock[] = [];
  let paragraph: string[] = [];
  let list: { type: "bullet" | "numbered"; items: RichInline[][] } | null = null;
  const endParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", inlines: markdownInlines(paragraph.join(" ")) });
      paragraph = [];
    }
  };
  const endList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (line.trim() === "") {
      endParagraph();
      endList();
    } else if (heading) {
      endParagraph();
      endList();
      const level = Math.min(3, heading[1]!.length) as 1 | 2 | 3;
      blocks.push({
        type: "heading",
        level,
        inlines: markdownInlines(heading[2]!.replace(/\s+#+$/, "")),
      });
    } else if (bullet || numbered) {
      endParagraph();
      const type = bullet ? "bullet" : "numbered";
      if (!list || list.type !== type) {
        endList();
        list = { type, items: [] };
      }
      list.items.push(markdownInlines((bullet ?? numbered)![1]!));
    } else {
      endList();
      paragraph.push(line.trim());
    }
  }
  endParagraph();
  endList();
  return { blocks };
}

/** The title of an imported note: its first heading, or the file name. */
export function markdownTitle(markdown: string, fileName: string): string {
  const heading = /^#{1,6}\s+(.+)$/m.exec(markdown);
  const fromFile = fileName.replace(/\.(md|markdown|txt)$/i, "").trim();
  return (heading?.[1]?.replace(/[*_`\\]/g, "").trim() || fromFile || "Imported note").slice(
    0,
    200,
  );
}

/** One note as a standalone HTML page; images are passed in as data URLs. */
export function noteHtmlDocument(title: string, bodyHtml: string): string {
  const safeTitle = title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem}img{max-width:100%;height:auto}</style>
</head>
<body>
<h1>${safeTitle}</h1>
${bodyHtml}
</body>
</html>
`;
}
