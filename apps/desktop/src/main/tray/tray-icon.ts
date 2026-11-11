import { crc32, deflateSync } from "node:zlib";

// The menu bar icon is drawn here, so the repository holds no image file for it. The shape
// is a simple microphone: a capsule, a cradle under it, a stem and a base.

/** Icon size in points. macOS menu bar icons are 18 pt; the 2x version is 36 px. */
export const TRAY_ICON_POINTS = 18;

/** True when the point (in an 18 by 18 box) is inside the microphone shape. */
function inside(x: number, y: number): boolean {
  const cx = 9;
  // Capsule: every point within 2.5 of the segment (9, 4.5) to (9, 8.5).
  const nearestY = Math.min(8.5, Math.max(4.5, y));
  if (Math.hypot(x - cx, y - nearestY) <= 2.5) return true;
  // Cradle: the lower half of a ring around the capsule's bottom.
  if (y >= 8.5 && Math.abs(Math.hypot(x - cx, y - 8.5) - 4.4) <= 0.6) return true;
  // Stem and base.
  if (Math.abs(x - cx) <= 0.6 && y >= 12.8 && y <= 15.6) return true;
  return Math.abs(y - 15.4) <= 0.6 && Math.abs(x - cx) <= 2.6;
}

/** Alpha values (0 to 255), one per pixel, `scale` pixels per point, smoothed 4 by 4. */
export function micAlpha(scale: number): { size: number; alpha: Uint8Array } {
  const size = TRAY_ICON_POINTS * scale;
  const alpha = new Uint8Array(size * size);
  const samples = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / scale;
          const y = (py + (sy + 0.5) / samples) / scale;
          if (inside(x, y)) hits++;
        }
      }
      alpha[py * size + px] = Math.round((hits / (samples * samples)) * 255);
    }
  }
  return { size, alpha };
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** A PNG of the icon: black with the shape in the alpha channel (a macOS template image). */
export function micPng(scale: number): Buffer {
  const { size, alpha } = micAlpha(scale);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x++) rows[row + 1 + x * 4 + 3] = alpha[y * size + x]!;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
