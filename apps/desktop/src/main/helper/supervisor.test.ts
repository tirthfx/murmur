import { PROTOCOL_VERSION } from "@murmur/shared";
import { describe, expect, it } from "vitest";
import {
  FakeClock,
  createFakeSpawner,
  createTestLogger,
  flush,
  type FakeHelperProcess,
} from "./fakes";
import { HelperSupervisor } from "./supervisor";

function setup(options: Partial<ConstructorParameters<typeof HelperSupervisor>[0]> = {}) {
  const clock = new FakeClock();
  const spawner = createFakeSpawner();
  const logger = createTestLogger();
  const supervisor = new HelperSupervisor({
    binary: { path: "/fake/murmur-helper" },
    appVersion: "9.9.9",
    spawn: spawner.spawn,
    clock,
    logger,
    ...options,
  });
  const statuses: string[] = [];
  supervisor.onStatusChange((status) => statuses.push(status.state));
  return { clock, spawner, logger, supervisor, statuses };
}

/** Plays the helper side of a successful handshake on a fake process. */
async function completeHandshake(helper: FakeHelperProcess): Promise<void> {
  helper.sendHello();
  await flush();
  const ack = helper.lastRequest("hello.ack");
  if (!ack) throw new Error("main did not send hello.ack");
  helper.respondOk(ack, { ready: true });
  await flush();
}

async function startReady() {
  const context = setup();
  const started = context.supervisor.start();
  await completeHandshake(context.spawner.processes[0]!);
  await started;
  return context;
}

describe("handshake", () => {
  it("sends hello.ack with the app's versions and becomes ready, logging the helper version", async () => {
    const { supervisor, spawner, logger } = setup();
    const started = supervisor.start();
    expect(supervisor.getStatus().state).toBe("starting");
    expect(spawner.paths).toEqual(["/fake/murmur-helper"]);

    const helper = spawner.processes[0]!;
    helper.sendHello({ helperVersion: "0.1.0" });
    await flush();
    expect(helper.lastRequest("hello.ack")).toEqual({
      id: "m-000001",
      type: "hello.ack",
      payload: { accepted: true, protocolVersion: PROTOCOL_VERSION, appVersion: "9.9.9" },
    });
    helper.respondOk(helper.lastRequest("hello.ack")!, { ready: true });

    await expect(started).resolves.toMatchObject({ helperVersion: "0.1.0", protocolVersion: 1 });
    expect(supervisor.getStatus()).toEqual({
      state: "ready",
      helperVersion: "0.1.0",
      message: null,
    });
    expect(logger.lines.some((line) => /helper ready: version 0\.1\.0/.test(line))).toBe(true);
  });

  it("treats a protocol version mismatch as an error and does not use the helper", async () => {
    const { supervisor, spawner, logger, clock } = setup();
    const started = supervisor.start();
    const rejection = expect(started).rejects.toMatchObject({ code: "PROTOCOL_VERSION_MISMATCH" });
    const helper = spawner.processes[0]!;
    helper.sendHello({ protocolVersion: PROTOCOL_VERSION + 1 });
    await flush();
    await rejection;

    expect(supervisor.getStatus().state).toBe("error");
    expect(supervisor.getStatus().message).toMatch(/Protocol version mismatch/);
    expect(logger.lines.some((line) => line.startsWith("error:") && /mismatch/.test(line))).toBe(
      true,
    );
    expect(helper.lastRequest("hello.ack")?.payload).toMatchObject({ accepted: false });
    expect(helper.killSignals).toEqual(["SIGTERM"]);

    await clock.advance(120_000);
    expect(spawner.processes).toHaveLength(1);
    await expect(supervisor.ping()).rejects.toMatchObject({ code: "HELPER_UNAVAILABLE" });
  });

  it("kills and restarts a helper that never sends hello", async () => {
    const { supervisor, spawner, clock } = setup();
    void supervisor.start().catch(() => {});
    await clock.advance(4999);
    expect(spawner.processes[0]!.killSignals).toEqual([]);
    await clock.advance(1);
    expect(spawner.processes[0]!.killSignals).toEqual(["SIGKILL"]);
    await clock.advance(500);
    expect(spawner.processes).toHaveLength(2);
  });

  it("restarts when hello.ack gets no answer within 5 seconds", async () => {
    const { supervisor, spawner, clock, logger } = setup();
    void supervisor.start().catch(() => {});
    const first = spawner.processes[0]!;
    first.sendHello();
    await flush();
    expect(first.lastRequest("hello.ack")).toBeDefined();

    await clock.advance(5000);
    expect(first.killSignals).toEqual(["SIGKILL"]);
    expect(logger.lines.some((line) => /handshake failed.*5000 ms/.test(line))).toBe(true);
    await clock.advance(500);
    expect(spawner.processes).toHaveLength(2);
  });

  it("reports a helper that exits without ever becoming ready as a restart", async () => {
    const { supervisor, spawner, clock } = setup();
    void supervisor.start().catch(() => {});
    spawner.processes[0]!.exit({ code: 1, signal: null });
    await clock.advance(500);
    expect(spawner.processes).toHaveLength(2);
  });
});

describe("request timeout and correlation", () => {
  it("rejects a request with HELPER_TIMEOUT after 5 seconds and ignores the late answer", async () => {
    const { supervisor, spawner, clock, logger } = await startReady();
    const helper = spawner.processes[0]!;
    let outcome: unknown;
    supervisor.ping().catch((error: unknown) => (outcome = error));
    const request = helper.lastRequest("ping")!;

    await clock.advance(4999);
    expect(outcome).toBeUndefined();
    await clock.advance(1);
    expect(outcome).toMatchObject({ code: "HELPER_TIMEOUT" });

    helper.respondOk(request, { uptimeMs: 1 });
    await flush();
    expect(logger.lines.some((line) => /no waiting request/.test(line))).toBe(true);
  });

  it("matches responses by id, not by order", async () => {
    const { supervisor, spawner } = await startReady();
    const helper = spawner.processes[0]!;
    const first = supervisor.ping();
    const second = supervisor.ping();
    const [firstRequest, secondRequest] = helper.received.filter((m) => m.type === "ping");
    helper.respondOk(secondRequest!, { uptimeMs: 22 });
    helper.respondOk(firstRequest!, { uptimeMs: 11 });
    await expect(first).resolves.toEqual({ uptimeMs: 11 });
    await expect(second).resolves.toEqual({ uptimeMs: 22 });
  });

  it("rejects with the helper's error code when it answers ok: false", async () => {
    const { supervisor, spawner } = await startReady();
    const helper = spawner.processes[0]!;
    const result = supervisor.ping();
    helper.respondError(helper.lastRequest("ping")!, "INTERNAL", "boom");
    await expect(result).rejects.toMatchObject({ code: "INTERNAL", message: "boom" });
  });

  it("rejects a result that does not match the request's schema", async () => {
    const { supervisor, spawner } = await startReady();
    const helper = spawner.processes[0]!;
    const result = supervisor.ping();
    helper.respondOk(helper.lastRequest("ping")!, { uptimeMs: "soon" });
    await expect(result).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("copes with partial lines, several messages per chunk, junk and unknown events", async () => {
    const { supervisor, spawner, logger } = await startReady();
    const helper = spawner.processes[0]!;
    const result = supervisor.ping();
    const id = helper.lastRequest("ping")!.id;
    const response = `{"id":"${id}","type":"response","payload":{"requestType":"ping","ok":true,"result":{"uptimeMs":7}}}\n`;
    helper.sendRaw(
      'garbage\n{"id":null,"type":"mystery","payload":{}}\n{"id":null,"type":"mystery","payload":{}}\n',
    );
    helper.sendRaw(response.slice(0, 20));
    helper.sendRaw(response.slice(20));
    await expect(result).resolves.toEqual({ uptimeMs: 7 });
    expect(
      logger.lines.filter((line) => /unknown helper event type mystery/.test(line)),
    ).toHaveLength(1);
    expect(logger.lines.some((line) => /invalid-json/.test(line))).toBe(true);
  });

  it("turns helper stderr lines into log entries", async () => {
    const { spawner, logger } = await startReady();
    spawner.processes[0]!.sendStderr("[murmur-helper] hel");
    spawner.processes[0]!.sendStderr("lo\n");
    expect(logger.lines).toContain("info: [stderr] [murmur-helper] hello");
  });
});

describe("crash and restart", () => {
  it("rejects in-flight requests with HELPER_RESTARTED and restarts after the backoff", async () => {
    const { supervisor, spawner, clock, logger, statuses } = await startReady();
    const first = spawner.processes[0]!;
    let outcome: unknown;
    supervisor.ping().catch((error: unknown) => (outcome = error));

    first.exit({ code: null, signal: "SIGKILL" });
    await flush();
    expect(outcome).toMatchObject({ code: "HELPER_RESTARTED" });
    expect(supervisor.getStatus().state).toBe("starting");
    expect(spawner.processes).toHaveLength(1);

    await clock.advance(499);
    expect(spawner.processes).toHaveLength(1);
    await clock.advance(1);
    expect(spawner.processes).toHaveLength(2);

    await completeHandshake(spawner.processes[1]!);
    expect(supervisor.getStatus().state).toBe("ready");
    expect(statuses).toEqual(["starting", "ready", "starting", "starting", "ready"]);
    expect(
      logger.lines.some((line) => /restarted: ready 500 ms after the previous exit/.test(line)),
    ).toBe(true);
  });

  it("restarts with growing backoff: 0.5 s, then 1 s, then 2 s", async () => {
    const { supervisor, spawner, clock } = setup();
    void supervisor.start().catch(() => {});
    await completeHandshake(spawner.processes[0]!);

    spawner.processes[0]!.exit();
    await clock.advance(500);
    expect(spawner.processes).toHaveLength(2);
    await completeHandshake(spawner.processes[1]!);

    spawner.processes[1]!.exit();
    await clock.advance(999);
    expect(spawner.processes).toHaveLength(2);
    await clock.advance(1);
    expect(spawner.processes).toHaveLength(3);
    await completeHandshake(spawner.processes[2]!);

    spawner.processes[2]!.exit();
    await clock.advance(1999);
    expect(spawner.processes).toHaveLength(3);
    await clock.advance(1);
    expect(spawner.processes).toHaveLength(4);
  });

  it("restarts a helper that stops answering pings after three misses", async () => {
    const { spawner, clock, logger } = await startReady();
    const first = spawner.processes[0]!;
    // Pings go out every 5 s and time out after 5 s, so each miss takes 10 s from the previous.
    await clock.advance(5000);
    expect(first.received.filter((m) => m.type === "ping")).toHaveLength(1);
    await clock.advance(5000); // first ping times out
    await clock.advance(5000); // second ping sent
    await clock.advance(5000); // second ping times out
    await clock.advance(5000); // third ping sent
    expect(first.killSignals).toEqual([]);
    await clock.advance(5000); // third ping times out
    expect(first.killSignals).toEqual(["SIGKILL"]);
    expect(logger.lines.some((line) => /stopped answering pings/.test(line))).toBe(true);
  });

  it("keeps a healthy helper alive when pings are answered", async () => {
    const { spawner, clock } = await startReady();
    const helper = spawner.processes[0]!;
    for (let i = 0; i < 4; i++) {
      await clock.advance(5000);
      helper.respondOk(helper.lastRequest("ping")!, { uptimeMs: i });
      await flush();
    }
    expect(helper.killSignals).toEqual([]);
    expect(helper.received.filter((m) => m.type === "ping")).toHaveLength(4);
  });
});

describe("restart limit", () => {
  it("stops after 3 restarts within 60 seconds and surfaces an error state", async () => {
    const { supervisor, spawner, clock, logger } = setup();
    const started = supervisor.start();
    await completeHandshake(spawner.processes[0]!);

    for (let crash = 0; crash < 3; crash++) {
      spawner.processes[crash]!.exit();
      await clock.advance(2000);
      expect(spawner.processes).toHaveLength(crash + 2);
      await completeHandshake(spawner.processes[crash + 1]!);
    }
    expect(supervisor.getStatus().state).toBe("ready");

    spawner.processes[3]!.exit();
    await flush();
    expect(supervisor.getStatus().state).toBe("error");
    expect(supervisor.getStatus().message).toMatch(/3 restarts in 60 seconds/);
    expect(logger.lines.some((line) => line.startsWith("error:") && /giving up/.test(line))).toBe(
      true,
    );

    await clock.advance(300_000);
    expect(spawner.processes).toHaveLength(4);
    await expect(supervisor.ping()).rejects.toMatchObject({ code: "HELPER_UNAVAILABLE" });
    // The first start succeeded, so its promise settled long before the limit was hit.
    await expect(started).resolves.toBeDefined();
  });

  it("rejects start() when the helper keeps crashing before it is ready", async () => {
    const { supervisor, spawner, clock } = setup();
    const started = supervisor.start();
    const rejection = expect(started).rejects.toMatchObject({ code: "HELPER_UNAVAILABLE" });
    for (let crash = 0; crash < 3; crash++) {
      spawner.processes[crash]!.exit();
      await clock.advance(2000);
    }
    spawner.processes[3]!.exit();
    await flush();
    await rejection;
    expect(supervisor.getStatus().state).toBe("error");
  });

  it("forgets restarts older than the window", async () => {
    const { supervisor, spawner, clock } = setup({ restartWindowMs: 10_000 });
    void supervisor.start().catch(() => {});
    await completeHandshake(spawner.processes[0]!);
    // One crash every ~6 s: never more than 2 inside the 10 s window, so the budget holds.
    for (let crash = 0; crash < 6; crash++) {
      spawner.processes[crash]!.exit();
      await clock.advance(2000);
      expect(supervisor.getStatus().state).toBe("starting");
      await completeHandshake(spawner.processes[crash + 1]!);
      expect(supervisor.getStatus().state).toBe("ready");
      await clock.advance(4000);
    }
    expect(spawner.processes).toHaveLength(7);
  });
});

describe("clean shutdown", () => {
  it("sends shutdown, waits for the exit and does not restart", async () => {
    const { supervisor, spawner, clock } = await startReady();
    const helper = spawner.processes[0]!;
    let done = false;
    const shutdown = supervisor.shutdown("app-quit").then(() => (done = true));
    await flush();
    expect(helper.lastRequest("shutdown")?.payload).toEqual({ reason: "app-quit" });
    expect(done).toBe(false);

    helper.respondOk(helper.lastRequest("shutdown")!);
    helper.exit({ code: 0, signal: null });
    await shutdown;
    expect(supervisor.getStatus().state).toBe("stopped");
    expect(helper.killSignals).toEqual([]);

    await clock.advance(120_000);
    expect(spawner.processes).toHaveLength(1);
    expect(clock.pendingTimers).toBe(0);
  });

  it("kills a helper that ignores shutdown after the grace period", async () => {
    const { supervisor, spawner, clock } = await startReady();
    const helper = spawner.processes[0]!;
    let done = false;
    const shutdown = supervisor.shutdown("app-quit").then(() => (done = true));
    await clock.advance(1999);
    expect(helper.killSignals).toEqual([]);
    await clock.advance(1);
    expect(helper.killSignals).toEqual(["SIGKILL"]);
    await shutdown;
    expect(done).toBe(true);
    expect(supervisor.getStatus().state).toBe("stopped");
  });

  it("cancels a pending restart", async () => {
    const { supervisor, spawner, clock } = await startReady();
    spawner.processes[0]!.exit();
    await flush();
    await supervisor.shutdown("app-quit");
    await clock.advance(60_000);
    expect(spawner.processes).toHaveLength(1);
    expect(supervisor.getStatus().state).toBe("stopped");
  });

  it("stops a helper that is still starting", async () => {
    const { supervisor, spawner } = setup();
    void supervisor.start().catch(() => {});
    await supervisor.shutdown("app-quit");
    expect(spawner.processes[0]!.killSignals).toEqual(["SIGTERM"]);
    expect(supervisor.getStatus().state).toBe("stopped");
  });

  it("terminate() kills at once", async () => {
    const { supervisor, spawner } = await startReady();
    supervisor.terminate();
    expect(spawner.processes[0]!.killSignals).toEqual(["SIGKILL"]);
  });
});

describe("unavailable helper", () => {
  it("reports unavailable with a clear message and never spawns", async () => {
    const { supervisor, spawner } = setup({
      binary: { path: null, message: "The helper has not been built." },
    });
    await expect(supervisor.start()).rejects.toMatchObject({ code: "HELPER_UNAVAILABLE" });
    expect(supervisor.getStatus()).toEqual({
      state: "unavailable",
      helperVersion: null,
      message: "The helper has not been built.",
    });
    expect(spawner.processes).toHaveLength(0);
    await supervisor.shutdown("app-quit");
    expect(supervisor.getStatus().state).toBe("unavailable");
  });
});

describe("spawn failure", () => {
  it("treats a spawn that throws like a crash and retries under the budget", async () => {
    let attempts = 0;
    const { supervisor, clock } = setup({
      spawn: () => {
        attempts += 1;
        throw new Error("spawn failed");
      },
    });
    const started = supervisor.start();
    const rejection = expect(started).rejects.toMatchObject({ code: "HELPER_UNAVAILABLE" });
    await clock.advance(60_000);
    await rejection;
    expect(attempts).toBe(4);
    expect(supervisor.getStatus().state).toBe("error");
  });
});
