import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  envelopeSchema,
  formatRequestId,
  isHelperEventType,
  HELPER_REQUESTS,
  helloPayloadSchema,
  helperErrorEventPayloadSchema,
  responsePayloadSchema,
  NdjsonDecoder,
  HELPER_EVENTS,
} from "./index";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "..", "protocol-fixtures");
const swiftConstants = path.join(
  here,
  "../../../native/helper-mac/Sources/MurmurHelperCore/ProtocolConstants.swift",
);

interface Fixture {
  messages?: unknown[];
  invalidMessages?: unknown[];
  invalidLines?: string[];
}

function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), "utf8")) as Fixture;
}

const requestResultSchemas = (requestType: string): z.ZodType | undefined =>
  (HELPER_REQUESTS as Record<string, { result: z.ZodType } | undefined>)[requestType]?.result;

const shape = (type: string, id: z.ZodType, payload: z.ZodType) =>
  z.strictObject({ id, type: z.literal(type), payload });
const helloEventSchema = shape("hello", z.null(), helloPayloadSchema);
const helperErrorEventSchema = shape("helper.error", z.null(), helperErrorEventPayloadSchema);
const responseSchema = z.strictObject({
  id: z.string(),
  type: z.literal("response"),
  payload: responsePayloadSchema,
});

/** A whole message of a request main sends, or of an event the helper raises. */
function messageSchema(type: string): z.ZodType | undefined {
  const request = (HELPER_REQUESTS as Record<string, { payload: z.ZodType } | undefined>)[type];
  if (request) return shape(type, z.string(), request.payload);
  const event = (HELPER_EVENTS as Record<string, z.ZodType | undefined>)[type];
  return event ? shape(type, z.null(), event) : undefined;
}

/** Checks a fixture message against its whole-message schema, the way main would. */
function validateMessage(message: unknown): boolean {
  const envelope = envelopeSchema.safeParse(message);
  if (!envelope.success) return false;
  const { type } = envelope.data;
  if (type === "hello") return helloEventSchema.safeParse(message).success;
  if (type === "helper.error") return helperErrorEventSchema.safeParse(message).success;
  if (type === "response") {
    const response = responseSchema.safeParse(message);
    if (!response.success) return false;
    const payload = response.data.payload;
    if (!payload.ok) return true;
    return requestResultSchemas(payload.requestType)?.safeParse(payload.result).success ?? false;
  }
  // A type this side does not model: the envelope shape is all that can be checked.
  return messageSchema(type)?.safeParse(message).success ?? true;
}

describe("protocol fixtures", () => {
  const files = readdirSync(fixturesDir).filter((name) => name.endsWith(".json"));

  it("has fixtures", () => {
    expect(files).toContain("hello.json");
  });

  for (const name of files) {
    const fixture = loadFixture(name);

    it(`${name}: every valid message passes its schema`, () => {
      for (const message of fixture.messages ?? []) {
        expect(validateMessage(message), JSON.stringify(message)).toBe(true);
      }
    });

    it(`${name}: every invalid message is rejected`, () => {
      for (const message of fixture.invalidMessages ?? []) {
        expect(validateMessage(message), JSON.stringify(message)).toBe(false);
      }
    });

    it(`${name}: every invalid line is rejected as JSON or as an envelope`, () => {
      const decoder = new NdjsonDecoder();
      for (const line of fixture.invalidLines ?? []) {
        const [result] = decoder.push(`${line}\n`);
        const accepted = result?.ok === true && envelopeSchema.safeParse(result.value).success;
        expect(accepted, line).toBe(false);
      }
    });
  }
});

describe("envelope", () => {
  it("rejects extra keys, a missing id and a non-object payload", () => {
    expect(envelopeSchema.safeParse({ id: null, type: "x", payload: {}, extra: 1 }).success).toBe(
      false,
    );
    expect(envelopeSchema.safeParse({ type: "x", payload: {} }).success).toBe(false);
    expect(envelopeSchema.safeParse({ id: null, type: "x", payload: [] }).success).toBe(false);
  });

  it("formats request ids as m- plus six digits", () => {
    expect(formatRequestId(1)).toBe("m-000001");
    expect(formatRequestId(123)).toBe("m-000123");
  });
});

describe("hello event", () => {
  it("ignores unknown payload fields", () => {
    const parsed = helloEventSchema.safeParse({
      id: null,
      type: "hello",
      payload: { protocolVersion: 1, helperVersion: "0.1.0", capabilities: [], future: true },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("helper events", () => {
  it("lists the feature events and nothing inherited", () => {
    expect(isHelperEventType("hotkey.event")).toBe(true);
    expect(isHelperEventType("hotkey.tap.status")).toBe(true);
    expect(isHelperEventType("hello")).toBe(false);
    expect(isHelperEventType("toString")).toBe(false);
  });
});

describe("Swift protocol version", () => {
  it("matches PROTOCOL_VERSION", () => {
    const source = readFileSync(swiftConstants, "utf8");
    const match = /static let protocolVersion\s*=\s*(\d+)/.exec(source);
    expect(match, "protocolVersion not found in ProtocolConstants.swift").not.toBeNull();
    expect(Number(match?.[1])).toBe(PROTOCOL_VERSION);
  });
});
