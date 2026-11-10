import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@murmur/shared";
import { createIpcHandler } from "./ipc";

const entryUrl = "file:///app/.vite/renderer/main_window/index.html";
const info = { name: "Murmur", version: "0.0.0", platform: "darwin" };
const helperStatus = { state: "ready", helperVersion: "0.1.0", message: null } as const;

function setup() {
  const getAppInfo = vi.fn(() => info);
  const getHelperStatus = vi.fn(() => helperStatus);
  const handle = createIpcHandler({ entryUrl, getAppInfo, getHelperStatus });
  return { handle, getAppInfo, getHelperStatus };
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
