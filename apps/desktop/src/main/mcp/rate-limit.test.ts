import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("rate limiter (CN-11)", () => {
  it("allows the limit in a minute, then says how long to wait", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: () => 3, now: () => now });
    for (let i = 0; i < 3; i++) {
      expect(limiter.check("a")).toEqual({ ok: true });
      now += 1_000;
    }
    expect(limiter.check("a")).toEqual({ ok: false, retryAfterMs: 57_000 });
    now = 60_000;
    expect(limiter.check("a")).toEqual({ ok: true });
  });

  it("counts each client alone, and takes a new limit at once", () => {
    let limit = 1;
    const limiter = createRateLimiter({ limit: () => limit, now: () => 0 });
    expect(limiter.check("a")).toEqual({ ok: true });
    expect(limiter.check("b")).toEqual({ ok: true });
    expect(limiter.check("a").ok).toBe(false);
    limit = 2;
    expect(limiter.check("a")).toEqual({ ok: true });
    limiter.forget("a");
    expect(limiter.check("a")).toEqual({ ok: true });
  });
});
