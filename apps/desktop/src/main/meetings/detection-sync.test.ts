import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DETECT, DEFAULT_MEETING_MATCHERS, type DetectSettings } from "@murmur/shared";
import { createDetectionSync } from "./detection-sync";

function setup(initial: Partial<DetectSettings> = {}, ready = true) {
  let settings: DetectSettings = { ...DEFAULT_DETECT, ...initial };
  let up = ready;
  const watch = vi.fn(async () => {});
  const stopped = vi.fn();
  const sync = createDetectionSync({
    matchers: () => DEFAULT_MEETING_MATCHERS,
    settings: () => settings,
    helperReady: () => up,
    watch,
    stopped,
    logger: { info() {}, warn() {}, error() {} },
  });
  return {
    sync: () => sync.sync(),
    watch,
    stopped,
    change: (next: Partial<DetectSettings>) => (settings = { ...settings, ...next }),
    helper: (next: boolean) => (up = next),
  };
}

describe("detection sync", () => {
  it("with detection off, the helper gets no detect.subscribe at all", () => {
    const t = setup({ enabled: false });
    t.sync();
    t.sync();
    expect(t.watch).not.toHaveBeenCalled();
    expect(t.stopped).not.toHaveBeenCalled();
  });

  it("does not send before the helper is ready, then sends once", () => {
    const t = setup({}, false);
    t.sync();
    expect(t.watch).not.toHaveBeenCalled();
    t.helper(true);
    t.sync();
    t.sync();
    expect(t.watch).toHaveBeenCalledTimes(1);
    expect(t.watch).toHaveBeenCalledWith({ enabled: true, matchers: DEFAULT_MEETING_MATCHERS });
  });

  it("sends only the apps that are on and not set to never, and again when that changes", () => {
    const t = setup({ apps: { zoom: false, meet: true, teams: true }, neverApps: ["teams"] });
    t.sync();
    expect(t.watch).toHaveBeenLastCalledWith({
      enabled: true,
      matchers: [DEFAULT_MEETING_MATCHERS[1]],
    });
    t.change({ neverApps: [] });
    t.sync();
    expect(t.watch).toHaveBeenCalledTimes(2);
  });

  it("stops the helper after a start when detection is turned off, and only then", () => {
    const t = setup();
    t.sync();
    t.change({ enabled: false });
    t.sync();
    expect(t.stopped).toHaveBeenCalledTimes(1);
    expect(t.watch).toHaveBeenLastCalledWith({ enabled: false, matchers: [] });
    t.sync();
    expect(t.watch).toHaveBeenCalledTimes(2);
  });

  it("tells a restarted helper again, without sending a stop to a helper that is gone", () => {
    const t = setup();
    t.sync();
    t.helper(false);
    t.sync();
    expect(t.stopped).toHaveBeenCalledTimes(1);
    expect(t.watch).toHaveBeenCalledTimes(1);
    t.helper(true);
    t.sync();
    expect(t.watch).toHaveBeenCalledTimes(2);
  });

  it("with every app off, nothing is sent", () => {
    const t = setup({ apps: { zoom: false, meet: false, teams: false } });
    t.sync();
    expect(t.watch).not.toHaveBeenCalled();
  });
});
