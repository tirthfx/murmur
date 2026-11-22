import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { createAudit, type Audit } from "./audit.ts";
import { migrate } from "./migrations.ts";
import { createSettings } from "./settings.ts";
import { BACKOFF_MS, createSiem, isLocalUrl, type Siem } from "./siem.ts";

let db: DatabaseSync;
let clock = 1_000_000;
let audit: Audit;
let siem: Siem;
let posts: { url: string; line: string }[] = [];
let answers: number[] = [];
let file = "";

beforeEach(() => {
  clock = 1_000_000;
  posts = [];
  answers = [];
  file = join(mkdtempSync(join(tmpdir(), "siem-")), "audit.jsonl");
  db = new DatabaseSync(":memory:");
  migrate(db);
  const settings = createSettings(db, () => clock);
  siem = createSiem({
    db,
    settings,
    now: () => clock,
    filePath: file,
    post: async (url, line) => {
      posts.push({ url, line });
      return answers.shift() ?? 200;
    },
  });
  audit = createAudit({
    db,
    settings,
    now: () => clock,
    onRecorded: (event) => siem.enqueue(event),
  });
});

describe("which addresses a webhook may use", () => {
  it("allows this machine and private networks only", () => {
    for (const url of [
      "http://localhost:9000/x",
      "http://127.0.0.1/x",
      "http://[::1]:8080/x",
      "https://10.1.2.3/x",
      "http://172.16.0.5/x",
      "http://172.31.255.1/x",
      "http://192.168.1.20:3000/hook",
      "http://siem.local/x",
    ])
      expect(isLocalUrl(url), url).toBe(true);
    for (const url of [
      "https://example.com/x",
      "http://172.32.0.1/x",
      "http://8.8.8.8/x",
      "ftp://localhost/x",
      "file:///etc/passwd",
      "not a url",
    ])
      expect(isLocalUrl(url), url).toBe(false);
  });

  it("is checked when the setting is saved", () => {
    expect(siem.setConfig({ mode: "webhook", webhookUrl: "https://example.com/x" }).ok).toBe(false);
    expect(siem.setConfig({ mode: "webhook", webhookUrl: "" }).ok).toBe(false);
    expect(siem.setConfig({ mode: "nope" as never }).ok).toBe(false);
    expect(siem.setConfig({ mode: "webhook", webhookUrl: "http://127.0.0.1:9000/in" }).ok).toBe(
      true,
    );
    expect(siem.config()).toEqual({ mode: "webhook", webhookUrl: "http://127.0.0.1:9000/in" });
  });
});

describe("file mode", () => {
  it("writes each new entry as a JSON line", async () => {
    siem.setConfig({ mode: "file" });
    audit.record({ action: "auth.sign_in", actorId: "u1" });
    audit.record({ action: "account.created", actorId: "u1" });
    expect(await siem.flush()).toEqual({ sent: 2, failed: 0 });
    const lines = readFileSync(file, "utf8").trimEnd().split("\n");
    expect(lines.map((line) => (JSON.parse(line) as { action: string }).action)).toEqual([
      "auth.sign_in",
      "account.created",
    ]);
    expect(siem.status()).toMatchObject({ pending: 0, sent: 2, failed: 0 });
    // Nothing is sent twice.
    expect(await siem.flush()).toEqual({ sent: 0, failed: 0 });
  });

  it("queues nothing while it is off", async () => {
    audit.record({ action: "auth.sign_in" });
    expect(siem.status()).toMatchObject({ mode: "off", pending: 0 });
    expect(await siem.flush()).toEqual({ sent: 0, failed: 0 });
  });
});

describe("webhook mode", () => {
  beforeEach(() => siem.setConfig({ mode: "webhook", webhookUrl: "http://127.0.0.1:9000/in" }));

  it("posts the entry", async () => {
    audit.record({ action: "auth.sign_in", actorId: "u1" });
    await siem.flush();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe("http://127.0.0.1:9000/in");
    expect(JSON.parse(posts[0]!.line)).toMatchObject({ action: "auth.sign_in", seq: 1 });
  });

  it("leaves the entry queued and shown as failed after three answers of 500", async () => {
    answers = [500, 500, 500];
    audit.record({ action: "auth.sign_in" });

    expect(await siem.flush()).toEqual({ sent: 0, failed: 0 });
    expect(siem.status()).toMatchObject({ pending: 1, failed: 0 });
    // It waits before the next try.
    expect(await siem.flush()).toEqual({ sent: 0, failed: 0 });
    expect(posts).toHaveLength(1);

    clock += BACKOFF_MS[0];
    await siem.flush();
    expect(posts).toHaveLength(2);
    clock += BACKOFF_MS[1];
    expect(await siem.flush()).toEqual({ sent: 0, failed: 1 });
    expect(posts).toHaveLength(3);

    const status = siem.status();
    expect(status).toMatchObject({ pending: 0, sent: 0, failed: 1 });
    expect(status.failures).toEqual([{ seq: 1, attempts: 3, error: "The receiver answered 500." }]);
    // The entry is still in the log and the chain is fine.
    expect(audit.verify().ok).toBe(true);

    clock += 1_000_000;
    await siem.flush();
    expect(posts).toHaveLength(3);
  });

  it("sends a failed entry again when asked, and recovers when the receiver does", async () => {
    answers = [500, 500, 500];
    audit.record({ action: "auth.sign_in" });
    for (const wait of [0, BACKOFF_MS[0], BACKOFF_MS[1]]) {
      clock += wait;
      await siem.flush();
    }
    expect(siem.status().failed).toBe(1);
    expect(siem.retryFailed()).toBe(1);
    await siem.flush();
    expect(siem.status()).toMatchObject({ pending: 0, sent: 1, failed: 0 });
  });

  it("treats a receiver that cannot be reached like a bad answer", async () => {
    const dead = createSiem({
      db,
      settings: createSettings(db, () => clock),
      now: () => clock,
      filePath: file,
      post: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:9000");
      },
    });
    audit.record({ action: "auth.sign_in" });
    await dead.flush();
    expect(dead.status().pending).toBe(1);
    expect(db.prepare("SELECT last_error FROM siem_queue").get()).toEqual({
      last_error: "connect ECONNREFUSED 127.0.0.1:9000",
    });
  });
});
