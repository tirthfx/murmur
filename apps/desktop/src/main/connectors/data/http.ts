/** A request with the account's token (the connector service renews it); tests pass a fake. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A read connector could not read: the message is plain words for the Connectors page. */
export class ReadError extends Error {}

export interface RateLimitOptions {
  sleep(ms: number): Promise<void>;
  /** How many times a busy answer is waited out and asked again. */
  maxRetries?: number;
  /** The longest single wait; a provider that asks for more is treated as busy. */
  maxWaitMs?: number;
}

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One request that waits out a rate limit: on a busy answer (429, or GitHub's 403 with a
 * `Retry-After`) it waits as long as the provider asked (`Retry-After`, in seconds) and asks again,
 * a few times, so a read is not lost to a short limit.
 */
export async function requestWithRetry(
  fetch: Fetch,
  url: string,
  init: RequestInit | undefined,
  options: RateLimitOptions,
  name: string,
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3;
  const maxWait = options.maxWaitMs ?? 30_000;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, init);
    const retryAfter = response.headers.get("retry-after");
    const busy = response.status === 429 || (response.status === 403 && retryAfter !== null);
    if (!busy) return response;
    await response.body?.cancel().catch(() => undefined);
    const seconds = Number(retryAfter ?? "1");
    const wait = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 1000;
    if (attempt >= maxRetries || wait > maxWait)
      throw new ReadError(`${name} is busy just now. Try again in a few minutes.`);
    await options.sleep(wait);
  }
}

/** The text of an answer as JSON, or null when it is not. */
export const jsonOf = (response: Response): Promise<unknown> =>
  response.json().catch(() => null) as Promise<unknown>;

/** A string cut to `max` characters, on one line when `oneLine`. */
export function clip(text: string, max: number, oneLine = false): string {
  const value = oneLine ? text.replace(/\s+/g, " ") : text;
  return value.trim().slice(0, max);
}

/** The time of a date text as milliseconds, or 0 when it cannot be read. */
export function timeOf(text: string | undefined | null): number {
  const at = text ? Date.parse(text) : Number.NaN;
  return Number.isNaN(at) ? 0 : at;
}
