import { z } from "zod";
import { FIREFLIES_ID } from "@murmur/shared";
import type { ConnectorProvider } from "../providers";
import {
  ReadError,
  clip,
  jsonOf,
  requestWithRetry,
  type Fetch,
  type RateLimitOptions,
} from "../data/http";
import type { ParsedTranscript } from "../../meetings/import/formats";

const GRAPHQL = "https://api.fireflies.ai/graphql";

/** The only place the key is sent. */
export const FIREFLIES_ORIGIN = "https://api.fireflies.ai";

/**
 * Fireflies (CN-10): the owner's personal API key, no OAuth app. It is asked once on the
 * Connectors page, checked by asking Fireflies whose key it is, and kept in the Keychain. It is
 * sent only in the `Authorization` header to Fireflies, from main, and never logged.
 */
export const firefliesProvider: ConnectorProvider = {
  id: FIREFLIES_ID,
  name: "Fireflies",
  authorizeUrl: "",
  tokenUrl: "",
  revokeUrl: null,
  scopes: [],
  loopbackPort: null,
  async accountLabel() {
    throw new Error("Fireflies signs in with a key");
  },
  apiKey: {
    async verify({ key, http }) {
      let response: Response;
      try {
        response = await http(GRAPHQL, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ query: "{ user { email } }" }),
        });
      } catch {
        return { ok: false, reason: "unreachable" };
      }
      if (response.status === 401 || response.status === 403)
        return { ok: false, reason: "rejected" };
      if (!response.ok) return { ok: false, reason: "unreachable" };
      const body = z
        .object({ data: z.object({ user: z.object({ email: z.string().min(3) }) }).nullish() })
        .safeParse(await jsonOf(response));
      // Fireflies answers a wrong key with an error body, not always with a 401.
      return body.success && body.data.data
        ? { ok: true, label: body.data.data.user.email }
        : { ok: false, reason: "rejected" };
    },
  },
};

// ------------------------------------------------------------------ reads

async function query(
  fetch: Fetch,
  limits: RateLimitOptions,
  text: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const response = await requestWithRetry(
    fetch,
    GRAPHQL,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: text, variables }),
    },
    limits,
    "Fireflies",
  );
  if (response.status === 401 || response.status === 403)
    throw new ReadError("Fireflies no longer accepts this key. Add it again.");
  if (!response.ok) throw new ReadError(`Fireflies answered ${response.status}.`);
  const body = z
    .object({ data: z.unknown().optional(), errors: z.array(z.unknown()).optional() })
    .safeParse(await jsonOf(response));
  if (!body.success || (body.data.errors?.length ?? 0) > 0 || body.data.data === undefined)
    throw new ReadError("Fireflies sent an answer Murmur cannot read.");
  return body.data.data;
}

export interface FirefliesListing {
  id: string;
  title: string;
  /** Milliseconds. */
  startedAt: number;
  /** Milliseconds; null when it does not say. */
  durationMs: number | null;
}

const listingSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullish(),
  date: z.number().nullish(),
  duration: z.number().nullish(),
});

/** The transcripts from `fromMs` to `toMs`, newest first. Nothing but the list is read. */
export async function listFirefliesTranscripts(options: {
  fetch: Fetch;
  limits: RateLimitOptions;
  fromMs: number;
  toMs: number;
  limit?: number;
}): Promise<FirefliesListing[]> {
  const data = z.object({ transcripts: z.array(z.unknown()).nullable() }).safeParse(
    await query(
      options.fetch,
      options.limits,
      `query($from: DateTime, $to: DateTime, $limit: Int) {
          transcripts(fromDate: $from, toDate: $to, limit: $limit) { id title date duration }
        }`,
      {
        from: new Date(options.fromMs).toISOString(),
        to: new Date(options.toMs).toISOString(),
        limit: options.limit ?? 50,
      },
    ),
  );
  if (!data.success) throw new ReadError("Fireflies sent an answer Murmur cannot read.");
  const found: FirefliesListing[] = [];
  for (const raw of data.data.transcripts ?? []) {
    const item = listingSchema.safeParse(raw);
    if (!item.success || !item.data.date) continue;
    found.push({
      id: item.data.id,
      title: (item.data.title ?? "").trim() || "Fireflies meeting",
      startedAt: Math.round(item.data.date),
      // Fireflies' duration is in minutes.
      durationMs: item.data.duration ? Math.round(item.data.duration * 60_000) : null,
    });
  }
  return found.sort((a, b) => b.startedAt - a.startedAt);
}

const sentenceSchema = z.object({
  speaker_name: z.string().nullish(),
  text: z.string().nullish(),
  start_time: z.number().nullish(),
  end_time: z.number().nullish(),
});

const detailSchema = z.object({
  transcript: z
    .object({
      id: z.string().min(1),
      title: z.string().nullish(),
      date: z.number().nullish(),
      sentences: z.array(z.unknown()).nullish(),
      summary: z
        .object({
          overview: z.string().nullish(),
          short_summary: z.string().nullish(),
          bullet_gist: z.string().nullish(),
          action_items: z.string().nullish(),
        })
        .nullish(),
    })
    .nullable(),
});

const bullets = (text: string | null | undefined) =>
  (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s*•-]+/, "").trim())
    .filter(Boolean)
    .map((line) => `- ${clip(line, 400, true)}`);

/** Fireflies' summary as the Markdown Murmur uses: `##` sections and `-` bullets; empty when it sent none. */
export function summaryMarkdown(summary: {
  overview?: string | null | undefined;
  short_summary?: string | null | undefined;
  bullet_gist?: string | null | undefined;
  action_items?: string | null | undefined;
}): string {
  const lines: string[] = [];
  const overview = (summary.overview ?? summary.short_summary ?? "").trim();
  if (overview) lines.push("## Overview", clip(overview, 2000), "");
  const points = bullets(summary.bullet_gist);
  if (points.length > 0) lines.push("## Key points", ...points, "");
  const actions = bullets(summary.action_items);
  if (actions.length > 0) lines.push("## Action items", ...actions, "");
  return lines.join("\n").trim();
}

export interface FirefliesTranscript {
  transcript: ParsedTranscript;
  summary: string | null;
}

/**
 * One transcript with its sentences, speakers and times (seconds in Fireflies, milliseconds
 * here), and its own summary when it has one. A sentence with no words is left out.
 */
export async function getFirefliesTranscript(options: {
  fetch: Fetch;
  limits: RateLimitOptions;
  id: string;
}): Promise<FirefliesTranscript> {
  const data = detailSchema.safeParse(
    await query(
      options.fetch,
      options.limits,
      `query($id: String!) {
        transcript(id: $id) {
          id title date
          sentences { speaker_name text start_time end_time }
          summary { overview short_summary bullet_gist action_items }
        }
      }`,
      { id: options.id },
    ),
  );
  if (!data.success || data.data.transcript === null)
    throw new ReadError("Fireflies has no such transcript.");
  const detail = data.data.transcript;
  const segments: ParsedTranscript["segments"] = [];
  for (const raw of detail.sentences ?? []) {
    const sentence = sentenceSchema.safeParse(raw);
    const text = sentence.success ? (sentence.data.text ?? "").trim() : "";
    if (!sentence.success || text === "") continue;
    const startMs = Math.max(0, Math.round((sentence.data.start_time ?? 0) * 1000));
    const endMs = Math.max(startMs + 1, Math.round((sentence.data.end_time ?? 0) * 1000));
    segments.push({
      startMs,
      endMs,
      speaker: sentence.data.speaker_name?.trim() || null,
      text: clip(text, 4000),
    });
  }
  const summary = detail.summary ? summaryMarkdown(detail.summary) : "";
  return {
    transcript: {
      format: "json",
      title: detail.title?.trim() || null,
      startedAt: detail.date ? Math.round(detail.date) : null,
      segments,
      timesEstimated: false,
    },
    summary: summary === "" ? null : summary,
  };
}
