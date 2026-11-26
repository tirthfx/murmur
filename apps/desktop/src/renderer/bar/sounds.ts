import type { SoundName } from "@murmur/shared";
import cancel from "./sounds/cancel.wav";
import error from "./sounds/error.wav";
import lock from "./sounds/lock.wav";
import start from "./sounds/start.wav";
import success from "./sounds/success.wav";

/** Murmur's own tones, made by `scripts/make-sounds.mjs`. */
export const SOUND_URLS: Record<SoundName, string> = { start, lock, success, error, cancel };

/** Plays a sound (DC-40). Failures are ignored: sounds are optional. */
export function playSound(name: SoundName, volume = 0.5): void {
  const audio = new Audio(SOUND_URLS[name]);
  audio.volume = Math.min(1, Math.max(0, volume));
  void audio.play().catch(() => {});
}
