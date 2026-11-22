import {
  FREE_MEETINGS_PER_MONTH,
  lockedText,
  planAllows,
  type PlanFeature,
  type PlanTier,
} from "@murmur/shared";
import type { PolicyService } from "./policy-service";

/**
 * Plan and policy checks that more than one place makes (TM-14, TM-25). Each returns the words
 * to show for a refusal, or null when the feature may run. They are read on every call, so a
 * plan or policy change applies at once.
 */

/** How many meetings were started in the calendar month of `now` (this Mac's time zone). */
export function meetingsThisMonth(meetings: readonly { startedAt: number }[], now: number): number {
  const at = new Date(now);
  const start = new Date(at.getFullYear(), at.getMonth(), 1).getTime();
  return meetings.filter((meeting) => meeting.startedAt >= start && meeting.startedAt <= now)
    .length;
}

export interface MeetingGateDeps {
  plan(): PlanTier;
  policy: Pick<PolicyService, "featureRefusal">;
  meetings(): readonly { startedAt: number }[];
  now(): number;
}

/** Why a new meeting recording may not start: Notetaker is off by policy, or Free is used up. */
export function meetingStartRefusal(deps: MeetingGateDeps): string | null {
  const off = deps.policy.featureRefusal("notetaker");
  if (off) return off;
  if (planAllows(deps.plan(), "unlimitedMeetings")) return null;
  if (meetingsThisMonth(deps.meetings(), deps.now()) < FREE_MEETINGS_PER_MONTH) return null;
  return `${lockedText("unlimitedMeetings")}. Free records ${FREE_MEETINGS_PER_MONTH} meetings a month.`;
}

/** Why a plan-gated feature may not run, or null. Policy is checked separately. */
export function planRefusal(plan: PlanTier, feature: PlanFeature): string | null {
  return planAllows(plan, feature) ? null : lockedText(feature);
}

export interface FocusedApp {
  bundleId: string | null;
}

/**
 * Why a use is refused in the app that has focus (TM-13), or null. The focused app is asked for
 * only when the policy blocks some, so a Mac without such a policy pays nothing. When the app
 * cannot be read the use is not refused: nothing is known to block it.
 */
export async function blockedAppRefusal(
  deps: {
    policy: Pick<PolicyService, "current" | "appRefusal">;
    focus(): Promise<FocusedApp | null>;
  },
  use: "dictation" | "notetaker",
): Promise<string | null> {
  if (deps.policy.current().blockedApps.length === 0) return null;
  const focus = await deps.focus().catch(() => null);
  return focus ? deps.policy.appRefusal({ bundleId: focus.bundleId }, use) : null;
}
