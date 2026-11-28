import {
  FREE_LIMITS,
  FREE_MEETINGS_PER_MONTH,
  lockedText,
  planAllows,
  type PlanFeature,
  type PlanTier,
  type Rewrite,
  type RewriteSaveResult,
} from "@murmur/shared";

/**
 * Plan gates (RW-22, TM-25). Checked in main on every call, so a plan change applies at once.
 * Free keeps the five built-ins, three custom Rewrites and three Rewrite shortcuts.
 */

const customCount = (rewrites: readonly Rewrite[]) =>
  rewrites.filter((rewrite) => rewrite.builtinKey === null).length;

/** Null when a new custom Rewrite may be added; otherwise the refusal. */
export function refuseNewRewrite(
  plan: PlanTier,
  rewrites: readonly Rewrite[],
): Extract<RewriteSaveResult, { ok: false }> | null {
  if (planAllows(plan, "unlimitedRewrites")) return null;
  if (customCount(rewrites) < FREE_LIMITS.customRewrites) return null;
  return { ok: false, reason: "plan", message: lockedText() };
}

/** Null when this Rewrite may get a shortcut; otherwise the message. Removing is always fine. */
export function refuseRewriteShortcut(
  plan: PlanTier,
  rewrites: readonly Rewrite[],
  id: string,
): string | null {
  if (planAllows(plan, "unlimitedRewriteShortcuts")) return null;
  const withShortcut = rewrites.filter((rewrite) => rewrite.shortcut !== null);
  if (withShortcut.some((rewrite) => rewrite.id === id)) return null;
  if (withShortcut.length < FREE_LIMITS.rewriteShortcuts) return null;
  return lockedText();
}

/** How many Rewrite shortcuts are bound: all, or the first three on Free. */
export function boundRewriteShortcuts(plan: PlanTier): number | undefined {
  return planAllows(plan, "unlimitedRewriteShortcuts") ? undefined : FREE_LIMITS.rewriteShortcuts;
}

/** Why a plan-gated feature may not run, or null. */
export function planRefusal(plan: PlanTier, feature: PlanFeature): string | null {
  return planAllows(plan, feature) ? null : lockedText();
}

/** How many meetings were started in the calendar month of `now` (this Mac's time zone). */
export function meetingsThisMonth(meetings: readonly { startedAt: number }[], now: number): number {
  const at = new Date(now);
  const start = new Date(at.getFullYear(), at.getMonth(), 1).getTime();
  return meetings.filter((meeting) => meeting.startedAt >= start && meeting.startedAt <= now)
    .length;
}

export interface MeetingGateDeps {
  plan(): PlanTier;
  meetings(): readonly { startedAt: number }[];
  now(): number;
}

/** Why a new meeting recording may not start: Free's meetings for the month are used up. */
export function meetingStartRefusal(deps: MeetingGateDeps): string | null {
  if (planAllows(deps.plan(), "unlimitedMeetings")) return null;
  if (meetingsThisMonth(deps.meetings(), deps.now()) < FREE_MEETINGS_PER_MONTH) return null;
  return `${lockedText()}. Free records ${FREE_MEETINGS_PER_MONTH} meetings a month.`;
}
