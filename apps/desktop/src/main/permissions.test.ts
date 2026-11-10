import { describe, expect, it, vi } from "vitest";
import type { PermissionSnapshot } from "@murmur/shared";
import { createTestLogger } from "./helper/fakes";
import { HelperError } from "./helper/types";
import { createPermissionsService } from "./permissions";

const granted: PermissionSnapshot = {
  microphone: "granted",
  accessibility: "denied",
  inputMonitoring: "not_determined",
  screenRecording: "unknown",
};

function setup(overrides: Partial<Parameters<typeof createPermissionsService>[0]["helper"]> = {}) {
  const helper = {
    checkPermissions: vi.fn().mockResolvedValue(granted),
    requestPermission: vi
      .fn()
      .mockResolvedValue({ status: "not_determined", openedSettings: false }),
    ...overrides,
  };
  const logger = createTestLogger();
  return { helper, logger, service: createPermissionsService({ helper, logger }) };
}

describe("permissions service", () => {
  it("check returns the helper's statuses and logs them with the reason", async () => {
    const { service, logger } = setup();
    expect(await service.check("launch")).toEqual({ statuses: granted, message: null });
    expect(logger.lines.join("\n")).toContain("checked (launch): microphone=granted");
  });

  it("check reports unknown with a message when the helper is unavailable", async () => {
    const { service } = setup({
      checkPermissions: vi.fn().mockRejectedValue(new HelperError("HELPER_UNAVAILABLE", "gone")),
    });
    const info = await service.check("focus");
    expect(Object.values(info.statuses)).toEqual(["unknown", "unknown", "unknown", "unknown"]);
    expect(info.message).toMatch(/helper is not running/i);
  });

  it("check explains an old helper that lacks the request", async () => {
    const { service } = setup({
      checkPermissions: vi.fn().mockRejectedValue(new HelperError("UNSUPPORTED_REQUEST", "x")),
    });
    expect((await service.check("launch")).message).toMatch(/rebuild/i);
  });

  it("request asks the helper for the kind, then re-reads the statuses", async () => {
    const { service, helper } = setup();
    const info = await service.request("microphone");
    expect(helper.requestPermission).toHaveBeenCalledExactlyOnceWith("microphone");
    expect(helper.checkPermissions).toHaveBeenCalledOnce();
    expect(info.statuses).toEqual(granted);
  });

  it("request refuses Screen Recording and unknown kinds without calling the helper", async () => {
    const { service, helper } = setup();
    await expect(service.request("screenRecording")).rejects.toThrow(/refused/);
    await expect(service.request("camera" as never)).rejects.toThrow(/refused/);
    expect(helper.requestPermission).not.toHaveBeenCalled();
  });

  it("request still returns statuses if the helper fails the request", async () => {
    const { service } = setup({
      requestPermission: vi.fn().mockRejectedValue(new HelperError("HELPER_TIMEOUT", "slow")),
    });
    expect((await service.request("accessibility")).statuses).toEqual(granted);
  });
});

describe("permissions onChecked", () => {
  it("passes statuses from successful checks only, and stops after unsubscribe", async () => {
    const checkPermissions = vi
      .fn<() => Promise<PermissionSnapshot>>()
      .mockResolvedValue(granted)
      .mockResolvedValueOnce(granted)
      .mockRejectedValueOnce(new HelperError("HELPER_UNAVAILABLE", "gone"));
    const { service } = setup({ checkPermissions });
    const seen: PermissionSnapshot[] = [];
    const unsubscribe = service.onChecked((statuses) => seen.push(statuses));
    await service.check("one");
    await service.check("two");
    unsubscribe();
    await service.check("three");
    expect(seen).toEqual([granted]);
  });
});
