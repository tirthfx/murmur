import { crc32 } from "node:zlib";

/** One file of an archive: its path inside it, and its bytes. */
export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** The largest size the plain ZIP format can say; a meeting stays far below it. */
const ZIP_MAX = 0xffffffff;
/** UTF-8 names. */
const FLAGS = 0x0800;
const VERSION = 20;
/** 1 January 1980, the earliest date the format has: the files carry no time of their own. */
const DOS_DATE = 0x21;

/**
 * A ZIP archive of files stored as they are (NT-18). The audio is already compressed, so nothing
 * would be gained by compressing it again, and this needs no library.
 */
export function zipFiles(entries: readonly ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const size = entry.data.length;
    const sum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(FLAGS, 8);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    parts.push(local, name, entry.data);
    directory.push(central, name);
    offset += local.length + name.length + size;
    if (offset > ZIP_MAX) throw new Error("The archive would be too large.");
  }

  const index = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, index, end]);
}
