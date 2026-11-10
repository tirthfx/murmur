import { describe, expect, it, vi } from "vitest";
import {
  createNavigationGuard,
  denyPermissionCheck,
  denyPermissionRequest,
  denyWindowOpen,
  isAppUrl,
  isTrustedIpcSender,
} from "./guards";

const fileEntry =
  "file:///Applications/Murmur.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.html";
const devEntry = "http://localhost:5173";

describe("denyWindowOpen", () => {
  it("denies every request, external or not", () => {
    expect(denyWindowOpen({ url: "https://example.com" })).toEqual({ action: "deny" });
    expect(denyWindowOpen({ url: "about:blank" })).toEqual({ action: "deny" });
    expect(denyWindowOpen({ url: fileEntry })).toEqual({ action: "deny" });
    expect(denyWindowOpen({ url: "" })).toEqual({ action: "deny" });
  });
});

describe("isAppUrl", () => {
  it("matches the bundled page by path and ignores hash and query", () => {
    expect(isAppUrl(fileEntry, fileEntry)).toBe(true);
    expect(isAppUrl(`${fileEntry}#/home?x=1`, fileEntry)).toBe(true);
  });

  it("rejects other files, remote URLs and other schemes in production", () => {
    expect(isAppUrl("file:///etc/passwd", fileEntry)).toBe(false);
    expect(isAppUrl("https://example.com", fileEntry)).toBe(false);
    expect(isAppUrl("http://localhost:5173", fileEntry)).toBe(false);
    expect(isAppUrl("javascript:alert(1)", fileEntry)).toBe(false);
    expect(isAppUrl("data:text/html,hi", fileEntry)).toBe(false);
  });

  it("matches the dev server origin and nothing else in development", () => {
    expect(isAppUrl("http://localhost:5173/some/page", devEntry)).toBe(true);
    expect(isAppUrl("http://localhost:5174/", devEntry)).toBe(false);
    expect(isAppUrl("https://localhost:5173/", devEntry)).toBe(false);
    expect(isAppUrl("http://evil.example/", devEntry)).toBe(false);
    expect(isAppUrl("file:///etc/passwd", devEntry)).toBe(false);
  });

  it("rejects unparseable input", () => {
    expect(isAppUrl("not a url", fileEntry)).toBe(false);
    expect(isAppUrl("", devEntry)).toBe(false);
  });
});

describe("createNavigationGuard", () => {
  it("prevents navigation away from the app", () => {
    const guard = createNavigationGuard(fileEntry);
    const event = { preventDefault: vi.fn() };
    guard(event, "https://example.com/");
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("lets the app reload itself", () => {
    const guard = createNavigationGuard(fileEntry);
    const event = { preventDefault: vi.fn() };
    guard(event, fileEntry);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe("permission handlers", () => {
  it("denies every permission request", () => {
    for (const permission of ["media", "geolocation", "notifications", "clipboard-read"]) {
      const callback = vi.fn();
      denyPermissionRequest(permission, callback);
      expect(callback).toHaveBeenCalledExactlyOnceWith(false);
    }
  });

  it("denies every permission check", () => {
    expect(denyPermissionCheck()).toBe(false);
  });
});

describe("isTrustedIpcSender", () => {
  it("trusts only the app page", () => {
    expect(isTrustedIpcSender(fileEntry, fileEntry)).toBe(true);
    expect(isTrustedIpcSender("https://example.com/", fileEntry)).toBe(false);
    expect(isTrustedIpcSender(undefined, fileEntry)).toBe(false);
  });
});
