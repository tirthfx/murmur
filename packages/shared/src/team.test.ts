import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "./ipc";
import {
  isLockedChannel,
  teamConnectSchema,
  teamRedeemSchema,
  teamSetupSchema,
  TEAM_LIMITS,
} from "./team";

describe("what a locked Murmur refuses", () => {
  it("is every channel that shows a meeting, a question, a brief or a task, except starting and stopping", () => {
    const refused = Object.entries(IPC_CHANNELS)
      .filter(([, channel]) => isLockedChannel(channel))
      .map(([name]) => name);
    for (const name of [
      "meetingsList",
      "meetingDetail",
      "meetingRecording",
      "meetingExport",
      "meetingRecap",
      "askThreads",
      "askSend",
      "briefGet",
      "tasksList",
    ])
      expect(refused, name).toContain(name);
    for (const name of ["meetingStart", "meetingStop"]) expect(refused, name).not.toContain(name);
  });

  it("leaves the lock screen, settings and dictation alone", () => {
    for (const channel of [
      IPC_CHANNELS.teamUnlock,
      IPC_CHANNELS.teamView,
      IPC_CHANNELS.getSettings,
      IPC_CHANNELS.getAppInfo,
    ])
      expect(isLockedChannel(channel), channel).toBe(false);
  });
});

describe("team inputs", () => {
  it("are trimmed and limited", () => {
    expect(teamConnectSchema.parse({ serverUrl: "  http://x  " }).serverUrl).toBe("http://x");
    expect(teamConnectSchema.safeParse({ serverUrl: "" }).success).toBe(false);
    expect(teamSetupSchema.safeParse({ name: "A", email: "a@b.co", password: "p" }).success).toBe(
      true,
    );
    expect(teamSetupSchema.safeParse({ name: "", email: "a@b.co", password: "p" }).success).toBe(
      false,
    );
    expect(teamRedeemSchema.safeParse({ code: "inv_1" }).success).toBe(true);
    expect(teamRedeemSchema.safeParse({ code: "inv_1", extra: 1 }).success).toBe(false);
    expect(TEAM_LIMITS.idleLockMinutes.default).toBe(15);
  });
});
