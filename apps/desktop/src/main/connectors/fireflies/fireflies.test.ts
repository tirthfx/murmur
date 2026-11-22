import { describe, expect, it } from "vitest";
import { ReadError } from "../data/http";
import {
  firefliesProvider,
  getFirefliesTranscript,
  listFirefliesTranscripts,
  summaryMarkdown,
} from "./fireflies";

const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), init);
const limits = { sleep: async () => undefined };
const verify = firefliesProvider.apiKey!.verify;

describe("Fireflies key (CN-10)", () => {
  it("has no OAuth app and nothing to ask for", () => {
    expect(firefliesProvider.scopes).toEqual([]);
    expect(firefliesProvider.loopbackPort).toBeNull();
  });

  it("names the account by the email of the key, sending the key only as the bearer header", async () => {
    const calls: { url: string; auth: string | null; body: string }[] = [];
    const result = await verify({
      key: "fk-1",
      http: async (url, init) => {
        calls.push({
          url,
          auth: new Headers(init?.headers).get("authorization"),
          body: String(init?.body),
        });
        return json({ data: { user: { email: "me@example.com" } } });
      },
    });
    expect(result).toEqual({ ok: true, label: "me@example.com" });
    expect(calls).toEqual([
      {
        url: "https://api.fireflies.ai/graphql",
        auth: "Bearer fk-1",
        body: expect.not.stringContaining("fk-1"),
      },
    ]);
  });

  it("rejects a wrong key, however Fireflies says so, and reports an unreachable service", async () => {
    for (const answer of [
      () => json({}, { status: 401 }),
      () => json({ data: null, errors: [{ code: "auth_failed" }] }),
    ])
      expect(await verify({ key: "bad", http: async () => answer() })).toEqual({
        ok: false,
        reason: "rejected",
      });
    expect(await verify({ key: "k", http: async () => json({}, { status: 503 }) })).toEqual({
      ok: false,
      reason: "unreachable",
    });
    expect(
      await verify({
        key: "k",
        http: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    ).toEqual({ ok: false, reason: "unreachable" });
  });
});

describe("listFirefliesTranscripts", () => {
  it("lists the transcripts of the range, newest first, with minutes turned into milliseconds", async () => {
    const bodies: { variables: Record<string, unknown> }[] = [];
    const list = await listFirefliesTranscripts({
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return json({
          data: {
            transcripts: [
              { id: "a", title: "Old", date: 1_700_000_000_000, duration: 30.5 },
              { id: "b", title: " ", date: 1_700_100_000_000, duration: null },
              { id: "c", title: "No date", date: null },
            ],
          },
        });
      },
      limits,
      fromMs: Date.UTC(2026, 9, 23),
      toMs: Date.UTC(2026, 10, 22),
    });
    expect(list).toEqual([
      { id: "b", title: "Fireflies meeting", startedAt: 1_700_100_000_000, durationMs: null },
      { id: "a", title: "Old", startedAt: 1_700_000_000_000, durationMs: 1_830_000 },
    ]);
    expect(bodies[0]!.variables).toEqual({
      from: "2026-10-23T00:00:00.000Z",
      to: "2026-11-22T00:00:00.000Z",
      limit: 50,
    });
  });

  it("explains a refused key and an unreadable answer", async () => {
    const args = { limits, fromMs: 0, toMs: 1 };
    await expect(
      listFirefliesTranscripts({ ...args, fetch: async () => json({}, { status: 401 }) }),
    ).rejects.toThrow("no longer accepts this key");
    await expect(
      listFirefliesTranscripts({
        ...args,
        fetch: async () => json({ errors: [{ message: "x" }] }),
      }),
    ).rejects.toThrow("cannot read");
  });
});

describe("getFirefliesTranscript", () => {
  const detail = (over: Record<string, unknown> = {}) =>
    json({
      data: {
        transcript: {
          id: "a",
          title: "Launch sync",
          date: 1_700_000_000_000,
          sentences: [
            { speaker_name: "Dana Lee", text: "Let's start.", start_time: 1.5, end_time: 3.25 },
            { speaker_name: null, text: "Hello", start_time: 4, end_time: 5 },
            { speaker_name: "Sam", text: "   ", start_time: 6, end_time: 7 },
          ],
          summary: {
            overview: "They planned the launch.",
            bullet_gist: "* Ship on Thursday\n- QA first",
            action_items: "Dana: send the plan\n",
          },
          ...over,
        },
      },
    });

  it("maps sentences to lines with speaker names and times, and leaves out empty ones", async () => {
    const result = await getFirefliesTranscript({ fetch: async () => detail(), limits, id: "a" });
    expect(result.transcript).toEqual({
      format: "json",
      title: "Launch sync",
      startedAt: 1_700_000_000_000,
      timesEstimated: false,
      segments: [
        { startMs: 1500, endMs: 3250, speaker: "Dana Lee", text: "Let's start." },
        { startMs: 4000, endMs: 5000, speaker: null, text: "Hello" },
      ],
    });
  });

  it("brings the provider's summary as Markdown, or none", async () => {
    const withSummary = await getFirefliesTranscript({
      fetch: async () => detail(),
      limits,
      id: "a",
    });
    expect(withSummary.summary).toBe(
      "## Overview\nThey planned the launch.\n\n## Key points\n- Ship on Thursday\n- QA first\n\n## Action items\n- Dana: send the plan",
    );
    const without = await getFirefliesTranscript({
      fetch: async () => detail({ summary: null }),
      limits,
      id: "a",
    });
    expect(without.summary).toBeNull();
    expect(summaryMarkdown({})).toBe("");
  });

  it("says when Fireflies has no such transcript", async () => {
    await expect(
      getFirefliesTranscript({
        fetch: async () => json({ data: { transcript: null } }),
        limits,
        id: "x",
      }),
    ).rejects.toThrow(ReadError);
  });
});
