import { describe, expect, it } from "vitest";
import {
  IPC_CHANNELS,
  PERMISSION_KINDS,
  isRequestablePermissionKind,
  parseIpcRequest,
  permissionsInfoSchema,
  unknownPermissionSnapshot,
} from "./index";

describe("permission kinds", () => {
  it("has the four permissions", () => {
    expect([...PERMISSION_KINDS]).toEqual([
      "microphone",
      "accessibility",
      "inputMonitoring",
      "screenRecording",
    ]);
  });

  it("allows requests for three of them, not Screen Recording or unknown names", () => {
    expect(isRequestablePermissionKind("microphone")).toBe(true);
    expect(isRequestablePermissionKind("accessibility")).toBe(true);
    expect(isRequestablePermissionKind("inputMonitoring")).toBe(true);
    expect(isRequestablePermissionKind("screenRecording")).toBe(false);
    expect(isRequestablePermissionKind("camera")).toBe(false);
    expect(isRequestablePermissionKind(undefined)).toBe(false);
  });

  it("builds an all-unknown snapshot that fits the info schema", () => {
    expect(
      permissionsInfoSchema.safeParse({ statuses: unknownPermissionSnapshot(), message: null })
        .success,
    ).toBe(true);
  });
});

describe("permission IPC arguments", () => {
  it("takes no arguments to read the status", () => {
    expect(parseIpcRequest(IPC_CHANNELS.getPermissions, []).ok).toBe(true);
    expect(parseIpcRequest(IPC_CHANNELS.getPermissions, ["x"]).ok).toBe(false);
  });

  it("accepts a request for a requestable kind", () => {
    expect(parseIpcRequest(IPC_CHANNELS.requestPermission, ["microphone"]).ok).toBe(true);
  });

  it("refuses a request for Screen Recording, unknown kinds and a missing kind", () => {
    for (const args of [["screenRecording"], ["camera"], [""], [], [1], ["microphone", "x"]]) {
      expect(parseIpcRequest(IPC_CHANNELS.requestPermission, args), JSON.stringify(args)).toEqual({
        ok: false,
        reason: "invalid-args",
      });
    }
  });

  it("opens settings for any known kind but not for URLs or unknown names", () => {
    for (const kind of PERMISSION_KINDS) {
      expect(parseIpcRequest(IPC_CHANNELS.openPermissionSettings, [kind]).ok).toBe(true);
    }
    for (const arg of ["x-apple.systempreferences:com.apple.preference.security", "camera", 5]) {
      expect(parseIpcRequest(IPC_CHANNELS.openPermissionSettings, [arg]).ok).toBe(false);
    }
  });
});
