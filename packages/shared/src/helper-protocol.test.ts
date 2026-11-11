import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  audioCancelRequestSchema,
  audioDevicesRequestSchema,
  audioLevelEventSchema,
  audioSilentEventSchema,
  audioDevicesChangedEventSchema,
  audioRouteChangedEventSchema,
  audioStartRequestSchema,
  audioStopRequestSchema,
  envelopeSchema,
  formatRequestId,
  helloAckRequestSchema,
  helloEventSchema,
  helperErrorEventSchema,
  insertCopyRequestSchema,
  mediaMuteRequestSchema,
  contextSnapshotRequestSchema,
  typingWatchRequestSchema,
  mediaPlaybackRequestSchema,
  mediaPauseRequestSchema,
  mediaResumeRequestSchema,
  typingActivityEventSchema,
  mediaStatusRequestSchema,
  insertTextRequestSchema,
  hotkeyConfigureRequestSchema,
  hotkeyEventSchema,
  hotkeyTapStatusEventSchema,
  isHelperEventType,
  pingRequestSchema,
  permissionsRequestRequestSchema,
  permissionsStatusRequestSchema,
  responseSchema,
  shutdownRequestSchema,
  transcribeFileRequestSchema,
  transcribeLoadRequestSchema,
  transcribeUnloadRequestSchema,
  HELPER_REQUESTS,
  NdjsonDecoder,
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

/** Picks the whole-message schema for a fixture message, the way main would. */
function validateMessage(message: unknown): boolean {
  const envelope = envelopeSchema.safeParse(message);
  if (!envelope.success) return false;
  switch (envelope.data.type) {
    case "hello":
      return helloEventSchema.safeParse(message).success;
    case "helper.error":
      return helperErrorEventSchema.safeParse(message).success;
    case "hello.ack":
      return helloAckRequestSchema.safeParse(message).success;
    case "ping":
      return pingRequestSchema.safeParse(message).success;
    case "shutdown":
      return shutdownRequestSchema.safeParse(message).success;
    case "permissions.status":
      return permissionsStatusRequestSchema.safeParse(message).success;
    case "permissions.request":
      return permissionsRequestRequestSchema.safeParse(message).success;
    case "hotkey.configure":
      return hotkeyConfigureRequestSchema.safeParse(message).success;
    case "hotkey.event":
      return hotkeyEventSchema.safeParse(message).success;
    case "hotkey.tap.status":
      return hotkeyTapStatusEventSchema.safeParse(message).success;
    case "audio.devices":
      return audioDevicesRequestSchema.safeParse(message).success;
    case "audio.start":
      return audioStartRequestSchema.safeParse(message).success;
    case "audio.stop":
      return audioStopRequestSchema.safeParse(message).success;
    case "audio.cancel":
      return audioCancelRequestSchema.safeParse(message).success;
    case "audio.level":
      return audioLevelEventSchema.safeParse(message).success;
    case "audio.silent":
      return audioSilentEventSchema.safeParse(message).success;
    case "audio.devices.changed":
      return audioDevicesChangedEventSchema.safeParse(message).success;
    case "audio.route.changed":
      return audioRouteChangedEventSchema.safeParse(message).success;
    case "transcribe.load":
      return transcribeLoadRequestSchema.safeParse(message).success;
    case "transcribe.unload":
      return transcribeUnloadRequestSchema.safeParse(message).success;
    case "transcribe.file":
      return transcribeFileRequestSchema.safeParse(message).success;
    case "insert.text":
      return insertTextRequestSchema.safeParse(message).success;
    case "insert.copy":
      return insertCopyRequestSchema.safeParse(message).success;
    case "media.status":
      return mediaStatusRequestSchema.safeParse(message).success;
    case "media.mute":
      return mediaMuteRequestSchema.safeParse(message).success;
    case "media.playback":
      return mediaPlaybackRequestSchema.safeParse(message).success;
    case "media.pause":
      return mediaPauseRequestSchema.safeParse(message).success;
    case "media.resume":
      return mediaResumeRequestSchema.safeParse(message).success;
    case "typing.watch":
      return typingWatchRequestSchema.safeParse(message).success;
    case "typing.activity":
      return typingActivityEventSchema.safeParse(message).success;
    case "context.snapshot":
      return contextSnapshotRequestSchema.safeParse(message).success;
    case "response": {
      const response = responseSchema.safeParse(message);
      if (!response.success) return false;
      const payload = response.data.payload;
      if (!payload.ok) return true;
      return requestResultSchemas(payload.requestType)?.safeParse(payload.result).success ?? false;
    }
    default:
      // Requests this side does not model yet: the envelope shape is all that can be checked.
      return true;
  }
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
