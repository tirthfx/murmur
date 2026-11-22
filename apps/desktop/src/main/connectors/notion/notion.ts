import { z } from "zod";
import { CONNECTOR_DATA_LIMITS, NOTION_ID, type ConnectorItem } from "@murmur/shared";
import type { ConnectorProvider } from "../providers";
import {
  ReadError,
  clip,
  jsonOf,
  requestWithRetry,
  timeOf,
  type Fetch,
  type RateLimitOptions,
} from "../data/http";

const API = "https://api.notion.com/v1";
/** The only place a Notion token is sent. */
export const NOTION_ORIGIN = "https://api.notion.com";
const VERSION = { "Notion-Version": "2022-06-28" } as const;

/**
 * Notion (CN-06): a public integration the owner registered. Notion has no scopes in the sign-in:
 * what is visible is only the pages the owner shares with the integration, which is the selection.
 * The app proves itself with HTTP Basic and a JSON body, and the redirect address is exact, so the
 * sign-in listens on port 17822: register `http://127.0.0.1:17822/callback`. Tokens do not expire.
 */
export const notionProvider: ConnectorProvider = {
  id: NOTION_ID,
  name: "Notion",
  authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
  tokenUrl: `${API}/oauth/token`,
  revokeUrl: null,
  scopes: [],
  scopeParam: null,
  authorizeParams: { owner: "user" },
  tokenAuth: "basic",
  tokenBody: "json",
  tokenHeaders: VERSION,
  loopbackPort: 17822,
  needsClientSecret: true,
  async accountLabel({ token, http }) {
    const response = await http(`${API}/users/me`, {
      headers: { authorization: `Bearer ${token.accessToken}`, ...VERSION },
    });
    if (!response.ok) throw new Error("profile failed");
    const body = z
      .object({
        name: z.string().nullish(),
        bot: z.object({ workspace_name: z.string().nullish() }).nullish(),
      })
      .parse(await response.json());
    const label = body.bot?.workspace_name || body.name;
    if (!label) throw new Error("no workspace");
    return label;
  },
};

// ------------------------------------------------------------------ reads

const richText = z.array(z.object({ plain_text: z.string().optional() }));
const plain = (parts: z.infer<typeof richText> | undefined) =>
  (parts ?? []).map((part) => part.plain_text ?? "").join("");

const pageSchema = z.object({
  id: z.string().min(1),
  url: z.string().optional(),
  last_edited_time: z.string().optional(),
  archived: z.boolean().optional(),
  in_trash: z.boolean().optional(),
  properties: z
    .record(z.string(), z.object({ type: z.string(), title: richText.optional() }).passthrough())
    .optional(),
});

const searchSchema = z.object({
  results: z.array(z.unknown()),
  has_more: z.boolean().optional(),
  next_cursor: z.string().nullish(),
});

const blockSchema = z
  .object({
    type: z.string(),
    child_page: z.object({ title: z.string().optional() }).optional(),
    child_database: z.object({ title: z.string().optional() }).optional(),
  })
  .passthrough();

const childrenSchema = z.object({
  results: z.array(z.unknown()),
  has_more: z.boolean().optional(),
  next_cursor: z.string().nullish(),
});

const TEXT_BLOCKS = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "quote",
  "callout",
  "toggle",
  "code",
]);

/** One block as a line of Markdown-like text; null for a block that has no text. Databases are named, not walked. */
export function blockLine(raw: unknown): string | null {
  const block = blockSchema.safeParse(raw);
  if (!block.success) return null;
  const { type } = block.data;
  if (type === "child_page") return `[page: ${block.data.child_page?.title ?? ""}]`;
  if (type === "child_database") return `[database: ${block.data.child_database?.title ?? ""}]`;
  if (!TEXT_BLOCKS.has(type)) return null;
  const inner = (block.data as Record<string, unknown>)[type] as
    { rich_text?: z.infer<typeof richText> } | undefined;
  const text = plain(inner?.rich_text).trim();
  if (text === "") return null;
  if (type === "heading_1") return `# ${text}`;
  if (type === "heading_2") return `## ${text}`;
  if (type === "heading_3") return `### ${text}`;
  if (type === "bulleted_list_item") return `- ${text}`;
  if (type === "numbered_list_item") return `1. ${text}`;
  if (type === "to_do") return `- [ ] ${text}`;
  if (type === "quote") return `> ${text}`;
  return text;
}

async function request(
  fetch: Fetch,
  url: string,
  init: RequestInit | undefined,
  limits: RateLimitOptions,
): Promise<unknown> {
  const response = await requestWithRetry(
    fetch,
    url,
    { ...init, headers: { ...VERSION, ...init?.headers } },
    limits,
    "Notion",
  );
  if (response.status === 401)
    throw new ReadError("Notion no longer accepts this sign-in. Connect again.");
  if (!response.ok) throw new ReadError(`Notion answered ${response.status}.`);
  const body = await jsonOf(response);
  if (body === null) throw new ReadError("Notion sent an answer Murmur cannot read.");
  return body;
}

const BLOCK_REQUESTS = 3;

/** A page's text from its first blocks, cut at `maxChars`; `truncated` says it was cut. */
async function pageText(options: {
  fetch: Fetch;
  limits: RateLimitOptions;
  id: string;
  maxChars: number;
}): Promise<{ text: string; truncated: boolean }> {
  const lines: string[] = [];
  let length = 0;
  let cursor: string | null = null;
  let more = false;
  for (let call = 0; call < BLOCK_REQUESTS; call++) {
    const query = new URLSearchParams({
      page_size: "100",
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    const parsed = childrenSchema.safeParse(
      await request(
        options.fetch,
        `${API}/blocks/${encodeURIComponent(options.id)}/children?${query}`,
        undefined,
        options.limits,
      ),
    );
    if (!parsed.success) throw new ReadError("Notion sent an answer Murmur cannot read.");
    for (const block of parsed.data.results) {
      const line = blockLine(block);
      if (line === null) continue;
      lines.push(line);
      length += line.length + 1;
    }
    cursor = parsed.data.next_cursor ?? null;
    more = parsed.data.has_more === true && cursor !== null;
    if (!more || length > options.maxChars) break;
  }
  const full = lines.join("\n");
  const truncated = full.length > options.maxChars || more;
  return { text: full.slice(0, options.maxChars), truncated };
}

/**
 * The pages shared with the integration, most recently edited first: the title, the time of the
 * last edit, and the page's text up to `maxChars` (marked as cut when it was). A page that is not
 * shared never appears in what Notion answers, so it is in no list.
 */
export async function readPages(options: {
  fetch: Fetch;
  limits: RateLimitOptions;
  maxChars: number;
  max?: number;
}): Promise<ConnectorItem[]> {
  const max = options.max ?? CONNECTOR_DATA_LIMITS.pages;
  const pages: z.infer<typeof pageSchema>[] = [];
  let cursor: string | null = null;
  for (let call = 0; call < 3 && pages.length < max; call++) {
    const body = searchSchema.safeParse(
      await request(
        options.fetch,
        `${API}/search`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filter: { property: "object", value: "page" },
            sort: { direction: "descending", timestamp: "last_edited_time" },
            page_size: 25,
            ...(cursor ? { start_cursor: cursor } : {}),
          }),
        },
        options.limits,
      ),
    );
    if (!body.success) throw new ReadError("Notion sent an answer Murmur cannot read.");
    for (const raw of body.data.results) {
      const page = pageSchema.safeParse(raw);
      if (page.success && !page.data.archived && !page.data.in_trash) pages.push(page.data);
    }
    cursor = body.data.next_cursor ?? null;
    if (body.data.has_more !== true || cursor === null) break;
  }

  const items: ConnectorItem[] = [];
  for (const page of pages.slice(0, max)) {
    const titleProperty = Object.values(page.properties ?? {}).find((p) => p.type === "title");
    const title = clip(plain(titleProperty?.title), CONNECTOR_DATA_LIMITS.titleChars, true);
    const { text, truncated } = await pageText({
      fetch: options.fetch,
      limits: options.limits,
      id: page.id,
      maxChars: options.maxChars,
    });
    items.push({
      id: page.id,
      connector: NOTION_ID,
      kind: "page",
      title: title || "(Untitled)",
      text,
      truncated,
      updatedAt: timeOf(page.last_edited_time),
      url: page.url && /^https:\/\//i.test(page.url) ? page.url : null,
      tags: truncated ? ["cut"] : [],
    });
  }
  return items;
}
