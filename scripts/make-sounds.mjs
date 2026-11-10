// Synthesises Murmur's own feedback sounds (DC-40) as 16-bit mono WAV files. Plain sine
// notes with short attacks and gentle decays; nothing is sampled from anywhere.
//
//   node scripts/make-sounds.mjs

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 44100;

/** Notes: [frequency in Hz, start in ms, length in ms]. */
const SOUNDS = {
  start: [
    [659.25, 0, 70],
    [987.77, 60, 80],
  ],
  lock: [
    [880, 0, 60],
    [880, 80, 60],
  ],
  success: [
    [1046.5, 0, 200],
    [1318.51, 40, 200],
  ],
  error: [
    [220, 0, 120],
    [174.61, 130, 160],
  ],
  cancel: [
    [987.77, 0, 60],
    [659.25, 55, 80],
  ],
};

function render(notes) {
  const end = Math.max(...notes.map(([, start, length]) => start + length));
  const samples = new Float32Array(Math.ceil((end / 1000) * RATE));
  for (const [frequency, start, length] of notes) {
    const from = Math.floor((start / 1000) * RATE);
    const count = Math.floor((length / 1000) * RATE);
    for (let i = 0; i < count && from + i < samples.length; i++) {
      const t = i / RATE;
      const attack = Math.min(1, t / 0.005);
      const decay = Math.exp((-4 * i) / count);
      samples[from + i] += 0.25 * attack * decay * Math.sin(2 * Math.PI * frequency * t);
    }
  }
  return samples;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, i) =>
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), i * 2),
  );
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const out = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../apps/desktop/src/renderer/bar/sounds",
);
for (const [name, notes] of Object.entries(SOUNDS)) {
  const samples = render(notes);
  await writeFile(path.join(out, `${name}.wav`), wav(samples));
  console.log(`${name}.wav ${((samples.length / RATE) * 1000).toFixed(0)} ms`);
}
