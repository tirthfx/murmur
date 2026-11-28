/**
 * A sliding window of calls per client (CN-11: 60 a minute). `check` records the call when it is
 * allowed; when it is not, it says how long until one would be.
 */
export interface RateLimiter {
  check(client: string): { ok: true } | { ok: false; retryAfterMs: number };
}

export function createRateLimiter(deps: {
  limit(): number;
  windowMs?: number;
  now(): number;
}): RateLimiter {
  const windowMs = deps.windowMs ?? 60_000;
  const calls = new Map<string, number[]>();
  return {
    check(client) {
      const now = deps.now();
      const recent = (calls.get(client) ?? []).filter((at) => now - at < windowMs);
      if (recent.length >= deps.limit()) {
        calls.set(client, recent);
        return { ok: false, retryAfterMs: Math.max(1, recent[0]! + windowMs - now) };
      }
      recent.push(now);
      calls.set(client, recent);
      return { ok: true };
    },
  };
}
