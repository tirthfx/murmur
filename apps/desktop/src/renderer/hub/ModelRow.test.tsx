// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Models } from "./ModelRow";
import { createMockApi, SAMPLE_MODELS, sampleModel } from "./test-api";

afterEach(cleanup);

const row = (name: string) => screen.findByRole("group", { name });

describe("the models on this Mac (HB-15)", () => {
  it("lists each model with its size, state and host", async () => {
    window.murmur = createMockApi();
    render(<Models />);
    const speech = await row("Speech model");
    expect(speech.textContent).toContain("Download 648 MB");
    expect(speech.textContent).toContain("On disk: 648 MB.");
    expect(speech.textContent).toContain("Ready. Every file passed its check.");
    expect(within(speech).queryByRole("button", { name: /^Download/ })).toBeNull();
    const quality = await row("Quality language model");
    expect(quality.textContent).toContain("Not downloaded.");
    expect(quality.textContent).toContain("Downloads from huggingface.co.");
    expect(within(quality).queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(await row("Fast language model (default)")).toBeTruthy();
  });

  it("downloads a model, shows its progress and cancels it", async () => {
    const user = userEvent.setup();
    const downloading = sampleModel({
      id: "quality",
      state: "downloading",
      totalBytes: 1_000_000_000,
      diskBytes: 250_000_000,
      downloadedBytes: 250_000_000,
    });
    window.murmur = createMockApi({
      modelDownload: vi.fn().mockResolvedValue(downloading),
      modelCancel: vi
        .fn()
        .mockResolvedValue({ ...downloading, state: "missing", downloadedBytes: 0 }),
      modelsList: vi.fn().mockResolvedValueOnce(SAMPLE_MODELS).mockResolvedValue([downloading]),
    });
    render(<Models only="quality" />);
    await user.click(
      await screen.findByRole("button", { name: "Download the quality language model" }),
    );
    expect(window.murmur.modelDownload).toHaveBeenCalledWith("quality");
    expect(await screen.findByText("250 MB of 1.0 GB from huggingface.co")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Speech model" })).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Cancel the quality language model download" }),
    );
    expect(window.murmur.modelCancel).toHaveBeenCalledWith("quality");
  });

  it("deletes only after a confirmation", async () => {
    const user = userEvent.setup();
    window.murmur = createMockApi();
    render(<Models only="speech" />);
    await user.click(await screen.findByRole("button", { name: "Remove the speech model" }));
    await user.click(screen.getByRole("button", { name: "Keep the speech model" }));
    expect(window.murmur.modelRemove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove the speech model" }));
    await user.click(screen.getByRole("button", { name: "Delete the speech model files" }));
    expect(window.murmur.modelRemove).toHaveBeenCalledWith("speech");
    expect(await screen.findByText("Not downloaded.")).toBeTruthy();
  });

  it("says why a download failed and offers it again", async () => {
    window.murmur = createMockApi({
      modelsList: vi.fn().mockResolvedValue([
        sampleModel({
          state: "failed",
          diskBytes: 0,
          message: "The download did not finish: model/a: SHA-256 does not match the manifest",
        }),
      ]),
    });
    render(<Models />);
    const speech = await row("Speech model");
    expect(speech.textContent).toContain("SHA-256 does not match");
    expect(
      within(speech).getByRole("button", { name: "Download the speech model" }).textContent,
    ).toContain("Download again");
  });
});
