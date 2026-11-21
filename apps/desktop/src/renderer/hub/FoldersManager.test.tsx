// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_SKILLS, type MeetingFolder } from "@murmur/shared";
import { FoldersManager } from "./FoldersManager";
import { createMockApi } from "./test-api";

const folder = (over: Partial<MeetingFolder> = {}): MeetingFolder => ({
  id: "f1",
  name: "Customer calls",
  meetings: 3,
  defaultSkillId: null,
  autoExportPath: null,
  ...over,
});

let api: ReturnType<typeof createMockApi>;
const changed = vi.fn();
beforeEach(() => {
  api = createMockApi();
  api.skillsList = vi.fn().mockResolvedValue(BUILT_IN_SKILLS);
  changed.mockClear();
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

describe("folders (NT-17, NT-18)", () => {
  it("makes a folder and tells the page", async () => {
    render(<FoldersManager folders={[]} onChange={changed} />);
    expect(screen.getByText(/Every meeting is in the Inbox/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create the folder" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.change(screen.getByLabelText("New folder"), { target: { value: "Planning" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the folder" }));
    await waitFor(() => expect(api.folderCreate).toHaveBeenCalledWith("Planning"));
    await waitFor(() => expect(changed).toHaveBeenCalled());
  });

  it("shows why a name was refused", async () => {
    api.folderCreate = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "There is a folder with that name already." });
    render(<FoldersManager folders={[folder()]} onChange={changed} />);
    fireEvent.change(screen.getByLabelText("New folder"), { target: { value: "customer calls" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the folder" }));
    expect(await screen.findByText("There is a folder with that name already.")).toBeTruthy();
    expect(changed).not.toHaveBeenCalled();
  });

  it("renames a folder", async () => {
    render(<FoldersManager folders={[folder()]} onChange={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Customer calls" }));
    fireEvent.change(screen.getByLabelText("New name for Customer calls"), {
      target: { value: "Clients" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save the name of Customer calls" }));
    await waitFor(() => expect(api.folderRename).toHaveBeenCalledWith("f1", "Clients"));
  });

  it("keeps the meetings of a folder that is deleted, and says so first", async () => {
    render(<FoldersManager folders={[folder()]} onChange={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Customer calls" }));
    expect(
      screen.getByText("Its 3 meetings go to the Inbox. Nothing else is deleted."),
    ).toBeTruthy();
    expect(api.folderDelete).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete Customer calls and keep its meetings" }),
    );
    await waitFor(() => expect(api.folderDelete).toHaveBeenCalledWith("f1"));
  });

  it("can be cancelled", () => {
    render(<FoldersManager folders={[folder()]} onChange={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Customer calls" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep the folder" }));
    expect(api.folderDelete).not.toHaveBeenCalled();
    expect(screen.queryByText(/Nothing else is deleted/)).toBeNull();
  });

  it("sets the Skill of a folder", async () => {
    render(<FoldersManager folders={[folder()]} onChange={changed} />);
    fireEvent.click(
      await screen.findByRole("combobox", { name: "Skill for summaries in Customer calls" }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "Customer call notes" }));
    await waitFor(() =>
      expect(api.folderUpdate).toHaveBeenCalledWith("f1", {
        defaultSkillId: "customer-call-notes",
      }),
    );
  });

  it("chooses where a file of each meeting is written, and stops", async () => {
    render(
      <FoldersManager
        folders={[folder({ autoExportPath: "/Users/me/Shared" })]}
        onChange={changed}
      />,
    );
    expect(screen.getByText("A file of each meeting is written to /Users/me/Shared")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Choose where a file of each meeting in Customer calls is written/,
      }),
    );
    await waitFor(() => expect(api.folderChooseExport).toHaveBeenCalledWith("f1"));
    fireEvent.click(screen.getByRole("button", { name: "Stop writing files for Customer calls" }));
    await waitFor(() => expect(api.folderClearExport).toHaveBeenCalledWith("f1"));
    cleanup();
    render(<FoldersManager folders={[folder()]} onChange={changed} />);
    expect(screen.getByText("No file is written after a meeting.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Stop writing files/ })).toBeNull();
    expect(
      within(screen.getByRole("list", { name: "Folders" })).getByText("3 meetings"),
    ).toBeTruthy();
  });
});
