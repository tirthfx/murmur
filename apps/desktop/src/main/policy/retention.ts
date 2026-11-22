import { clampRetention, type RetentionLimit } from "@murmur/shared";

/**
 * A person's retention choices are words ("7 days", "Keep for ever"), and a policy limit is days
 * (TM-15). This turns a choice into the nearest choice the limit allows, so the choices stay as
 * they are in the settings and the limit is applied where the data is kept or deleted.
 */
export interface Period<T> {
  value: T;
  /** Days kept; null is for ever. Zero is "as soon as it has been used". */
  days: number | null;
}

export const DICTATION_AUDIO: readonly Period<"never" | "24h" | "keep">[] = [
  { value: "never", days: 0 },
  { value: "24h", days: 1 },
  { value: "keep", days: null },
];
export const HISTORY_TEXT: readonly Period<7 | 30 | 365 | null>[] = [
  { value: 7, days: 7 },
  { value: 30, days: 30 },
  { value: 365, days: 365 },
  { value: null, days: null },
];
export const MEETING_AUDIO: readonly Period<"processing" | "7d" | "30d" | "forever">[] = [
  { value: "processing", days: 0 },
  { value: "7d", days: 7 },
  { value: "30d", days: 30 },
  { value: "forever", days: null },
];
export const MEETING_TRANSCRIPT: readonly Period<"30d" | "90d" | "1y" | "forever">[] = [
  { value: "30d", days: 30 },
  { value: "90d", days: 90 },
  { value: "1y", days: 365 },
  { value: "forever", days: null },
];

/**
 * The choice to use: the one given when the limit allows it; when it is longer than the maximum,
 * the longest choice within it (or the shortest there is, when none is short enough); when it is
 * shorter than the minimum, the shortest choice that is long enough.
 */
export function effectivePeriod<T>(
  periods: readonly Period<T>[],
  current: T,
  limit: RetentionLimit,
): T {
  const days = periods.find((period) => period.value === current)?.days;
  if (days === undefined) return current;
  const clamped = clampRetention(limit, days);
  if (!clamped.limited) return current;
  const finite = periods.filter((period) => period.days !== null) as {
    value: T;
    days: number;
  }[];
  const tooLong = limit.max !== null && (days === null || days > limit.max);
  if (tooLong) {
    const within = finite.filter((period) => period.days <= clamped.days!);
    const best = within.sort((a, b) => b.days - a.days)[0];
    return (best ?? finite.sort((a, b) => a.days - b.days)[0] ?? { value: current }).value;
  }
  const enough = finite.filter((period) => period.days >= clamped.days!);
  const best = enough.sort((a, b) => a.days - b.days)[0];
  return best ? best.value : (periods.find((period) => period.days === null)?.value ?? current);
}
