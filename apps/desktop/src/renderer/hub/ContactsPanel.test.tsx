// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockApi } from "./test-api";
import { ContactsPanel } from "./ContactsPanel";
import { MentionField } from "./MentionField";

const priya = {
  id: "ab12",
  name: "Priya",
  email: null,
  source: "manual" as const,
  createdAt: 1,
  updatedAt: 1,
};

afterEach(cleanup);

describe("Contacts panel (NT-12)", () => {
  it("lists contacts and opens a card", async () => {
    window.murmur = createMockApi();
    vi.mocked(window.murmur.contactsList).mockResolvedValue([priya]);
    vi.mocked(window.murmur.contactCard).mockResolvedValue({
      contact: priya,
      meetings: [{ id: "m1", title: "Planning", startedAt: 1 }],
      tasks: [{ id: "t1", title: "Send the plan" }],
    });
    const open = vi.fn();
    render(<ContactsPanel onOpenMeeting={open} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Priya" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open the meeting Planning" }));
    expect(open).toHaveBeenCalledWith("m1");
    expect(screen.getByText("Send the plan")).toBeTruthy();
  });
});

/** The box with its own text, as a page holds it. */
function Held({ label, onValue }: { label: string; onValue: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <MentionField
      label={label}
      rows={3}
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
    />
  );
}

describe("mentioning someone while typing", () => {
  it("offers the contact and writes a mention", async () => {
    window.murmur = createMockApi();
    vi.mocked(window.murmur.contactsList).mockResolvedValue([priya]);
    const change = vi.fn();
    render(<Held label="Notes" onValue={change} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Ask @Pri" } });
    fireEvent.keyUp(screen.getByRole("textbox"), { key: "ArrowRight" });
    fireEvent.click(await screen.findByRole("button", { name: "Mention Priya" }));
    expect(change).toHaveBeenLastCalledWith("Ask @[contact:ab12|Priya] ");
  });

  it("offers to create a contact for a name nobody has", async () => {
    window.murmur = createMockApi();
    vi.mocked(window.murmur.contactSave).mockResolvedValue({ ok: true, contact: priya });
    const change = vi.fn();
    render(<Held label="Task" onValue={change} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "@Priya" } });
    fireEvent.keyUp(screen.getByRole("textbox"), { key: "ArrowRight" });
    fireEvent.click(await screen.findByRole("button", { name: "Create contact Priya" }));
    await waitFor(() => expect(change).toHaveBeenLastCalledWith("@[contact:ab12|Priya] "));
  });
});
