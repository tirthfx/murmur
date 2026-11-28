import type { AudioDevice } from "@murmur/shared";

/** Real inputs first, then the rest, then those made by software (HB-16). */
const RANK: Record<AudioDevice["transport"], number> = {
  builtin: 0,
  usb: 0,
  bluetooth: 0,
  other: 1,
  virtual: 2,
};

/**
 * The microphones to choose from, grouped by rank and named for their group. A virtual input is
 * left out when they are hidden, unless it is the one chosen.
 */
export function microphoneChoices(
  devices: readonly AudioDevice[],
  showVirtual: boolean,
  chosen: string,
): { value: string; label: string }[] {
  return devices
    .filter((device) => showVirtual || device.transport !== "virtual" || device.id === chosen)
    .map((device, index) => ({ device, index }))
    .sort((a, b) => RANK[a.device.transport] - RANK[b.device.transport] || a.index - b.index)
    .map(({ device }) => ({
      value: device.id,
      label:
        device.transport === "virtual"
          ? `${device.name} (virtual)`
          : device.transport === "other"
            ? `${device.name} (other)`
            : device.name,
    }));
}
