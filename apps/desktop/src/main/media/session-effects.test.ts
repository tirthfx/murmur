import { describe, expect, it, vi } from "vitest";
import type { Settings } from "@murmur/shared";
import { createTestLogger } from "../helper/fakes";
import { HelperError } from "../helper/types";
import { createSessionEffects, START_SOUND_WAIT_MS, type MarkerFile } from "./session-effects";

const base: Settings = {
  holdShortcut: { type: "key", keyCode: 61, modifiers: [] },
  handsFreeShortcut: null,
  inputDevice: "auto",
  language: "auto",
  cleanupLevel: "standard",
  sounds: { start: true, lock: true, success: true, error: true, cancel: false },
  muteWhileDictating: true,
  setupComplete: true,
  pressEnterCommand: true,
  contextAwareness: true,
  mouseButtons: { hold: null, handsFree: null },
  typingReminder: { enabled: true, snoozedUntil: null },
  whisperMode: false,
};

function setup(
  options: { muted?: boolean | null; settings?: Partial<Settings>; markerThere?: boolean } = {},
) {
  let outputMuted: boolean | null = options.muted === undefined ? false : options.muted;
  let markerThere = options.markerThere ?? false;
  const steps: string[] = [];
  const marker: MarkerFile = {
    exists: () => markerThere,
    write: () => {
      markerThere = true;
      steps.push("marker written");
    },
    remove: () => {
      if (markerThere) steps.push("marker removed");
      markerThere = false;
    },
  };
  const helper = {
    getOutputMuted: vi.fn(async () => outputMuted),
    setOutputMuted: vi.fn(async (muted: boolean) => {
      const previous = outputMuted ?? false;
      outputMuted = muted;
      steps.push(muted ? "muted" : "unmuted");
      return previous;
    }),
  };
  const effects = createSessionEffects({
    settings: () => ({ ...base, ...options.settings }),
    playSound: (name) => steps.push(`sound ${name}`),
    helper,
    marker,
    sleep: async (ms) => {
      steps.push(`wait ${ms}`);
    },
    logger: createTestLogger(),
  });
  return { effects, steps, helper, output: () => outputMuted, markerThere: () => markerThere };
}

describe("session effects", () => {
  it("plays the start sound and waits for it before muting, then restores at the end", async () => {
    const { effects, steps, output, markerThere } = setup();
    await effects.beforeStart();
    expect(output()).toBe(true);
    await effects.afterEnd();
    expect(steps).toEqual([
      `sound start`,
      `wait ${START_SOUND_WAIT_MS}`,
      "marker written",
      "muted",
      "unmuted",
      "marker removed",
    ]);
    expect(output()).toBe(false);
    expect(markerThere()).toBe(false);
  });

  it("leaves an output that was already muted alone", async () => {
    const { effects, helper, output } = setup({ muted: true });
    await effects.beforeStart();
    await effects.afterEnd();
    expect(helper.setOutputMuted).not.toHaveBeenCalled();
    expect(output()).toBe(true);
  });

  it("does nothing to the output when the setting is off or there is no mute switch", async () => {
    const off = setup({ settings: { muteWhileDictating: false } });
    await off.effects.beforeStart();
    expect(off.helper.getOutputMuted).not.toHaveBeenCalled();
    const none = setup({ muted: null });
    await none.effects.beforeStart();
    expect(none.helper.setOutputMuted).not.toHaveBeenCalled();
  });

  it("restores the output on the next launch after a crash while muted", async () => {
    const { effects, steps, output } = setup({ muted: true, markerThere: true });
    await effects.recover();
    expect(output()).toBe(false);
    expect(steps).toEqual(["unmuted", "marker removed"]);
    await effects.recover();
    expect(steps).toHaveLength(2);
  });

  it("removes the marker again if muting fails", async () => {
    const { effects, helper, markerThere } = setup();
    helper.setOutputMuted.mockRejectedValueOnce(new HelperError("AUDIO_ENGINE_FAILED", "no"));
    await effects.beforeStart();
    expect(markerThere()).toBe(false);
  });

  it("skips the start sound and its wait when turned off, and honours each sound's switch", async () => {
    const { effects, steps } = setup({
      settings: {
        muteWhileDictating: false,
        setupComplete: true,
        pressEnterCommand: true,
        contextAwareness: true,
        mouseButtons: { hold: null, handsFree: null },
        typingReminder: { enabled: true, snoozedUntil: null },
        whisperMode: false,
        sounds: { start: false, lock: true, success: true, error: false, cancel: false },
      },
    });
    await effects.beforeStart();
    effects.sound("success");
    effects.sound("error");
    effects.sound("cancel");
    expect(steps).toEqual(["sound success"]);
  });
});
