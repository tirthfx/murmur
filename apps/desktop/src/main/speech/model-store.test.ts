import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeechModel } from "@murmur/shared";
import { DEFAULT_SPEECH_MODEL } from "@murmur/shared";
import { checkModel, downloadModel, modelLocation, ModelDownloadError } from "./model-store";

const contents: Record<string, string> = {
  "model/config.json": '{"name":"test"}',
  "model/AudioEncoder.mlmodelc/weights/weight.bin": "x".repeat(5000),
  "tokenizer/tokenizer.json": '{"version":"1"}',
};

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const model: SpeechModel = {
  id: "test-model",
  label: "Test model",
  totalBytes: Object.values(contents).reduce((sum, text) => sum + Buffer.byteLength(text), 0),
  files: Object.entries(contents).map(([file, text]) => ({
    path: file,
    url: `https://huggingface.co/test/resolve/abc/${file}`,
    size: Buffer.byteLength(text),
    sha256: sha256(text),
  })),
};

function fakeFetch(overrides: Record<string, string> = {}) {
  return vi.fn(async (url: string | URL | Request) => {
    const file = String(url).split("/resolve/abc/")[1]!;
    const body = overrides[file] ?? contents[file];
    if (body === undefined) return new Response("missing", { status: 404 });
    return new Response(body, { status: 200 });
  });
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "murmur-model-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("model store", () => {
  it("reports a model that was never downloaded as missing", async () => {
    expect(await checkModel(root, model)).toEqual({
      ok: false,
      reason: "missing",
      file: "model/config.json",
    });
  });

  it("downloads every file, verifies it, and reports progress up to the total", async () => {
    const fetch = fakeFetch();
    const progress: number[] = [];
    const bytes = await downloadModel(root, model, {
      fetch,
      onProgress: (done) => progress.push(done),
    });
    expect(bytes).toBe(model.totalBytes);
    expect(progress.at(-1)).toBe(model.totalBytes);
    expect(await checkModel(root, model)).toEqual({ ok: true });
    const { tokenizerDir } = modelLocation(root, model);
    expect(await readFile(path.join(tokenizerDir, "tokenizer.json"), "utf8")).toBe(
      '{"version":"1"}',
    );
  });

  it("is cached: a second run downloads nothing", async () => {
    await downloadModel(root, model, { fetch: fakeFetch() });
    const fetch = fakeFetch();
    expect(await downloadModel(root, model, { fetch })).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("detects a changed file and repairs only that file", async () => {
    await downloadModel(root, model, { fetch: fakeFetch() });
    const { modelDir } = modelLocation(root, model);
    await writeFile(path.join(modelDir, "config.json"), '{"name":"evil"}');
    expect(await checkModel(root, model)).toEqual({
      ok: false,
      reason: "checksum",
      file: "model/config.json",
    });
    const fetch = fakeFetch();
    await downloadModel(root, model, { fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await checkModel(root, model)).toEqual({ ok: true });
  });

  it("refuses a download whose SHA-256 does not match and leaves nothing in place", async () => {
    const fetch = fakeFetch({ "tokenizer/tokenizer.json": '{"version":"2"}' });
    await expect(downloadModel(root, model, { fetch })).rejects.toMatchObject({
      reason: "checksum",
      file: "tokenizer/tokenizer.json",
    });
    expect((await checkModel(root, model)).ok).toBe(false);
  });

  it("refuses a short download", async () => {
    const fetch = fakeFetch({ "model/config.json": "{}" });
    await expect(downloadModel(root, model, { fetch })).rejects.toBeInstanceOf(ModelDownloadError);
  });

  it("only downloads from https://huggingface.co", async () => {
    const bad = { ...model, files: [{ ...model.files[0]!, url: "http://example.com/x" }] };
    await expect(downloadModel(root, bad, { fetch: fakeFetch() })).rejects.toMatchObject({
      reason: "address",
    });
  });

  it("stops on an HTTP error", async () => {
    const fetch = vi.fn(async () => new Response("no", { status: 500 }));
    await expect(downloadModel(root, model, { fetch })).rejects.toMatchObject({ reason: "http" });
  });

  describe("resuming", () => {
    const file = "model/AudioEncoder.mlmodelc/weights/weight.bin";
    const partial = () => path.join(root, `${model.id}.partial`, `${file}.download`);

    async function leavePartial(text: string) {
      await mkdir(path.dirname(partial()), { recursive: true });
      await writeFile(partial(), text);
    }

    it("asks only for the missing bytes and appends them", async () => {
      await leavePartial("x".repeat(3000));
      const ranges: (string | null)[] = [];
      const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const name = String(url).split("/resolve/abc/")[1]!;
        const range = new Headers(init?.headers).get("Range");
        if (name !== file) return new Response(contents[name], { status: 200 });
        ranges.push(range);
        const from = Number(/bytes=(\d+)-/.exec(range ?? "")?.[1] ?? 0);
        return new Response(contents[name]!.slice(from), { status: from > 0 ? 206 : 200 });
      });
      const bytes = await downloadModel(root, model, { fetch });
      expect(ranges).toEqual(["bytes=3000-"]);
      expect(bytes).toBe(model.totalBytes - 3000);
      expect((await checkModel(root, model)).ok).toBe(true);
    });

    it("starts over when the server ignores the range", async () => {
      await leavePartial("y".repeat(3000));
      const bytes = await downloadModel(root, model, { fetch: fakeFetch() });
      expect(bytes).toBe(model.totalBytes);
      expect((await checkModel(root, model)).ok).toBe(true);
    });

    it("rejects a resumed file whose earlier bytes were wrong", async () => {
      await leavePartial("y".repeat(3000));
      const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const name = String(url).split("/resolve/abc/")[1]!;
        const ranged = new Headers(init?.headers).has("Range");
        return new Response(ranged ? contents[name]!.slice(3000) : contents[name], {
          status: ranged ? 206 : 200,
        });
      });
      await expect(downloadModel(root, model, { fetch })).rejects.toMatchObject({
        reason: "checksum",
      });
    });
  });

  it("refuses file paths that leave the model folder", async () => {
    const bad = { ...model, files: [{ ...model.files[0]!, path: "../escape.json" }] };
    await expect(checkModel(root, bad)).rejects.toThrow("Unsafe model file path");
  });
});

describe("default speech model manifest", () => {
  it("pins every file to an https huggingface.co address at a fixed revision with a SHA-256", () => {
    expect(DEFAULT_SPEECH_MODEL.files.length).toBeGreaterThan(10);
    for (const file of DEFAULT_SPEECH_MODEL.files) {
      expect(file.url).toMatch(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\//);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.path).toMatch(/^(model|tokenizer)\//);
    }
    const total = DEFAULT_SPEECH_MODEL.files.reduce((sum, file) => sum + file.size, 0);
    expect(DEFAULT_SPEECH_MODEL.totalBytes).toBe(total);
  });

  it("includes the tokenizer, so loading never needs the network", () => {
    const paths = DEFAULT_SPEECH_MODEL.files.map((file) => file.path);
    expect(paths).toContain("tokenizer/tokenizer.json");
    expect(paths).toContain("model/config.json");
  });
});
