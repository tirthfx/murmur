import { describe, expect, it } from "vitest";
import { GITHUB_SCOPES } from "@murmur/shared";
import { githubProvider, readGithub, type EtagMap } from "./github";

const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), init);
const limits = { sleep: async () => undefined };
const NOW = Date.parse("2026-11-22T12:00:00Z");

const issue = (n: number, over: Record<string, unknown> = {}) => ({
  number: n,
  title: `Issue ${n}`,
  state: "open",
  html_url: `https://github.com/acme/app/issues/${n}`,
  updated_at: "2026-11-20T10:00:00Z",
  labels: [{ name: "bug" }],
  ...over,
});

function fake(answer: (url: string, headers: Headers) => Response) {
  const calls: { url: string; headers: Headers }[] = [];
  return {
    calls,
    fetch: async (url: string, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      calls.push({ url, headers });
      return answer(url, headers);
    },
  };
}

const run = (t: ReturnType<typeof fake>, options: { repos?: string[]; etags?: EtagMap } = {}) =>
  readGithub({
    fetch: t.fetch,
    limits,
    repos: options.repos ?? ["acme/app"],
    login: "octocat",
    now: NOW,
    etags: options.etags ?? {},
  });

describe("GitHub provider (CN-08)", () => {
  it("asks only who the account is, and names it by its login", async () => {
    expect(githubProvider.scopes).toEqual([...GITHUB_SCOPES]);
    expect(githubProvider.scopes).toEqual(["read:user"]);
    const label = await githubProvider.accountLabel({
      token: { accessToken: "t", refreshToken: null, expiresIn: null, scopes: [] },
      http: async () => json({ login: "octocat" }),
    });
    expect(label).toBe("octocat");
  });
});

describe("readGithub", () => {
  it("never asks about a repository that was not selected, or one that is not a repository name", async () => {
    const t = fake(() => json([]));
    await run(t, { repos: ["acme/app", "not a repo", "../etc/passwd"] });
    expect(t.calls.length).toBe(2);
    expect(
      t.calls.every((c) => c.url.startsWith("https://api.github.com/repos/acme/app/issues?")),
    ).toBe(true);
    await run(
      fake(() => json([])),
      { repos: [] },
    );
    const none = fake(() => json([]));
    await run(none, { repos: [] });
    expect(none.calls).toEqual([]);
  });

  it("asks once for what is assigned and once for what mentions the owner, with a stable address in a day", async () => {
    const t = fake(() => json([]));
    await run(t);
    const queries = t.calls.map((c) => new URL(c.url).searchParams);
    expect(queries.map((q) => [q.get("assignee"), q.get("mentioned")])).toEqual([
      ["octocat", null],
      [null, "octocat"],
    ]);
    expect(queries[0]!.get("since")).toBe("2026-11-08T00:00:00.000Z");
    expect(t.calls[0]!.headers.get("x-github-api-version")).toBe("2022-11-28");
  });

  it("reads issues and pull requests, once each, with state and labels", async () => {
    const t = fake((url) =>
      new URL(url).searchParams.get("assignee")
        ? json([issue(1), issue(2, { pull_request: {}, labels: ["wip"], state: "closed" })])
        : json([
            issue(2, { pull_request: {}, labels: ["wip"], state: "closed" }),
            issue(3, { updated_at: "2026-11-21T10:00:00Z" }),
          ]),
    );
    const { items } = await run(t);
    expect(items.map((i) => [i.id, i.kind])).toEqual([
      ["acme/app#3", "issue"],
      ["acme/app#1", "issue"],
      ["acme/app#2", "pull_request"],
    ]);
    expect(items.find((i) => i.id === "acme/app#2")).toMatchObject({
      title: "acme/app#2 Issue 2",
      text: "closed: Issue 2",
      tags: ["closed", "wip"],
      url: "https://github.com/acme/app/issues/2",
    });
  });

  it("keeps what it had on a 304, and asks with the ETag it kept", async () => {
    const first = fake(() => json([issue(1)], { headers: { etag: 'W/"abc"' } }));
    const a = await run(first);
    expect(Object.keys(a.etags)).toHaveLength(2);

    const second = fake((_url, headers) =>
      headers.get("if-none-match") === 'W/"abc"' ? new Response(null, { status: 304 }) : json([]),
    );
    const b = await run(second, { etags: a.etags });
    expect(second.calls.every((c) => c.headers.get("if-none-match") === 'W/"abc"')).toBe(true);
    expect(b.items).toEqual(a.items);
    expect(b.etags).toEqual(a.etags);
  });

  it("skips a repository this sign-in cannot see and says which, and keeps reading the others", async () => {
    const t = fake((url) =>
      url.includes("/acme/secret/") ? json({}, { status: 404 }) : json([issue(1)]),
    );
    const { items, problems } = await run(t, { repos: ["acme/secret", "acme/app"] });
    expect(items.map((i) => i.id)).toEqual(["acme/app#1"]);
    expect(problems).toEqual(["acme/secret cannot be read with this sign-in."]);
  });

  it("explains a refused sign-in, a used-up rate limit and an unreadable answer", async () => {
    await expect(run(fake(() => json({}, { status: 401 })))).rejects.toThrow("no longer accepts");
    await expect(
      run(fake(() => json({}, { status: 403, headers: { "x-ratelimit-remaining": "0" } }))),
    ).rejects.toThrow("rate limit is used up");
    await expect(run(fake(() => json({ not: "a list" })))).rejects.toThrow("cannot read");
  });

  it("drops a link that is not at github.com", async () => {
    const t = fake(() => json([issue(1, { html_url: "https://evil.example/x" })]));
    expect((await run(t)).items[0]!.url).toBeNull();
  });
});
