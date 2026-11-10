import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@murmur/shared";
import { createIpcHandler } from "./ipc";

const entryUrl = "file:///app/.vite/renderer/main_window/index.html";
const info = { name: "Murmur", version: "0.0.0", platform: "darwin" };

function setup() {
  const getAppInfo = vi.fn(() => info);
  const handle = createIpcHandler({ entryUrl, getAppInfo });
  return { handle, getAppInfo };
}

describe("createIpcHandler", () => {
  it("returns app info to the app page", () => {
    const { handle } = setup();
    expect(handle(IPC_CHANNELS.getAppInfo, { senderFrame: { url: entryUrl } }, [])).toEqual(info);
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
