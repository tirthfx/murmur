import type { SoundName } from "@murmur/shared";
import cancel from "./sounds/cancel.wav";
import error from "./sounds/error.wav";
import lock from "./sounds/lock.wav";
import start from "./sounds/start.wav";
import success from "./sounds/success.wav";

/** Murmur's own tones, made by `scripts/make-sounds.mjs`. */
export const SOUND_URLS: Record<SoundName, string> = { start, lock, success, error, cancel };

const VOLUME = 0.5;

/** Plays a sound at half volume (DC-40 default). Failures are ignored: sounds are optional. */
export function playSound(name: SoundName): void {
  const audio = new Audio(SOUND_URLS[name]);
  audio.volume = VOLUME;
  void audio.play().catch(() => {});
}
