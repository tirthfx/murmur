// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailSection, readSampleFile } from "./EmailSection";
import { createMockApi } from "./test-api";

afterEach(cleanup);

const fileOf = (bytes: Uint8Array) => ({
  size: bytes.length,
  arrayBuffer: async () => bytes.buffer as ArrayBuffer,
});

describe("Email section", () => {
  it("refuses a 25 KB file with the limit shown, and files that are not text", async () => {
    await expect(readSampleFile(fileOf(new Uint8Array(25 * 1024).fill(97)))).resolves.toEqual({
      ok: false,
      message: "The file is 25 KB; samples can be up to 20 KB.",
    });
    await expect(readSampleFile(fileOf(new Uint8Array([0xff, 0xfe, 0x00])))).resolves.toMatchObject(
      { ok: false, message: expect.stringContaining("plain text") },
    );
    await expect(readSampleFile(fileOf(new TextEncoder().encode("Hi team")))).resolves.toEqual({
      ok: true,
      text: "Hi team",
    });
  });

  it("saves the signature and the email language", async () => {
    const api = createMockApi();
    window.murmur = api;
    render(<EmailSection />);
    const box = await screen.findByLabelText(/^Signature/);
    fireEvent.change(box, { target: { value: "Best,\nTirth" } });
    expect(screen.getByTestId("signature-preview").textContent).toContain("Best,");
    await act(async () => screen.getByRole("button", { name: "Save signature" }).click());
    expect(api.updateSettings).toHaveBeenCalledWith({
      email: { signature: "Best,\nTirth", addToNew: true, addToReplies: false, language: null },
    });
  });

  it("adds a pasted sample and shows a refusal from main", async () => {
    const writingSamplesSave = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        sample: { id: "w1", label: "Work", text: "Hi", bytes: 2, createdAt: 1 },
      })
      .mockResolvedValueOnce({ ok: false, reason: "full", message: "You can keep up to 10." });
    const writingSamplesList = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ id: "w1", label: "Work", text: "Hi", bytes: 2, createdAt: 1 }]);
    window.murmur = createMockApi({ writingSamplesSave, writingSamplesList });
    render(<EmailSection />);
    fireEvent.change(await screen.findByLabelText(/^Sample label/), { target: { value: "Work" } });
    fireEvent.change(screen.getByLabelText(/^Sample text/), { target: { value: "Hi" } });
    await act(async () => screen.getByRole("button", { name: "Save sample" }).click());
    expect(writingSamplesSave).toHaveBeenCalledWith({ label: "Work", text: "Hi" });
    await waitFor(() => expect(screen.getByText("Work · under 1 KB")).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/^Sample label/), { target: { value: "More" } });
    fireEvent.change(screen.getByLabelText(/^Sample text/), { target: { value: "x" } });
    await act(async () => screen.getByRole("button", { name: "Save sample" }).click());
    expect(screen.getByText("You can keep up to 10.")).toBeTruthy();
  });
});
