// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingDetail, TranscriptVersionInfo } from "@murmur/shared";
import { LanguagePanel } from "./LanguagePanel";
import { createMockApi } from "./test-api";

const detail = (
  over: { meeting?: Record<string, unknown> } & Omit<Partial<MeetingDetail>, "meeting"> = {},
): MeetingDetail => {
  const { meeting, ...rest } = over;
  return {
    meeting: {
      id: "m-1",
      title: "Sync",
      status: "ready",
      language: null,
      translate: false,
      audioDeletedAt: null,
      ...meeting,
    },
    detectedLanguage: null,
    rerunBlocked: null,
    transcriptVersions: [],
    ...rest,
  } as unknown as MeetingDetail;
};

const version = (over: Partial<TranscriptVersionInfo> = {}): TranscriptVersionInfo => ({
  id: 4,
  version: 1,
  language: null,
  translate: false,
  lines: 12,
  replacedAt: Date.UTC(2026, 10, 21),
  expiresAt: Date.UTC(2026, 11, 21),
  ...over,
});

let api: ReturnType<typeof createMockApi>;
beforeEach(() => {
  api = createMockApi();
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

const choose = async (label: string, option: string) => {
  fireEvent.click(await screen.findByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
};

describe("meeting language and rerun (NT-20, NT-23)", () => {
  it("shows the language heard when it is detected", () => {
    render(<LanguagePanel detail={detail({ detectedLanguage: "es" })} />);
    expect(screen.getByText("Heard: Spanish.")).toBeTruthy();
    cleanup();
    render(
      <LanguagePanel detail={detail({ meeting: { language: "de" }, detectedLanguage: "es" })} />,
    );
    expect(screen.queryByText(/Heard:/)).toBeNull();
  });

  it("does not change a finished meeting by itself: it asks before transcribing again", async () => {
    render(<LanguagePanel detail={detail()} />);
    await choose("Language", "Spanish");
    expect(api.meetingRerun).not.toHaveBeenCalled();
    expect(api.meetingSetLanguage).not.toHaveBeenCalled();
    expect(screen.getByText(/it does not change the transcript by itself/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Transcribe this meeting again" }));
    // The confirmation says what is replaced and what is kept.
    const note = screen.getByText(/Transcribe again in Spanish\?/);
    expect(note).toBeTruthy();
    expect(
      screen.getByText(/replaces the transcript and writes a new summary version/),
    ).toBeTruthy();
    expect(screen.getByText(/done tasks stay done/)).toBeTruthy();
    expect(screen.getByText(/kept for 30 days and can be put back/)).toBeTruthy();
    expect(api.meetingRerun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Transcribe again" }));
    await waitFor(() =>
      expect(api.meetingRerun).toHaveBeenCalledWith("m-1", { language: "es", translate: false }),
    );
    await waitFor(() => expect(screen.queryByText(/Transcribe again in Spanish\?/)).toBeNull());
  });

  it("can be cancelled, and can ask for English", async () => {
    render(<LanguagePanel detail={detail()} />);
    fireEvent.click(screen.getByRole("switch", { name: "Write the transcript in English" }));
    fireEvent.click(screen.getByRole("button", { name: "Transcribe this meeting again" }));
    expect(screen.getByText(/Transcribe again, written in English\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/written in English\?/)).toBeNull();
    expect(api.meetingRerun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Transcribe this meeting again" }));
    fireEvent.click(screen.getByRole("button", { name: "Transcribe again" }));
    await waitFor(() =>
      expect(api.meetingRerun).toHaveBeenCalledWith("m-1", { language: null, translate: true }),
    );
  });

  it("is disabled, with the reason, when the audio is gone", () => {
    render(
      <LanguagePanel
        detail={detail({
          rerunBlocked: "The audio of this meeting was deleted, so it cannot be transcribed again.",
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Transcribe this meeting again" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByText(/audio of this meeting was deleted/)).toBeTruthy();
  });

  it("shows why a rerun was refused", async () => {
    api.meetingRerun = vi.fn().mockResolvedValue({
      ok: false,
      message: "Some of the audio files of this meeting are missing.",
    });
    render(<LanguagePanel detail={detail()} />);
    fireEvent.click(screen.getByRole("button", { name: "Transcribe this meeting again" }));
    fireEvent.click(screen.getByRole("button", { name: "Transcribe again" }));
    expect(await screen.findByText(/audio files of this meeting are missing/)).toBeTruthy();
  });

  it("applies a change at once while the meeting is still recording", async () => {
    render(<LanguagePanel detail={detail({ meeting: { status: "recording" } })} />);
    expect(screen.queryByRole("button", { name: "Transcribe this meeting again" })).toBeNull();
    expect(screen.getByText("A change applies to the rest of this recording.")).toBeTruthy();
    await choose("Language", "German");
    await waitFor(() =>
      expect(api.meetingSetLanguage).toHaveBeenCalledWith("m-1", {
        language: "de",
        translate: false,
      }),
    );
    fireEvent.click(screen.getByRole("switch", { name: "Write the transcript in English" }));
    await waitFor(() =>
      expect(api.meetingSetLanguage).toHaveBeenLastCalledWith("m-1", {
        language: "de",
        translate: true,
      }),
    );
  });

  it("offers only the speech model's languages, not the dictation-only profile", async () => {
    render(<LanguagePanel detail={detail()} />);
    fireEvent.click(await screen.findByRole("combobox", { name: "Language" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options[0]).toBe("Detect automatically");
    expect(options).toContain("Hindi");
    expect(options.some((text) => /Mixed/.test(text ?? ""))).toBe(false);
  });

  it("lists earlier transcripts and puts one back", async () => {
    api.meetingVersionRestore = vi.fn().mockResolvedValue({ ok: true });
    render(
      <LanguagePanel
        detail={detail({
          transcriptVersions: [
            version(),
            version({ id: 3, version: 2, language: "es", translate: true, lines: 1 }),
          ],
        })}
      />,
    );
    const list = within(screen.getByRole("list", { name: "Earlier transcripts" }));
    expect(list.getByText(/detected automatically · 12 lines · replaced/)).toBeTruthy();
    expect(list.getByText(/Spanish, in English · 1 line · replaced/)).toBeTruthy();
    fireEvent.click(
      list.getAllByRole("button", { name: /Put back the transcript replaced on/ })[0]!,
    );
    await waitFor(() => expect(api.meetingVersionRestore).toHaveBeenCalledWith("m-1", 4));
  });

  it("will not put a transcript back while the meeting is being transcribed", () => {
    render(
      <LanguagePanel
        detail={detail({ meeting: { status: "processing" }, transcriptVersions: [version()] })}
      />,
    );
    expect(screen.getByRole("button", { name: /Put back the transcript/ })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("says why a transcript could not be put back", async () => {
    api.meetingVersionRestore = vi.fn().mockResolvedValue({
      ok: false,
      message: "That version is gone: it was kept for a limited time.",
    });
    render(<LanguagePanel detail={detail({ transcriptVersions: [version()] })} />);
    fireEvent.click(screen.getByRole("button", { name: /Put back the transcript/ }));
    expect(await screen.findByText(/kept for a limited time/)).toBeTruthy();
  });
});
