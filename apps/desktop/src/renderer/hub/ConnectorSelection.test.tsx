// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTOR_CATALOGUE,
  DEFAULT_CONNECTOR_SETTINGS,
  connectorChoice,
  type ConnectorAccount,
  type ConnectorDataStatus,
  type ConnectorSettings,
  type ConnectorView,
} from "@murmur/shared";
import { ConnectorSelection } from "./ConnectorSelection";
import { createMockApi } from "./test-api";

const account = (connector: string): ConnectorAccount => ({
  id: "a1",
  connector,
  email: "me@example.com",
  scopes: [],
  status: "connected",
  statusReason: null,
  lastSyncAt: null,
  createdAt: 1,
});

const view = (id: string, over: Partial<ConnectorView> = {}): ConnectorView => {
  const entry = CONNECTOR_CATALOGUE.find((c) => c.id === id)!;
  return {
    ...entry,
    readiness: "ready",
    clientId: "x",
    clientSecretSaved: true,
    choice: connectorChoice(DEFAULT_CONNECTOR_SETTINGS, entry),
    accounts: [account(id)],
    connecting: false,
    ...over,
  };
};

let api: ReturnType<typeof createMockApi>;
const save = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  api = createMockApi();
  save.mockClear();
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

const show = (
  id: string,
  settings: Partial<ConnectorSettings> = {},
  status: ConnectorDataStatus[] = [{ accountId: "a1", itemCount: 0, readAt: null }],
) =>
  render(
    <ConnectorSelection
      connector={view(id)}
      settings={{ ...DEFAULT_CONNECTOR_SETTINGS, ...settings }}
      status={status}
      save={save}
    />,
  );

describe("selecting what a connector reads (CN-05 to CN-08)", () => {
  it("says how much is kept, and nothing when nothing is", () => {
    show("slack");
    expect(screen.getByText("Nothing kept on this Mac yet.")).toBeTruthy();
    cleanup();
    show("slack", {}, [{ accountId: "a1", itemCount: 3, readAt: Date.UTC(2026, 10, 22, 12) }]);
    expect(screen.getByText(/3 items kept on this Mac, read /)).toBeTruthy();
  });

  it("starts with no Slack channel selected, loads the list on request and saves the choice", async () => {
    api.connectorOptions = vi.fn().mockResolvedValue({
      ok: true,
      options: [
        { id: "C1", label: "#alpha" },
        { id: "C2", label: "#beta" },
      ],
    });
    show("slack");
    expect(screen.getByText("No channels selected, so none is read.")).toBeTruthy();
    expect(api.connectorOptions).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Choose channels for me@example.com" }));
    fireEvent.click(await screen.findByRole("switch", { name: "#beta" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ slack: { channels: ["C2"], privateChannels: false } }),
    );
    expect(api.connectorOptions).toHaveBeenCalledWith("a1");
  });

  it("lets a selected channel be turned off, and stops at the limit", async () => {
    api.connectorOptions = vi.fn().mockResolvedValue({
      ok: true,
      options: Array.from({ length: 22 }, (_, i) => ({ id: `C${i}`, label: `#c${i}` })),
    });
    const channels = Array.from({ length: 20 }, (_, i) => `C${i}`);
    show("slack", { slack: { channels, privateChannels: false } });
    fireEvent.click(screen.getByRole("button", { name: "Choose channels for me@example.com" }));
    const extra = await screen.findByRole("switch", { name: "#c21" });
    expect(extra.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("switch", { name: "#c0" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        slack: { channels: channels.slice(1), privateChannels: false },
      }),
    );
  });

  it("shows why the list could not be loaded", async () => {
    api.connectorOptions = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "Slack is busy just now." });
    show("slack");
    fireEvent.click(screen.getByRole("button", { name: "Choose channels for me@example.com" }));
    expect(await screen.findByText("Slack is busy just now.")).toBeTruthy();
  });

  it("changes how much of a Notion page is kept", async () => {
    show("notion");
    expect(screen.getByText(/Only pages you share with the integration are read/)).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: "Most text kept from a page" }));
    fireEvent.click(await screen.findByRole("option", { name: "5,000 characters" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ notion: { maxCharsPerPage: 5000 } }));
  });

  it("reads only my Linear issues until that is turned off, and then lets teams be chosen", async () => {
    api.connectorOptions = vi
      .fn()
      .mockResolvedValue({ ok: true, options: [{ id: "T1", label: "Eng (ENG)" }] });
    show("linear");
    expect(screen.queryByRole("button", { name: /Choose teams/ })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Only issues assigned to me" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ linear: { teams: [], assignedOnly: false } }),
    );
    cleanup();
    show("linear", { linear: { teams: [], assignedOnly: false } });
    fireEvent.click(screen.getByRole("button", { name: "Choose teams for me@example.com" }));
    fireEvent.click(await screen.findByRole("switch", { name: "Eng (ENG)" }));
    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith({ linear: { teams: ["T1"], assignedOnly: false } }),
    );
  });

  it("saves GitHub repositories one to a line, and refuses a line that is not owner/name", async () => {
    show("github", { github: { repos: ["acme/app"] } });
    const box = screen.getByLabelText("Repositories to read");
    expect((box as HTMLTextAreaElement).value).toBe("acme/app");
    fireEvent.change(box, { target: { value: "acme/app\nnot a repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the repositories" }));
    expect(await screen.findByText("“not a repo” is not written owner/name.")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "acme/app\n acme/web \nacme/app\n\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the repositories" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ github: { repos: ["acme/app", "acme/web"] } }),
    );
  });

  it("shows nothing for an account that is not connected", () => {
    const { container } = render(
      <ConnectorSelection
        connector={view("slack", {
          accounts: [{ ...account("slack"), status: "needs_attention" }],
        })}
        settings={DEFAULT_CONNECTOR_SETTINGS}
        status={[]}
        save={save}
      />,
    );
    expect(container.textContent).toBe("");
  });
});
