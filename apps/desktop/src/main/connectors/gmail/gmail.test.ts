import { describe, expect, it } from "vitest";
import {
  GmailError,
  buildMime,
  createDraft,
  draftUrl,
  encodeSubject,
  gmailProvider,
  htmlToText,
  parseThread,
  recentThreadsWith,
} from "./gmail";

const b64url = (text: string) =>
  Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

const message = (id: string, parts: unknown, headers: Record<string, string> = {}) => ({
  id,
  internalDate: "1700000000000",
  payload: {
    mimeType: "multipart/mixed",
    headers: Object.entries({
      From: "Dana <dana@example.com>",
      To: "me@example.com",
      ...headers,
    }).map(([name, value]) => ({ name, value })),
    parts,
  },
});

describe("Gmail provider (CN-04)", () => {
  it("signs in with who the account is and nothing about mail", () => {
    expect(gmailProvider.scopes).toEqual(["openid", "email"]);
    expect(gmailProvider.authorizeParams).toMatchObject({ include_granted_scopes: "true" });
  });
});

describe("htmlToText", () => {
  it("turns markup into text without rendering it", () => {
    expect(
      htmlToText(
        '<style>p{color:red}</style><p>Hello&nbsp;<b>Dana</b> &amp; Sam</p><div>Next<br>line</div><script>alert(1)</script><img src="https://t.example/p.gif">',
      ),
    ).toBe("Hello Dana & Sam\nNext\nline");
  });
  it("decodes numeric entities and keeps unknown ones", () => {
    expect(htmlToText("caf&#233; &#x41; &unknown;")).toBe("café A &unknown;");
  });
});

describe("parseThread", () => {
  it("prefers the plain part, falls back to HTML as text, and skips attachments", () => {
    const thread = parseThread({
      id: "t1",
      messages: [
        message(
          "m1",
          [
            { mimeType: "text/plain", body: { data: b64url("Plain words") } },
            { mimeType: "text/html", body: { data: b64url("<p>Html words</p>") } },
            {
              mimeType: "application/pdf",
              filename: "plan.pdf",
              body: { attachmentId: "att1", data: b64url("SECRET") },
            },
          ],
          { Subject: "Plan" },
        ),
        message("m2", [{ mimeType: "text/html", body: { data: b64url("<p>Only html</p>") } }]),
      ],
    });
    expect(thread?.subject).toBe("Plan");
    expect(thread?.messages.map((m) => m.text)).toEqual(["Plain words", "Only html"]);
    expect(JSON.stringify(thread)).not.toContain("SECRET");
    expect(thread?.messages[0]).toMatchObject({
      from: "Dana <dana@example.com>",
      dateMs: 1700000000000,
    });
  });

  it("returns null for something that is not a thread and cuts long text", () => {
    expect(parseThread({ nope: true })).toBeNull();
    const long = parseThread({
      id: "t",
      messages: [
        message("m", [{ mimeType: "text/plain", body: { data: b64url("x".repeat(9000)) } }]),
      ],
    });
    expect(long?.messages[0]?.text.length).toBe(4000);
    expect(long?.subject).toBe("(No subject)");
  });
});

describe("recentThreadsWith", () => {
  function fakeFetch(threads: Record<string, unknown>) {
    const urls: string[] = [];
    const fetch = async (url: string): Promise<Response> => {
      urls.push(url);
      if (url.includes("/threads?"))
        return json({ threads: Object.keys(threads).map((id) => ({ id })) });
      const id = decodeURIComponent(url.split("/threads/")[1]!.split("?")[0]!);
      return json(threads[id]);
    };
    return { fetch, urls };
  }

  it("searches for the people, reads each thread as text and never asks for an attachment", async () => {
    const f = fakeFetch({
      a: {
        id: "a",
        messages: [
          message(
            "m1",
            [
              { mimeType: "text/plain", body: { data: b64url("Hi") } },
              { filename: "x.pdf", mimeType: "application/pdf", body: { attachmentId: "z" } },
            ],
            { Subject: "Budget" },
          ),
        ],
      },
    });
    const threads = await recentThreadsWith({
      fetch: f.fetch,
      emails: ["Dana@Example.com", "not an address", "sam@example.com"],
      max: 3,
    });
    expect(threads.map((t) => t.subject)).toEqual(["Budget"]);
    const query = new URL(f.urls[0]!).searchParams;
    expect(query.get("q")).toBe(
      "(from:(dana@example.com OR sam@example.com) OR to:(dana@example.com OR sam@example.com)) newer_than:90d",
    );
    expect(query.get("maxResults")).toBe("3");
    expect(f.urls.join("\n")).not.toMatch(/attachments/);
    expect(f.urls.every((url) => url.startsWith("https://gmail.googleapis.com/"))).toBe(true);
  });

  it("asks for nothing when there is nobody to look for", async () => {
    const f = fakeFetch({});
    expect(await recentThreadsWith({ fetch: f.fetch, emails: ["nope"], max: 5 })).toEqual([]);
    expect(f.urls).toEqual([]);
  });

  it("fails with a plain message when Gmail refuses", async () => {
    await expect(
      recentThreadsWith({
        fetch: async () => json({}, 401),
        emails: ["dana@example.com"],
        max: 2,
      }),
    ).rejects.toThrow("Gmail answered 401.");
  });
});

describe("buildMime", () => {
  const decodeBody = (mime: string) =>
    Buffer.from(mime.split("\r\n\r\n")[1]!.replace(/\r\n/g, ""), "base64").toString("utf8");

  it("writes a plain text message with the recipient, the subject and the body", () => {
    const mime = buildMime({ to: "dana@example.com", subject: "Notes", body: "Hello\nthere" });
    expect(mime.startsWith("To: dana@example.com\r\nSubject: Notes\r\nMIME-Version: 1.0\r\n")).toBe(
      true,
    );
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(decodeBody(mime)).toBe("Hello\r\nthere");
  });

  it("leaves the recipient out when there is none, and encodes a subject that is not ASCII", () => {
    const mime = buildMime({ to: "", subject: "Café", body: "x" });
    expect(mime).not.toContain("To:");
    expect(mime).toContain("Subject: =?UTF-8?B?Q2Fmw6k=?=");
    expect(encodeSubject("Two\r\nlines")).toBe("Two lines");
  });

  it("refuses a recipient that could add a header or another recipient", () => {
    for (const to of [
      "a@example.com\r\nBcc: x@example.com",
      "a@example.com, b@example.com",
      "Dana <a@example.com>",
      "nobody",
    ])
      expect(() => buildMime({ to, subject: "s", body: "b" })).toThrow(GmailError);
  });
});

describe("createDraft", () => {
  it("posts one message to the drafts address and returns where it is", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const result = await createDraft({
      fetch: async (url, init) => {
        calls.push({ url, ...(init ? { init } : {}) });
        return json({ id: "r123", message: { id: "m456", threadId: "t" } });
      },
      to: "dana@example.com",
      subject: "Follow-up",
      body: "Thanks for today.",
    });
    expect(result).toEqual({ draftId: "r123", messageId: "m456" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    expect(calls[0]!.init?.method).toBe("POST");
    const raw = (JSON.parse(String(calls[0]!.init?.body)) as { message: { raw: string } }).message
      .raw;
    expect(Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()).toContain(
      "To: dana@example.com",
    );
  });

  it("never calls anything that sends", async () => {
    const urls: string[] = [];
    await createDraft({
      fetch: async (url) => {
        urls.push(url);
        return json({ id: "r", message: { id: "m" } });
      },
      to: "dana@example.com",
      subject: "s",
      body: "b",
    });
    expect(urls.some((url) => /send/i.test(url))).toBe(false);
  });

  it("says what to do when Google does not allow drafts, and when the answer is wrong", async () => {
    const base = { to: "", subject: "s", body: "b" };
    await expect(createDraft({ ...base, fetch: async () => json({}, 403) })).rejects.toThrow(
      /permission to create drafts/,
    );
    await expect(createDraft({ ...base, fetch: async () => json({}, 500) })).rejects.toThrow(
      "Gmail answered 500.",
    );
    await expect(createDraft({ ...base, fetch: async () => json({ x: 1 }) })).rejects.toThrow(
      /cannot read/,
    );
  });
});

describe("draftUrl", () => {
  it("opens the draft for the account it is in", () => {
    expect(draftUrl("me@example.com", "m456")).toBe(
      "https://mail.google.com/mail/u/me%40example.com/#drafts?compose=m456",
    );
  });
});
