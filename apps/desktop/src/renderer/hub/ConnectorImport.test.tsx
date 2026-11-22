// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTOR_CATALOGUE,
  DEFAULT_CONNECTOR_SETTINGS,
  connectorChoice,
  type ConnectorAccount,
  type ConnectorView,
  type ImportableRecording,
  type TranscriptImportPreview,
} from "@murmur/shared";
import { ConnectorImport, KeyForm } from "./ConnectorImport";
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

const view = (id: string): ConnectorView => {
  const entry = CONNECTOR_CATALOGUE.find((c) => c.id === id)!;
  return {
    ...entry,
    readiness: "ready",
    clientId: null,
    clientSecretSaved: false,
    choice: connectorChoice(DEFAULT_CONNECTOR_SETTINGS, entry),
    accounts: [account(id)],
    connecting: false,
  };
};

const recording = (over: Partial<ImportableRecording> = {}): ImportableRecording => ({
  remoteId: "r1",
  title: "Launch sync",
  startedAt: Date.UTC(2026, 10, 20, 10),
  durationMs: 1_800_000,
  hasTranscript: true,
  imported: false,
  ...over,
});

const preview = (over: Partial<TranscriptImportPreview> = {}): TranscriptImportPreview => ({
  token: "tok",
  fileName: "Zoom: Launch sync",
  format: "vtt",
  formatName: "WebVTT",
  title: "Launch sync",
  startedAt: Date.UTC(2026, 10, 20, 10),
  durationMs: 12_000,
  lines: 2,
  speakers: ["Dana Lee", "Sam Ortiz"],
  timesEstimated: false,
  duplicate: null,
  ...over,
});

let api: ReturnType<typeof createMockApi>;
const save = vi.fn().mockResolvedValue(undefined);
const imported = vi.fn();

beforeEach(() => {
  api = createMockApi();
  save.mockClear();
  imported.mockClear();
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

const mount = (id: string) =>
  render(
    <ConnectorImport
      connector={view(id)}
      account={account(id)}
      settings={DEFAULT_CONNECTOR_SETTINGS}
      save={save}
      onImported={imported}
    />,
  );

describe("importing from Zoom or Fireflies (CN-09, CN-10)", () => {
  it("lists nothing until asked, then the meetings with their state", async () => {
    api.connectorRecordings = vi.fn().mockResolvedValue({
      ok: true,
      recordings: [
        recording(),
        recording({ remoteId: "r2", title: "Audio only", hasTranscript: false }),
        recording({ remoteId: "r3", title: "Done", imported: true }),
      ],
    });
    mount("zoom");
    expect(api.connectorRecordings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "List the meetings in Zoom" }));
    const list = within(await screen.findByRole("list", { name: "Meetings in Zoom" }));
    expect(list.getByText("Launch sync")).toBeTruthy();
    expect(list.getByText("No transcript file")).toBeTruthy();
    expect(list.getByText("Imported")).toBeTruthy();
    expect(api.connectorRecordings).toHaveBeenCalledWith("a1");
    // Nothing is fetched or imported by listing.
    expect(api.connectorImportPrepare).not.toHaveBeenCalled();
    expect(api.meetingImportConfirm).not.toHaveBeenCalled();
  });

  it("shows the same preview as for a file, and imports only on the confirm", async () => {
    api.connectorRecordings = vi.fn().mockResolvedValue({ ok: true, recordings: [recording()] });
    api.connectorImportPrepare = vi.fn().mockResolvedValue({ ok: true, preview: preview() });
    api.meetingImportConfirm = vi.fn().mockResolvedValue({ ok: true, meetingId: "m1" });
    mount("zoom");
    fireEvent.click(screen.getByRole("button", { name: "List the meetings in Zoom" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import “Launch sync”" }));
    expect(await screen.findByText(/Zoom: Launch sync: WebVTT\. 1 meeting, 2 lines/)).toBeTruthy();
    expect(screen.getByText(/Speakers: Dana Lee, Sam Ortiz/)).toBeTruthy();
    expect(api.connectorImportPrepare).toHaveBeenCalledWith("a1", "r1");
    expect(api.meetingImportConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import this transcript" }));
    await waitFor(() =>
      expect(api.meetingImportConfirm).toHaveBeenCalledWith({
        token: "tok",
        title: "Launch sync",
        startedAt: Date.UTC(2026, 10, 20, 10) - 0,
      }),
    );
    await waitFor(() => expect(imported).toHaveBeenCalledWith("m1"));
  });

  it("will not import a recording that was imported already", async () => {
    api.connectorRecordings = vi.fn().mockResolvedValue({ ok: true, recordings: [recording()] });
    api.connectorImportPrepare = vi.fn().mockResolvedValue({
      ok: true,
      preview: preview({
        duplicate: { meetingId: "m0", title: "Launch sync", reason: "same-recording" },
      }),
    });
    mount("zoom");
    fireEvent.click(screen.getByRole("button", { name: "List the meetings in Zoom" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import “Launch sync”" }));
    expect(
      await screen.findByText("This meeting is already imported as “Launch sync”."),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Import this transcript" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Import it anyway" })).toBeNull();
  });

  it("shows why a list or a meeting could not be fetched", async () => {
    api.connectorRecordings = vi.fn().mockResolvedValue({
      ok: false,
      message: "Zoom no longer accepts this sign-in. Connect again.",
    });
    mount("zoom");
    fireEvent.click(screen.getByRole("button", { name: "List the meetings in Zoom" }));
    expect(
      await screen.findByText("Zoom no longer accepts this sign-in. Connect again."),
    ).toBeTruthy();
    cleanup();
    api.connectorRecordings = vi.fn().mockResolvedValue({ ok: true, recordings: [recording()] });
    api.connectorImportPrepare = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "That recording has no transcript file." });
    mount("zoom");
    fireEvent.click(screen.getByRole("button", { name: "List the meetings in Zoom" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import “Launch sync”" }));
    expect(await screen.findByText("That recording has no transcript file.")).toBeTruthy();
  });

  it("says when there is nothing in the range, and saves a new range", async () => {
    api.connectorRecordings = vi.fn().mockResolvedValue({ ok: true, recordings: [] });
    mount("zoom");
    fireEvent.click(screen.getByRole("button", { name: "List the meetings in Zoom" }));
    expect(await screen.findByText("No meetings in the last 30 days.")).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: "Look back" }));
    fireEvent.click(await screen.findByRole("option", { name: "7 days" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ zoom: { rangeDays: 7 } }));
  });

  it("lets Fireflies' summary be kept or not", async () => {
    mount("fireflies");
    const toggle = screen.getByRole("switch", { name: /Keep Fireflies’ summary/ });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        fireflies: { rangeDays: 30, importProviderSummary: false },
      }),
    );
    expect(screen.getByText(/speakers and times/)).toBeTruthy();
  });
});

describe("the Fireflies key (CN-10)", () => {
  it("is typed as a password, sent once, and cleared whether or not it was accepted", async () => {
    api.connectorConnectKey = vi.fn().mockResolvedValue({ ok: false, message: "Key rejected." });
    const onResult = vi.fn();
    render(<KeyForm connector={view("fireflies")} onResult={onResult} />);
    const input = screen.getByLabelText("Fireflies API key") as HTMLInputElement;
    expect(input.type).toBe("password");
    const save = screen.getByRole("button", { name: "Save the Fireflies key" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "  fk-secret " } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.connectorConnectKey).toHaveBeenCalledWith("fireflies", "  fk-secret "),
    );
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({ ok: false, message: "Key rejected." }),
    );
    expect(input.value).toBe("");
  });
});
