import { describe, expect, it } from "vitest";
import type { AudioDevice } from "@murmur/shared";
import { chooseAutoDevice, isVirtualInput } from "./auto-device";

const device = (
  id: string,
  transport: AudioDevice["transport"],
  isDefault = false,
  name = id,
): AudioDevice => ({ id, name, isDefault, transport, sampleRate: 48_000 });

describe("Auto microphone", () => {
  const builtin = device("builtin", "builtin");
  const usb = device("usb", "usb");
  const loopback = device("loop", "virtual", true, "Loopback Audio");

  it("never picks a virtual device over a real microphone", () => {
    expect(chooseAutoDevice({ devices: [builtin, loopback], lidClosed: false })).toBe("builtin");
    expect(chooseAutoDevice({ devices: [builtin, usb, loopback], lidClosed: null })).toBe("usb");
    expect(isVirtualInput(device("bh", "other", false, "BlackHole 2ch"))).toBe(true);
  });

  it("keeps the system default when it is a real microphone", () => {
    expect(
      chooseAutoDevice({ devices: [{ ...builtin, isDefault: true }, usb], lidClosed: false }),
    ).toBeNull();
  });

  it("skips the built-in microphone while the lid is closed", () => {
    const devices = [{ ...builtin, isDefault: true }, usb];
    expect(chooseAutoDevice({ devices, lidClosed: true })).toBe("usb");
    // Lid open again: the default (built in) is fine.
    expect(chooseAutoDevice({ devices, lidClosed: false })).toBeNull();
  });

  it("falls back to the system default when nothing real is left", () => {
    expect(
      chooseAutoDevice({ devices: [{ ...builtin, isDefault: true }], lidClosed: true }),
    ).toBeNull();
    expect(chooseAutoDevice({ devices: [loopback], lidClosed: false })).toBeNull();
    expect(chooseAutoDevice({ devices: [], lidClosed: null })).toBeNull();
  });
});
