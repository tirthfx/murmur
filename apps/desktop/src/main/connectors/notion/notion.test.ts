import { describe, expect, it } from "vitest";
import { blockLine, notionProvider, readPages } from "./notion";

const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), init);
const limits = (sleeps: number[] = []) => ({
  sleep: async (ms: number) => {
    sleeps.push(ms);
  },
});
const rich = (text: string) => [{ plain_text: text }];
const block = (type: string, text: string) => ({ type, [type]: { rich_text: rich(text) } });
const page = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  object: "page",
  id,
  url: `https://www.notion.so/${id}`,
  last_edited_time: "2026-11-20T10:00:00.000Z",
  properties: { Name: { type: "title", title: rich(title) } },
  ...over,
});

function fake(options: { pages: unknown[]; blocks?: Record<string, unknown[]> }) {
  const calls: { url: string; method: string; headers: Headers }[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers) });
    if (url.endsWith("/search")) return json({ results: options.pages, has_more: false });
    const id = url.split("/blocks/")[1]!.split("/")[0]!;
    return json({ results: options.blocks?.[id] ?? [], has_more: false });
  };
  return { fetch, calls };
}

describe("Notion provider (CN-06)", () => {
  it("asks for no scopes, proves itself with Basic and JSON, and listens on a fixed port", () => {
    expect(notionProvider.scopes).toEqual([]);
    expect(notionProvider.scopeParam).toBeNull();
    expect(notionProvider.tokenAuth).toBe("basic");
    expect(notionProvider.tokenBody).toBe("json");
    expect(notionProvider.tokenHeaders).toMatchObject({ "Notion-Version": expect.any(String) });
    expect(notionProvider.loopbackPort).toBe(17822);
  });

  it("names the account by its workspace", async () => {
    const label = await notionProvider.accountLabel({
      token: { accessToken: "t", refreshToken: null, expiresIn: null, scopes: [] },
      http: async () => json({ name: "Murmur bot", bot: { workspace_name: "Acme" } }),
    });
    expect(label).toBe("Acme");
  });
});

describe("blockLine", () => {
  it("flattens blocks into Markdown-like text and names, but does not walk, databases", () => {
    expect(blockLine(block("heading_2", "Plan"))).toBe("## Plan");
    expect(blockLine(block("bulleted_list_item", "One"))).toBe("- One");
    expect(blockLine(block("to_do", "Ship"))).toBe("- [ ] Ship");
    expect(blockLine(block("paragraph", "Words"))).toBe("Words");
    expect(blockLine({ type: "child_database", child_database: { title: "Tasks" } })).toBe(
      "[database: Tasks]",
    );
    expect(blockLine({ type: "child_page", child_page: { title: "Sub" } })).toBe("[page: Sub]");
    expect(blockLine(block("paragraph", "  "))).toBeNull();
    expect(blockLine({ type: "image", image: {} })).toBeNull();
    expect(blockLine("nope")).toBeNull();
  });
});

describe("readPages", () => {
  it("lists what Notion shares with the integration, with title, time, link and text", async () => {
    const t = fake({
      pages: [page("p1", "Roadmap")],
      blocks: { p1: [block("heading_1", "Goals"), block("paragraph", "Ship M6")] },
    });
    const items = await readPages({ fetch: t.fetch, limits: limits(), maxChars: 10_000 });
    expect(items).toEqual([
      {
        id: "p1",
        connector: "notion",
        kind: "page",
        title: "Roadmap",
        text: "# Goals\nShip M6",
        truncated: false,
        updatedAt: Date.parse("2026-11-20T10:00:00.000Z"),
        url: "https://www.notion.so/p1",
        tags: [],
      },
    ]);
    // Every request carries the version header; the pages come from search, so an unshared page is never asked about.
    expect(t.calls.every((c) => c.headers.get("notion-version") !== null)).toBe(true);
    expect(t.calls.map((c) => c.method)).toEqual(["POST", "GET"]);
  });

  it("cuts a page over the limit and marks it as cut", async () => {
    const t = fake({
      pages: [page("p1", "Long")],
      blocks: { p1: [block("paragraph", "x".repeat(900)), block("paragraph", "y".repeat(900))] },
    });
    const [item] = await readPages({ fetch: t.fetch, limits: limits(), maxChars: 1000 });
    expect(item!.text).toHaveLength(1000);
    expect(item!.truncated).toBe(true);
    expect(item!.tags).toEqual(["cut"]);
  });

  it("leaves out archived pages, names an untitled one, and drops a link that is not https", async () => {
    const t = fake({
      pages: [
        page("a", "Old", { archived: true }),
        page("b", "x", { properties: {}, url: "javascript:alert(1)" }),
      ],
    });
    const items = await readPages({ fetch: t.fetch, limits: limits(), maxChars: 1000 });
    expect(items.map((i) => [i.id, i.title, i.url])).toEqual([["b", "(Untitled)", null]]);
  });

  it("explains a refused sign-in and a busy service in plain words", async () => {
    await expect(
      readPages({ fetch: async () => json({}, { status: 401 }), limits: limits(), maxChars: 1000 }),
    ).rejects.toThrow("Notion no longer accepts this sign-in");
    await expect(
      readPages({
        fetch: async () => json({}, { status: 429, headers: { "retry-after": "1" } }),
        limits: limits(),
        maxChars: 1000,
      }),
    ).rejects.toThrow("Notion is busy just now");
  });
});
