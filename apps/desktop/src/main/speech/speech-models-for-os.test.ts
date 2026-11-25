import { DEFAULT_SPEECH_MODEL, WINDOWS_SPEECH_MODEL } from "@murmur/shared";
import { describe, expect, it } from "vitest";
import { speechModelFor } from "../platform";
import { checkModel, modelLocation } from "./model-store";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

describe("the speech model for each OS", () => {
  it("the Mac keeps the CoreML build and Windows gets the whisper.cpp file", () => {
    expect(speechModelFor("darwin")).toBe(DEFAULT_SPEECH_MODEL);
    expect(speechModelFor("win32")).toBe(WINDOWS_SPEECH_MODEL);
  });

  it("the two models do not share a folder", () => {
    expect(WINDOWS_SPEECH_MODEL.id).not.toBe(DEFAULT_SPEECH_MODEL.id);
  });

  it("the Windows manifest is one pinned, checksummed file under model/", () => {
    expect(WINDOWS_SPEECH_MODEL.files).toHaveLength(1);
    const [file] = WINDOWS_SPEECH_MODEL.files;
    expect(file?.path).toMatch(/^model\/ggml-.*\.bin$/);
    expect(file?.url).toMatch(
      /^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/[0-9a-f]{40}\//,
    );
    expect(file?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(WINDOWS_SPEECH_MODEL.totalBytes).toBe(file?.size);
  });

  it("a file that matches the manifest passes the check and one that differs does not", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "murmur-winmodel-"));
    try {
      const bytes = Buffer.from("not a real model");
      const model = {
        ...WINDOWS_SPEECH_MODEL,
        totalBytes: bytes.length,
        files: [
          {
            ...WINDOWS_SPEECH_MODEL.files[0]!,
            size: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        ],
      };
      const where = modelLocation(dir, model);
      await mkdir(where.modelDir, { recursive: true });
      await writeFile(path.join(dir, model.id, model.files[0]!.path), bytes);
      expect(await checkModel(dir, model)).toEqual({ ok: true });
      await writeFile(
        path.join(dir, model.id, model.files[0]!.path),
        Buffer.from("not a real modeL"),
      );
      expect(await checkModel(dir, model)).toMatchObject({ ok: false, reason: "checksum" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
