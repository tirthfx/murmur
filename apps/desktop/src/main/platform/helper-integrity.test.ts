import { describe, expect, it } from "vitest";
import { checkHelperBinary, parseManifest, sha256Hex } from "./helper-integrity";
import { createMacHelper } from "./mac-helper";

const bytes = new TextEncoder().encode("helper bytes");
const good = sha256Hex(bytes);
const files = (map: Record<string, Uint8Array>) => (file: string) => map[file] ?? null;
const text = (value: string) => new TextEncoder().encode(value);

describe("checkHelperBinary", () => {
  it("accepts a binary that matches its manifest, with or without a file name", () => {
    for (const manifest of [good, `${good}  murmur-helper\n`, good.toUpperCase()]) {
      expect(
        checkHelperBinary("/h", { read: files({ "/h": bytes, "/h.sha256": text(manifest) }) }),
      ).toEqual({ ok: true, checked: true });
    }
  });

  it("refuses a binary that was changed", () => {
    const result = checkHelperBinary("/h", {
      read: files({ "/h": text("tampered"), "/h.sha256": text(good) }),
    });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("does not match") });
  });

  it("refuses a manifest that is not a hash", () => {
    expect(
      checkHelperBinary("/h", { read: files({ "/h": bytes, "/h.sha256": text("nope") }) }),
    ).toMatchObject({ ok: false });
  });

  it("does not check a build that has no manifest", () => {
    expect(checkHelperBinary("/h", { read: files({ "/h": bytes }) })).toEqual({
      ok: true,
      checked: false,
    });
  });

  it("parses a manifest", () => {
    expect(parseManifest(`${good} x`)).toBe(good);
    expect(parseManifest("")).toBeNull();
  });
});

describe("the helper is not started when its hash is wrong", () => {
  const base = {
    isPackaged: true,
    resourcesPath: "/App/Contents/Resources",
    appPath: "/repo/apps/desktop",
    env: {},
    appVersion: "1.0.0",
    exists: () => true,
    logger: { info() {}, warn() {}, error() {} },
  };

  it("reports the helper as unavailable with the reason", async () => {
    const helper = createMacHelper({
      ...base,
      integrity: () => ({ ok: false, message: "does not match" }),
    });
    await expect(helper.start()).rejects.toMatchObject({ code: "HELPER_UNAVAILABLE" });
    expect(helper.getStatus()).toMatchObject({ state: "unavailable", message: "does not match" });
  });
});
