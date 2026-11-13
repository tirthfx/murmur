// The local language model used for text cleanup (vault ADR-0014, owner's choice in
// Session 03). No imports, so a plain Node script can load it.
import type { SpeechModel } from "./speech-models";

/** Same shape as the speech model manifest: files with size and SHA-256 at a pinned revision. */
export type ModelManifest = SpeechModel;

/** Qwen3 4B Instruct 2507, 4-bit (Q4_K_M) GGUF. Apache 2.0. */
export const DEFAULT_CLEANUP_MODEL: ModelManifest = {
  id: "qwen3-4b-instruct-2507-q4km",
  label: "Qwen3 4B Instruct (4-bit)",
  totalBytes: 2497281120,
  files: [
    {
      path: "model/Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
      url: "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
      size: 2497281120,
      sha256: "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597",
    },
  ],
};

/**
 * Instruct Mode's Quality model (RW-15, owner's choice 2026-11-13): Qwen3 8B, 4-bit (Q4_K_M)
 * GGUF. Apache 2.0. Downloaded only when asked, in Settings. Its thinking mode is kept off.
 */
export const QUALITY_INSTRUCT_MODEL: ModelManifest = {
  id: "qwen3-8b-q4km",
  label: "Qwen3 8B (4-bit)",
  totalBytes: 5027784512,
  files: [
    {
      path: "model/Qwen3-8B-Q4_K_M.gguf",
      url: "https://huggingface.co/unsloth/Qwen3-8B-GGUF/resolve/a6adef130ffb23ddaf1a62fec9dced968c9bc482/Qwen3-8B-Q4_K_M.gguf",
      size: 5027784512,
      sha256: "120307ba529eb2439d6c430d94104dabd578497bc7bfe7e322b5d9933b449bd4",
    },
  ],
};

/** Instruct Mode's two presets: Fast is the cleanup model, Quality the larger one. */
export const INSTRUCT_MODEL_CHOICES = ["fast", "quality"] as const;
export type InstructModelChoice = (typeof INSTRUCT_MODEL_CHOICES)[number];
