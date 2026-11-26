import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isOwnSource, windowsWording, windowsWordingPlugin } from "./windows-wording";

const DESKTOP = path.resolve(__dirname, "..");
const SOURCES = [path.join(DESKTOP, "src"), path.resolve(DESKTOP, "../../packages/shared/src")];

/** Words that only mean something on a Mac. */
const MAC_WORD =
  /\bMac\b|\bmacOS\b|\bKeychain\b|\b[Mm]enu\s+bar\b|\bSystem\s+Settings\b|\bFinder\b/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    // The Mac's own adapter files and the test doubles are never shown on Windows.
    return /\.(ts|tsx)$/.test(name) &&
      !/\.test\.tsx?$|^mac-|test-api|smoke|conformance|-contract\.ts$/.test(name)
      ? [full]
      : [];
  });
}

/** Every text a person could read: string literals, template parts and the text between tags. */
function texts(file: string, code: string): string[] {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const text = node.text.replace(/\s+/g, " ").trim();
      // A single word is an id or a key ("macOS" as the name of the system), not a sentence.
      if (text.includes(" ")) found.push(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("Windows wording", () => {
  it.each([
    ["Kept only on this Mac.", "Kept only on this PC."],
    ["This Mac", "This PC"],
    ["the Mac's sound", "the PC's sound"],
    ["It is kept in the Mac&apos;s Keychain.", "It is kept in Windows Credential Manager."],
    ["The token is not in the Keychain.", "The token is not in Windows Credential Manager."],
    ["Show the next meeting in the menu bar", "Show the next meeting in the notification area"],
    ["next meeting menu bar lookahead", "next meeting system tray lookahead"],
    ["Open System Settings", "Open Windows Settings"],
    ["Show in Finder", "Show in File Explorer"],
    ["System follows macOS. The", "System follows Windows. The"],
    ["kept on this\n          Mac, then", "kept on this\n          PC, then"],
    [
      "macOS notifications. macOS asks once for permission the first time one is shown.",
      "Windows notifications. ",
    ],
  ])("says %j as %j", (mac, windows) => {
    expect(windowsWording(mac)).toBe(windows);
  });

  it("leaves code and ids alone", () => {
    const code = `const keychain: Keychain = createHelperKeychain(); osName: "macOS"; "com.apple.finder"; isMac`;
    expect(windowsWording(code)).toBe(code);
  });

  it("covers every text in the app and the shared package", () => {
    const all = SOURCES.flatMap(files);
    expect(all.length).toBeGreaterThan(200);
    // The check sees the words it is there for: the source has many of them.
    const before = all.flatMap((file) =>
      texts(file, readFileSync(file, "utf8")).filter((text) => MAC_WORD.test(text)),
    );
    expect(before.length).toBeGreaterThan(40);
    const left = all.flatMap((file) =>
      texts(file, windowsWording(readFileSync(file, "utf8")))
        .filter((text) => MAC_WORD.test(text))
        .map((text) => `${path.relative(DESKTOP, file)}: ${text}`),
    );
    // A new Mac word needs a phrase in `windows-wording.ts`.
    expect(left).toEqual([]);
  });

  it("rewrites the app's own source, for a Windows build only", () => {
    const own = path.join(DESKTOP, "src/renderer/hub/HistoryPage.tsx");
    const shared = path.resolve(DESKTOP, "../../packages/shared/src/privacy.ts");
    expect([own, shared].every(isOwnSource)).toBe(true);
    expect(isOwnSource("/repo/node_modules/@murmur/shared/src/privacy.ts")).toBe(true);
    expect(isOwnSource("C:\\repo\\node_modules\\@murmur\\shared\\src\\home.ts")).toBe(true);
    expect(isOwnSource("/repo/node_modules/lib/src/index.ts")).toBe(false);
    expect(isOwnSource("/repo/node_modules/@murmur/shared/node_modules/zod/src/x.ts")).toBe(false);
    expect(windowsWordingPlugin("win32").transform(`"on this Mac"`, own)?.code).toBe(
      `"on this PC"`,
    );
    expect(windowsWordingPlugin("darwin").transform(`"on this Mac"`, own)).toBeNull();
    expect(windowsWordingPlugin("win32").transform(`"on this Mac"`, "/x/other.ts")).toBeNull();
  });
});
