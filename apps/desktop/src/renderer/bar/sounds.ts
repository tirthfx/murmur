import type { SoundName, SoundSet } from "@murmur/shared";
import start from "./sounds/start.wav";
import lock from "./sounds/lock.wav";
import success from "./sounds/success.wav";
import error from "./sounds/error.wav";
import cancel from "./sounds/cancel.wav";
import milestone from "./sounds/milestone.wav";
import softStart from "./sounds/soft-start.wav";
import softLock from "./sounds/soft-lock.wav";
import softSuccess from "./sounds/soft-success.wav";
import softError from "./sounds/soft-error.wav";
import softCancel from "./sounds/soft-cancel.wav";
import softMilestone from "./sounds/soft-milestone.wav";

/** Murmur's own tones, made by `scripts/make-sounds.mjs`. */
export const SOUND_URLS: Record<Exclude<SoundSet, "off">, Record<SoundName, string>> = {
  subtle: { start, lock, success, error, cancel, milestone },
  soft: {
    start: softStart,
    lock: softLock,
    success: softSuccess,
    error: softError,
    cancel: softCancel,
    milestone: softMilestone,
  },
};

/** Plays a sound (DC-40). Failures are ignored: sounds are optional. */
export function playSound(name: SoundName, volume = 0.5, set: SoundSet = "subtle"): void {
  if (set === "off") return;
  const audio = new Audio(SOUND_URLS[set][name]);
  audio.volume = Math.min(1, Math.max(0, volume));
  void audio.play().catch(() => {});
}
