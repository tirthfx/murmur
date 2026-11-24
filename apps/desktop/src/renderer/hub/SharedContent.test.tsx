// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MurmurApi, TeamSharedFolder, TeamSharedSkill, TeamView } from "@murmur/shared";
import { ExportPanel } from "./ExportPanel";
import { SharedContent } from "./SharedContent";
import { createMockApi, SAMPLE_TEAM_VIEW } from "./test-api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const skill: TeamSharedSkill = {
  id: "s1",
  name: "Call recap",
  description: "Sums up a call",
  body: "---\nname: Call recap\n---\nFive lines.",
  scope: "company",
  departmentId: null,
  version: 2,
  updatedAt: 1_700_000_000_000,
  teamId: "t1",
  teamName: "Acme",
};

const folder = (patch: Partial<TeamSharedFolder> = {}): TeamSharedFolder => ({
  id: "f1",
  name: "Q4 deal",
  kind: "shared",
  departmentId: null,
  createdBy: "u1",
  mine: true,
  canWrite: true,
  canManage: true,
  members: [],
  items: [
    {
      id: "n1",
      title: "Kickoff call",
      sharedBy: "Sam",
      sharedAt: 1_700_000_000_000,
      sourceRef: "",
    },
  ],
  teamId: "t1",
  teamName: "Acme",
  ...patch,
});

const signedIn = (shared: TeamView["shared"]): TeamView => ({
  ...SAMPLE_TEAM_VIEW,
  enabled: true,
  state: "signed_in",
  serverUrl: "http://127.0.0.1:7830/",
  user: { name: "Ada", email: "ada@example.com" },
  teams: [{ id: "t1", name: "Acme", myRole: "member" }],
  shared,
});

function mount(ui: React.ReactElement, overrides: Partial<MurmurApi> = {}) {
  const api = createMockApi(overrides);
  vi.stubGlobal("window", Object.assign(window, { murmur: api }));
  render(ui);
  return api;
}

describe("shared content on the Team page", () => {
  it("says so when nothing is shared yet", () => {
    mount(<SharedContent view={signedIn({ skills: [], folders: [] })} />);
    expect(screen.getByText("No Skill is shared with you yet.")).toBeTruthy();
    expect(screen.getByText("No folder is shared with you yet.")).toBeTruthy();
  });

  it("lists a Skill with its version, and copies it into the person's own Skills", async () => {
    const api = mount(<SharedContent view={signedIn({ skills: [skill], folders: [] })} />, {
      teamSkillAdd: vi.fn().mockResolvedValue({ ok: true, skill: { name: "Call recap" } }),
    });
    const list = within(screen.getByRole("list", { name: "Skills your teams share" }));
    expect(list.getByText("Call recap")).toBeTruthy();
    expect(list.getByText("Version 2")).toBeTruthy();
    expect(list.queryByText("Acme")).toBeNull(); // one team: no need to name it
    fireEvent.click(screen.getByRole("button", { name: "Add Call recap to my Skills" }));
    await waitFor(() =>
      expect(api.teamSkillAdd).toHaveBeenCalledWith({ teamId: "t1", skillId: "s1" }),
    );
    expect(await screen.findByText("Added to your Skills as “Call recap”.")).toBeTruthy();
  });

  it("says why a Skill could not be added", async () => {
    mount(<SharedContent view={signedIn({ skills: [skill], folders: [] })} />, {
      teamSkillAdd: vi.fn().mockResolvedValue({ ok: false, message: "Line 3: bad.", line: 3 }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Call recap to my Skills" }));
    expect(await screen.findByText("Line 3: bad.")).toBeTruthy();
  });

  it("names the team on each item when the person is in more than one", () => {
    const view = signedIn({ skills: [skill], folders: [folder()] });
    view.teams = [...view.teams, { id: "t2", name: "Other", myRole: "member" }];
    mount(<SharedContent view={view} />);
    expect(screen.getAllByText("Acme").length).toBeGreaterThanOrEqual(2);
  });

  it("shows a folder's notes by title and reads one on request", async () => {
    const api = mount(<SharedContent view={signedIn({ skills: [], folders: [folder()] })} />, {
      teamNoteRead: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          id: "n1",
          title: "Kickoff call",
          body: "# Kickoff\n- Agreed",
          sourceRef: "",
          sharedBy: "Sam",
          sharedAt: 1,
        },
      }),
    });
    expect(screen.getByText("1 note")).toBeTruthy();
    expect(screen.queryByText("Kickoff call")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the notes in Q4 deal" }));
    fireEvent.click(screen.getByRole("button", { name: "Read Kickoff call" }));
    await waitFor(() =>
      expect(api.teamNoteRead).toHaveBeenCalledWith({ teamId: "t1", folderId: "f1", noteId: "n1" }),
    );
    expect(await screen.findByText(/Agreed/)).toBeTruthy();
  });

  it("marks a folder the person can only read", () => {
    mount(
      <SharedContent view={signedIn({ skills: [], folders: [folder({ canWrite: false })] })} />,
    );
    expect(screen.getByText("1 note, read only")).toBeTruthy();
  });

  it("makes a folder for chosen people", async () => {
    const api = mount(<SharedContent view={signedIn({ skills: [], folders: [] })} />, {
      teamPeople: vi.fn().mockResolvedValue({
        ok: true,
        value: [
          { userId: "u1", name: "Ada", email: "ada@example.com", role: "member" },
          { userId: "u2", name: "Bea", email: "bea@example.com", role: "member" },
        ],
      }),
      teamFolderCreate: vi.fn().mockResolvedValue({ ok: true, value: { name: "Q4 deal" } }),
    });
    // The person themselves is not offered: they are always in it.
    expect(await screen.findByRole("switch", { name: "Bea" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Ada" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Folder name" }), {
      target: { value: "Q4 deal" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "Bea" }));
    fireEvent.click(screen.getByRole("button", { name: "Make the shared folder" }));
    await waitFor(() =>
      expect(api.teamFolderCreate).toHaveBeenCalledWith({
        teamId: "t1",
        name: "Q4 deal",
        members: ["u2"],
      }),
    );
    expect(await screen.findByText("Made the folder “Q4 deal”.")).toBeTruthy();
  });
});

describe("sharing a meeting into a team folder", () => {
  const open = (shared: TeamView["shared"], overrides: Partial<MurmurApi> = {}) =>
    mount(<ExportPanel meetingId="m1" onClose={() => undefined} />, {
      teamView: vi.fn().mockResolvedValue(signedIn(shared)),
      ...overrides,
    });

  it("offers the folders the person may add to, and says what is and is not sent", async () => {
    open({
      skills: [],
      folders: [folder(), folder({ id: "f2", name: "Read only", canWrite: false })],
    });
    expect(await screen.findByText("Share with your team")).toBeTruthy();
    expect(screen.getByText(/The transcript, your own notes and the audio stay/)).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: /Folder/ }));
    expect(screen.queryByRole("option", { name: "Read only" })).toBeNull();
  });

  it("shares the summary and tasks into the folder", async () => {
    const api = open(
      { skills: [], folders: [folder()] },
      { teamShareMeeting: vi.fn().mockResolvedValue({ ok: true, value: { id: "n9" } }) },
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Share the summary and tasks into the folder" }),
    );
    await waitFor(() =>
      expect(api.teamShareMeeting).toHaveBeenCalledWith({
        meetingId: "m1",
        teamId: "t1",
        folderId: "f1",
      }),
    );
    expect(await screen.findByText("Shared into Q4 deal.")).toBeTruthy();
  });

  it("says why a meeting could not be shared", async () => {
    open(
      { skills: [], folders: [folder()] },
      {
        teamShareMeeting: vi.fn().mockResolvedValue({
          ok: false,
          message: "This meeting has no summary yet. Make one first.",
        }),
      },
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Share the summary and tasks into the folder" }),
    );
    expect(
      await screen.findByText("This meeting has no summary yet. Make one first."),
    ).toBeTruthy();
  });

  it("is not shown without a team folder the person may add to, or when signed out", async () => {
    open({ skills: [], folders: [folder({ canWrite: false })] });
    await waitFor(() => expect(screen.getByText("Export a shareable file")).toBeTruthy());
    expect(screen.queryByText("Share with your team")).toBeNull();
    cleanup();
    mount(<ExportPanel meetingId="m1" onClose={() => undefined} />, {
      teamView: vi.fn().mockResolvedValue({
        ...signedIn({ skills: [], folders: [folder()] }),
        state: "signed_out",
      }),
    });
    await waitFor(() => expect(screen.getByText("Export a shareable file")).toBeTruthy());
    expect(screen.queryByText("Share with your team")).toBeNull();
  });
});
