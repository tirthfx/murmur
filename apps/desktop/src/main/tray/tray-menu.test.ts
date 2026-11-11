import { describe, expect, it } from "vitest";
import type { AudioDevice } from "@murmur/shared";
import { trayMenu, trayTooltip, type TrayItem, type TrayState } from "./tray-menu";

const device = (id: string, name: string): AudioDevice => ({
  id,
  name,
  isDefault: false,
  transport: "usb",
  sampleRate: 48000,
});

const base: TrayState = {
  recording: false,
  status: "idle",
  devices: [device("desk", "Desk Mic"), device("built-in", "MacBook Microphone")],
  inputDevice: "auto",
  languages: [],
  hasLastTranscript: true,
  typingReminder: "on",
};

type Row = Extract<TrayItem, { kind: "item" }>;
const rows = (items: TrayItem[]) => items.filter((item): item is Row => item.kind === "item");
const row = (state: TrayState, label: string) =>
  rows(trayMenu(state)).find((item) => item.label === label)!;

describe("tray menu", () => {
  it("lists the items in the agreed order", () => {
    expect(rows(trayMenu(base)).map((item) => item.label)).toEqual([
      "Start dictation",
      "Microphone",
      "Languages",
      "Copy last transcript",
      "Typing reminder",
      "Quit Murmur",
    ]);
  });

  it("labels the first item by state", () => {
    expect(rows(trayMenu({ ...base, recording: true }))[0]!.label).toBe("Stop dictation");
    expect(rows(trayMenu(base))[0]!.action).toEqual({ type: "toggle" });
  });

  it("lists Auto and each microphone, with a check on the current one", () => {
    const submenu = rows(row({ ...base, inputDevice: "desk" }, "Microphone").submenu!);
    expect(submenu.map((item) => [item.label, item.checked])).toEqual([
      ["Auto", false],
      ["Desk Mic", true],
      ["MacBook Microphone", false],
    ]);
    expect(submenu[1]!.action).toEqual({ type: "device", id: "desk" });
  });

  it("checks Auto by default and still offers it without a device list", () => {
    const submenu = rows(row({ ...base, devices: null }, "Microphone").submenu!);
    expect(submenu.map((item) => [item.label, item.checked])).toEqual([["Auto", true]]);
  });

  it("keeps an unplugged saved microphone visible and checked", () => {
    const submenu = rows(row({ ...base, inputDevice: "gone" }, "Microphone").submenu!);
    expect(submenu.at(-1)).toMatchObject({
      label: "Saved microphone (not connected)",
      checked: true,
      enabled: false,
    });
  });

  it("checks the chosen language only", () => {
    const submenu = rows(row({ ...base, languages: ["hi", "en"] }, "Languages").submenu!);
    expect(submenu.filter((item) => item.checked).map((item) => item.label)).toEqual(["Hindi"]);
    expect(submenu[0]!.label).toBe("Detect automatically");
    const auto = rows(row(base, "Languages").submenu!);
    expect(auto.filter((item) => item.checked).map((item) => item.label)).toEqual([
      "Detect automatically",
    ]);
    expect(auto.at(-1)!.label).toBe("Mixed: Hindi in Latin script");
  });

  it("disables copy when there is no transcript", () => {
    expect(row({ ...base, hasLastTranscript: false }, "Copy last transcript").enabled).toBe(false);
    expect(row(base, "Copy last transcript").enabled).toBe(true);
  });

  it("always offers Quit, enabled, in every state", () => {
    for (const state of [
      base,
      { ...base, recording: true, status: "listening" as const },
      { ...base, devices: null, hasLastTranscript: false, status: "warning" as const },
    ]) {
      const quit = rows(trayMenu(state)).at(-1)!;
      expect(quit).toMatchObject({ label: "Quit Murmur", action: { type: "quit" } });
      expect(quit.enabled ?? true).toBe(true);
    }
  });

  it("offers snoozes for the typing reminder, or turning it on", () => {
    const labels = (status: TrayState["typingReminder"]) =>
      rows(row({ ...base, typingReminder: status }, "Typing reminder").submenu!).map(
        (item) => item.label,
      );
    expect(labels("on")).toEqual(["Snooze for 1 hour", "Snooze until tomorrow", "Turn off"]);
    expect(labels("snoozed")).toEqual([
      "Snoozed",
      "Resume now",
      "Snooze for 1 hour",
      "Snooze until tomorrow",
      "Turn off",
    ]);
    expect(labels("off")).toEqual(["Turn on"]);
  });

  it("has a tooltip for each status", () => {
    expect(trayTooltip("idle")).toBe("Murmur");
    expect(trayTooltip("listening")).toContain("listening");
    expect(trayTooltip("warning")).toContain("problem");
  });
});
