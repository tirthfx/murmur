import { describe, expect, it } from "vitest";
import type { PermissionSnapshot } from "@murmur/shared";
import {
  FakeClock,
  createFakeSpawner,
  createTestLogger,
  flush,
  type FakeHelperProcess,
} from "./helper/fakes";
import { HelperSupervisor } from "./helper/supervisor";
import { createHotkeyService } from "./hotkeys";
import { MAC_DEFAULT_HOTKEY_BINDINGS } from "./platform/mac-hotkeys";

const statuses = (inputMonitoring: PermissionSnapshot["inputMonitoring"]): PermissionSnapshot => ({
  microphone: "granted",
  accessibility: "granted",
  inputMonitoring,
  screenRecording: "unknown",
});

async function completeHandshake(helper: FakeHelperProcess): Promise<void> {
  helper.sendHello();
  await flush();
  helper.respondOk(helper.lastRequest("hello.ack")!, { ready: true });
  await flush();
}

function setup(bindings = MAC_DEFAULT_HOTKEY_BINDINGS) {
  const clock = new FakeClock();
  const spawner = createFakeSpawner();
  const helper = new HelperSupervisor({
    binary: { path: "/fake/murmur-helper" },
    appVersion: "9.9.9",
    spawn: spawner.spawn,
    clock,
    logger: createTestLogger(),
  });
  const logger = createTestLogger();
  let now = 1_000_000;
  const service = createHotkeyService({ helper, bindings, logger, now: () => now });
  return {
    clock,
    spawner,
    helper,
    logger,
    service,
    setNow: (value: number) => {
      now = value;
    },
  };
}

/** Starts the service and the helper, and returns the first configure request. */
async function startConfiguring(context: ReturnType<typeof setup>) {
  context.service.start();
  void context.helper.start().catch(() => {});
  const proc = context.spawner.processes[0]!;
  await completeHandshake(proc);
  const request = proc.lastRequest("hotkey.configure");
  if (!request) throw new Error("no hotkey.configure was sent");
  return { proc, request };
}

describe("hotkey service", () => {
  it("configures the default binding when the helper becomes ready", async () => {
    const context = setup();
    const { proc, request } = await startConfiguring(context);
    expect(request.payload).toEqual({
      bindings: [
        {
          id: "dictate-hold",
          action: "dictate.hold",
          trigger: { type: "key", keyCode: 61, modifiers: [] },
          mode: "hold",
        },
      ],
    });
    expect(context.service.getState()).toBe("configuring");
    proc.respondOk(request, { registered: ["dictate-hold"], rejected: [] });
    await flush();
    expect(context.service.getState()).toBe("active");
    expect(context.logger.lines).toContain("info: registered: dictate-hold");
  });

  it("logs each key event with its latency and nothing more", async () => {
    const context = setup();
    const { proc, request } = await startConfiguring(context);
    proc.respondOk(request, { registered: ["dictate-hold"], rejected: [] });
    await flush();
    context.setNow(5_012);
    proc.send({
      id: null,
      type: "hotkey.event",
      payload: { bindingId: "dictate-hold", action: "dictate.hold", state: "down", at: 5_000 },
    });
    expect(context.logger.lines).toContain("info: dictate-hold down at=5000 latency=12ms");
  });

  it("logs rejected bindings", async () => {
    const context = setup();
    const { proc, request } = await startConfiguring(context);
    proc.respondOk(request, {
      registered: ["dictate-hold"],
      rejected: [
        { id: "x", code: "CONFLICT", message: "Another binding already uses this trigger" },
      ],
    });
    await flush();
    expect(context.logger.lines).toContain(
      "warn: binding x rejected (CONFLICT): Another binding already uses this trigger",
    );
  });

  it("waits for Input Monitoring without asking for it, then retries once a check shows it granted", async () => {
    const context = setup();
    const { proc, request } = await startConfiguring(context);
    proc.respondError(
      request,
      "PERMISSION_DENIED",
      "inputMonitoring: Input Monitoring is not granted",
    );
    await flush();
    expect(context.service.getState()).toBe("needs_permission");
    expect(proc.received.some((message) => message.type === "permissions.request")).toBe(false);

    const configureCount = () =>
      proc.received.filter((message) => message.type === "hotkey.configure").length;
    context.service.handlePermissions(statuses("denied"));
    expect(configureCount()).toBe(1);

    context.service.handlePermissions(statuses("granted"));
    await flush();
    expect(configureCount()).toBe(2);
    proc.respondOk(proc.lastRequest("hotkey.configure")!, {
      registered: ["dictate-hold"],
      rejected: [],
    });
    await flush();
    expect(context.service.getState()).toBe("active");
  });

  it("does not retry on a granted check when it is not waiting for the permission", async () => {
    const context = setup();
    const { proc, request } = await startConfiguring(context);
    proc.respondOk(request, { registered: ["dictate-hold"], rejected: [] });
    await flush();
    context.service.handlePermissions(statuses("granted"));
    await flush();
    expect(proc.received.filter((message) => message.type === "hotkey.configure")).toHaveLength(1);
  });

  it("configures again after a helper restart and ignores the old attempt's reply", async () => {
    const context = setup();
    const { proc: first, request: firstRequest } = await startConfiguring(context);
    first.exit();
    await flush();
    expect(context.service.getState()).toBe("off");

    await context.clock.advance(500);
    const second = context.spawner.processes[1]!;
    await completeHandshake(second);
    const secondRequest = second.lastRequest("hotkey.configure");
    expect(secondRequest).toBeDefined();

    // A late reply on the dead process changes nothing.
    first.respondError(firstRequest, "PERMISSION_DENIED");
    await flush();
    expect(context.service.getState()).toBe("configuring");

    second.respondOk(secondRequest!, { registered: ["dictate-hold"], rejected: [] });
    await flush();
    expect(context.service.getState()).toBe("active");
  });

  it("tells the owner to rebuild a helper that has no hotkey support", async () => {
    const context = setup();
    const { proc, request } = await startConfiguring(context);
    proc.respondError(request, "UNSUPPORTED_REQUEST", "Unknown request type");
    await flush();
    expect(context.service.getState()).toBe("failed");
    expect(context.logger.lines.join("\n")).toContain("npm run build:helper");
  });

  it("warns when macOS turns the key listener off", async () => {
    const context = setup();
    const { proc } = await startConfiguring(context);
    proc.send({ id: null, type: "hotkey.tap.status", payload: { state: "disabled_by_system" } });
    expect(context.logger.lines).toContain(
      "warn: macOS turned the key listener off; held keys were released",
    );
  });

  it("sends nothing when the platform has no bindings, and stops listening on stop", async () => {
    const context = setup([]);
    context.service.start();
    void context.helper.start().catch(() => {});
    const proc = context.spawner.processes[0]!;
    await completeHandshake(proc);
    expect(proc.lastRequest("hotkey.configure")).toBeUndefined();
    expect(context.service.getState()).toBe("off");

    context.service.stop();
    proc.send({
      id: null,
      type: "hotkey.event",
      payload: { bindingId: "dictate-hold", action: "dictate.hold", state: "down", at: 1 },
    });
    expect(context.logger.lines.some((line) => line.includes("dictate-hold down"))).toBe(false);
  });
});

describe("hotkey service events", () => {
  it("passes key events to subscribers", async () => {
    const context = setup();
    const seen: string[] = [];
    context.service.onEvent((event) => seen.push(`${event.bindingId} ${event.state}`));
    const { proc } = await startConfiguring(context);
    proc.send({
      id: null,
      type: "hotkey.event",
      payload: { bindingId: "dictate-hold", action: "dictate.hold", state: "down", at: 5 },
    });
    expect(seen).toEqual(["dictate-hold down"]);
  });
});

describe("hotkey service live changes", () => {
  it("sends new bindings at once, and none while paused", async () => {
    const context = setup();
    const { proc, request } = await startConfiguring(context);
    proc.respondOk(request, { registered: ["dictate-hold"], rejected: [] });
    await flush();
    const chord = {
      id: "dictate-toggle",
      action: "dictate.toggle" as const,
      trigger: { type: "key" as const, keyCode: 2, modifiers: ["control" as const] },
      mode: "press" as const,
    };
    context.service.setBindings([...MAC_DEFAULT_HOTKEY_BINDINGS, chord]);
    expect((proc.lastRequest("hotkey.configure")!.payload.bindings as unknown[]).length).toBe(2);
    context.service.setPaused(true);
    expect(proc.lastRequest("hotkey.configure")!.payload).toEqual({ bindings: [] });
    context.service.setPaused(false);
    expect((proc.lastRequest("hotkey.configure")!.payload.bindings as unknown[]).length).toBe(2);
  });
});
