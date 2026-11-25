import { describe, expect, it } from "vitest";
import { clientConfigPath, diffLines, maskToken, mergeConfig, serverEntry } from "./client-config";

const entry = serverEntry({
  command: "/Applications/Murmur.app/Contents/Resources/mcp/murmur-mcp",
  socketPath: "/Users/me/Library/Application Support/Murmur/mcp.sock",
  token: "tok-1234567890",
});

describe("client config files (CN-11)", () => {
  it("knows where Claude desktop and Cursor keep theirs", () => {
    expect(
      clientConfigPath("claude-desktop", "/Users/me", ["Library", "Application Support", "Claude"]),
    ).toBe("/Users/me/Library/Application Support/Claude/claude_desktop_config.json");
    expect(clientConfigPath("cursor", "/Users/me", [])).toBe("/Users/me/.cursor/mcp.json");
  });

  it("makes an entry with the command, the socket and the token", () => {
    expect(entry).toEqual({
      command: "/Applications/Murmur.app/Contents/Resources/mcp/murmur-mcp",
      args: [],
      env: {
        MURMUR_MCP_SOCKET: "/Users/me/Library/Application Support/Murmur/mcp.sock",
        MURMUR_MCP_TOKEN: "tok-1234567890",
      },
    });
  });

  it("makes a new file when there is none", () => {
    const merged = mergeConfig(null, entry);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(JSON.parse(merged.text)).toEqual({ mcpServers: { murmur: entry } });
    expect(merged.text.endsWith("\n")).toBe(true);
    expect(mergeConfig("   \n", entry)).toEqual(merged);
  });

  it("adds Murmur and keeps everything else, and replaces an older Murmur entry", () => {
    const existing = JSON.stringify({
      globalShortcut: "Cmd+Space",
      mcpServers: { files: { command: "npx", args: ["files"] }, murmur: { command: "old" } },
    });
    const merged = mergeConfig(existing, entry);
    if (!merged.ok) throw new Error(merged.message);
    expect(JSON.parse(merged.text)).toEqual({
      globalShortcut: "Cmd+Space",
      mcpServers: { files: { command: "npx", args: ["files"] }, murmur: entry },
    });
  });

  it("never touches a file that is not a JSON object with an object for mcpServers", () => {
    for (const bad of [
      "{nope",
      "[]",
      '"text"',
      "null",
      '{"mcpServers": []}',
      '{"mcpServers": "x"}',
    ]) {
      const merged = mergeConfig(bad, entry);
      expect(merged.ok, bad).toBe(false);
    }
    expect(mergeConfig("{nope", entry)).toEqual({
      ok: false,
      message: "The file is not valid JSON, so Murmur will not change it. Fix it and try again.",
    });
  });

  it("masks a token but for its last four characters, wherever it is", () => {
    expect(maskToken('{"a":"tok-1234567890","b":"tok-1234567890"}', "tok-1234567890")).toBe(
      '{"a":"••••••••7890","b":"••••••••7890"}',
    );
    expect(maskToken("nothing", "")).toBe("nothing");
  });
});

describe("diff of a config file (CN-11)", () => {
  const kinds = (lines: ReturnType<typeof diffLines>) =>
    lines.map((line) => `${line.kind}:${line.text}`);

  it("shows a new file as all added", () => {
    expect(kinds(diffLines("", '{\n  "a": 1\n}\n'))).toEqual(["add:{", 'add:  "a": 1', "add:}"]);
  });

  it("shows what changed with a little around it, and folds the rest", () => {
    const before = [
      "{",
      ...Array.from({ length: 20 }, (_, i) => `  "k${i}": ${i},`),
      '  "end": 0',
      "}",
    ].join("\n");
    const after = before.replace('"k10": 10,', '"k10": 99,');
    const lines = diffLines(before, after);
    expect(kinds(lines)).toEqual([
      "skip:9 unchanged lines",
      'same:  "k8": 8,',
      'same:  "k9": 9,',
      'remove:  "k10": 10,',
      'add:  "k10": 99,',
      'same:  "k11": 11,',
      'same:  "k12": 12,',
      "skip:9 unchanged lines",
    ]);
  });

  it("shows nothing but unchanged lines folded when the files are the same", () => {
    const text = '{\n  "a": 1\n}\n';
    expect(kinds(diffLines(text, text))).toEqual(["skip:3 unchanged lines"]);
  });

  it("shows removed lines, and says 1 unchanged line in the singular", () => {
    expect(kinds(diffLines("a\nb\nc\nd\ne\nf\ng\nh\n", "a\nb\nc\nd\ne\nf\ng\n"))).toEqual([
      "skip:5 unchanged lines",
      "same:f",
      "same:g",
      "remove:h",
    ]);
    expect(kinds(diffLines("a\n", "a\nb\nc\n"))).toEqual(["same:a", "add:b", "add:c"]);
  });
});
