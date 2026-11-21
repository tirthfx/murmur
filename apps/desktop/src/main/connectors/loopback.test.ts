import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { startLoopback } from "./loopback";

const get = (url: string) =>
  fetch(url).then(async (r) => ({ status: r.status, text: await r.text() }));

describe("loopback redirect listener (CN-01)", () => {
  it("listens on 127.0.0.1 and gives the code when the state matches, then closes", async () => {
    const loopback = await startLoopback({ port: 0, path: "/callback" });
    expect(loopback.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const result = loopback.wait("state-1");
    const reply = await get(`${loopback.redirectUri}?code=abc&state=state-1`);
    expect(reply.status).toBe(200);
    expect(reply.text).toContain("close this tab");
    await expect(result).resolves.toEqual({ ok: true, code: "abc" });
    // One request: the listener is gone.
    await expect(get(`${loopback.redirectUri}?code=abc&state=state-1`)).rejects.toThrow();
  });

  it("refuses an answer with another state", async () => {
    const loopback = await startLoopback({ port: 0, path: "/callback" });
    const result = loopback.wait("right");
    const reply = await get(`${loopback.redirectUri}?code=abc&state=wrong`);
    expect(reply.status).toBe(400);
    await expect(result).resolves.toMatchObject({ ok: false, reason: "state" });
  });

  it("reports a denied sign-in and a missing code", async () => {
    const denied = await startLoopback({ port: 0, path: "/callback" });
    const first = denied.wait("s");
    await get(`${denied.redirectUri}?error=access_denied&state=s`);
    await expect(first).resolves.toMatchObject({
      ok: false,
      reason: "denied",
      message: "The sign-in was not allowed.",
    });
    const empty = await startLoopback({ port: 0, path: "/callback" });
    const second = empty.wait("s");
    await get(`${empty.redirectUri}?state=s`);
    await expect(second).resolves.toMatchObject({ ok: false, reason: "denied" });
  });

  it("gives the provider's own reason when it sends one, such as an administrator's consent", async () => {
    const loopback = await startLoopback({ port: 0, path: "/callback" });
    const result = loopback.wait("s");
    await get(
      `${loopback.redirectUri}?error=access_denied&state=s&error_description=${encodeURIComponent("AADSTS90094: The grant requires administrator permission.")}`,
    );
    await expect(result).resolves.toEqual({
      ok: false,
      reason: "denied",
      message:
        "The provider refused the sign-in: AADSTS90094: The grant requires administrator permission.",
    });
  });

  it("can name localhost in the redirect while it listens on 127.0.0.1", async () => {
    const loopback = await startLoopback({ port: 0, path: "/callback", redirectHost: "localhost" });
    expect(loopback.redirectUri).toMatch(/^http:\/\/localhost:\d+\/callback$/);
    const result = loopback.wait("s");
    const port = new URL(loopback.redirectUri).port;
    await get(`http://127.0.0.1:${port}/callback?code=c&state=s`);
    await expect(result).resolves.toEqual({ ok: true, code: "c" });
  });

  it("ignores other paths and methods while it waits", async () => {
    const loopback = await startLoopback({ port: 0, path: "/callback" });
    const origin = new URL(loopback.redirectUri).origin;
    const result = loopback.wait("s");
    expect((await get(`${origin}/favicon.ico`)).status).toBe(404);
    expect((await fetch(loopback.redirectUri, { method: "POST" })).status).toBe(404);
    await get(`${loopback.redirectUri}?code=c&state=s`);
    await expect(result).resolves.toEqual({ ok: true, code: "c" });
  });

  it("gives up after the timeout, and when it is closed", async () => {
    const slow = await startLoopback({ port: 0, path: "/callback", timeoutMs: 20 });
    await expect(slow.wait("s")).resolves.toMatchObject({ ok: false, reason: "timeout" });
    const closed = await startLoopback({ port: 0, path: "/callback" });
    const waiting = closed.wait("s");
    closed.close();
    await expect(waiting).resolves.toMatchObject({ ok: false, reason: "cancelled" });
  });

  it("says so when a fixed port is taken", async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve));
    const { port } = taken.address() as { port: number };
    await expect(startLoopback({ port, path: "/callback" })).rejects.toThrow(/is in use/);
    taken.close();
  });

  it("can use a fixed port", async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const { port } = probe.address() as { port: number };
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const loopback = await startLoopback({ port, path: "/slack/callback" });
    expect(loopback.redirectUri).toBe(`http://127.0.0.1:${port}/slack/callback`);
    loopback.close();
  });
});
