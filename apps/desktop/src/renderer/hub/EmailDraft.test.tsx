// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailAutomationRecord, EmailDraftProposal } from "@murmur/shared";
import { EmailDraft } from "./EmailDraft";
import { createMockApi } from "./test-api";

const proposal: EmailDraftProposal = {
  candidates: [
    { name: "Dana Lee", email: "dana@example.com" },
    { name: null, email: "sam@example.com" },
  ],
  to: "dana@example.com",
  subject: "Budget numbers",
  body: "Hi Dana,\n\nHere are the numbers. https://example.com/x",
  accountId: "a1",
  accountEmail: "me@example.com",
};

const record: EmailAutomationRecord = {
  id: "auto-1",
  sourceKind: "task",
  sourceId: "t1",
  to: "dana@example.com",
  subject: "Budget numbers",
  draftId: "r1",
  openUrl: "https://mail.google.com/mail/u/me%40example.com/#drafts?compose=m9",
  createdAt: 1,
};

let api: ReturnType<typeof createMockApi>;

beforeEach(() => {
  api = createMockApi();
  api.emailDraftState = vi.fn().mockResolvedValue({ available: true, reason: null });
  api.emailDraftPropose = vi.fn().mockResolvedValue({ ok: true, proposal });
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

const source = { kind: "task" as const, id: "t1" };

describe("Draft email (NT-27)", () => {
  it("is switched off with the reason next to it", async () => {
    api.emailDraftState = vi.fn().mockResolvedValue({
      available: false,
      reason: "Connect Gmail on the Connectors page first.",
    });
    render(<EmailDraft source={source} />);
    expect(await screen.findByText("Connect Gmail on the Connectors page first.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Draft email" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(api.emailDraftPropose).not.toHaveBeenCalled();
  });

  it("shows the recipient, subject and text before anything is created, and creates only on the click", async () => {
    api.emailDraftCreate = vi.fn().mockResolvedValue({
      ok: true,
      automationId: "auto-1",
      draftId: "r1",
      openUrl: record.openUrl,
    });
    render(<EmailDraft source={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "Draft email" }));

    expect(await screen.findByDisplayValue("Budget numbers")).toBeTruthy();
    expect(screen.getByDisplayValue(/Here are the numbers/)).toBeTruthy();
    expect(screen.getByText(/never sent from Murmur/)).toBeTruthy();
    expect(api.emailDraftCreate).not.toHaveBeenCalled();

    // The owner edits the subject; what is created is what the owner confirmed.
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Q4 budget" } });
    api.emailDraftList = vi.fn().mockResolvedValue([{ ...record, subject: "Q4 budget" }]);
    fireEvent.click(screen.getByRole("button", { name: "Create the draft in Gmail" }));

    await waitFor(() => expect(api.emailDraftCreate).toHaveBeenCalledTimes(1));
    expect(api.emailDraftCreate).toHaveBeenCalledWith({
      source,
      accountId: "a1",
      to: "dana@example.com",
      subject: "Q4 budget",
      body: proposal.body,
    });
    expect(
      await screen.findByText(/Draft “Q4 budget” to dana@example.com is in Gmail/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open “Q4 budget” in Gmail" }));
    expect(api.emailDraftOpen).toHaveBeenCalledWith(record.openUrl);
  });

  it("does not create anything when Cancel is clicked", async () => {
    render(<EmailDraft source={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "Draft email" }));
    await screen.findByDisplayValue("Budget numbers");
    fireEvent.click(screen.getByRole("button", { name: "Do not create a draft" }));
    expect(screen.queryByDisplayValue("Budget numbers")).toBeNull();
    expect(api.emailDraftCreate).not.toHaveBeenCalled();
  });

  it("asks for a real address before creating", async () => {
    api.emailDraftPropose = vi
      .fn()
      .mockResolvedValue({ ok: true, proposal: { ...proposal, to: "" } });
    render(<EmailDraft source={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "Draft email" }));
    fireEvent.change(await screen.findByLabelText("Address"), {
      target: { value: "not an address" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create the draft in Gmail" }));
    expect(
      await screen.findByText("Write one email address, or leave the recipient empty."),
    ).toBeTruthy();
    expect(api.emailDraftCreate).not.toHaveBeenCalled();
  });

  it("shows why a draft could not be proposed or created", async () => {
    api.emailDraftPropose = vi.fn().mockResolvedValue({ ok: false, message: "That task is gone." });
    render(<EmailDraft source={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "Draft email" }));
    expect(await screen.findByText("That task is gone.")).toBeTruthy();
    cleanup();

    api.emailDraftPropose = vi.fn().mockResolvedValue({ ok: true, proposal });
    api.emailDraftCreate = vi.fn().mockResolvedValue({ ok: false, message: "Gmail answered 500." });
    render(<EmailDraft source={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "Draft email" }));
    await screen.findByDisplayValue("Budget numbers");
    fireEvent.click(screen.getByRole("button", { name: "Create the draft in Gmail" }));
    expect(await screen.findByText("Gmail answered 500.")).toBeTruthy();
    // The editor stays, so nothing the owner wrote is lost.
    expect(screen.getByDisplayValue("Budget numbers")).toBeTruthy();
  });

  it("lists drafts that were made before, with a way to open them", async () => {
    api.emailDraftList = vi.fn().mockResolvedValue([record]);
    render(<EmailDraft source={source} label="Draft email from the summary" />);
    expect(
      await screen.findByText(/Draft “Budget numbers” to dana@example.com is in Gmail/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Draft email from the summary" })).toBeTruthy();
  });
});
