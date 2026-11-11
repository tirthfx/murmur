import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { micAlpha, micPng } from "./tray-icon";

describe("tray icon", () => {
  it("draws 18 points at each scale", () => {
    expect(micAlpha(1).size).toBe(18);
    expect(micAlpha(2).size).toBe(36);
  });

  it("is solid in the capsule, empty in the corners, and left-right symmetric", () => {
    const { size, alpha } = micAlpha(2);
    const at = (x: number, y: number) => alpha[y * size + x]!;
    expect(at(18, 12)).toBe(255);
    expect(at(0, 0)).toBe(0);
    expect(at(size - 1, size - 1)).toBe(0);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size / 2; x++) expect(at(x, y)).toBe(at(size - 1 - x, y));
    }
  });

  it("encodes a PNG with the right size and the shape in the alpha channel", () => {
    const png = micPng(2);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(36);
    expect(png.readUInt32BE(20)).toBe(36);
    const length = png.readUInt32BE(33);
    const rows = inflateSync(png.subarray(41, 41 + length));
    expect(rows.length).toBe(36 * (36 * 4 + 1));
    // Row 12, pixel 18: black, fully opaque.
    const pixel = 12 * (36 * 4 + 1) + 1 + 18 * 4;
    expect([...rows.subarray(pixel, pixel + 4)]).toEqual([0, 0, 0, 255]);
  });
});
