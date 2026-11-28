import { describe, expect, it } from "vitest";
import type { AudioDevice } from "@murmur/shared";
import { microphoneChoices } from "./microphone-choices";

const device = (id: string, transport: AudioDevice["transport"]): AudioDevice => ({
  id,
  name: id,
  isDefault: false,
  transport,
  sampleRate: 48_000,
});

const devices = [device("loop", "virtual"), device("odd", "other"), device("usb", "usb")];

describe("the microphone list (HB-16)", () => {
  it("puts real inputs first and says which are virtual", () => {
    expect(microphoneChoices(devices, true, "auto").map((choice) => choice.label)).toEqual([
      "usb",
      "odd (other)",
      "loop (virtual)",
    ]);
  });

  it("hides virtual inputs when asked, but never the chosen one", () => {
    expect(microphoneChoices(devices, false, "auto").map((c) => c.value)).toEqual(["usb", "odd"]);
    expect(microphoneChoices(devices, false, "loop").map((c) => c.value)).toContain("loop");
  });
});
