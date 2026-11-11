import type { AudioDevice, AudioInputs } from "@murmur/shared";

// Microphone choice in Auto (roadmap M2 epic 7): never a virtual device over a real
// microphone, and no built-in microphone while the lid is closed. Chosen at each dictation,
// so opening the lid again counts from the next one.

/** Names of common virtual and loopback inputs, for devices that do not say they are virtual. */
const VIRTUAL_NAMES =
  /\b(blackhole|loopback|soundflower|zoomaudiodevice|zoom audio|teams audio|aggregate|multi-output|virtual|obs|krisp)\b/i;

export function isVirtualInput(device: AudioDevice): boolean {
  return device.transport === "virtual" || VIRTUAL_NAMES.test(device.name);
}

/** Real microphones first: plugged in, then wireless, then others, then built in. */
const ORDER: Record<AudioDevice["transport"], number> = {
  usb: 0,
  bluetooth: 1,
  other: 2,
  builtin: 3,
  virtual: 4,
};

/**
 * The device id for Auto, or null to leave it to the system default (when that is already a
 * good choice, or when there is nothing better).
 */
export function chooseAutoDevice({ devices, lidClosed }: AudioInputs): string | null {
  const usable = devices.filter(
    (device) => !isVirtualInput(device) && !(lidClosed === true && device.transport === "builtin"),
  );
  const systemDefault = devices.find((device) => device.isDefault);
  if (!systemDefault || usable.some((device) => device.id === systemDefault.id)) return null;
  const best = [...usable].sort((a, b) => ORDER[a.transport] - ORDER[b.transport])[0];
  return best?.id ?? null;
}
