import type { SpeechModel } from "./speech-models";

/**
 * The speech model the Windows helper loads: Whisper large-v3 turbo, quantised to 5 bits, as a
 * single ggml file for whisper.cpp (about 574 MB; MIT licence). It is the same Whisper model the
 * Mac runs, in a format that runs on the CPU. The address is pinned to one revision of the
 * repository, and the size and SHA-256 are the ones Hugging Face publishes for that file
 * (`X-Linked-Size` and `X-Linked-ETag`). Change the model by changing all four fields together.
 *
 * Whisper.cpp has no separate tokenizer, so the manifest lists only the model file; the app
 * still passes a tokenizer folder because the protocol carries one, and the Windows helper
 * ignores it.
 */
export const WINDOWS_SPEECH_MODEL: SpeechModel = {
  id: "whisper-large-v3-turbo-q5_0",
  label: "Whisper large-v3 turbo (5-bit, whisper.cpp)",
  totalBytes: 574041195,
  files: [
    {
      path: "model/ggml-large-v3-turbo-q5_0.bin",
      url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin",
      size: 574041195,
      sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    },
  ],
};
