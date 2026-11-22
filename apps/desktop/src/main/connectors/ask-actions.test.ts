import { describe, expect, it, vi } from "vitest";
import type { ExtensionActionId } from "@murmur/shared";
import { createAskActions, looksLikeAction } from "./ask-actions";

const NOW = new Date(2026, 10, 22, 10, 0).getTime();

const contacts = [
  { name: "Priya Rao", email: "priya@example.com" },
  { name: "Dana Lee", email: "dana@example.com" },
  { name: "Sam Ortiz", email: "sam@example.com" },
  { name: "Sam Roy", email: "samr@example.com" },
];

function setup(
  options: {
    enabled?: boolean;
    ready?: ExtensionActionId[];
    answer?: string | (() => Promise<string>);
    emailAccount?: { id: string; email: string } | null;
    calendarAccount?: { id: string; email: string; connector: string } | null;
  } = {},
) {
  const generate = vi.fn(
    async (_request: { system: string; prompt: string; maxTokens: number }) => {
      const answer = options.answer ?? '{"intent":"answer"}';
      return typeof answer === "string" ? answer : answer();
    },
  );
  const stateOf = vi.fn((id: ExtensionActionId) => ({
    state: (options.ready ?? ["draft_email", "create_event", "post_to_slack"]).includes(id)
      ? ("ready" as const)
      : ("off" as const),
    reason: null,
    hidden: false,
  }));
  const service = createAskActions({
    enabled: () => options.enabled ?? true,
    runner: { stateOf },
    generate,
    contacts: () => contacts,
    emailAccount: () =>
      options.emailAccount === undefined
        ? { id: "g1", email: "me@gmail.test" }
        : options.emailAccount,
    calendarAccount: () =>
      options.calendarAccount === undefined
        ? { id: "c1", email: "me@cal.test", connector: "googleCalendar" }
        : options.calendarAccount,
    eventDefaults: () => ({ durationMinutes: 30, invitesAllowed: false }),
    now: () => NOW,
  });
  return { service, generate };
}

const ask = (question: string) => ({ question, meetingId: null });

describe("looksLikeAction (CN-13)", () => {
  it("is true for a request that starts as an order", () => {
    for (const text of [
      "Draft a follow-up to Priya about the timeline",
      "Please draft a reply to Sam",
      "Can you schedule a meeting with Dana tomorrow?",
      "Could you please send Dana the notes",
      "Create an event for the offsite",
      "Post the summary to Slack",
      "Go ahead and write an email to Priya",
    ])
      expect(looksLikeAction(text)).toBe(true);
  });

  it("is false for a question, even one with an action verb in it", () => {
    for (const text of [
      "Did we create an event for the offsite?",
      "What did we say about drafting the email?",
      "Who is going to send the notes?",
      "When was the meeting scheduled?",
      "Summarize what Priya said",
      "How do I post to Slack?",
      "Is there a draft email for Dana?",
      "The email we drafted last week, what was in it?",
      "",
    ])
      expect(looksLikeAction(text)).toBe(false);
  });
});

describe("Ask connector actions (CN-13)", () => {
  it("does nothing, and never asks the model, while the option is off", async () => {
    const t = setup({ enabled: false, answer: '{"intent":"action","action":"draft_email"}' });
    expect(await t.service.propose(ask("Draft a follow-up to Priya"))).toEqual({
      ok: true,
      proposal: null,
    });
    expect(t.generate).not.toHaveBeenCalled();
  });

  it("never asks the model about a question that only asks for information", async () => {
    const t = setup({ answer: '{"intent":"action","action":"draft_email"}' });
    for (const text of ["Did we draft the email to Priya?", "What did Dana say about the budget?"])
      expect(await t.service.propose(ask(text))).toEqual({ ok: true, proposal: null });
    expect(t.generate).not.toHaveBeenCalled();
  });

  it("makes no proposal when the model says it is only a question, or answers badly, or fails", async () => {
    for (const answer of [
      '{"intent":"answer","action":null}',
      '{"intent":"action","action":"delete_everything"}',
      '{"intent":"action","action":"draft_email"',
      "no json",
      async () => {
        throw new Error("no model");
      },
    ]) {
      const t = setup({ answer });
      expect(await t.service.propose(ask("Draft a note to Priya"))).toEqual({
        ok: true,
        proposal: null,
      });
    }
  });

  it("proposes only an action that is ready, and none when nothing is", async () => {
    const t = setup({
      ready: ["create_event"],
      answer: '{"intent":"action","action":"draft_email","recipient":"Priya"}',
    });
    expect(await t.service.propose(ask("Draft a follow-up to Priya"))).toEqual({
      ok: true,
      proposal: null,
    });
    expect(t.generate.mock.calls[0]![0].system).toContain("create_event");
    expect(t.generate.mock.calls[0]![0].system).not.toContain("draft_email,");
    const none = setup({ ready: [], answer: '{"intent":"action","action":"draft_email"}' });
    expect(await none.service.propose(ask("Draft a follow-up to Priya"))).toEqual({
      ok: true,
      proposal: null,
    });
    expect(none.generate).not.toHaveBeenCalled();
  });

  it("proposes an email with the recipient found among the people Murmur knows", async () => {
    const t = setup({
      answer:
        '{"intent":"action","action":"draft_email","recipient":"Priya","subject":"Timeline","body":"Hi Priya,\\n\\nHere is the timeline."}',
    });
    const result = await t.service.propose(ask("Draft a follow-up to Priya about the timeline"));
    expect(result).toEqual({
      ok: true,
      proposal: {
        action: "draft_email",
        line: "Draft an email to Priya: Timeline",
        note: null,
        form: {
          candidates: [{ name: "Priya Rao", email: "priya@example.com" }],
          to: "priya@example.com",
          subject: "Timeline",
          body: "Hi Priya,\n\nHere is the timeline.",
          accountId: "g1",
          accountEmail: "me@gmail.test",
        },
      },
    });
  });

  it("asks the owner to choose when a name is unknown or fits two people, and never picks one", async () => {
    const unknown = setup({
      answer: '{"intent":"action","action":"draft_email","recipient":"Zed"}',
    });
    const a = await unknown.service.propose(ask("Draft an email to Zed"));
    expect(a.ok && a.proposal && a.proposal.action === "draft_email" && a.proposal.form.to).toBe(
      "",
    );
    expect(a.ok && a.proposal?.note).toBe(
      "No one called “Zed” was found. Choose a contact or type an address.",
    );
    const two = setup({ answer: '{"intent":"action","action":"draft_email","recipient":"Sam"}' });
    const b = await two.service.propose(ask("Draft an email to Sam"));
    expect(b.ok && b.proposal && b.proposal.action === "draft_email" && b.proposal.form.to).toBe(
      "",
    );
    expect(b.ok && b.proposal?.note).toMatch(/More than one person is called “Sam”/);
    expect(
      b.ok && b.proposal && b.proposal.action === "draft_email" && b.proposal.form.candidates,
    ).toHaveLength(2);
  });

  it("proposes an event with the time the owner gave, or tomorrow morning when there is none", async () => {
    const given = setup({
      answer:
        '{"intent":"action","action":"create_event","title":"Timeline review","recipient":"Dana","when":"2026-11-25T14:00"}',
    });
    const a = await given.service.propose(
      ask("Schedule a timeline review with Dana on the 25th at 2"),
    );
    expect(a).toMatchObject({
      ok: true,
      proposal: {
        action: "create_event",
        note: null,
        form: {
          title: "Timeline review",
          startMs: new Date(2026, 10, 25, 14, 0).getTime(),
          durationMinutes: 30,
          accountId: "c1",
          connector: "googleCalendar",
          invitesAllowed: false,
          candidates: [{ name: "Dana Lee", email: "dana@example.com" }],
        },
      },
    });
    const none = setup({ answer: '{"intent":"action","action":"create_event","when":"someday"}' });
    const b = await none.service.propose(ask("Create an event for the follow-up"));
    expect(
      b.ok && b.proposal && b.proposal.action === "create_event" && b.proposal.form.startMs,
    ).toBe(new Date(2026, 10, 23, 9, 0).getTime());
    expect(b.ok && b.proposal?.note).toBe("No time was given, so it starts tomorrow morning.");
  });

  it("proposes a Slack message as text only; no channel is read until the owner goes on", async () => {
    const t = setup({
      answer: '{"intent":"action","action":"post_to_slack","message":"Budget is ready"}',
    });
    expect(await t.service.propose(ask("Post to Slack that the budget is ready"))).toEqual({
      ok: true,
      proposal: {
        action: "post_to_slack",
        line: "Send a message to Slack",
        note: null,
        text: "Budget is ready",
      },
    });
  });

  it("makes no proposal when the account an action needs is gone", async () => {
    const t = setup({ emailAccount: null, answer: '{"intent":"action","action":"draft_email"}' });
    expect(await t.service.propose(ask("Draft an email to Priya"))).toEqual({
      ok: true,
      proposal: null,
    });
  });

  it("cleans what the model wrote: one-line subject, no control characters", async () => {
    const t = setup({
      answer:
        '{"intent":"action","action":"draft_email","subject":"Hi\\r\\nBcc: x@example.com","body":"Text\\u0000 here"}',
    });
    const result = await t.service.propose(ask("Draft an email to Priya"));
    expect(
      result.ok &&
        result.proposal &&
        result.proposal.action === "draft_email" &&
        result.proposal.form.subject,
    ).toBe("Hi Bcc: x@example.com");
    expect(
      result.ok &&
        result.proposal &&
        result.proposal.action === "draft_email" &&
        result.proposal.form.body,
    ).toBe("Text here");
  });
});
