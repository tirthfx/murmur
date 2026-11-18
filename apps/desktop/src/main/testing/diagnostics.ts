import type { DataCounts, HelperStatus, RetentionView, Settings } from "@murmur/shared";

export interface DiagnosticsInput {
  app: { name: string; version: string; electron: string; node: string };
  system: { platform: string; release: string; arch: string };
  helper: HelperStatus;
  settings: Settings;
  counts: DataCounts;
  retention: RetentionView;
  now: number;
}

/**
 * HB-53, HB-55: what a diagnostics bundle holds. Versions, settings and counts only: the
 * display name, the email signature, Memory and every dictated or written text are left out,
 * so the file can be read by anyone helping without exposing what was said.
 */
export function diagnosticsReport(input: DiagnosticsInput): Record<string, unknown> {
  const { settings } = input;
  const safeSettings: Record<string, unknown> = { ...settings };
  safeSettings.profile = {
    displayName: settings.profile.displayName ? "(set)" : "",
    showOnHome: settings.profile.showOnHome,
  };
  safeSettings.email = { ...settings.email, signature: settings.email.signature ? "(set)" : "" };
  safeSettings.commandMode = { ...settings.commandMode, wakePhrase: "(set)" };
  return {
    madeAt: new Date(input.now).toISOString(),
    app: input.app,
    system: input.system,
    helper: input.helper,
    settings: safeSettings,
    counts: Object.fromEntries(input.counts.categories.map((item) => [item.category, item.count])),
    retention: input.retention,
    note: "Made on this Mac when asked for. It holds versions, settings and counts, and no dictated or written text. Nothing was sent.",
  };
}
