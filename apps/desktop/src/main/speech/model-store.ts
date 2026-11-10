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
  readonly reason: "address" | "http" | "size" | "checksum";
  readonly file: string;

  constructor(reason: ModelDownloadError["reason"], file: string, message: string) {
    super(message);
    this.name = "ModelDownloadError";
    this.reason = reason;
    this.file = file;
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
  onProgress?: (doneBytes: number, totalBytes: number) => void;
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

/**
 * Makes the model complete and correct on disk. Files already right are kept, others are
 * downloaded into a staging folder, and the folder is moved into place only when every
 * file matches the manifest. Returns the bytes downloaded (0 when nothing was missing).
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
  for (const file of model.files) {
    if ((await checkFile(staging, file)).ok) {
      done += file.size;
      report();
      continue;
    }
    checkAddress(file);
    const target = safeJoin(staging, file.path);
    const partial = `${target}.download`;
    await mkdir(path.dirname(target), { recursive: true });
    const response = await fetchFile(file.url, { redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new ModelDownloadError("http", file.path, `${file.path}: HTTP ${response.status}`);
    }
    if (response.url && !response.url.startsWith("https://")) {
      throw new ModelDownloadError("address", file.path, `${file.path}: redirected off HTTPS`);
    }
    const hash = createHash("sha256");
    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        bytes += chunk.length;
        done += chunk.length;
        downloaded += chunk.length;
        report();
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      meter,
      createWriteStream(partial),
    );
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
    await rename(partial, target);
  }
  await rename(staging, dir);
  return downloaded;
}
