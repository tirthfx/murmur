import type { PlatformHelper, Settings, SoundName } from "@murmur/shared";
import type { Logger } from "../helper/types";

/** The start sound is 140 ms; recording waits for it so it is never in the audio (DC-40). */
export const START_SOUND_WAIT_MS = 170;

/** A tiny file that exists only while Murmur holds the output muted (crash recovery). */
export interface MarkerFile {
  exists(): boolean;
  write(content: string): void;
  remove(): void;
}

export interface SessionEffectsDeps {
  settings: () => Settings;
  playSound: (name: SoundName) => void;
  helper: Pick<PlatformHelper, "getOutputMuted" | "setOutputMuted">;
  marker: MarkerFile;
  sleep: (ms: number) => Promise<void>;
  logger: Logger;
}

export interface SessionEffects {
  /** Before the microphone starts: start sound, then mute if asked. */
  beforeStart(): Promise<void>;
  /** After the recording ends for any reason: restore the output if Murmur muted it. */
  afterEnd(): Promise<void>;
  /** Plays a sound if it is turned on. */
  sound(name: SoundName): void;
  /** On launch and helper restart: undo a mute left behind by a crash. */
  recover(): Promise<void>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSessionEffects(deps: SessionEffectsDeps): SessionEffects {
  const { helper, marker, logger } = deps;
  let mutedByUs = false;

  function sound(name: SoundName): void {
    if (!deps.settings().sounds[name]) return;
    // While the output is muted a sound would be silent anyway.
    if (mutedByUs && name === "lock") return;
    deps.playSound(name);
  }

  async function unmute(reason: string): Promise<void> {
    try {
      await helper.setOutputMuted(false);
      marker.remove();
      logger.info(`output restored (${reason})`);
    } catch (error) {
      logger.warn(`could not restore the output (${reason}): ${message(error)}`);
    }
  }

  return {
    sound,
    async beforeStart() {
      const settings = deps.settings();
      if (settings.sounds.start) {
        deps.playSound("start");
        await deps.sleep(START_SOUND_WAIT_MS);
      }
      if (!settings.muteWhileDictating || mutedByUs) return;
      try {
        const muted = await helper.getOutputMuted();
        // Already muted, or no mute switch: leave it exactly as it is.
        if (muted !== false) return;
        // Written before muting, so a crash in between still gets the output back.
        marker.write(JSON.stringify({ restoreMuted: false }));
        await helper.setOutputMuted(true);
        mutedByUs = true;
      } catch (error) {
        logger.warn(`could not mute the output: ${message(error)}`);
        if (!mutedByUs) marker.remove();
      }
    },
    async afterEnd() {
      if (!mutedByUs) return;
      mutedByUs = false;
      await unmute("dictation ended");
    },
    async recover() {
      if (mutedByUs || !marker.exists()) return;
      await unmute("left muted by an earlier run");
    },
  };
}
