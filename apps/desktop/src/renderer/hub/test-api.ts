import { vi } from "vitest";
import type { MurmurApi, PermissionsInfo } from "@murmur/shared";

export const SAMPLE_PERMISSIONS: PermissionsInfo = {
  statuses: {
    microphone: "granted",
    accessibility: "denied",
    inputMonitoring: "not_determined",
    screenRecording: "unknown",
  },
  message: null,
};

/** A mocked preload API for renderer tests. Override any member. */
export function createMockApi(overrides: Partial<MurmurApi> = {}): MurmurApi {
  return {
    getAppInfo: vi.fn().mockResolvedValue({ name: "Murmur", version: "1.2.3", platform: "darwin" }),
    getHelperStatus: vi
      .fn()
      .mockResolvedValue({ state: "ready", helperVersion: "0.1.0", message: null }),
    getPermissions: vi.fn().mockResolvedValue(SAMPLE_PERMISSIONS),
    requestPermission: vi.fn().mockResolvedValue(SAMPLE_PERMISSIONS),
    openPermissionSettings: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
