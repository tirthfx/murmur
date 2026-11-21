// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MCP_STATUS_OFF,
  type McpAuditEntry,
  type McpClientInfo,
  type McpConfigPreview,
} from "@murmur/shared";
import { auditAccessibility } from "./a11y-audit";
import { McpApps } from "./McpApps";
import { createMockApi } from "./test-api";

const client = (over: Partial<McpClientInfo> = {}): McpClientInfo => ({
  id: "c1",
  name: "Claude desktop",
  kind: "claude-desktop",
  createdAt: 1,
  lastUsedAt: null,
  ...over,
});

const preview = (over: Partial<McpConfigPreview> = {}): McpConfigPreview => ({
  previewId: "p1",
  clientName: "Claude desktop (Claude desktop)",
  path: "/Users/me/Library/Application Support/Claude/claude_desktop_config.json",
  exists: true,
  changed: true,
  lines: [
    { kind: "same", text: "{" },
    { kind: "remove", text: '  "old": 1' },
    { kind: "add", text: '  "murmur": { "token": "••••••••abcd" }' },
    { kind: "skip", text: "4 unchanged lines" },
  ],
  backupPath:
    "/Users/me/Library/Application Support/Claude/claude_desktop_config.json.murmur-backup",
  ...over,
});

const call = (over: Partial<McpAuditEntry> = {}): McpAuditEntry => ({
  id: 1,
  at: 1_700_000_000_000,
  client: "Claude desktop",
  tool: "get_meeting",
  ok: true,
  resultBytes: 1234,
  write: false,
  ...over,
});

let api: ReturnType<typeof createMockApi>;
const show = (clients: McpClientInfo[], audit: McpAuditEntry[] = []) => {
  api.mcpClients = vi.fn().mockResolvedValue({
    clients,
    command: "/Applications/Murmur.app/Contents/Resources/mcp/murmur-mcp",
    socketPath: "/data/mcp.sock",
  });
  api.mcpAudit = vi.fn().mockResolvedValue(audit);
};

beforeEach(() => {
  api = createMockApi();
  show([]);
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

describe("apps that may use Murmur (CN-11)", () => {
  it("says no app has been added, and adds one with a name and a kind", async () => {
    render(<McpApps status={MCP_STATUS_OFF} />);
    expect(await screen.findByText("No app has been added yet.")).toBeTruthy();
    const add = screen.getByRole("button", { name: "Add the app" });
    expect(add).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Add an app"), { target: { value: "Cursor" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Kind of app" }));
    fireEvent.click(await screen.findByRole("option", { name: "Cursor" }));
    fireEvent.click(screen.getByRole("button", { name: "Add the app" }));
    await waitFor(() => expect(api.mcpIssue).toHaveBeenCalledWith("Cursor", "cursor"));
    expect(await screen.findByText("Done.")).toBeTruthy();
  });

  it("shows why an app was not added", async () => {
    api.mcpIssue = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "There is an app with that name already." });
    render(<McpApps status={MCP_STATUS_OFF} />);
    fireEvent.change(await screen.findByLabelText("Add an app"), { target: { value: "Claude" } });
    fireEvent.click(screen.getByRole("button", { name: "Add the app" }));
    expect(await screen.findByText("There is an app with that name already.")).toBeTruthy();
  });

  it("lists the apps with their kind and when they were last used", async () => {
    show([
      client(),
      client({ id: "c2", name: "Cursor", kind: "cursor", lastUsedAt: 1_700_000_000_000 }),
    ]);
    render(<McpApps status={MCP_STATUS_OFF} />);
    const list = within(await screen.findByRole("list", { name: "Apps that may use Murmur" }));
    // The name, and the kind of app it is.
    expect(list.getAllByText("Claude desktop")).toHaveLength(2);
    expect(list.getByText("Not used yet")).toBeTruthy();
    expect(list.getByText(/Last used/)).toBeTruthy();
  });

  it("shows the changes to a config file and writes nothing until they are approved", async () => {
    show([client()]);
    api.mcpConfigPreview = vi.fn().mockResolvedValue({ ok: true, preview: preview() });
    render(<McpApps status={MCP_STATUS_OFF} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Show the changes to Claude desktop's config" }),
    );
    const panel = within(await screen.findByRole("group", { name: "Changes to the config file" }));
    expect(panel.getByText(/claude_desktop_config.json$/)).toBeTruthy();
    const diff = screen.getByLabelText("What would change");
    expect(diff.textContent).toContain('+   "murmur": { "token": "••••••••abcd" }');
    expect(diff.textContent).toContain('-   "old": 1');
    expect(diff.textContent).toContain("… 4 unchanged lines");
    expect(panel.getByText(/The token is hidden here but is written in the file/)).toBeTruthy();
    expect(panel.getByText(/A copy of the file as it is now is kept as/)).toBeTruthy();
    // Nothing is written by looking.
    expect(api.mcpConfigWrite).not.toHaveBeenCalled();
    // The window never held a token.
    expect(document.body.textContent).not.toMatch(/[A-Za-z0-9_-]{43}/);

    fireEvent.click(panel.getByRole("button", { name: "Write this file" }));
    await waitFor(() => expect(api.mcpConfigWrite).toHaveBeenCalledWith("p1"));
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "Changes to the config file" })).toBeNull(),
    );
  });

  it("does not write when the changes are not approved", async () => {
    show([client()]);
    api.mcpConfigPreview = vi.fn().mockResolvedValue({ ok: true, preview: preview() });
    render(<McpApps status={MCP_STATUS_OFF} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Show the changes to Claude desktop's config" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Do not write it" }));
    expect(screen.queryByRole("group", { name: "Changes to the config file" })).toBeNull();
    expect(api.mcpConfigWrite).not.toHaveBeenCalled();
  });

  it("says when the file is new, and when it already has the app", async () => {
    show([client()]);
    api.mcpConfigPreview = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, preview: preview({ exists: false, backupPath: null }) })
      .mockResolvedValueOnce({ ok: true, preview: preview({ changed: false }) });
    render(<McpApps status={MCP_STATUS_OFF} />);
    const open = await screen.findByRole("button", {
      name: "Show the changes to Claude desktop's config",
    });
    fireEvent.click(open);
    expect(await screen.findByText(/it does not exist yet and will be made/)).toBeTruthy();
    expect(screen.queryByText(/A copy of the file/)).toBeNull();
    fireEvent.click(open);
    expect(
      await screen.findByText("The file already has this app. Nothing to change."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Write this file" })).toBeNull();
  });

  it("shows why no preview could be made", async () => {
    show([client()]);
    api.mcpConfigPreview = vi.fn().mockResolvedValue({
      ok: false,
      message: "The file is not valid JSON, so Murmur will not change it. Fix it and try again.",
    });
    render(<McpApps status={MCP_STATUS_OFF} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Show the changes to Claude desktop's config" }),
    );
    expect(await screen.findByText(/The file is not valid JSON/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Changes to the config file" })).toBeNull();
  });

  it("shows the command, socket and address of an app that is set up by hand", async () => {
    show([client({ id: "c3", name: "My editor", kind: "other" })]);
    render(
      <McpApps
        status={{
          ...MCP_STATUS_OFF,
          running: true,
          http: { wanted: true, listening: true, url: "http://127.0.0.1:7825/mcp", problem: null },
        }}
      />,
    );
    expect(screen.queryByRole("button", { name: /Show the changes/ })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Show how to connect My editor" }));
    expect(
      await screen.findByText("/Applications/Murmur.app/Contents/Resources/mcp/murmur-mcp"),
    ).toBeTruthy();
    expect(screen.getByText("/data/mcp.sock")).toBeTruthy();
    expect(screen.getByText(/http:\/\/127.0.0.1:7825\/mcp/)).toBeTruthy();
  });

  it("copies a token through main, and says it is cleared", async () => {
    show([client()]);
    api.mcpCopyToken = vi
      .fn()
      .mockResolvedValue({ ok: true, message: "Copied. The clipboard is cleared in a minute." });
    render(<McpApps status={MCP_STATUS_OFF} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Copy the token of Claude desktop" }),
    );
    await waitFor(() => expect(api.mcpCopyToken).toHaveBeenCalledWith("c1"));
    expect(await screen.findByText("Copied. The clipboard is cleared in a minute.")).toBeTruthy();
  });

  it("removes an app, or makes a new token, only after a confirming click", async () => {
    show([client()]);
    render(<McpApps status={MCP_STATUS_OFF} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Claude desktop" }));
    expect(api.mcpRevoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep things as they are" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Claude desktop" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Claude desktop and stop its access" }),
    );
    await waitFor(() => expect(api.mcpRevoke).toHaveBeenCalledWith("c1"));

    fireEvent.click(await screen.findByRole("button", { name: "New token for Claude desktop" }));
    expect(api.mcpRotate).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Make a new token for Claude desktop and stop the old one",
      }),
    );
    await waitFor(() => expect(api.mcpRotate).toHaveBeenCalledWith("c1"));
  });

  it("lists the recent calls with names and sizes, and clears the log", async () => {
    show(
      [client()],
      [
        call({ id: 2, tool: "create_task", write: true, ok: false, resultBytes: 40 }),
        call({ id: 1 }),
      ],
    );
    render(<McpApps status={MCP_STATUS_OFF} />);
    const list = within(await screen.findByRole("list", { name: "Recent calls" }));
    expect(list.getByText("create_task")).toBeTruthy();
    expect(list.getByText("Writes")).toBeTruthy();
    expect(list.getByText("Refused")).toBeTruthy();
    expect(list.getByText("Done")).toBeTruthy();
    expect(list.getByText("1,234 bytes")).toBeTruthy();
    expect(screen.getByText(/What was asked and what was answered is never kept/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear the log of calls" }));
    await waitFor(() => expect(api.mcpAuditClear).toHaveBeenCalled());
  });

  it("passes the accessibility check with apps, a diff and calls", async () => {
    show([client(), client({ id: "c2", name: "Cursor", kind: "cursor" })], [call()]);
    api.mcpConfigPreview = vi.fn().mockResolvedValue({ ok: true, preview: preview() });
    const { container } = render(<McpApps status={MCP_STATUS_OFF} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Show the changes to Claude desktop's config" }),
    );
    await screen.findByLabelText("What would change");
    expect(auditAccessibility(container)).toEqual([]);
  });
});
