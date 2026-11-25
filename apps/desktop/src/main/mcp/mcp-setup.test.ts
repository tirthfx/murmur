import { describe, expect, it, vi } from "vitest";
import type { Keychain } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { clientConfigPath } from "./client-config";
import { createMcpClients } from "./mcp-clients";
import { backupPath, createMcpSetup, PREVIEW_MS, type ConfigFiles } from "./mcp-setup";

class FakeKeychain implements Keychain {
  items = new Map<string, string>();
  async get(service: string, account: string) {
    return this.items.get(`${service}|${account}`) ?? null;
  }
  async set(service: string, account: string, value: string) {
    this.items.set(`${service}|${account}`, value);
  }
  async delete(service: string, account: string) {
    return this.items.delete(`${service}|${account}`);
  }
}

class FakeFiles implements ConfigFiles {
  files = new Map<string, string>();
  writes: string[] = [];
  failWrite = false;
  read(file: string) {
    return this.files.get(file) ?? null;
  }
  write(file: string, text: string) {
    if (this.failWrite) throw new Error("disk full");
    this.writes.push(file);
    this.files.set(file, text);
  }
}

const HOME = "/Users/me";
const CLAUDE_FOLDER = ["Library", "Application Support", "Claude"];
const CLAUDE_FILE = clientConfigPath("claude-desktop", HOME, CLAUDE_FOLDER);

async function setup() {
  const db = openDatabase(":memory:");
  const keychain = new FakeKeychain();
  let n = 0;
  let now = 1_000;
  const clients = createMcpClients(db, {
    keychain,
    newId: () => `c${++n}`,
    now: () => now,
    logger: { warn: vi.fn() },
  });
  const files = new FakeFiles();
  const setup = createMcpSetup({
    clients,
    files,
    home: HOME,
    claudeFolder: CLAUDE_FOLDER,
    command: () => "/Applications/Murmur.app/Contents/Resources/mcp/murmur-mcp",
    socketPath: "/Users/me/Library/Application Support/Murmur/mcp.sock",
    newId: () => `p${++n}`,
    now: () => now,
  });
  const claude = await clients.issue("Claude desktop", "claude-desktop");
  const cursor = await clients.issue("Cursor", "cursor");
  const other = await clients.issue("Other app", "other");
  if (!claude.ok || !cursor.ok || !other.ok) throw new Error("issue");
  return {
    setup,
    files,
    clients,
    claude: claude.client,
    cursor: cursor.client,
    other: other.client,
    advance: (ms: number) => (now += ms),
  };
}

describe("writing a client's config only after the owner approves the diff (CN-11)", () => {
  it("shows what would be written, with the token masked, and writes nothing", async () => {
    const t = await setup();
    const result = await t.setup.preview(t.claude.id);
    if (!result.ok) throw new Error(result.message);
    const { preview } = result;
    expect(preview).toMatchObject({
      clientName: "Claude desktop (Claude desktop)",
      path: CLAUDE_FILE,
      exists: false,
      changed: true,
      backupPath: null,
    });
    const shown = preview.lines.map((line) => line.text).join("\n");
    expect(shown).toContain('"murmur"');
    expect(shown).toContain("murmur-mcp");
    expect(shown).toContain("••••••••");
    const token = (await t.clients.token(t.claude.id))!;
    expect(JSON.stringify(preview)).not.toContain(token);
    expect(t.files.writes).toEqual([]);
    expect(t.files.files.size).toBe(0);
  });

  it("writes the file, with the real token, only when the preview is approved", async () => {
    const t = await setup();
    const preview = await t.setup.preview(t.claude.id);
    if (!preview.ok) throw new Error(preview.message);
    expect(await t.setup.apply(preview.preview.previewId)).toEqual({
      ok: true,
      message: "Wrote claude_desktop_config.json. Restart the app so it picks the change up.",
    });
    const written = JSON.parse(t.files.files.get(CLAUDE_FILE)!);
    const token = (await t.clients.token(t.claude.id))!;
    expect(written.mcpServers.murmur.env.MURMUR_MCP_TOKEN).toBe(token);
    expect(written.mcpServers.murmur.command).toContain("murmur-mcp");
    // The same preview cannot be used twice.
    expect(await t.setup.apply(preview.preview.previewId)).toMatchObject({ ok: false });
    expect(t.files.writes).toEqual([CLAUDE_FILE]);
  });

  it("keeps a copy of the file that was there, and the other parts of it", async () => {
    const t = await setup();
    const before = JSON.stringify(
      { theme: "dark", mcpServers: { files: { command: "x" } } },
      null,
      2,
    );
    t.files.files.set(CLAUDE_FILE, before);
    const preview = await t.setup.preview(t.claude.id);
    if (!preview.ok) throw new Error(preview.message);
    expect(preview.preview).toMatchObject({
      exists: true,
      changed: true,
      backupPath: backupPath(CLAUDE_FILE),
    });
    // Lines that stay are shown as they are.
    expect(
      preview.preview.lines.some((line) => line.kind === "add" && line.text.includes("murmur")),
    ).toBe(true);
    await t.setup.apply(preview.preview.previewId);
    expect(t.files.files.get(backupPath(CLAUDE_FILE))).toBe(before);
    expect(JSON.parse(t.files.files.get(CLAUDE_FILE)!)).toMatchObject({
      theme: "dark",
      mcpServers: { files: { command: "x" }, murmur: expect.anything() },
    });
  });

  it("writes nothing when the file changed after the preview", async () => {
    const t = await setup();
    t.files.files.set(CLAUDE_FILE, '{"a":1}');
    const preview = await t.setup.preview(t.claude.id);
    if (!preview.ok) throw new Error(preview.message);
    t.files.files.set(CLAUDE_FILE, '{"a":2}');
    expect(await t.setup.apply(preview.preview.previewId)).toEqual({
      ok: false,
      message:
        "The file changed since you looked at it, so nothing was written. Look at the changes again.",
    });
    expect(t.files.files.get(CLAUDE_FILE)).toBe('{"a":2}');
    expect(t.files.writes).toEqual([]);
    // Or when a file that was not there has appeared.
    const second = await setup();
    const p = await second.setup.preview(second.cursor.id);
    if (!p.ok) throw new Error(p.message);
    second.files.files.set(clientConfigPath("cursor", HOME, CLAUDE_FOLDER), "{}");
    expect(await second.setup.apply(p.preview.previewId)).toMatchObject({ ok: false });
  });

  it("refuses a preview that is old, unknown, or of an app that was removed", async () => {
    const t = await setup();
    const preview = await t.setup.preview(t.claude.id);
    if (!preview.ok) throw new Error(preview.message);
    t.advance(PREVIEW_MS + 1);
    expect(await t.setup.apply(preview.preview.previewId)).toMatchObject({ ok: false });
    expect(await t.setup.apply("nope")).toMatchObject({ ok: false });
    const fresh = await t.setup.preview(t.claude.id);
    if (!fresh.ok) throw new Error(fresh.message);
    await t.clients.revoke(t.claude.id);
    expect(await t.setup.apply(fresh.preview.previewId)).toEqual({
      ok: false,
      message: "That app is gone.",
    });
    expect(t.files.writes).toEqual([]);
  });

  it("a newer preview of the same app replaces the older one", async () => {
    const t = await setup();
    const first = await t.setup.preview(t.claude.id);
    const second = await t.setup.preview(t.claude.id);
    if (!first.ok || !second.ok) throw new Error("preview");
    expect(await t.setup.apply(first.preview.previewId)).toMatchObject({ ok: false });
    expect(await t.setup.apply(second.preview.previewId)).toMatchObject({ ok: true });
  });

  it("says nothing would change when the file already has the entry", async () => {
    const t = await setup();
    const first = await t.setup.preview(t.claude.id);
    if (!first.ok) throw new Error(first.message);
    await t.setup.apply(first.preview.previewId);
    const again = await t.setup.preview(t.claude.id);
    if (!again.ok) throw new Error(again.message);
    expect(again.preview.changed).toBe(false);
  });

  it("does not change a file that is not valid JSON, and reports a failed write", async () => {
    const t = await setup();
    t.files.files.set(CLAUDE_FILE, "{nope");
    expect(await t.setup.preview(t.claude.id)).toMatchObject({
      ok: false,
      message: expect.stringContaining("not valid JSON"),
    });
    t.files.files.set(CLAUDE_FILE, "{}");
    const preview = await t.setup.preview(t.claude.id);
    if (!preview.ok) throw new Error(preview.message);
    t.files.failWrite = true;
    expect(await t.setup.apply(preview.preview.previewId)).toEqual({
      ok: false,
      message: "Murmur could not write the file.",
    });
  });

  it("has nothing to write for another kind of app, a missing app or a missing token", async () => {
    const t = await setup();
    expect(await t.setup.preview(t.other.id)).toMatchObject({
      ok: false,
      message: expect.stringContaining("does not know where this app keeps its config"),
    });
    expect(await t.setup.preview("nope")).toEqual({ ok: false, message: "That app is gone." });
  });
});
