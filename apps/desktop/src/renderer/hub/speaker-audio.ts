/**
 * Plays a short sample of a speaker (NT-08). The chunk file is decoded with Web Audio (no media
 * element, so the page's content policy needs no change) and played from the line's start for
 * at most the time given. One sample plays at a time: a new one stops the last.
 */
export interface SamplePlayer {
  /** Starts playing; resolves when it ends or is stopped, and rejects if it cannot be played. */
  play(bytes: Uint8Array, offsetSec: number, playSec: number): Promise<void>;
  stop(): void;
}

export function createSamplePlayer(): SamplePlayer {
  let context: AudioContext | null = null;
  let current: { source: AudioBufferSourceNode; finish: () => void } | null = null;

  const stop = () => {
    const playing = current;
    current = null;
    if (!playing) return;
    try {
      playing.source.stop();
    } catch {
      // Already ended.
    }
    playing.finish();
  };

  return {
    stop,
    async play(bytes, offsetSec, playSec) {
      stop();
      const Audio = window.AudioContext;
      if (!Audio) throw new Error("No audio output");
      context ??= new Audio();
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const buffer = await context.decodeAudioData(copy as ArrayBuffer);
      if (context.state === "suspended") await context.resume();
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      await new Promise<void>((resolve) => {
        const entry = { source, finish: resolve };
        current = entry;
        source.onended = () => {
          if (current === entry) current = null;
          resolve();
        };
        source.start(0, Math.max(0, offsetSec), Math.max(0.1, playSec));
      });
    },
  };
}
