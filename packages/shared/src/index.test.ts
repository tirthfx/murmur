import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, isSupportedProtocolVersion } from "./index";

describe("PROTOCOL_VERSION", () => {
  it("is 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});

describe("isSupportedProtocolVersion", () => {
  it("accepts the current protocol version", () => {
    expect(isSupportedProtocolVersion(PROTOCOL_VERSION)).toBe(true);
  });

  it("rejects any other version", () => {
    expect(isSupportedProtocolVersion(0)).toBe(false);
    expect(isSupportedProtocolVersion(2)).toBe(false);
  });
});
