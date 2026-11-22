import { describe, expect, it } from "vitest";
import { ZOOM_SCOPES } from "@murmur/shared";
import { ReadError } from "../data/http";
import { downloadZoomTranscript, isZoomUrl, listZoomRecordings, zoomProvider } from "./zoom";

const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), init);
const limits = { sleep: async () => undefined };
const NOW = Date.UTC(2026, 10, 22);
const DAY = 86_400_000;

const meeting = (uuid: string, over: Record<string, unknown> = {}) => ({
  uuid,
  topic: `Meeting ${uuid}`,
  start_time: "2026-11-20T10:00:00Z",
  duration: 45,
  recording_files: [
    { file_type: "MP4", download_url: "https://zoom.us/rec/download/video" },
    {
      file_type: "TRANSCRIPT",
      file_extension: "VTT",
      recording_type: "audio_transcript",
      status: "completed",
      download_url: `https://zoom.us/rec/download/${uuid}`,
    },
  ],
  ...over,
});

describe("Zoom provider (CN-09)", () => {
  it("reads recordings only, on a fixed port, with Basic auth and no scope parameter", () => {
    expect(zoomProvider.scopes).toEqual([...ZOOM_SCOPES]);
    expect(zoomProvider.scopes).toEqual(["recording:read"]);
    expect(zoomProvider.scopeParam).toBeNull();
    expect(zoomProvider.tokenAuth).toBe("basic");
    expect(zoomProvider.loopbackPort).toBe(17824);
  });

  it("names the account by its email", async () => {
    const label = await zoomProvider.accountLabel({
      token: { accessToken: "t", refreshToken: null, expiresIn: null, scopes: [] },
      http: async () => json({ email: "me@example.com" }),
    });
    expect(label).toBe("me@example.com");
  });
});

describe("isZoomUrl", () => {
  it("allows only Zoom's own https addresses", () => {
    expect(isZoomUrl("https://zoom.us/rec/download/x")).toBe(true);
    expect(isZoomUrl("https://us02web.zoom.us/rec/x")).toBe(true);
    for (const bad of [
      "http://zoom.us/x",
      "https://zoom.us.evil.example/x",
      "https://notzoom.us/x",
      "x",
    ])
      expect(isZoomUrl(bad)).toBe(false);
  });
});

describe("listZoomRecordings", () => {
  it("lists the meetings with a transcript file, newest first, with their UUIDs, and nothing is downloaded", async () => {
    const calls: string[] = [];
    const list = await listZoomRecordings({
      fetch: async (url) => {
        calls.push(url);
        return json({
          meetings: [
            meeting("a=="),
            meeting("b==", {
              start_time: "2026-11-21T09:00:00Z",
              recording_files: [{ file_type: "MP4", download_url: "https://zoom.us/x" }],
            }),
          ],
        });
      },
      limits,
      fromMs: NOW - 30 * DAY,
      toMs: NOW,
    });
    expect(list.map((m) => [m.uuid, m.topic, m.durationMs, m.transcriptUrl])).toEqual([
      ["b==", "Meeting b==", 45 * 60_000, null],
      ["a==", "Meeting a==", 45 * 60_000, "https://zoom.us/rec/download/a=="],
    ]);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!).origin).toBe("https://api.zoom.us");
    expect(new URL(calls[0]!).searchParams.get("from")).toBe("2026-10-23");
    expect(calls.some((url) => url.includes("download"))).toBe(false);
  });

  it("asks a month at a time for a longer range and follows the pages", async () => {
    const calls: URLSearchParams[] = [];
    await listZoomRecordings({
      fetch: async (url) => {
        const q = new URL(url).searchParams;
        calls.push(q);
        return json(
          q.get("next_page_token") ? { meetings: [] } : { meetings: [], next_page_token: "more" },
        );
      },
      limits,
      fromMs: NOW - 90 * DAY,
      toMs: NOW,
    });
    // Three months, two pages each.
    expect(calls).toHaveLength(6);
  });

  it("leaves out a transcript that is not finished, is not VTT, or is not at Zoom", async () => {
    const odd = (over: Record<string, unknown>) =>
      meeting("x", {
        recording_files: [
          {
            file_type: "TRANSCRIPT",
            file_extension: "VTT",
            status: "completed",
            download_url: "https://zoom.us/ok",
            ...over,
          },
        ],
      });
    for (const over of [
      { status: "processing" },
      { file_extension: "TXT" },
      { download_url: "https://evil.example/t" },
    ]) {
      const list = await listZoomRecordings({
        fetch: async () => json({ meetings: [odd(over)] }),
        limits,
        fromMs: NOW - DAY,
        toMs: NOW,
      });
      expect(list[0]!.transcriptUrl).toBeNull();
    }
  });

  it("explains a refused sign-in, missing scopes and a busy service", async () => {
    const ask = (status: number, headers: Record<string, string> = {}) =>
      listZoomRecordings({
        fetch: async () => json({}, { status, headers }),
        limits,
        fromMs: NOW - DAY,
        toMs: NOW,
      });
    await expect(ask(401)).rejects.toThrow("no longer accepts");
    await expect(ask(403)).rejects.toThrow("scopes");
    await expect(ask(500)).rejects.toThrow("Zoom answered 500.");
    await expect(ask(429, { "retry-after": "1" })).rejects.toThrow("Zoom is busy");
  });
});

describe("downloadZoomTranscript", () => {
  it("reads the file's text through the fetch it is given, and only from Zoom", async () => {
    const urls: string[] = [];
    const text = await downloadZoomTranscript({
      fetch: async (url) => {
        urls.push(url);
        return new Response("WEBVTT\n");
      },
      limits,
      url: "https://zoom.us/rec/download/a",
    });
    expect(text).toBe("WEBVTT\n");
    expect(urls).toEqual(["https://zoom.us/rec/download/a"]);
    let asked = false;
    await expect(
      downloadZoomTranscript({
        fetch: async () => {
          asked = true;
          return new Response("x");
        },
        limits,
        url: "https://evil.example/t",
      }),
    ).rejects.toBeInstanceOf(ReadError);
    expect(asked).toBe(false);
  });

  it("refuses a file that is too big, and says what went wrong", async () => {
    await expect(
      downloadZoomTranscript({
        fetch: async () =>
          new Response("x", { headers: { "content-length": String(30 * 1024 * 1024) } }),
        limits,
        url: "https://zoom.us/a",
      }),
    ).rejects.toThrow("too big");
    await expect(
      downloadZoomTranscript({
        fetch: async () => new Response("", { status: 401 }),
        limits,
        url: "https://zoom.us/a",
      }),
    ).rejects.toThrow("no longer accepts");
    await expect(
      downloadZoomTranscript({
        fetch: async () => new Response("", { status: 404 }),
        limits,
        url: "https://zoom.us/a",
      }),
    ).rejects.toThrow("answered 404 for the transcript");
  });
});
