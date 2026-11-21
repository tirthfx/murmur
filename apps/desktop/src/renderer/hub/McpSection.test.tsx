// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MCP_SETTINGS,
  MCP_STATUS_OFF,
  type McpSettings,
  type McpStatus,
} from "@murmur/shared";
import { auditAccessibility } from "./a11y-audit";
import { McpSection } from "./McpSection";
import { createMockApi, SAMPLE_SETTINGS } from "./test-api";

let api: ReturnType<typeof createMockApi>;
let current: McpSettings;

const settingsWith = (mcp: McpSettings) => ({
  ...structuredClone(SAMPLE_SETTINGS),
  settings: { ...structuredClone(SAMPLE_SETTINGS).settings, mcp },
});

const on = (over: Partial<McpStatus> = {}): McpStatus => ({
  running: true,
  stdio: { wanted: true, listening: true, path: "/Users/me/Murmur/mcp.sock", problem: null },
  http: { wanted: false, listening: false, url: null, problem: null },
  ...over,
});

beforeEach(() => {
  current = DEFAULT_MCP_SETTINGS;
  api = createMockApi({
    getSettings: vi.fn(async () => settingsWith(current)),
    updateSettings: vi.fn(async (patch: { mcp?: McpSettings }) => {
      if (patch.mcp) current = patch.mcp;
      return settingsWith(current);
    }),
  });
  api.mcpStatus = vi.fn().mockResolvedValue(MCP_STATUS_OFF);
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

describe("Local MCP server section (CN-11)", () => {
  it("is off by default and shows nothing but the switch", async () => {
    render(<McpSection />);
    const toggle = await screen.findByRole("switch", { name: "Turn on the local MCP server" });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("switch", { name: "Command for desktop apps" })).toBeNull();
    expect(screen.getByText(/never gives out audio, sign-ins or your other files/)).toBeTruthy();
  });

  it("turns it on, and shows where it is listening", async () => {
    api.mcpStatus = vi.fn().mockResolvedValueOnce(MCP_STATUS_OFF).mockResolvedValue(on());
    render(<McpSection />);
    fireEvent.click(await screen.findByRole("switch", { name: "Turn on the local MCP server" }));
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({
        mcp: { ...DEFAULT_MCP_SETTINGS, enabled: true },
      }),
    );
    expect(await screen.findByText("Local socket on: /Users/me/Murmur/mcp.sock")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Command for desktop apps" })).toBeTruthy();
    expect(screen.queryByLabelText("Port")).toBeNull();
  });

  it("turns the web address on, and changes the port only to a valid one", async () => {
    current = { ...DEFAULT_MCP_SETTINGS, enabled: true };
    render(<McpSection />);
    fireEvent.click(
      await screen.findByRole("switch", { name: "Web address with an access token" }),
    );
    const port = await screen.findByLabelText("Port");
    expect((port as HTMLInputElement).value).toBe("7825");
    const use = screen.getByRole("button", { name: "Use this port" });
    expect(use).toHaveProperty("disabled", true);
    fireEvent.change(port, { target: { value: "80" } });
    expect(use).toHaveProperty("disabled", true);
    fireEvent.change(port, { target: { value: "7900" } });
    expect(use).toHaveProperty("disabled", false);
    fireEvent.click(use);
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenLastCalledWith({
        mcp: expect.objectContaining({ http: { port: 7900 } }),
      }),
    );
  });

  it("shows why a transport could not start", async () => {
    current = { ...DEFAULT_MCP_SETTINGS, enabled: true, transport: { stdio: true, http: true } };
    api.mcpStatus = vi.fn().mockResolvedValue(
      on({
        http: {
          wanted: true,
          listening: false,
          url: null,
          problem: "Port 7825 is in use. Choose another port.",
        },
      }),
    );
    render(<McpSection />);
    expect(await screen.findByText("Port 7825 is in use. Choose another port.")).toBeTruthy();
    expect(screen.getByText("Web address: not listening.")).toBeTruthy();
    expect(screen.getByText(/Local socket on:/)).toBeTruthy();
  });

  it("passes the accessibility check when on", async () => {
    current = { ...DEFAULT_MCP_SETTINGS, enabled: true, transport: { stdio: true, http: true } };
    api.mcpStatus = vi.fn().mockResolvedValue(
      on({
        http: { wanted: true, listening: true, url: "http://127.0.0.1:7825/mcp", problem: null },
      }),
    );
    const { container } = render(<McpSection />);
    await screen.findByText("Web address on: http://127.0.0.1:7825/mcp");
    expect(auditAccessibility(container)).toEqual([]);
  });
});
