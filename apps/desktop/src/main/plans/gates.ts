import {
  FREE_LIMITS,
  lockedText,
  planAllows,
  type PlanTier,
  type Rewrite,
  type RewriteSaveResult,
} from "@murmur/shared";

/**
 * Plan gates on Rewrites (RW-22). Checked in main on every call, so a plan change applies at
 * once. Free keeps the five built-ins, three custom Rewrites and three Rewrite shortcuts.
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
  return { ok: false, reason: "plan", message: lockedText("unlimitedRewrites") };
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
  return lockedText("unlimitedRewriteShortcuts");
}

/** How many Rewrite shortcuts are bound: all, or the first three on Free. */
export function boundRewriteShortcuts(plan: PlanTier): number | undefined {
  return planAllows(plan, "unlimitedRewriteShortcuts") ? undefined : FREE_LIMITS.rewriteShortcuts;
}
