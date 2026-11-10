import { describe, expect, it } from "vitest";
import { NdjsonDecoder, encodeMessage } from "./ndjson";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("encodeMessage", () => {
  it("writes one line ending in a newline, with the envelope keys in order", () => {
    const line = encodeMessage({ id: null, type: "hello", payload: { a: 1 } });
    expect(line).toBe('{"id":null,"type":"hello","payload":{"a":1}}\n');
  });

  it("keeps newlines inside strings escaped, so the message stays on one line", () => {
    const line = encodeMessage({ id: "m-000001", type: "x", payload: { text: "a\nb" } });
    expect(line.match(/\n/g)).toHaveLength(1);
  });
});

describe("NdjsonDecoder", () => {
  it("decodes several messages from one chunk", () => {
    const decoder = new NdjsonDecoder();
    expect(decoder.push('{"a":1}\n{"b":2}\n{"c":3}\n')).toEqual([
      { ok: true, value: { a: 1 } },
      { ok: true, value: { b: 2 } },
      { ok: true, value: { c: 3 } },
    ]);
  });

  it("holds a partial line until its newline arrives", () => {
    const decoder = new NdjsonDecoder();
    expect(decoder.push('{"a":')).toEqual([]);
    expect(decoder.push('1}\n{"b"')).toEqual([{ ok: true, value: { a: 1 } }]);
    expect(decoder.push(":2}\n")).toEqual([{ ok: true, value: { b: 2 } }]);
  });

  it("handles a chunk boundary in the middle of a multi-byte character", () => {
    const decoder = new NdjsonDecoder();
    const all = bytes('{"t":"é€"}\n');
    const cut = all.indexOf(0xc3) + 1;
    expect(decoder.push(all.slice(0, cut))).toEqual([]);
    expect(decoder.push(all.slice(cut))).toEqual([{ ok: true, value: { t: "é€" } }]);
  });

  it("handles one byte at a time", () => {
    const decoder = new NdjsonDecoder();
    const results = [...bytes('{"a":1}\n{"b":2}\n')].flatMap((byte) =>
      decoder.push(new Uint8Array([byte])),
    );
    expect(results).toEqual([
      { ok: true, value: { a: 1 } },
      { ok: true, value: { b: 2 } },
    ]);
  });

  it("reports invalid JSON and keeps decoding", () => {
    const decoder = new NdjsonDecoder();
    expect(decoder.push('not json\n{"ok":true}\n')).toEqual([
      { ok: false, error: "invalid-json" },
      { ok: true, value: { ok: true } },
    ]);
  });

  it("skips blank lines", () => {
    const decoder = new NdjsonDecoder();
    expect(decoder.push('\n  \n{"a":1}\n')).toEqual([{ ok: true, value: { a: 1 } }]);
  });

  it("drops an over-long line once, even when it arrives in pieces", () => {
    const decoder = new NdjsonDecoder(16);
    expect(decoder.push("x".repeat(10))).toEqual([]);
    expect(decoder.push("x".repeat(10))).toEqual([{ ok: false, error: "line-too-long" }]);
    expect(decoder.push("x".repeat(10))).toEqual([]);
    expect(decoder.push('x\n{"a":1}\n')).toEqual([{ ok: true, value: { a: 1 } }]);
  });

  it("counts bytes, not characters, for a complete line", () => {
    const decoder = new NdjsonDecoder(8);
    expect(decoder.push('"éééé"\n')).toEqual([{ ok: false, error: "line-too-long" }]);
  });

  it("round-trips encoded messages", () => {
    const decoder = new NdjsonDecoder();
    const message = { id: "m-000001", type: "ping", payload: {} };
    expect(decoder.push(encodeMessage(message))).toEqual([{ ok: true, value: message }]);
  });
});
