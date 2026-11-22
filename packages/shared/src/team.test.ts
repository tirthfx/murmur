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

describe("the team client's error set (SW-08)", () => {
  it("maps each status of the local server to one error", async () => {
    const { teamClientErrorFor, TEAM_CLIENT_ERRORS } = await import("./team-client");
    expect(TEAM_CLIENT_ERRORS).toEqual([
      "unauthorized",
      "forbidden",
      "not_found",
      "conflict",
      "invalid",
      "rate_limited",
      "offline",
      "refused",
      "server",
    ]);
    expect(teamClientErrorFor(401)).toBe("unauthorized");
    expect(teamClientErrorFor(403)).toBe("forbidden");
    expect(teamClientErrorFor(404)).toBe("not_found");
    expect(teamClientErrorFor(409)).toBe("conflict");
    expect(teamClientErrorFor(400)).toBe("invalid");
    expect(teamClientErrorFor(415)).toBe("invalid");
    expect(teamClientErrorFor(429)).toBe("rate_limited");
    expect(teamClientErrorFor(400, "delayed")).toBe("rate_limited");
    expect(teamClientErrorFor(500)).toBe("server");
    expect(teamClientErrorFor(503)).toBe("server");
  });
});
