import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@murmur/shared";
import { createIpcHandler } from "./ipc";

const entryUrl = "file:///app/.vite/renderer/main_window/index.html";
const info = { name: "Murmur", version: "0.0.0", platform: "darwin" };
const helperStatus = { state: "ready", helperVersion: "0.1.0", message: null } as const;

function setup() {
  const getAppInfo = vi.fn(() => info);
  const getHelperStatus = vi.fn(() => helperStatus);
  const permissionsInfo = {
    statuses: {
      microphone: "granted",
      accessibility: "denied",
      inputMonitoring: "not_determined",
      screenRecording: "unknown",
    },
    message: null,
  } as const;
  const getPermissions = vi.fn(() => Promise.resolve(permissionsInfo));
  const requestPermission = vi.fn(() => Promise.resolve(permissionsInfo));
  const openPermissionSettings = vi.fn(() => Promise.resolve());
  const handle = createIpcHandler({
    entryUrl,
    getAppInfo,
    getHelperStatus,
    getPermissions,
    requestPermission,
    openPermissionSettings,
  });
  return {
    handle,
    getAppInfo,
    getHelperStatus,
    getPermissions,
    requestPermission,
    openPermissionSettings,
    permissionsInfo,
  };
}

describe("createIpcHandler", () => {
  it("returns app info to the app page", () => {
    const { handle } = setup();
    expect(handle(IPC_CHANNELS.getAppInfo, { senderFrame: { url: entryUrl } }, [])).toEqual(info);
  });

  it("returns the helper status to the app page", () => {
    const { handle } = setup();
    expect(handle(IPC_CHANNELS.getHelperStatus, { senderFrame: { url: entryUrl } }, [])).toEqual(
      helperStatus,
    );
  });

  it("rejects arguments on the helper status call and untrusted senders", () => {
    const { handle, getHelperStatus } = setup();
    expect(() =>
      handle(IPC_CHANNELS.getHelperStatus, { senderFrame: { url: entryUrl } }, ["x"]),
    ).toThrow(/invalid-args/);
    expect(() =>
      handle(IPC_CHANNELS.getHelperStatus, { senderFrame: { url: "https://example.com/" } }, []),
    ).toThrow(/untrusted sender/);
    expect(getHelperStatus).not.toHaveBeenCalled();
  });

  it("rejects an unknown channel", () => {
    const { handle } = setup();
    expect(() => handle("app:nope", { senderFrame: { url: entryUrl } }, [])).toThrow(
      /unknown-channel/,
    );
  });

  it("rejects invalid arguments without running the implementation", () => {
    const { handle, getAppInfo } = setup();
    expect(() =>
      handle(IPC_CHANNELS.getAppInfo, { senderFrame: { url: entryUrl } }, ["extra"]),
    ).toThrow(/invalid-args/);
    expect(getAppInfo).not.toHaveBeenCalled();
  });

  it("rejects a sender that is not the app page", () => {
    const { handle, getAppInfo } = setup();
    expect(() =>
      handle(IPC_CHANNELS.getAppInfo, { senderFrame: { url: "https://example.com/" } }, []),
    ).toThrow(/untrusted sender/);
    expect(() => handle(IPC_CHANNELS.getAppInfo, {}, [])).toThrow(/untrusted sender/);
    expect(() => handle(IPC_CHANNELS.getAppInfo, { senderFrame: null }, [])).toThrow(
      /untrusted sender/,
    );
    expect(getAppInfo).not.toHaveBeenCalled();
  });
});

describe("permission channels", () => {
  const sender = { senderFrame: { url: entryUrl } };

  it("getPermissions returns the service result", async () => {
    const { handle, getPermissions, permissionsInfo } = setup();
    await expect(handle(IPC_CHANNELS.getPermissions, sender, [])).resolves.toEqual(permissionsInfo);
    expect(getPermissions).toHaveBeenCalledOnce();
  });

  it("requestPermission passes a requestable kind through", async () => {
    const { handle, requestPermission } = setup();
    await handle(IPC_CHANNELS.requestPermission, sender, ["accessibility"]);
    expect(requestPermission).toHaveBeenCalledExactlyOnceWith("accessibility");
  });

  it("requestPermission refuses Screen Recording and unknown kinds", () => {
    const { handle, requestPermission } = setup();
    for (const args of [["screenRecording"], ["camera"], [], [{}], ["microphone", "x"]]) {
      expect(() => handle(IPC_CHANNELS.requestPermission, sender, args)).toThrow(/invalid-args/);
    }
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("permission calls from an untrusted sender do nothing", () => {
    const { handle, getPermissions, requestPermission, openPermissionSettings } = setup();
    const evil = { senderFrame: { url: "https://example.com/" } };
    expect(() => handle(IPC_CHANNELS.getPermissions, evil, [])).toThrow(/untrusted sender/);
    expect(() => handle(IPC_CHANNELS.requestPermission, evil, ["microphone"])).toThrow(
      /untrusted sender/,
    );
    expect(() => handle(IPC_CHANNELS.openPermissionSettings, evil, ["microphone"])).toThrow(
      /untrusted sender/,
    );
    expect(getPermissions).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(openPermissionSettings).not.toHaveBeenCalled();
  });

  it("openPermissionSettings takes a permission kind, never a URL", async () => {
    const { handle, openPermissionSettings } = setup();
    await handle(IPC_CHANNELS.openPermissionSettings, sender, ["screenRecording"]);
    expect(openPermissionSettings).toHaveBeenCalledExactlyOnceWith("screenRecording");
    for (const arg of ["x-apple.systempreferences:com.apple.preference.security", "https://a.b"]) {
      expect(() => handle(IPC_CHANNELS.openPermissionSettings, sender, [arg])).toThrow(
        /invalid-args/,
      );
    }
    expect(openPermissionSettings).toHaveBeenCalledOnce();
  });
});
