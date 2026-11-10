import { MAX_LINE_BYTES, type Envelope } from "./helper-protocol";

/** Encodes one message as a single line, including the trailing newline. */
export function encodeMessage(envelope: Envelope): string {
  return `${JSON.stringify(envelope)}\n`;
}

export type DecodedLine =
  { ok: true; value: unknown } | { ok: false; error: "invalid-json" | "line-too-long" };

const encoder = new TextEncoder();

/**
 * Incremental NDJSON decoder. Feed it chunks as they arrive from a stream: partial lines are
 * held until their newline arrives, and one chunk may yield several messages. Bad lines
 * become `{ok: false}` results instead of throwing, so one bad line never stops the stream.
 * Blank lines are skipped. A line over the byte limit is dropped and reported once.
 */
export class NdjsonDecoder {
  private readonly textDecoder = new TextDecoder("utf-8");
  private pending = "";
  private discarding = false;

  constructor(private readonly maxLineBytes: number = MAX_LINE_BYTES) {}

  push(chunk: string | Uint8Array): DecodedLine[] {
    const text =
      typeof chunk === "string" ? chunk : this.textDecoder.decode(chunk, { stream: true });
    const results: DecodedLine[] = [];
    let rest = text;
    for (;;) {
      const newline = rest.indexOf("\n");
      if (newline === -1) {
        this.holdPartial(rest, results);
        return results;
      }
      const piece = rest.slice(0, newline);
      rest = rest.slice(newline + 1);
      if (this.discarding) {
        this.discarding = false;
      } else {
        this.finishLine(this.pending + piece, results);
      }
      this.pending = "";
    }
  }

  private holdPartial(partial: string, results: DecodedLine[]): void {
    if (this.discarding) return;
    // A string's UTF-16 length never exceeds its UTF-8 byte length, so a longer buffer is
    // certainly over the limit. A buffer that passes is checked exactly when the line completes.
    if (this.pending.length + partial.length > this.maxLineBytes) {
      this.discarding = true;
      this.pending = "";
      results.push({ ok: false, error: "line-too-long" });
      return;
    }
    this.pending += partial;
  }

  private finishLine(line: string, results: DecodedLine[]): void {
    if (line.trim() === "") return;
    if (byteLength(line) > this.maxLineBytes) {
      results.push({ ok: false, error: "line-too-long" });
      return;
    }
    try {
      results.push({ ok: true, value: JSON.parse(line) });
    } catch {
      results.push({ ok: false, error: "invalid-json" });
    }
  }
}

function byteLength(text: string): number {
  return encoder.encode(text).length;
}
