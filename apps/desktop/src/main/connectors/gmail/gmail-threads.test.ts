import { describe, expect, it } from "vitest";
import { GMAIL_SCOPE_READ } from "@murmur/shared";
import { openDatabase } from "../../db/database";
import { ConnectorError } from "../connector-service";
import { createConnectorStore } from "../connector-store";
import { THREADS_TTL_MS, createGmailThreads } from "./gmail-threads";

const b64 = (text: string) => Buffer.from(text).toString("base64url");
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

function setup(options: { scopes?: string[]; answer?: (url: string) => Response } = {}) {
  const db = openDatabase(":memory:");
  const store = createConnectorStore(db);
  store.upsertAccount({
    id: "g1",
    connector: "gmail",
    email: "me@example.com",
    scopes: options.scopes ?? ["openid", GMAIL_SCOPE_READ],
    at: 1,
  });
  const urls: string[] = [];
  let now = 1_000_000;
  const threads = createGmailThreads({
    connectors: {
      list: () => store.list(),
      authorizedFetch: async (_id, url) => {
        urls.push(url);
        return (
          options.answer?.(url) ??
          (url.includes("/threads?")
            ? json({ threads: [{ id: "t1" }] })
            : json({
                id: "t1",
                messages: [
                  {
                    id: "m1",
                    internalDate: "5",
                    payload: {
                      headers: [{ name: "Subject", value: "Budget" }],
                      mimeType: "text/plain",
                      body: { data: b64("Numbers attached.") },
                    },
                  },
                ],
              }))
        );
      },
    },
    connectorStore: store,
    now: () => now,
  });
  return { threads, urls, advance: (ms: number) => (now += ms) };
}

describe("threads for a brief (CN-04)", () => {
  it("reads the threads as plain text through an account that may read mail", async () => {
    const t = setup();
    const found = await t.threads(["dana@example.com"], 5);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ subject: "Budget" });
    expect(found[0]!.messages[0]!.text).toBe("Numbers attached.");
    expect(t.urls.every((url) => url.startsWith("https://gmail.googleapis.com/"))).toBe(true);
    expect(t.urls.join(" ")).not.toContain("attachments");
  });

  it("keeps what it read for fifteen minutes, then asks again", async () => {
    const t = setup();
    await t.threads(["dana@example.com"], 5);
    const first = t.urls.length;
    await t.threads(["dana@example.com"], 5);
    expect(t.urls.length).toBe(first);
    t.advance(THREADS_TTL_MS - 1000);
    await t.threads(["dana@example.com"], 5);
    expect(t.urls.length).toBe(first);
    t.advance(2000);
    await t.threads(["dana@example.com"], 5);
    expect(t.urls.length).toBe(first * 2);
    // Other people are another read.
    await t.threads(["sam@example.com"], 5);
    expect(t.urls.length).toBeGreaterThan(first * 2);
  });

  it("refuses with plain words when no account may read mail", async () => {
    const t = setup({ scopes: ["openid"] });
    await expect(t.threads(["dana@example.com"], 5)).rejects.toThrow("permission to read mail");
    expect(t.urls).toEqual([]);
  });

  it("turns a failure into words for the owner", async () => {
    await expect(
      setup({ answer: () => json({}, 500) }).threads(["dana@example.com"], 5),
    ).rejects.toThrow("Gmail answered 500.");
    const stale = setup({
      answer: () => {
        throw new ConnectorError("needs-attention", "Connect again.");
      },
    });
    await expect(stale.threads(["dana@example.com"], 5)).rejects.toThrow("Connect again.");
    const down = setup({
      answer: () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(down.threads(["dana@example.com"], 5)).rejects.toThrow("Gmail could not be read.");
  });
});
