import { describe, expect, it, vi } from "vitest";
import { createHubPage, type PageContents } from "./hub-page";

/** A window that behaves as Electron's does: its page cannot be read once it is closed. */
function fakeWindow() {
  let closed = false;
  let handler: () => void = () => {};
  const contents = { isDestroyed: () => closed, send: vi.fn() } satisfies PageContents;
  return {
    contents,
    get webContents() {
      if (closed) throw new TypeError("Object has been destroyed");
      return contents;
    },
    on: (_event: "closed", next: () => void) => (handler = next),
    close() {
      closed = true;
      handler();
    },
  };
}

describe("the Hub page", () => {
  it("receives events while its window is open, and closing raises nothing", () => {
    const page = createHubPage();
    page.send("early", 1);
    const window = fakeWindow();
    page.follow(window);
    page.send("state", "idle");
    expect(() => window.close()).not.toThrow();
    page.send("late", 2);
    expect(window.contents.send.mock.calls).toEqual([["state", "idle"]]);
  });

  it("keeps the newer window when an older one closes", () => {
    const page = createHubPage();
    const first = fakeWindow();
    const second = fakeWindow();
    page.follow(first);
    page.follow(second);
    first.close();
    page.send("state", "listening");
    expect(second.contents.send).toHaveBeenCalledWith("state", "listening");
    expect(first.contents.send).not.toHaveBeenCalled();
  });

  it("does not send to a page that is already gone", () => {
    const page = createHubPage();
    const window = fakeWindow();
    page.follow(window);
    window.contents.isDestroyed = () => true;
    page.send("state", "idle");
    expect(window.contents.send).not.toHaveBeenCalled();
  });
});
