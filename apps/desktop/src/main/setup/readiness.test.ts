import { describe, expect, it } from "vitest";
import { blockerMessage, type PermissionSnapshot } from "@murmur/shared";
import { dictationBlockers, hasPermissionBlocker } from "./readiness";

const granted: PermissionSnapshot = {
  microphone: "granted",
  accessibility: "granted",
  inputMonitoring: "granted",
  screenRecording: "unknown",
};

describe("dictation readiness", () => {
  it("has no blockers when everything is in place", () => {
    const blockers = dictationBlockers({ helper: "ready", permissions: granted, speech: "ready" });
    expect(blockers).toEqual([]);
    expect(blockerMessage(blockers)).toBeNull();
  });

  it("lists each missing permission and the model", () => {
    const blockers = dictationBlockers({
      helper: "ready",
      permissions: { ...granted, microphone: "not_determined", inputMonitoring: "denied" },
      speech: "missing",
    });
    expect(blockers).toEqual(["microphone", "inputMonitoring", "speechModel"]);
    expect(hasPermissionBlocker(blockers)).toBe(true);
    expect(blockerMessage(blockers)).toBe(
      "Open Murmur to finish setup: microphone access is not granted (and 2 more)",
    );
  });

  it("does not need Screen Recording", () => {
    expect(
      dictationBlockers({
        helper: "ready",
        permissions: { ...granted, screenRecording: "denied" },
        speech: "ready",
      }),
    ).toEqual([]);
  });

  it("does not block on a status that cannot be read", () => {
    expect(
      dictationBlockers({
        helper: "ready",
        permissions: { ...granted, accessibility: "unknown" },
        speech: "ready",
      }),
    ).toEqual([]);
    expect(dictationBlockers({ helper: "ready", permissions: null, speech: "ready" })).toEqual([]);
  });

  it("reports a stopped helper and a model that is still loading", () => {
    const blockers = dictationBlockers({
      helper: "unavailable",
      permissions: granted,
      speech: "loading",
    });
    expect(blockers).toEqual(["helper", "speechModel"]);
    expect(hasPermissionBlocker(blockers)).toBe(false);
    expect(blockerMessage(["speechModel"])).toBe(
      "Open Murmur to finish setup: the speech model is not ready",
    );
  });
});
