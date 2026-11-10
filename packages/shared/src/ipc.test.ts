import { describe, expect, it } from "vitest";
import { IPC_CHANNELS, appInfoSchema, isIpcChannel, parseIpcRequest } from "./ipc";
import { helperStatusSchema } from "./platform-helper";

describe("IPC channels", () => {
  it("recognises only known channels", () => {
    expect(isIpcChannel(IPC_CHANNELS.getAppInfo)).toBe(true);
    expect(isIpcChannel("app:unknown")).toBe(false);
    expect(isIpcChannel(42)).toBe(false);
    expect(isIpcChannel(undefined)).toBe(false);
  });
});

describe("parseIpcRequest", () => {
  it("accepts getAppInfo with no arguments", () => {
    expect(parseIpcRequest(IPC_CHANNELS.getAppInfo, [])).toEqual({ ok: true, args: [] });
  });

  it("rejects getAppInfo with extra arguments", () => {
    expect(parseIpcRequest(IPC_CHANNELS.getAppInfo, ["x"])).toEqual({
      ok: false,
      reason: "invalid-args",
    });
  });

  it("rejects unknown channels", () => {
    expect(parseIpcRequest("app:nope", [])).toEqual({ ok: false, reason: "unknown-channel" });
    expect(parseIpcRequest({}, [])).toEqual({ ok: false, reason: "unknown-channel" });
  });

  it("never echoes the payload in a failure", () => {
    const result = parseIpcRequest(IPC_CHANNELS.getAppInfo, ["secret-value"]);
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });
});

describe("appInfoSchema", () => {
  it("accepts a well-formed value", () => {
    expect(
      appInfoSchema.safeParse({ name: "Murmur", version: "0.0.0", platform: "darwin" }).success,
    ).toBe(true);
  });

  it("rejects missing, empty and extra fields", () => {
    expect(appInfoSchema.safeParse({ name: "Murmur", version: "0.0.0" }).success).toBe(false);
    expect(
      appInfoSchema.safeParse({ name: "", version: "0.0.0", platform: "darwin" }).success,
    ).toBe(false);
    expect(
      appInfoSchema.safeParse({ name: "M", version: "1", platform: "darwin", extra: true }).success,
    ).toBe(false);
  });
});

describe("getHelperStatus", () => {
  it("is a known channel that takes no arguments", () => {
    expect(isIpcChannel(IPC_CHANNELS.getHelperStatus)).toBe(true);
    expect(parseIpcRequest(IPC_CHANNELS.getHelperStatus, [])).toEqual({ ok: true, args: [] });
    expect(parseIpcRequest(IPC_CHANNELS.getHelperStatus, [1])).toEqual({
      ok: false,
      reason: "invalid-args",
    });
  });

  it("accepts a status and rejects an unknown state or extra fields", () => {
    const ok = { state: "ready", helperVersion: "0.1.0", message: null };
    expect(helperStatusSchema.safeParse(ok).success).toBe(true);
    expect(helperStatusSchema.safeParse({ ...ok, state: "weird" }).success).toBe(false);
    expect(helperStatusSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
});
