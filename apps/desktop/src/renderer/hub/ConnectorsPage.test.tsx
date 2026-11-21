// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTOR_CATALOGUE,
  DEFAULT_CONNECTOR_SETTINGS,
  connectorChoice,
  type ConnectorAccount,
  type ConnectorReadiness,
  type ConnectorsView,
  type ConnectorView,
} from "@murmur/shared";
import { auditAccessibility } from "./a11y-audit";
import { ConnectorNotice } from "./ConnectorNotice";
import { connectorStatus, ConnectorsPage } from "./ConnectorsPage";
import { createMockApi } from "./test-api";

const account = (over: Partial<ConnectorAccount> = {}): ConnectorAccount => ({
  id: "a1",
  connector: "googleCalendar",
  email: "me@example.com",
  scopes: ["read"],
  status: "connected",
  statusReason: null,
  lastSyncAt: null,
  createdAt: 1,
  ...over,
});

interface Over {
  readiness?: ConnectorReadiness;
  accounts?: ConnectorAccount[];
  clientId?: string | null;
  clientSecretSaved?: boolean;
  connecting?: boolean;
}

const viewOf = (over: Record<string, Over> = {}): ConnectorsView => ({
  cacheTtlMinutes: 15,
  connectors: CONNECTOR_CATALOGUE.map((entry): ConnectorView => ({
    ...entry,
    readiness: "unavailable",
    clientId: null,
    clientSecretSaved: false,
    choice: connectorChoice(DEFAULT_CONNECTOR_SETTINGS, entry),
    accounts: [],
    connecting: false,
    ...over[entry.id],
  })),
});

let api: ReturnType<typeof createMockApi>;
const show = (view: ConnectorsView) => {
  api.connectorsView = vi.fn().mockResolvedValue(view);
};

beforeEach(() => {
  api = createMockApi();
  show(viewOf());
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

const card = async (name: string) => within(await screen.findByRole("listitem", { name }));

describe("Connectors page (CN-15)", () => {
  it("lists every connector with its status, and says one that is not built yet is not", async () => {
    render(<ConnectorsPage />);
    const list = await screen.findByRole("list", { name: "Connectors" });
    for (const entry of CONNECTOR_CATALOGUE) {
      expect(within(list).getByRole("listitem", { name: entry.name })).toBeTruthy();
    }
    const google = await card("Google Calendar");
    expect(google.getByText("Not built yet")).toBeTruthy();
    expect(google.getByText(/It will need: An OAuth client of type Desktop app/)).toBeTruthy();
    expect(google.queryByRole("button", { name: /^Connect/ })).toBeNull();
    // What it reads, what it can write, and the scopes in plain words.
    expect(google.getByText(/Your calendars, and the events from yesterday/)).toBeTruthy();
    expect(google.getByText(/Creating a follow-up event/)).toBeTruthy();
    expect(google.getByText("Read your calendar events")).toBeTruthy();
    expect(
      google.getByText("Create and change events (only when a feature needs it)"),
    ).toBeTruthy();
    expect(google.getByText(/Used by: .*Meeting reminders/)).toBeTruthy();
  });

  it("tells a connector that has no OAuth app yet what is missing, and saves the app details", async () => {
    show(viewOf({ googleCalendar: { readiness: "not-set-up" } }));
    render(<ConnectorsPage />);
    const google = await card("Google Calendar");
    expect(google.getByText("Needs setup")).toBeTruthy();
    expect(google.getByText(/Before you can connect, set up: An OAuth client/)).toBeTruthy();
    expect(google.queryByRole("button", { name: /^Connect/ })).toBeNull();
    const save = google.getByRole("button", { name: "Save the Google Calendar app details" });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.change(google.getByLabelText("Google Calendar OAuth client id"), {
      target: { value: " 123-abc.apps " },
    });
    fireEvent.change(google.getByLabelText("Google Calendar client secret"), {
      target: { value: "s3cret" },
    });
    expect((google.getByLabelText("Google Calendar client secret") as HTMLInputElement).type).toBe(
      "password",
    );
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.connectorSetClientId).toHaveBeenCalledWith("googleCalendar", "123-abc.apps"),
    );
    expect(api.connectorSetClientSecret).toHaveBeenCalledWith("googleCalendar", "s3cret");
    expect(await screen.findByText("Saved the Google Calendar app details.")).toBeTruthy();
  });

  it("does not ask for a secret from a connector that has none, and shows why a save failed", async () => {
    show(viewOf({ outlookCalendar: { readiness: "not-set-up" } }));
    api.connectorSetClientId = vi.fn().mockResolvedValue({
      ok: false,
      message: "A client id is one piece of text with no spaces.",
    });
    render(<ConnectorsPage />);
    const outlook = await card("Outlook calendar");
    expect(outlook.queryByLabelText("Outlook calendar client secret")).toBeNull();
    fireEvent.change(outlook.getByLabelText("Outlook calendar OAuth client id"), {
      target: { value: "bad id" },
    });
    fireEvent.click(outlook.getByRole("button", { name: "Save the Outlook calendar app details" }));
    expect(await screen.findByText(/one piece of text with no spaces/)).toBeTruthy();
  });

  it("connects through the system browser and shows the result", async () => {
    show(viewOf({ googleCalendar: { readiness: "ready" } }));
    let finish: (value: { ok: true; message: string }) => void = () => undefined;
    api.connectorConnect = vi.fn().mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<ConnectorsPage />);
    const google = await card("Google Calendar");
    expect(google.getByText("Not connected")).toBeTruthy();
    fireEvent.click(google.getByRole("button", { name: "Connect Google Calendar" }));
    expect(api.connectorConnect).toHaveBeenCalledWith("googleCalendar", undefined);
    // While the browser is open it can be cancelled, and nothing else can start.
    expect(await screen.findByText("Waiting for your browser…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel the Google Calendar sign-in" }));
    expect(api.connectorCancel).toHaveBeenCalledWith("googleCalendar");
    show(
      viewOf({
        googleCalendar: {
          readiness: "ready",
          accounts: [account({ lastSyncAt: 1_700_000_000_000 })],
        },
      }),
    );
    finish({ ok: true, message: "Connected me@example.com." });
    expect(await screen.findByText("Connected me@example.com.")).toBeTruthy();
    const after = await card("Google Calendar");
    expect(await after.findByText("me@example.com")).toBeTruthy();
    expect(after.getAllByText("Connected")).toHaveLength(2); // the connector and the account
    expect(after.getByText(/Last synced/)).toBeTruthy();
    expect(
      after.getByRole("button", { name: "Connect another Google Calendar account" }),
    ).toBeTruthy();
  });

  it("says why a sign-in did not finish", async () => {
    show(viewOf({ googleCalendar: { readiness: "ready" } }));
    api.connectorConnect = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "The sign-in was not allowed." });
    render(<ConnectorsPage />);
    fireEvent.click(
      await (
        await card("Google Calendar")
      ).findByRole("button", { name: "Connect Google Calendar" }),
    );
    expect(await screen.findByText("The sign-in was not allowed.")).toBeTruthy();
  });

  it("disconnects one of two accounts after a confirming click, and leaves the other", async () => {
    show(
      viewOf({
        googleCalendar: {
          readiness: "ready",
          accounts: [
            account({ id: "a1", email: "work@example.com" }),
            account({ id: "a2", email: "home@example.com" }),
          ],
        },
      }),
    );
    render(<ConnectorsPage />);
    const google = await card("Google Calendar");
    await google.findByText("work@example.com");
    fireEvent.click(google.getByRole("button", { name: "Disconnect home@example.com" }));
    expect(api.connectorDisconnect).not.toHaveBeenCalled();
    fireEvent.click(
      google.getByRole("button", {
        name: "Disconnect home@example.com and delete what Murmur saved for it",
      }),
    );
    await waitFor(() => expect(api.connectorDisconnect).toHaveBeenCalledWith("a2"));
    expect(api.connectorDisconnect).toHaveBeenCalledTimes(1);
    // The confirmation can be cancelled.
    fireEvent.click(google.getByRole("button", { name: "Disconnect work@example.com" }));
    fireEvent.click(google.getByRole("button", { name: "Keep it connected" }));
    expect(google.getByRole("button", { name: "Disconnect work@example.com" })).toBeTruthy();
  });

  it("shows one banner with Reconnect for an account that needs attention, and reconnects that email", async () => {
    show(
      viewOf({
        googleCalendar: {
          readiness: "ready",
          accounts: [
            account({
              status: "needs_attention",
              statusReason: "Google Calendar no longer accepts this sign-in. Connect again.",
            }),
          ],
        },
      }),
    );
    render(<ConnectorsPage />);
    await screen.findByText("Google Calendar (me@example.com) needs to be connected again");
    expect(screen.getAllByText(/needs to be connected again/)).toHaveLength(1);
    expect(screen.getAllByText(/no longer accepts this sign-in/).length).toBeGreaterThan(0);
    fireEvent.click(
      screen.getByRole("button", { name: "Reconnect Google Calendar me@example.com" }),
    );
    expect(api.connectorConnect).toHaveBeenCalledWith("googleCalendar", "me@example.com");
    expect((await card("Google Calendar")).getAllByText("Needs attention")).toHaveLength(2);
  });

  it("reads a calendar account now, and says how many events it found", async () => {
    show(viewOf({ googleCalendar: { readiness: "ready", accounts: [account()] } }));
    api.connectorSync = vi.fn().mockResolvedValue({ ok: true, message: "Read 12 events." });
    render(<ConnectorsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Read me@example.com now" }));
    await waitFor(() => expect(api.connectorSync).toHaveBeenCalledWith("a1"));
    expect(await screen.findByText("Read 12 events.")).toBeTruthy();
  });

  it("says why a calendar could not be read, and has no Read now for a connector that is not a calendar", async () => {
    show(
      viewOf({
        googleCalendar: { readiness: "ready", accounts: [account()] },
        gmail: {
          readiness: "ready",
          accounts: [account({ id: "m1", connector: "gmail", email: "m@example.com" })],
        },
      }),
    );
    api.connectorSync = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "Google Calendar answered 503." });
    render(<ConnectorsPage />);
    expect(await screen.findAllByRole("button", { name: /^Read .* now$/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Read me@example.com now" }));
    expect(await screen.findByText("Google Calendar answered 503.")).toBeTruthy();
  });

  it("turns an account off and on", async () => {
    show(viewOf({ googleCalendar: { readiness: "ready", accounts: [account()] } }));
    render(<ConnectorsPage />);
    const toggle = await screen.findByRole("switch", { name: "Use me@example.com" });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => expect(api.connectorSetEnabled).toHaveBeenCalledWith("a1", false));
  });

  it("changes the sync interval and the read-only switch of a connected connector", async () => {
    show(viewOf({ googleCalendar: { readiness: "ready", accounts: [account()] } }));
    render(<ConnectorsPage />);
    const google = await card("Google Calendar");
    fireEvent.click(
      await google.findByRole("combobox", { name: "Check Google Calendar for changes every" }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "1 hour" }));
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({
        connectors: {
          cacheTtlMinutes: 15,
          choices: { googleCalendar: { syncIntervalMinutes: 60, readOnly: true } },
        },
      }),
    );
    const readOnly = google.getByRole("switch", { name: "Google Calendar is read only" });
    expect((readOnly as HTMLInputElement).checked).toBe(true);
    fireEvent.click(readOnly);
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenLastCalledWith({
        connectors: {
          cacheTtlMinutes: 15,
          choices: { googleCalendar: { syncIntervalMinutes: 15, readOnly: false } },
        },
      }),
    );
  });

  it("has no read-only switch for a connector that never writes", async () => {
    show(
      viewOf({
        notion: { readiness: "ready", accounts: [account({ id: "n1", connector: "notion" })] },
      }),
    );
    render(<ConnectorsPage />);
    const notion = await card("Notion");
    await notion.findByRole("combobox", { name: "Check Notion for changes every" });
    expect(notion.queryByRole("switch", { name: /read only/ })).toBeNull();
  });

  it("lists the features that need a connector, off with the reason, and on when one works", async () => {
    render(<ConnectorsPage />);
    const features = within(
      await screen.findByRole("list", { name: "Features that use connectors" }),
    );
    const reminders = features
      .getByText("Meeting reminders and starting a recording")
      .closest("li")!;
    expect(within(reminders).getByText("Off")).toBeTruthy();
    expect(
      within(reminders).getByText(
        "Needs Google Calendar or Outlook calendar, which is not built yet.",
      ),
    ).toBeTruthy();
    cleanup();
    show(viewOf({ googleCalendar: { readiness: "ready", accounts: [account()] } }));
    render(<ConnectorsPage />);
    const again = within(await screen.findByRole("list", { name: "Features that use connectors" }));
    await waitFor(() =>
      expect(
        within(
          again.getByText("Meeting reminders and starting a recording").closest("li")!,
        ).getByText("On"),
      ).toBeTruthy(),
    );
  });

  it("reads again when the window is focused again", async () => {
    render(<ConnectorsPage />);
    await screen.findByRole("list", { name: "Connectors" });
    const calls = (api.connectorsView as ReturnType<typeof vi.fn>).mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect((api.connectorsView as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls + 1),
    );
  });

  it("passes the accessibility check with accounts of every state", async () => {
    show(
      viewOf({
        googleCalendar: {
          readiness: "ready",
          accounts: [
            account({ id: "a1" }),
            account({
              id: "a2",
              email: "b@example.com",
              status: "needs_attention",
              statusReason: "Gone.",
            }),
            account({ id: "a3", email: "c@example.com", status: "disabled" }),
          ],
        },
        slack: { readiness: "not-set-up", clientId: "x" },
      }),
    );
    const { container } = render(<ConnectorsPage />);
    await screen.findByText("b@example.com");
    expect(auditAccessibility(container)).toEqual([]);
  });
});

describe("connector status (CN-15)", () => {
  const entry = CONNECTOR_CATALOGUE[0]!;
  const base = viewOf().connectors[0]!;
  it("shows the one that matters most", () => {
    expect(connectorStatus({ ...base })).toEqual({ label: "Not built yet", variant: "neutral" });
    expect(connectorStatus({ ...base, readiness: "not-set-up" }).label).toBe("Needs setup");
    expect(connectorStatus({ ...base, readiness: "ready" }).label).toBe("Not connected");
    const connected = account({ connector: entry.id });
    expect(connectorStatus({ ...base, readiness: "ready", accounts: [connected] }).label).toBe(
      "Connected",
    );
    expect(
      connectorStatus({
        ...base,
        readiness: "ready",
        accounts: [connected, account({ id: "a2", status: "needs_attention" })],
      }).label,
    ).toBe("Needs attention");
    expect(
      connectorStatus({
        ...base,
        readiness: "ready",
        accounts: [account({ status: "disabled" })],
      }).label,
    ).toBe("Disabled");
  });
});

describe("a feature's connector notice (CN-15)", () => {
  it("says why the feature is off and opens the Connectors page", async () => {
    show(viewOf({ gmail: { readiness: "ready" } }));
    render(<ConnectorNotice featureId="email-drafts" />);
    expect(await screen.findByText("Follow-up email drafts is off")).toBeTruthy();
    expect(screen.getByText("Connect Gmail to use this.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Connectors" }));
    expect(window.location.hash).toBe("#/connectors");
  });

  it("shows Reconnect for an account that needs attention", async () => {
    show(
      viewOf({
        gmail: {
          readiness: "ready",
          accounts: [account({ id: "m1", connector: "gmail", status: "needs_attention" })],
        },
      }),
    );
    render(<ConnectorNotice featureId="email-drafts" />);
    fireEvent.click(await screen.findByRole("button", { name: "Reconnect me@example.com" }));
    expect(api.connectorConnect).toHaveBeenCalledWith("gmail", "me@example.com");
  });

  it("shows nothing when the feature can work, or is not known", async () => {
    show(viewOf({ gmail: { readiness: "ready", accounts: [account({ connector: "gmail" })] } }));
    const { container } = render(<ConnectorNotice featureId="email-drafts" />);
    await waitFor(() => expect(api.connectorsView).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(container.textContent).toBe("");
    cleanup();
    const unknown = render(<ConnectorNotice featureId="nope" />);
    expect(unknown.container.textContent).toBe("");
  });
});
