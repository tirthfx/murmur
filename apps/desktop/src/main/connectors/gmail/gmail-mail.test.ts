import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GMAIL_SETTINGS,
  GMAIL_SCOPE_READ,
  type ConnectorAccount,
  type GmailSettings,
} from "@murmur/shared";
import { addresses, createGmailMail, threadText } from "./gmail-mail";

const b64 = (text: string) => Buffer.from(text).toString("base64url");

const account: ConnectorAccount = {
  id: "g1",
  connector: "gmail",
  email: "me@example.com",
  scopes: [GMAIL_SCOPE_READ],
  status: "connected",
  statusReason: null,
  lastSyncAt: null,
  createdAt: 1,
};

const message = (id: string, headers: Record<string, string>, text?: string) => ({
  id,
  payload: {
    headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
    ...(text ? { mimeType: "text/plain", body: { data: b64(text) } } : {}),
  },
});

function setup(
  settings: Partial<GmailSettings>,
  answer: (url: URL) => unknown = () => ({}),
  accounts: ConnectorAccount[] = [account],
) {
  const urls: URL[] = [];
  const saveStyle = vi.fn();
  const addContacts = vi.fn((people: readonly unknown[]) => people.length - 1);
  const mail = createGmailMail({
    connectors: {
      list: () => accounts,
      authorizedFetch: async (_id, url) => {
        urls.push(new URL(url));
        return Response.json(answer(new URL(url)));
      },
    },
    settings: () => ({ ...DEFAULT_GMAIL_SETTINGS, ...settings }),
    saveStyle,
    addContacts,
    now: () => 9,
  });
  return { mail, urls, saveStyle, addContacts };
}

describe("reading Gmail only when asked", () => {
  it("asks nothing while a switch is off or without permission to read", async () => {
    const off = setup({});
    for (const result of [
      await off.mail.threads(),
      await off.mail.importContacts(),
      await off.mail.learnStyle(),
    ])
      expect(result).toMatchObject({ ok: false });
    expect(off.urls).toEqual([]);
    const unread = setup({ replyContext: true }, undefined, [{ ...account, scopes: [] }]);
    expect(await unread.mail.threads()).toEqual({
      ok: false,
      message: "Gmail has not been given permission to read mail.",
    });
  });

  it("offers recent inbox threads as text for the notes (CN-04)", async () => {
    const t = setup({ replyContext: true }, (url) =>
      url.pathname.endsWith("/threads")
        ? { threads: [{ id: "t1" }] }
        : {
            id: "t1",
            messages: [message("m1", { From: "Dana", Subject: "Budget" }, "Can we meet?")],
          },
    );
    expect(await t.mail.threads()).toEqual({
      ok: true,
      threads: [
        {
          id: "t1",
          subject: "Budget",
          from: "Dana",
          text: "Email thread: Budget\n\nFrom Dana:\nCan we meet?",
        },
      ],
    });
    expect(t.urls[0]!.searchParams.get("q")).toBe("in:inbox newer_than:30d");
  });

  it("keeps the end of a very long thread", () => {
    const text = threadText({
      id: "t",
      subject: "Long",
      messages: [{ id: "m", from: "A", to: "B", dateMs: 0, text: `${"x".repeat(9000)}END` }],
    });
    expect(text.startsWith("Email thread: Long\n\n…")).toBe(true);
    expect(text.endsWith("END")).toBe(true);
    expect(text.length).toBeLessThan(8100);
  });

  it("adds the people written to, from address lines only (NT-12)", async () => {
    const t = setup({ contactsFromMail: true }, (url) =>
      url.pathname.endsWith("/messages")
        ? { messages: [{ id: "m1" }, { id: "m2" }] }
        : url.pathname.endsWith("m1")
          ? message("m1", { To: '"Lee, Dana" <Dana@x.com>, me@example.com' })
          : message("m2", { To: "dana@x.com", Cc: "pat@y.com" }),
    );
    expect(await t.mail.importContacts()).toEqual({ ok: true, added: 1, found: 2 });
    expect(t.addContacts).toHaveBeenCalledWith([
      { name: "Lee, Dana", email: "dana@x.com" },
      { name: null, email: "pat@y.com" },
    ]);
    expect(t.urls[1]!.searchParams.get("format")).toBe("metadata");
    expect(t.urls[1]!.searchParams.getAll("metadataHeaders")).toEqual(["To", "Cc"]);
  });

  it("reads an address line", () => {
    expect(addresses("Pat <pat@y.com>, not-an-address, sam@z.org")).toEqual([
      { name: "Pat", email: "pat@y.com" },
      { name: null, email: "sam@z.org" },
    ]);
    expect(addresses("")).toEqual([]);
  });

  it("learns from sent mail and keeps what it learned (PZ-23)", async () => {
    const t = setup({ learnStyle: true }, (url) =>
      url.pathname.endsWith("/messages")
        ? { messages: [{ id: "1" }, { id: "2" }, { id: "3" }] }
        : message("m", {}, "Hi Dana,\nDone.\nBest,"),
    );
    const result = await t.mail.learnStyle();
    expect(result).toMatchObject({ ok: true, style: { greeting: "Hi {name},", messages: 3 } });
    expect(t.saveStyle).toHaveBeenCalledWith(expect.objectContaining({ signOff: "Best," }));
    expect(t.urls[0]!.searchParams.get("q")).toBe("in:sent newer_than:90d");
  });

  it("says when there is too little to learn from, or Gmail fails", async () => {
    const empty = setup({ learnStyle: true }, () => ({}));
    expect(await empty.mail.learnStyle()).toMatchObject({
      ok: false,
      message: expect.stringContaining("too little"),
    });
    expect(empty.saveStyle).not.toHaveBeenCalled();
    const broken = setup({ replyContext: true }, () => "nonsense");
    expect(await broken.mail.threads()).toEqual({
      ok: false,
      message: "Gmail sent an answer Murmur cannot read.",
    });
  });
});
