// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MurmurApi, TeamView } from "@murmur/shared";
import { TeamLock } from "./TeamLock";
import { TeamPage } from "./TeamPage";
import { createMockApi, SAMPLE_TEAM_VIEW } from "./test-api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const view = (patch: Partial<TeamView>): TeamView => ({ ...SAMPLE_TEAM_VIEW, ...patch });

const SIGNED_IN: TeamView = view({
  enabled: true,
  serverUrl: "http://127.0.0.1:7830/",
  state: "signed_in",
  serverSetUp: true,
  user: { name: "Ada", email: "ada@example.com" },
  teams: [{ id: "t1", name: "Acme", myRole: "admin" }],
  lastSyncAt: 1_700_000_000_000,
  sharedCounts: { dictionary: 3, snippets: 1 },
});

function mount(initial: TeamView, overrides: Partial<MurmurApi> = {}) {
  let push: (next: TeamView) => void = () => undefined;
  const api = createMockApi({
    teamView: vi.fn().mockResolvedValue(initial),
    onTeamChanged: vi.fn((handler: (next: TeamView) => void) => {
      push = handler;
      return () => undefined;
    }),
    ...overrides,
  });
  vi.stubGlobal("window", Object.assign(window, { murmur: api }));
  render(<TeamPage />);
  return { api, push: (next: TeamView) => push(next) };
}

describe("Team page", () => {
  it("is off until a server is connected, and connects to the address written", async () => {
    const connected = view({
      enabled: true,
      serverUrl: "http://127.0.0.1:7830/",
      state: "signed_out",
      serverSetUp: true,
    });
    const { api } = mount(SAMPLE_TEAM_VIEW, {
      teamConnect: vi.fn().mockResolvedValue({ ok: true, view: connected }),
    });
    const input = await screen.findByRole("textbox", { name: "Team server address" });
    fireEvent.change(input, { target: { value: "http://192.168.1.5:7830" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect to the team server" }));
    await waitFor(() =>
      expect(api.teamConnect).toHaveBeenCalledWith({ serverUrl: "http://192.168.1.5:7830" }),
    );
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("says so when the server cannot be reached", async () => {
    mount(SAMPLE_TEAM_VIEW, {
      teamConnect: vi
        .fn()
        .mockResolvedValue({ ok: false, message: "Could not reach the team server." }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Connect to the team server" }));
    expect(await screen.findByText("Could not reach the team server.")).toBeTruthy();
  });

  it("makes the owner on a new server, and signs in on one that has an owner", async () => {
    const fresh = view({
      enabled: true,
      serverUrl: "http://127.0.0.1:7830/",
      state: "signed_out",
      serverSetUp: false,
    });
    const first = mount(fresh);
    await screen.findByText(/no owner yet/);
    fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), {
      target: { value: "Ada" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "a long enough password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create the owner account" }));
    await waitFor(() =>
      expect(first.api.teamSetup).toHaveBeenCalledWith({
        name: "Ada",
        email: "ada@example.com",
        password: "a long enough password",
      }),
    );
    cleanup();

    const second = mount({ ...fresh, serverSetUp: true });
    await screen.findByText(/Sign in with the account/);
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(second.api.teamSignIn).toHaveBeenCalledWith({
        email: "ada@example.com",
        password: "pw",
      }),
    );
  });

  it("says how long to wait after too many wrong passwords", async () => {
    mount(view({ enabled: true, serverUrl: "http://x/", state: "signed_out", serverSetUp: true }), {
      teamSignIn: vi.fn().mockResolvedValue({
        ok: false,
        message: "Too many wrong passwords.",
        retryAfterSeconds: 30,
      }),
    });
    fireEvent.change(await screen.findByRole("textbox", { name: "Email" }), {
      target: { value: "a@b.co" },
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/Try again in 30 seconds/)).toBeTruthy();
  });

  it("shows who is signed in, the teams and what is shared, and has the controls", async () => {
    const { api } = mount(SIGNED_IN);
    expect(await screen.findByText(/Signed in as Ada \(ada@example.com\)/)).toBeTruthy();
    const teams = within(screen.getByRole("list", { name: "Your teams" }));
    expect(teams.getByText("Acme")).toBeTruthy();
    expect(teams.getByText("Admin")).toBeTruthy();
    expect(screen.getByText(/3 dictionary entries and 1 snippet/)).toBeTruthy();
    expect(screen.getByText(/Your own\s+entries are used first/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Update the shared entries now" }));
    fireEvent.click(screen.getByRole("button", { name: "Lock Murmur now" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out of the team server" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn off team mode" }));
    expect(api.teamSyncNow).toHaveBeenCalled();
    expect(api.teamLock).toHaveBeenCalled();
    expect(api.teamSignOut).toHaveBeenCalled();
    expect(api.teamDisconnect).toHaveBeenCalled();
  });

  it("shows a sync problem, and proposals that were turned down, which can be dismissed", async () => {
    const { api } = mount({
      ...SIGNED_IN,
      syncProblem: "Could not reach the team server.",
      notices: [{ id: "n1", summary: "Zendesk", note: "Too generic" }],
    });
    expect(await screen.findByText("Could not reach the team server.")).toBeTruthy();
    expect(screen.getByText("A proposal was turned down")).toBeTruthy();
    expect(screen.getByText(/Zendesk/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss the notices" }));
    expect(api.teamNoticesSeen).toHaveBeenCalled();
  });

  it("changes the idle lock time", async () => {
    const { api } = mount(SIGNED_IN);
    fireEvent.click(
      await screen.findByRole("combobox", { name: /Lock Murmur when the Mac has been idle/ }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "30 minutes" }));
    await waitFor(() => expect(api.teamSetIdleLock).toHaveBeenCalledWith(30));
  });

  it("uses an invite, with an account made when there is none", async () => {
    const out = view({
      enabled: true,
      serverUrl: "http://x/",
      state: "signed_out",
      serverSetUp: true,
    });
    const { api } = mount(out, {
      teamRedeem: vi
        .fn()
        .mockResolvedValue({ ok: true, status: "pending", teamName: "Acme", view: out }),
    });
    fireEvent.change(await screen.findByRole("textbox", { name: "Invite code" }), {
      target: { value: "inv_abc" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Name for the new account" }), {
      target: { value: "New Hire" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Email for the new account" }), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password for the new account"), {
      target: { value: "a long enough password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use the invite" }));
    await waitFor(() =>
      expect(api.teamRedeem).toHaveBeenCalledWith({
        code: "inv_abc",
        name: "New Hire",
        email: "new@example.com",
        password: "a long enough password",
      }),
    );
    expect(
      await screen.findByText("Your request to join Acme is waiting for an admin."),
    ).toBeTruthy();
  });

  it("follows the state the app pushes", async () => {
    const { push } = mount(SIGNED_IN);
    await screen.findByText(/Signed in as Ada/);
    push(
      view({
        enabled: true,
        serverUrl: "http://127.0.0.1:7830/",
        state: "signed_out",
        serverSetUp: true,
      }),
    );
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
  });
});

describe("the lock", () => {
  function lock(overrides: Partial<MurmurApi> = {}) {
    const api = createMockApi(overrides);
    vi.stubGlobal("window", Object.assign(window, { murmur: api }));
    render(<TeamLock />);
    return api;
  }

  it("asks for the password and unlocks with it", async () => {
    const api = lock();
    expect(screen.getByRole("dialog", { name: "Murmur is locked" })).toBeTruthy();
    expect(screen.getByText(/Enter your password to continue/)).toBeTruthy();
    const unlock = screen.getByRole("button", { name: "Unlock Murmur" }) as HTMLButtonElement;
    expect(unlock.disabled || unlock.getAttribute("aria-disabled") === "true").toBe(true);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "my password" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock Murmur" }));
    await waitFor(() => expect(api.teamUnlock).toHaveBeenCalledWith("my password"));
  });

  it("says when the password was wrong and how long to wait", async () => {
    lock({
      teamUnlock: vi.fn().mockResolvedValue({
        ok: false,
        message: "The email or the password is not right.",
        retryAfterSeconds: 30,
      }),
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock Murmur" }));
    expect(await screen.findByText(/not right\. Try again in 30 seconds/)).toBeTruthy();
  });
});
