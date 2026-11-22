import { z } from "zod";
import { ZOOM_ID, ZOOM_SCOPES } from "@murmur/shared";
import type { ConnectorProvider } from "../providers";
import {
  ReadError,
  jsonOf,
  requestWithRetry,
  timeOf,
  type Fetch,
  type RateLimitOptions,
} from "../data/http";
import { MAX_IMPORT_BYTES } from "../../meetings/import/transcript-import";

const API = "https://api.zoom.us/v2";

/** Whether an address is Zoom's own: the API and the download links of recordings. */
export function isZoomUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && (url.hostname === "zoom.us" || url.hostname.endsWith(".zoom.us"))
    );
  } catch {
    return false;
  }
}

/**
 * Zoom (CN-09): the owner's own user-managed OAuth app, with permission to read cloud recordings
 * (the scopes are set in the app, so none is sent). Zoom matches the redirect address exactly, so
 * the sign-in listens on port 17824: register `http://127.0.0.1:17824/callback`. The app proves
 * itself with HTTP Basic. Zoom renews a refresh token each time it is used.
 */
export const zoomProvider: ConnectorProvider = {
  id: ZOOM_ID,
  name: "Zoom",
  authorizeUrl: "https://zoom.us/oauth/authorize",
  tokenUrl: "https://zoom.us/oauth/token",
  revokeUrl: null,
  scopes: [...ZOOM_SCOPES],
  scopeParam: null,
  tokenAuth: "basic",
  loopbackPort: 17824,
  needsClientSecret: true,
  async accountLabel({ token, http }) {
    const response = await http(`${API}/users/me`, {
      headers: { authorization: `Bearer ${token.accessToken}` },
    });
    if (!response.ok) throw new Error("profile failed");
    return z.object({ email: z.string().min(3) }).parse(await response.json()).email;
  },
};

// ------------------------------------------------------------------ recordings

export interface ZoomRecording {
  /** The meeting's UUID: what a duplicate is recognised by. */
  uuid: string;
  topic: string;
  startedAt: number;
  durationMs: number;
  /** Zoom's download link of the transcript file; null when the recording has none. Never kept. */
  transcriptUrl: string | null;
}

const fileSchema = z.object({
  file_type: z.string().optional(),
  file_extension: z.string().optional(),
  recording_type: z.string().optional(),
  download_url: z.string().optional(),
  status: z.string().optional(),
});

const meetingSchema = z.object({
  uuid: z.string().min(1),
  topic: z.string().optional(),
  start_time: z.string().optional(),
  duration: z.number().optional(),
  recording_files: z.array(fileSchema).optional(),
});

const pageSchema = z.object({
  meetings: z.array(z.unknown()).optional(),
  next_page_token: z.string().optional(),
});

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const MONTH_MS = 30 * 86_400_000;
const MAX_PAGES = 5;

/** The transcript file of a recording: the one Zoom calls a transcript, as WebVTT, that has finished. */
function transcriptOf(files: z.infer<typeof fileSchema>[]): string | null {
  const file = files.find(
    (candidate) =>
      (candidate.file_type === "TRANSCRIPT" || candidate.recording_type === "audio_transcript") &&
      (candidate.file_extension ?? "VTT").toUpperCase() === "VTT" &&
      (candidate.status ?? "completed") === "completed" &&
      candidate.download_url &&
      isZoomUrl(candidate.download_url),
  );
  return file?.download_url ?? null;
}

/**
 * The cloud recordings from `fromMs` to `toMs`, newest first. Zoom lists a month at a time, so a
 * longer range is asked for in months. Nothing is downloaded here.
 */
export async function listZoomRecordings(options: {
  fetch: Fetch;
  limits: RateLimitOptions;
  fromMs: number;
  toMs: number;
}): Promise<ZoomRecording[]> {
  const found = new Map<string, ZoomRecording>();
  for (let end = options.toMs; end > options.fromMs; end -= MONTH_MS) {
    const start = Math.max(options.fromMs, end - MONTH_MS);
    let token = "";
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({
        from: day(start),
        to: day(end),
        page_size: "100",
        ...(token ? { next_page_token: token } : {}),
      });
      const response = await requestWithRetry(
        options.fetch,
        `${API}/users/me/recordings?${query}`,
        undefined,
        options.limits,
        "Zoom",
      );
      if (response.status === 401)
        throw new ReadError("Zoom no longer accepts this sign-in. Connect again.");
      if (response.status === 400 || response.status === 403)
        throw new ReadError(
          "Zoom did not allow the recordings to be listed. Check the app's scopes.",
        );
      if (!response.ok) throw new ReadError(`Zoom answered ${response.status}.`);
      const body = pageSchema.safeParse(await jsonOf(response));
      if (!body.success) throw new ReadError("Zoom sent an answer Murmur cannot read.");
      for (const raw of body.data.meetings ?? []) {
        const meeting = meetingSchema.safeParse(raw);
        if (!meeting.success) continue;
        const startedAt = timeOf(meeting.data.start_time);
        if (startedAt === 0) continue;
        found.set(meeting.data.uuid, {
          uuid: meeting.data.uuid,
          topic: (meeting.data.topic ?? "").trim() || "Zoom meeting",
          startedAt,
          durationMs: Math.max(0, (meeting.data.duration ?? 0) * 60_000),
          transcriptUrl: transcriptOf(meeting.data.recording_files ?? []),
        });
      }
      token = body.data.next_page_token ?? "";
      if (!token) break;
    }
  }
  return [...found.values()].sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * The text of a transcript file, held in memory and never written to disk or kept: Zoom's link
 * needs the account's token, so it only goes through `fetch`, and only to Zoom's own addresses.
 */
export async function downloadZoomTranscript(options: {
  fetch: Fetch;
  limits: RateLimitOptions;
  url: string;
}): Promise<string> {
  if (!isZoomUrl(options.url)) throw new ReadError("Murmur only downloads from Zoom.");
  const response = await requestWithRetry(
    options.fetch,
    options.url,
    undefined,
    options.limits,
    "Zoom",
  );
  if (response.status === 401)
    throw new ReadError("Zoom no longer accepts this sign-in. Connect again.");
  if (!response.ok) throw new ReadError(`Zoom answered ${response.status} for the transcript.`);
  const size = Number(response.headers.get("content-length") ?? "0");
  if (size > MAX_IMPORT_BYTES) throw new ReadError("That transcript is too big to import.");
  const text = await response.text();
  if (text.length > MAX_IMPORT_BYTES) throw new ReadError("That transcript is too big to import.");
  return text;
}
