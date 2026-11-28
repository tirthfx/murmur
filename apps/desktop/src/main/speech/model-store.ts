// Speech model files on disk: where they live, checking them against the manifest, and
// downloading them. Only Node built-ins and type imports, so `scripts/` can run this file
// directly with Node.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { SpeechModel, SpeechModelFile } from "@murmur/shared";

/** Downloads come only from this host, over HTTPS. Redirects must stay on HTTPS. */
export const MODEL_HOST = "huggingface.co";

export interface ModelLocation {
  dir: string;
  modelDir: string;
  tokenizerDir: string;
}

/** `root` is `.../Application Support/Murmur/models/speech/whisperkit`. */
export function modelLocation(root: string, model: SpeechModel): ModelLocation {
  const dir = path.join(root, model.id);
  return { dir, modelDir: path.join(dir, "model"), tokenizerDir: path.join(dir, "tokenizer") };
}

export type ModelCheck =
  { ok: true } | { ok: false; reason: "missing" | "size" | "checksum"; file: string };

// Plain fields, not constructor parameter properties: Node's own TypeScript support (used by
// the download script) only strips types and cannot run parameter properties.
export class ModelDownloadError extends Error {
  readonly reason: "address" | "http" | "size" | "checksum" | "cancelled";
  readonly file: string;
  /** True for a cut-off body or a temporary server error: worth trying again. */
  readonly retryable: boolean;

  constructor(
    reason: ModelDownloadError["reason"],
    file: string,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "ModelDownloadError";
    this.reason = reason;
    this.file = file;
    this.retryable = retryable;
  }
}

function safeJoin(base: string, relative: string): string {
  const joined = path.resolve(base, relative);
  if (!joined.startsWith(base + path.sep)) throw new Error(`Unsafe model file path: ${relative}`);
  return joined;
}

async function sizeOf(file: string): Promise<number | null> {
  try {
    const info = await stat(file);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function checkFile(base: string, file: SpeechModelFile): Promise<ModelCheck> {
  const target = safeJoin(base, file.path);
  const size = await sizeOf(target);
  if (size === null) return { ok: false, reason: "missing", file: file.path };
  if (size !== file.size) return { ok: false, reason: "size", file: file.path };
  if ((await sha256Of(target)) !== file.sha256) {
    return { ok: false, reason: "checksum", file: file.path };
  }
  return { ok: true };
}

/** Checks every file's size and SHA-256. Stops at the first problem. */
export async function checkModel(root: string, model: SpeechModel): Promise<ModelCheck> {
  const { dir } = modelLocation(root, model);
  for (const file of model.files) {
    const result = await checkFile(dir, file);
    if (!result.ok) return result;
  }
  return { ok: true };
}

export interface DownloadOptions {
  fetch?: typeof globalThis.fetch;
  /** Cancels the download; the bytes already here are kept for the next one. */
  signal?: AbortSignal;
  onProgress?: (doneBytes: number, totalBytes: number) => void;
  /** Called before each new try after a dropped connection (1-based). */
  onRetry?: (attempt: number, of: number, error: unknown) => void;
  /** Tries after the first one per file; default {@link RETRY_DELAYS_MS}.length. */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Waits before each new try of a file whose download was cut off. */
export const RETRY_DELAYS_MS = [1000, 3000, 10_000, 30_000, 60_000];

/** HTTP statuses that usually pass: timeouts, rate limits and server errors. */
const TEMPORARY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Disk problems another try will not fix. */
const LOCAL_ERRORS = new Set(["ENOSPC", "EACCES", "EPERM", "EROFS", "EDQUOT"]);

function isRetryable(error: unknown): boolean {
  if (error instanceof ModelDownloadError) return error.retryable;
  const code = (error as { code?: unknown } | null)?.code;
  return !(typeof code === "string" && LOCAL_ERRORS.has(code));
}

function checkAddress(file: SpeechModelFile): void {
  const url = new URL(file.url);
  if (url.protocol !== "https:" || url.hostname !== MODEL_HOST) {
    throw new ModelDownloadError(
      "address",
      file.path,
      `${file.path}: not an https://${MODEL_HOST} address`,
    );
  }
}

/** Bytes of this model on disk now, a part-finished download included. */
export async function modelBytesOnDisk(root: string, model: SpeechModel): Promise<number> {
  const { dir } = modelLocation(root, model);
  let bytes = 0;
  for (const file of model.files) {
    for (const base of [dir, `${dir}.partial`]) {
      const target = safeJoin(base, file.path);
      bytes += (await sizeOf(target)) ?? (await sizeOf(`${target}.download`)) ?? 0;
    }
  }
  return bytes;
}

/** Deletes the model's folder and anything part-downloaded. */
export async function removeModel(root: string, model: SpeechModel): Promise<void> {
  const { dir } = modelLocation(root, model);
  await rm(dir, { recursive: true, force: true });
  await rm(`${dir}.partial`, { recursive: true, force: true });
}

/** Waits `ms`, or less if the download is cancelled. */
async function pause(
  ms: number,
  sleep: (ms: number) => Promise<void>,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!signal) return sleep(ms);
  let stop = () => {};
  const cancelled = new Promise<void>((resolve) => {
    stop = resolve;
    signal.addEventListener("abort", stop, { once: true });
  });
  try {
    await Promise.race([sleep(ms), cancelled]);
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

/**
 * Makes the model complete and correct on disk. Files already right are kept, others are
 * downloaded into a staging folder, and the folder is moved into place only when every
 * file matches the manifest. A file left part-way by an earlier run is continued with an
 * HTTP range request. A dropped connection, a cut-off body or a temporary server error is
 * tried again a few times, continuing from the bytes already there. Returns the bytes
 * downloaded (0 when nothing was missing).
 */
export async function downloadModel(
  root: string,
  model: SpeechModel,
  options: DownloadOptions = {},
): Promise<number> {
  const fetchFile = options.fetch ?? globalThis.fetch;
  const { dir } = modelLocation(root, model);
  const staging = `${dir}.partial`;
  await mkdir(staging, { recursive: true });

  // Keep good files from an earlier copy: move them into staging before checking.
  for (const file of model.files) {
    const from = safeJoin(dir, file.path);
    const to = safeJoin(staging, file.path);
    if ((await sizeOf(from)) !== null && (await sizeOf(to)) === null) {
      await mkdir(path.dirname(to), { recursive: true });
      await rename(from, to);
    }
  }
  await rm(dir, { recursive: true, force: true });

  let done = 0;
  let downloaded = 0;
  const report = () => options.onProgress?.(done, model.totalBytes);
  const retries = options.retries ?? RETRY_DELAYS_MS.length;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  /** One try at one file; returns the bytes it fetched. A cut-off try leaves its bytes. */
  async function fetchInto(file: SpeechModelFile, partial: string): Promise<number> {
    // Continue a file an earlier run left part-way, when the server honours the range.
    const existing = (await sizeOf(partial)) ?? 0;
    const resumeFrom = existing > 0 && existing < file.size ? existing : 0;
    const response = await fetchFile(file.url, {
      redirect: "follow",
      ...(options.signal ? { signal: options.signal } : {}),
      ...(resumeFrom > 0 ? { headers: { Range: `bytes=${resumeFrom}-` } } : {}),
    });
    if (!response.ok || !response.body) {
      throw new ModelDownloadError(
        "http",
        file.path,
        `${file.path}: HTTP ${response.status}`,
        TEMPORARY_STATUS.has(response.status),
      );
    }
    if (response.url && !response.url.startsWith("https://")) {
      throw new ModelDownloadError("address", file.path, `${file.path}: redirected off HTTPS`);
    }
    const resumed = resumeFrom > 0 && response.status === 206;
    const hash = createHash("sha256");
    let bytes = 0;
    let fetched = 0;
    if (resumed) {
      for await (const chunk of createReadStream(partial)) hash.update(chunk as Buffer);
      bytes = resumeFrom;
      done += resumeFrom;
      report();
    }
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        bytes += chunk.length;
        done += chunk.length;
        fetched += chunk.length;
        report();
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      meter,
      createWriteStream(partial, { flags: resumed ? "a" : "w" }),
      options.signal ? { signal: options.signal } : {},
    );
    if (bytes < file.size) {
      // Cut off early: keep what arrived so the next try continues from it.
      throw new ModelDownloadError(
        "size",
        file.path,
        `${file.path}: got ${bytes} bytes, expected ${file.size}`,
        true,
      );
    }
    if (bytes !== file.size) {
      await rm(partial, { force: true });
      throw new ModelDownloadError(
        "size",
        file.path,
        `${file.path}: got ${bytes} bytes, expected ${file.size}`,
      );
    }
    if (hash.digest("hex") !== file.sha256) {
      await rm(partial, { force: true });
      throw new ModelDownloadError(
        "checksum",
        file.path,
        `${file.path}: SHA-256 does not match the manifest`,
      );
    }
    return fetched;
  }

  const stopIfCancelled = (file: SpeechModelFile): void => {
    if (options.signal?.aborted) {
      throw new ModelDownloadError("cancelled", file.path, "The download was cancelled.");
    }
  };

  for (const file of model.files) {
    stopIfCancelled(file);
    if ((await checkFile(staging, file)).ok) {
      done += file.size;
      report();
      continue;
    }
    checkAddress(file);
    const target = safeJoin(staging, file.path);
    const partial = `${target}.download`;
    await mkdir(path.dirname(target), { recursive: true });
    const before = done;
    for (let attempt = 0; ; attempt++) {
      done = before;
      try {
        downloaded += await fetchInto(file, partial);
        break;
      } catch (error) {
        stopIfCancelled(file);
        if (!isRetryable(error) || attempt >= retries) throw error;
        options.onRetry?.(attempt + 1, retries, error);
        const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!;
        await pause(delay, sleep, options.signal);
        stopIfCancelled(file);
      }
    }
    await rename(partial, target);
  }
  await rename(staging, dir);
  return downloaded;
}
