import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONNECTOR_SETTINGS,
  type ConnectorAccount,
  type ConnectorSettings,
} from "@murmur/shared";
import { openDatabase } from "../../db/database";
import { createSpeakersStore } from "../../meetings/speakers-store";
import { createTranscriptImport } from "../../meetings/import/transcript-import";
import { ConnectorError } from "../connector-service";
import { createConnectorImport } from "./connector-import";

const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), init);
const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const NOW = Date.UTC(2026, 10, 22, 12);

const VTT = `WEBVTT

1
00:00:05.000 --> 00:00:09.000
Dana Lee: Let's start.

2
00:00:10.000 --> 00:00:12.000
Sam Ortiz: Okay.
`;

const account = (
  connector: string,
  status: ConnectorAccount["status"] = "connected",
): ConnectorAccount => ({
  id: `a-${connector}`,
  connector,
  email: "me@example.com",
  scopes: [],
  status,
  statusReason: null,
  lastSyncAt: null,
  createdAt: 1,
});

function setup(
  options: {
    accounts?: ConnectorAccount[];
    answer?: (url: URL, init?: RequestInit) => Response | Promise<Response>;
    settings?: Partial<ConnectorSettings>;
  } = {},
) {
  const db = openDatabase(":memory:");
  let n = 0;
  const importer = createTranscriptImport(db, {
    speakers: createSpeakersStore(db, { now: () => 1 }),
    newId: () => `id-${++n}`,
    now: () => NOW,
    meetingsRoot: "/profile/meetings",
    ownerName: () => "",
    folderId: () => null,
  });
  const requests: { url: URL; account: string }[] = [];
  const service = createConnectorImport({
    connectors: {
      list: () => options.accounts ?? [account("zoom"), account("fireflies")],
      authorizedFetch: async (id, url, init) => {
        const parsed = new URL(url);
        requests.push({ url: parsed, account: id });
        if (!options.answer) throw new Error(`unexpected ${url}`);
        return options.answer(parsed, init);
      },
    },
    importer,
    settings: () => ({ ...DEFAULT_CONNECTOR_SETTINGS, ...options.settings }),
    now: () => NOW,
    logger,
    sleep: async () => undefined,
  });
  return { service, importer, db, requests };
}

const zoomAnswer = (url: URL): Response => {
  if (url.pathname.endsWith("/recordings"))
    return json({
      meetings: [
        {
          uuid: "abc==",
          topic: "Launch sync",
          start_time: "2026-11-20T10:00:00Z",
          duration: 30,
          recording_files: [
            {
              file_type: "TRANSCRIPT",
              file_extension: "VTT",
              status: "completed",
              download_url: "https://zoom.us/rec/download/abc",
            },
          ],
        },
        {
          uuid: "no-transcript==",
          topic: "Audio only",
          start_time: "2026-11-19T10:00:00Z",
          duration: 10,
          recording_files: [],
        },
      ],
    });
  return new Response(VTT);
};

const firefliesAnswer = (_url: URL, init?: RequestInit): Response => {
  const body = JSON.parse(String(init?.body)) as { query: string };
  if (body.query.includes("transcripts("))
    return json({
      data: {
        transcripts: [{ id: "ff1", title: "Design sync", date: NOW - 86_400_000, duration: 20 }],
      },
    });
  return json({
    data: {
      transcript: {
        id: "ff1",
        title: "Design sync",
        date: NOW - 86_400_000,
        sentences: [{ speaker_name: "Dana Lee", text: "Hello.", start_time: 1, end_time: 2 }],
        summary: { overview: "They met." },
      },
    },
  });
};

describe("importing from Zoom (CN-09)", () => {
  it("lists the recordings of the range with their transcript state, and downloads nothing", async () => {
    const t = setup({ answer: zoomAnswer });
    const result = await t.service.list("a-zoom");
    expect(result).toEqual({
      ok: true,
      recordings: [
        {
          remoteId: "abc==",
          title: "Launch sync",
          startedAt: Date.parse("2026-11-20T10:00:00Z"),
          durationMs: 1_800_000,
          hasTranscript: true,
          imported: false,
        },
        {
          remoteId: "no-transcript==",
          title: "Audio only",
          startedAt: Date.parse("2026-11-19T10:00:00Z"),
          durationMs: 600_000,
          hasTranscript: false,
          imported: false,
        },
      ],
    });
    expect(t.requests.every((r) => r.url.origin === "https://api.zoom.us")).toBe(true);
    expect(t.requests.some((r) => r.url.pathname.includes("/download"))).toBe(false);
    const range = t.requests[0]!.url.searchParams;
    expect(range.get("from")).toBe("2026-10-23");
  });

  it("follows the range in settings", async () => {
    const t = setup({
      answer: zoomAnswer,
      settings: { zoom: { rangeDays: 7, autoImport: false } },
    });
    await t.service.list("a-zoom");
    expect(t.requests[0]!.url.searchParams.get("from")).toBe("2026-11-15");
  });

  it("prepares a recording through the importer: its preview has the Zoom title and speakers, and the UUID is kept at confirm", async () => {
    const t = setup({ answer: zoomAnswer });
    const prepared = await t.service.prepare("a-zoom", "abc==");
    if (!prepared.ok || !("preview" in prepared)) throw new Error("not prepared");
    expect(prepared.preview).toMatchObject({
      fileName: "Zoom: Launch sync",
      title: "Launch sync",
      lines: 2,
      speakers: ["Dana Lee", "Sam Ortiz"],
      duplicate: null,
    });
    // The transcript came from Zoom's own address with the account's token.
    expect(
      t.requests.some((r) => r.url.pathname === "/rec/download/abc" && r.account === "a-zoom"),
    ).toBe(true);
    const confirmed = t.importer.confirm({
      token: prepared.preview.token,
      title: prepared.preview.title,
      startedAt: prepared.preview.startedAt,
    });
    expect(confirmed.ok).toBe(true);
    const row = t.db.prepare("SELECT external_ref, source FROM meetings").get() as {
      external_ref: string;
      source: string;
    };
    expect(row).toEqual({ external_ref: "zoom:abc==", source: "imported" });
  });

  it("does not import the same recording twice, and marks it as imported in the list", async () => {
    const t = setup({ answer: zoomAnswer });
    const first = await t.service.prepare("a-zoom", "abc==");
    if (!first.ok || !("preview" in first)) throw new Error("not prepared");
    t.importer.confirm({
      token: first.preview.token,
      title: first.preview.title,
      startedAt: first.preview.startedAt,
    });
    const list = await t.service.list("a-zoom");
    expect(list.ok && list.recordings.find((r) => r.remoteId === "abc==")?.imported).toBe(true);
    const again = await t.service.prepare("a-zoom", "abc==");
    if (!again.ok || !("preview" in again)) throw new Error("not prepared");
    expect(again.preview.duplicate).toMatchObject({ reason: "same-recording" });
    expect(
      t.importer.confirm({
        token: again.preview.token,
        title: again.preview.title,
        startedAt: again.preview.startedAt,
      }),
    ).toMatchObject({ ok: false });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meetings").get()).toEqual({ n: 1 });
  });

  it("says so when a recording has no transcript, is gone, or the file is not a transcript", async () => {
    const t = setup({ answer: zoomAnswer });
    expect(await t.service.prepare("a-zoom", "no-transcript==")).toEqual({
      ok: false,
      message: "That recording has no transcript file.",
    });
    expect(await t.service.prepare("a-zoom", "gone==")).toEqual({
      ok: false,
      message: "That recording is not in the list any more.",
    });
    const bad = setup({
      answer: (url) =>
        url.pathname.endsWith("/recordings")
          ? zoomAnswer(url)
          : new Response("not a transcript at all"),
    });
    const result = await bad.service.prepare("a-zoom", "abc==");
    expect(result.ok).toBe(false);
    expect(bad.db.prepare("SELECT COUNT(*) AS n FROM meetings").get()).toEqual({ n: 0 });
  });

  it("writes nothing to the database until the owner confirms", async () => {
    const t = setup({ answer: zoomAnswer });
    await t.service.list("a-zoom");
    await t.service.prepare("a-zoom", "abc==");
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meetings").get()).toEqual({ n: 0 });
  });
});

describe("importing from Fireflies (CN-10)", () => {
  it("lists the transcripts of the range", async () => {
    const t = setup({ answer: firefliesAnswer });
    const result = await t.service.list("a-fireflies");
    expect(result).toMatchObject({
      ok: true,
      recordings: [
        {
          remoteId: "ff1",
          title: "Design sync",
          durationMs: 1_200_000,
          hasTranscript: true,
          imported: false,
        },
      ],
    });
    expect(t.requests.every((r) => r.url.origin === "https://api.fireflies.ai")).toBe(true);
  });

  it("brings speaker names and the provider's summary as a labelled summary, which a local summary does not replace", async () => {
    const t = setup({ answer: firefliesAnswer });
    const prepared = await t.service.prepare("a-fireflies", "ff1");
    if (!prepared.ok || !("preview" in prepared)) throw new Error("not prepared");
    expect(prepared.preview.speakers).toEqual(["Dana Lee"]);
    t.importer.confirm({
      token: prepared.preview.token,
      title: prepared.preview.title,
      startedAt: prepared.preview.startedAt,
    });
    expect(t.db.prepare("SELECT external_ref FROM meetings").get()).toEqual({
      external_ref: "fireflies:ff1",
    });
    expect(
      t.db.prepare("SELECT skill_name, model_id, markdown FROM meeting_summaries").all(),
    ).toEqual([
      {
        skill_name: "Fireflies summary (imported)",
        model_id: "fireflies",
        markdown: "## Overview\nThey met.",
      },
    ]);
  });

  it("leaves the summary out when the owner turned that off", async () => {
    const t = setup({
      answer: firefliesAnswer,
      settings: {
        fireflies: { rangeDays: 30, importProviderSummary: false, autoImport: false },
      },
    });
    const prepared = await t.service.prepare("a-fireflies", "ff1");
    if (!prepared.ok || !("preview" in prepared)) throw new Error("not prepared");
    t.importer.confirm({
      token: prepared.preview.token,
      title: prepared.preview.title,
      startedAt: prepared.preview.startedAt,
    });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meeting_summaries").get()).toEqual({ n: 0 });
  });
});

describe("failures", () => {
  it("says an account is not there or not connected", async () => {
    const t = setup({ accounts: [account("zoom", "needs_attention")] });
    expect(await t.service.list("zzz")).toEqual({
      ok: false,
      message: "That account is not here.",
    });
    expect(await t.service.list("a-zoom")).toEqual({
      ok: false,
      message: "That account is not connected.",
    });
    expect(await t.service.prepare("a-zoom", "x")).toEqual({
      ok: false,
      message: "That account is not connected.",
    });
  });

  it("shows a sign-in that needs attention and a failure in plain words", async () => {
    const stale = setup({
      answer: () => {
        throw new ConnectorError("needs-attention", "Connect again.");
      },
    });
    expect(await stale.service.list("a-zoom")).toEqual({ ok: false, message: "Connect again." });
    const down = setup({
      answer: () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await down.service.list("a-fireflies")).toEqual({
      ok: false,
      message: "Fireflies could not be read.",
    });
    expect(await down.service.prepare("a-zoom", "x")).toEqual({
      ok: false,
      message: "Zoom could not be read.",
    });
  });

  it("leaves nothing in the database after a failed preparation", async () => {
    const t = setup({
      answer: (url) =>
        url.pathname.endsWith("/recordings") ? zoomAnswer(url) : new Response("", { status: 500 }),
    });
    const result = await t.service.prepare("a-zoom", "abc==");
    expect(result).toEqual({ ok: false, message: "Zoom answered 500 for the transcript." });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meetings").get()).toEqual({ n: 0 });
  });
});

describe("automatic import (CN-09, CN-10)", () => {
  const on = { zoom: { rangeDays: 30, autoImport: true } };

  it("brings in a new recording once, and nothing while it is off", async () => {
    const off = setup({ answer: zoomAnswer });
    await expect(off.service.importNew()).resolves.toEqual([]);
    expect(off.requests).toEqual([]);

    const t = setup({ answer: zoomAnswer, settings: on });
    const first = await t.service.importNew();
    expect(first.length).toBeGreaterThan(0);
    await expect(t.service.importNew()).resolves.toEqual([]);
  });

  it("skips an account whose service cannot be read", async () => {
    const t = setup({
      answer: () => new Response("{}", { status: 500 }),
      settings: on,
    });
    await expect(t.service.importNew()).resolves.toEqual([]);
  });
});
