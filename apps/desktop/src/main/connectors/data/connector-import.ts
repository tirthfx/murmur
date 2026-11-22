import {
  FIREFLIES_ID,
  ZOOM_ID,
  type ConnectorAccount,
  type ConnectorSettings,
  type RecordingsResult,
  type TranscriptImportPreviewResult,
} from "@murmur/shared";
import type { Logger } from "../../helper/types";
import { parseTranscriptFile } from "../../meetings/import/formats";
import type { TranscriptImport } from "../../meetings/import/transcript-import";
import { ConnectorError, type ConnectorService } from "../connector-service";
import {
  FIREFLIES_ORIGIN,
  getFirefliesTranscript,
  listFirefliesTranscripts,
} from "../fireflies/fireflies";
import { downloadZoomTranscript, isZoomUrl, listZoomRecordings } from "../zoom/zoom";
import { ReadError, defaultSleep, type Fetch } from "./http";

/**
 * Meetings from Zoom and Fireflies through the transcript importer (CN-09, CN-10). `list` shows
 * what could be imported, from a date range, and downloads nothing. `prepare` fetches the one the
 * owner picked and hands it to the importer, which describes it like a file; the owner confirms
 * there, so the preview, the duplicate checks and the writer are the importer's own. A download is
 * held in memory and is never written to disk or kept.
 */
export interface ConnectorImport {
  list(accountId: string): Promise<RecordingsResult>;
  prepare(accountId: string, remoteId: string): Promise<TranscriptImportPreviewResult>;
}

const DAY = 86_400_000;

export function createConnectorImport(deps: {
  connectors: Pick<ConnectorService, "list" | "authorizedFetch">;
  importer: Pick<TranscriptImport, "prepareRemote" | "isImported">;
  settings(): ConnectorSettings;
  now(): number;
  logger: Logger;
  sleep?(ms: number): Promise<void>;
}): ConnectorImport {
  const limits = { sleep: deps.sleep ?? defaultSleep };

  const account = (id: string): ConnectorAccount | null =>
    deps.connectors
      .list()
      .find(
        (entry) =>
          entry.id === id && (entry.connector === ZOOM_ID || entry.connector === FIREFLIES_ID),
      ) ?? null;

  /** A request with the account's token, only to its own service's addresses. */
  const fetchFor =
    (entry: ConnectorAccount): Fetch =>
    (url, init) => {
      const allowed =
        entry.connector === ZOOM_ID ? isZoomUrl(url) : new URL(url).origin === FIREFLIES_ORIGIN;
      if (!allowed) throw new ReadError("Refused a request to another address.");
      return deps.connectors.authorizedFetch(entry.id, url, init);
    };

  const failure = (entry: ConnectorAccount, error: unknown) => {
    if (error instanceof ReadError || error instanceof ConnectorError)
      return { ok: false as const, message: error.message };
    deps.logger.warn(`[import] ${entry.connector} (${entry.id}) failed`);
    return {
      ok: false as const,
      message: `${entry.connector === ZOOM_ID ? "Zoom" : "Fireflies"} could not be read.`,
    };
  };

  const rangeOf = (entry: ConnectorAccount) => {
    const settings = deps.settings();
    const days =
      entry.connector === ZOOM_ID ? settings.zoom.rangeDays : settings.fireflies.rangeDays;
    return { fromMs: deps.now() - days * DAY, toMs: deps.now() };
  };

  const usable = (id: string) => {
    const entry = account(id);
    if (!entry) return { ok: false as const, message: "That account is not here." };
    if (entry.status !== "connected")
      return { ok: false as const, message: "That account is not connected." };
    return { ok: true as const, entry };
  };

  return {
    async list(accountId) {
      const found = usable(accountId);
      if (!found.ok) return found;
      const { entry } = found;
      try {
        const fetch = fetchFor(entry);
        const range = rangeOf(entry);
        if (entry.connector === ZOOM_ID) {
          const meetings = await listZoomRecordings({ fetch, limits, ...range });
          return {
            ok: true,
            recordings: meetings.map((meeting) => ({
              remoteId: meeting.uuid,
              title: meeting.topic,
              startedAt: meeting.startedAt,
              durationMs: meeting.durationMs,
              hasTranscript: meeting.transcriptUrl !== null,
              imported: deps.importer.isImported(`${ZOOM_ID}:${meeting.uuid}`),
            })),
          };
        }
        const transcripts = await listFirefliesTranscripts({ fetch, limits, ...range });
        return {
          ok: true,
          recordings: transcripts.map((item) => ({
            remoteId: item.id,
            title: item.title,
            startedAt: item.startedAt,
            durationMs: item.durationMs,
            hasTranscript: true,
            imported: deps.importer.isImported(`${FIREFLIES_ID}:${item.id}`),
          })),
        };
      } catch (error) {
        return failure(entry, error);
      }
    },

    async prepare(accountId, remoteId) {
      const found = usable(accountId);
      if (!found.ok) return found;
      const { entry } = found;
      try {
        const fetch = fetchFor(entry);
        if (entry.connector === ZOOM_ID) {
          // The link is read again from Zoom now, and is never kept.
          const meetings = await listZoomRecordings({ fetch, limits, ...rangeOf(entry) });
          const meeting = meetings.find((candidate) => candidate.uuid === remoteId);
          if (!meeting)
            return { ok: false, message: "That recording is not in the list any more." };
          if (!meeting.transcriptUrl)
            return { ok: false, message: "That recording has no transcript file." };
          const text = await downloadZoomTranscript({ fetch, limits, url: meeting.transcriptUrl });
          const parsed = parseTranscriptFile(text, "zoom.vtt");
          if (!parsed.ok) return { ok: false, message: parsed.message };
          return toResult(
            deps.importer.prepareRemote({
              name: `Zoom: ${meeting.topic}`,
              transcript: parsed.transcript,
              title: meeting.topic,
              startedAt: meeting.startedAt,
              externalRef: `${ZOOM_ID}:${meeting.uuid}`,
            }),
          );
        }
        const detail = await getFirefliesTranscript({ fetch, limits, id: remoteId });
        const settings = deps.settings().fireflies;
        return toResult(
          deps.importer.prepareRemote({
            name: `Fireflies: ${detail.transcript.title ?? remoteId}`,
            transcript: detail.transcript,
            title: detail.transcript.title ?? "Fireflies meeting",
            startedAt: detail.transcript.startedAt ?? deps.now(),
            externalRef: `${FIREFLIES_ID}:${remoteId}`,
            summary: settings.importProviderSummary ? detail.summary : null,
          }),
        );
      } catch (error) {
        return failure(entry, error);
      }
    },
  };
}

const toResult = (
  prepared: ReturnType<TranscriptImport["prepareRemote"]>,
): TranscriptImportPreviewResult =>
  prepared.ok ? { ok: true, preview: prepared.preview } : prepared;
