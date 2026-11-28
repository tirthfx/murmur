import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { zipFiles } from "./zip";

/** Reads an archive back through its directory, as an unzip program does. */
function read(zip: Buffer): Record<string, string> {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const files: Record<string, string> = {};
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    const local = zip.readUInt32LE(at + 42);
    expect(zip.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + zip.readUInt16LE(local + 26);
    const data = zip.subarray(start, start + size);
    expect(crc32(data)).toBe(zip.readUInt32LE(at + 16));
    files[name] = data.toString("utf8");
    at += 46 + nameLength;
  }
  return files;
}

describe("the meeting archive (NT-18)", () => {
  it("holds every file with its name and bytes", () => {
    const zip = zipFiles([
      { name: "index.html", data: Buffer.from("<p>héllo</p>") },
      { name: "audio/mic-000001.m4a", data: Buffer.from("aac") },
    ]);
    expect(read(zip)).toEqual({ "index.html": "<p>héllo</p>", "audio/mic-000001.m4a": "aac" });
  });

  it("can be empty", () => {
    expect(read(zipFiles([]))).toEqual({});
  });
});
