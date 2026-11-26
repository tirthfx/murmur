import type { ContextSnapshotInput, FocusContext } from "@murmur/shared";
import { describe, expect, it, vi } from "vitest";
import { createPrivateFocus } from "./private-focus";

const context = (bundleId: string, text: string): FocusContext => ({
  appName: "App",
  bundleId,
  windowTitle: "Secret plans",
  role: "AXTextArea",
  subrole: null,
  editable: true,
  secure: false,
  textBefore: text,
  textAfter: "",
});

describe("the private app list (HB-48)", () => {
  const reader = (bundleId: string) =>
    vi.fn(async (input: ContextSnapshotInput) =>
      context(bundleId, input.maxBefore === 0 ? "" : "text"),
    );

  it("reads once when the list is empty", async () => {
    const read = reader("a.notes");
    await expect(createPrivateFocus(read, () => [])({})).resolves.toMatchObject({
      textBefore: "text",
    });
    expect(read).toHaveBeenCalledOnce();
  });

  it("never asks a listed app for its text, and hides its window title", async () => {
    const read = reader("Vault.exe");
    const result = await createPrivateFocus(read, () => ["vault.exe"])({});
    expect(result).toMatchObject({ textBefore: "", windowTitle: null, bundleId: "Vault.exe" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ maxBefore: 0, maxAfter: 0 });
  });

  it("reads other apps as before", async () => {
    const read = reader("a.notes");
    await expect(createPrivateFocus(read, () => ["a.vault"])({})).resolves.toMatchObject({
      textBefore: "text",
    });
  });
});
