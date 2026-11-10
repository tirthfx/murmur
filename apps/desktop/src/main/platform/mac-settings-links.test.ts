import { describe, expect, it } from "vitest";
import { PERMISSION_KINDS } from "@murmur/shared";
import { allPermissionSettingsUrls, permissionSettingsUrl } from "./mac-settings-links";

describe("permissionSettingsUrl", () => {
  it("returns the exact pane for each permission", () => {
    expect(permissionSettingsUrl("microphone")).toBe(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    );
    expect(permissionSettingsUrl("accessibility")).toBe(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    );
    expect(permissionSettingsUrl("inputMonitoring")).toBe(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
    );
    expect(permissionSettingsUrl("screenRecording")).toBe(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );
  });

  it("covers every permission kind, each with a distinct URL", () => {
    const urls = PERMISSION_KINDS.map((kind) => permissionSettingsUrl(kind));
    expect(urls.every((url) => url !== null)).toBe(true);
    expect(new Set(urls).size).toBe(PERMISSION_KINDS.length);
  });

  it("only produces x-apple.systempreferences URLs", () => {
    for (const url of allPermissionSettingsUrls()) {
      expect(url.startsWith("x-apple.systempreferences:")).toBe(true);
    }
  });

  it("returns null for unknown names, URLs and inherited object keys", () => {
    for (const input of [
      "camera",
      "",
      "https://example.com",
      "x-apple.systempreferences:com.apple.preference.security",
      "__proto__",
      "constructor",
      "toString",
      undefined,
      null,
      42,
      {},
    ]) {
      expect(permissionSettingsUrl(input), String(input)).toBeNull();
    }
  });
});
