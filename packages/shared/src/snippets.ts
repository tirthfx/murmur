import { z } from "zod";

// Snippets (PZ-08, PZ-09): a spoken trigger that inserts a saved body, plain or rich.

export const SNIPPET_LIMITS = {
  snippets: 1_000,
  triggerMin: 2,
  triggerMax: 60,
  /** Bytes of the stored body (UTF-8). */
  bodyBytes: 20 * 1024,
} as const;

// A small document model for rich bodies: paragraphs and lists of styled runs.

export const richInlineSchema = z.strictObject({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  /** Only http, https and mailto links are kept. */
  href: z.string().optional(),
});
export type RichInline = z.infer<typeof richInlineSchema>;

export const richBlockSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("paragraph"), inlines: z.array(richInlineSchema) }),
  z.strictObject({
    type: z.enum(["bullet", "numbered"]),
    items: z.array(z.array(richInlineSchema)),
  }),
]);
export type RichBlock = z.infer<typeof richBlockSchema>;

export const richDocSchema = z.strictObject({ blocks: z.array(richBlockSchema) });
export type RichDoc = z.infer<typeof richDocSchema>;

export const SNIPPET_FORMATS = ["plain", "rich_json"] as const;
export type SnippetFormat = (typeof SNIPPET_FORMATS)[number];

export const snippetSchema = z.strictObject({
  id: z.string().min(1),
  trigger: z.string().min(1),
  format: z.enum(SNIPPET_FORMATS),
  /** The body as plain text (what typed insertion and plain-text apps get). */
  plain: z.string(),
  /** The rich body, or null for a plain one. */
  rich: richDocSchema.nullable(),
  useCount: z.number().int().min(0),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Snippet = z.infer<typeof snippetSchema>;

/** What the Hub sends to add (no id) or change (with id) a snippet. */
export const snippetInputSchema = z.strictObject({
  id: z.string().min(1).optional(),
  trigger: z.string().max(SNIPPET_LIMITS.triggerMax + 20),
  /** A plain body when `rich` is null. */
  plain: z.string().max(SNIPPET_LIMITS.bodyBytes + 1024),
  rich: richDocSchema.nullable(),
});
export type SnippetInput = z.infer<typeof snippetInputSchema>;

export const SNIPPET_REFUSALS = [
  "empty-trigger",
  "trigger-length",
  "empty-body",
  "too-large",
  "duplicate",
  "full",
  "not-found",
] as const;

export const snippetSaveResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), snippet: snippetSchema }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum(SNIPPET_REFUSALS),
    message: z.string(),
  }),
]);
export type SnippetSaveResult = z.infer<typeof snippetSaveResultSchema>;

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Only links a mail or web app can open safely. */
export function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  return /^(https?:|mailto:)/i.test(trimmed) ? trimmed : null;
}

function inlineHtml(inline: RichInline): string {
  let html = escapeHtml(inline.text).replace(/\n/g, "<br>");
  if (inline.bold) html = `<b>${html}</b>`;
  if (inline.italic) html = `<i>${html}</i>`;
  if (inline.underline) html = `<u>${html}</u>`;
  const href = safeHref(inline.href);
  if (href) html = `<a href="${escapeHtml(href)}">${html}</a>`;
  return html;
}

const runsHtml = (inlines: readonly RichInline[]) => inlines.map(inlineHtml).join("");

/** The body as HTML for the pasteboard. */
export function richToHtml(doc: RichDoc): string {
  return doc.blocks
    .map((block) => {
      if (block.type === "paragraph") return `<p>${runsHtml(block.inlines) || "<br>"}</p>`;
      const tag = block.type === "bullet" ? "ul" : "ol";
      return `<${tag}>${block.items.map((item) => `<li>${runsHtml(item)}</li>`).join("")}</${tag}>`;
    })
    .join("");
}

/** The body as plain text: one line per paragraph and list item; links keep their address. */
export function richToPlain(doc: RichDoc): string {
  const runs = (inlines: readonly RichInline[]) =>
    inlines
      .map((inline) => {
        const href = safeHref(inline.href);
        return href && href !== inline.text && !href.endsWith(inline.text)
          ? `${inline.text} (${href.replace(/^mailto:/i, "")})`
          : inline.text;
      })
      .join("");
  return doc.blocks
    .flatMap((block) => {
      if (block.type === "paragraph") return [runs(block.inlines)];
      return block.items.map((item, index) =>
        block.type === "bullet" ? `• ${runs(item)}` : `${index + 1}. ${runs(item)}`,
      );
    })
    .join("\n");
}

/** A plain body as a document: one paragraph per line. */
export function plainToRich(text: string): RichDoc {
  return {
    blocks: text
      .split("\n")
      .map((line) => ({ type: "paragraph", inlines: line ? [{ text: line }] : [] })),
  };
}

/** Whether a document needs rich text at all: any mark, link or list. */
export function isRich(doc: RichDoc): boolean {
  return doc.blocks.some(
    (block) =>
      block.type !== "paragraph" ||
      block.inlines.some(
        (inline) => inline.bold || inline.italic || inline.underline || inline.href,
      ),
  );
}

/** Escapes plain text for HTML, keeping its line breaks. */
export function plainToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>");
}
