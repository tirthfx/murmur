import { z } from "zod";

/**
 * Focus Mode (RW-18, RW-19, RW-21): blocks chosen apps for a while. The helper reports the
 * app in front only while main has asked it to; main compares it with the blocked list and
 * shows the overlay. Apps are never quit.
 */

// ------------------------------------------------------------------ helper messages

export const focusWatchPayloadSchema = z.object({ enabled: z.boolean() });
export const focusWatchResultSchema = z.object({ watching: z.boolean() });

/** A browser's page: host and path only (no scheme, query or fragment). RW-20. */
export const pageSiteSchema = z.object({
  host: z.string().min(1).max(253),
  path: z.string().max(512),
});
export type PageSite = z.infer<typeof pageSiteSchema>;

/**
 * The app in front, sent when it changes (and once when watching starts). In a known browser
 * (capability `focus.sites`) it also carries the page's site, sent again when that changes:
 * `siteStatus` is `none` outside browsers, `unavailable` when the browser's page cannot be
 * read, and `ok` with `site` null for a page that is not http or https.
 */
export const frontAppPayloadSchema = z.object({
  bundleId: z.string().max(255).nullable(),
  name: z.string().max(200).nullable(),
  pid: z.number().int().nullable(),
  site: pageSiteSchema.nullable().optional(),
  siteStatus: z.enum(["none", "ok", "unavailable"]).optional(),
});
export type FrontApp = z.infer<typeof frontAppPayloadSchema>;

export const installedAppSchema = z.object({
  bundleId: z.string().min(1).max(255),
  name: z.string().min(1).max(200),
});
export type InstalledApp = z.infer<typeof installedAppSchema>;
export const appsListResultSchema = z.object({ apps: z.array(installedAppSchema).max(5000) });

// ------------------------------------------------------------------ settings and state

/** Minutes, or until turned off. */
export const FOCUS_DURATIONS = [25, 50, 90, "untilOff"] as const;
export const focusDurationSchema = z.union([
  z.literal(25),
  z.literal(50),
  z.literal(90),
  z.literal("untilOff"),
]);
export type FocusDuration = z.infer<typeof focusDurationSchema>;

export const FOCUS_DURATION_LABELS: Record<string, string> = {
  "25": "25 minutes",
  "50": "50 minutes",
  "90": "90 minutes",
  untilOff: "Until turned off",
};

export function focusDurationLabel(duration: FocusDuration): string {
  return FOCUS_DURATION_LABELS[String(duration)] ?? String(duration);
}

export const FOCUS_LIMITS = {
  /** RW-19. */
  apps: 100,
  /** RW-20. */
  sites: 200,
  /** RW-21: Pause Focus for 10 minutes. */
  pauseMs: 10 * 60_000,
} as const;

export const FOCUS_END_REASONS = ["timer", "user", "quit", "paused"] as const;
export type FocusEndReason = (typeof FOCUS_END_REASONS)[number];

export const focusStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("off") }),
  z.strictObject({
    status: z.literal("on"),
    /** Epoch ms when it ends; null until turned off. */
    endsAt: z.number().nullable(),
  }),
  z.strictObject({
    status: z.literal("paused"),
    resumeAt: z.number(),
    /** Time left when paused; null for until turned off. */
    remainingMs: z.number().nullable(),
  }),
]);
export type FocusState = z.infer<typeof focusStateSchema>;

export const focusRuleSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(["app", "site"]),
  /** The app's bundle id, or a site as `domain` or `domain/path`. */
  value: z.string(),
  label: z.string(),
  createdAt: z.number(),
});
export type FocusRule = z.infer<typeof focusRuleSchema>;

/** A dotted bundle id, or a Windows program file name, which may hold spaces and underscores. */
const APP_ID = /^([A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+|[^\\/:*?"<>|]+\.[Ee][Xx][Ee])$/;

export const focusAppInputSchema = z.strictObject({
  bundleId: z
    .string()
    .trim()
    .min(3)
    .max(255)
    .regex(APP_ID, "Use an app's bundle id, like com.example.App, or a program, like notepad.exe"),
  label: z.string().trim().min(1).max(200),
});
export type FocusAppInput = z.infer<typeof focusAppInputSchema>;

/** A site to block as typed: "example.com", "https://www.example.com/shorts", "example.com/news". */
export const focusSiteInputSchema = z.strictObject({ site: z.string().trim().min(1).max(600) });
export type FocusSiteInput = z.infer<typeof focusSiteInputSchema>;

const DOMAIN =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * A blocked site as stored: the domain in lower case without "www.", and an optional path
 * prefix without a trailing slash, query or fragment. Null when it is not a web address.
 */
export function parseSiteEntry(
  text: string,
): { domain: string; path: string | null; value: string } | null {
  let rest = text.trim().toLowerCase();
  rest = rest.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  rest = rest.split(/[?#]/)[0] ?? "";
  const slash = rest.indexOf("/");
  let domain = slash === -1 ? rest : rest.slice(0, slash);
  domain = domain
    .replace(/:\d+$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (!DOMAIN.test(domain)) return null;
  let path: string | null = slash === -1 ? null : rest.slice(slash).replace(/\/+$/, "");
  if (path === "" || path === "/") path = null;
  return { domain, path, value: path ? `${domain}${path}` : domain };
}

/**
 * Whether a page matches a blocked site: the same domain or one of its subdomains, and, when
 * the entry has a path, the same path or one under it. Paths compare without case.
 */
export function siteMatches(entry: string, site: PageSite): boolean {
  const parsed = parseSiteEntry(entry);
  if (!parsed) return false;
  const host = site.host.toLowerCase().replace(/\.$/, "");
  if (host !== parsed.domain && !host.endsWith(`.${parsed.domain}`)) return false;
  if (!parsed.path) return true;
  const path = site.path.toLowerCase().replace(/\/+$/, "");
  return path === parsed.path || path.startsWith(`${parsed.path}/`);
}

/** What the Hub shows for blocked sites. */
export const focusSitesViewSchema = z.strictObject({
  rules: z.array(focusRuleSchema),
  /** Browsers seen in front this run whose page could not be read. */
  unavailableIn: z.array(z.string()),
});
export type FocusSitesView = z.infer<typeof focusSitesViewSchema>;

export const focusAddResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), rule: focusRuleSchema }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type FocusAddResult = z.infer<typeof focusAddResultSchema>;

export const FOCUS_MESSAGES = {
  ended: "Focus ended",
  paused: "Focus paused for 10 minutes",
  resumed: "Focus is back on",
  limit: `At most ${FOCUS_LIMITS.apps} blocked apps.`,
  duplicate: "That app is already blocked.",
  self: "Murmur cannot block itself.",
  sitesLimit: `At most ${FOCUS_LIMITS.sites} blocked sites.`,
  siteDuplicate: "That site is already blocked.",
  notASite: "Type a web address, like example.com or example.com/news.",
  off: "Turn on Focus Mode in Experimental first.",
} as const;

/** RW-20: shown in the blocked sites list for a browser whose page cannot be read. */
export function focusSiteUnavailableText(browser: string): string {
  return `Website blocking is not available in ${browser}.`;
}

/** "Focus is on. Safari is blocked." */
export function focusBlockedText(name: string): string {
  return `Focus is on. ${name} is blocked.`;
}

/** m:ss or h:mm:ss left. */
export function focusTimeLeft(endsAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

// ------------------------------------------------------------------ the overlay page

export const FOCUS_OVERLAY_CHANNELS = {
  ready: "focus-overlay:ready",
  goBack: "focus-overlay:go-back",
  pause: "focus-overlay:pause",
  turnOff: "focus-overlay:turn-off",
} as const;

export const FOCUS_OVERLAY_PUSH = { state: "focus-overlay:state" } as const;

export const FOCUS_OVERLAY_ARGS = {
  [FOCUS_OVERLAY_CHANNELS.ready]: z.tuple([]),
  [FOCUS_OVERLAY_CHANNELS.goBack]: z.tuple([]),
  [FOCUS_OVERLAY_CHANNELS.pause]: z.tuple([]),
  [FOCUS_OVERLAY_CHANNELS.turnOff]: z.tuple([]),
} as const;

/** What the overlay shows: hidden, or the blocked item's name. */
export type FocusOverlayState = { stage: "hidden" } | { stage: "blocked"; name: string };

/** What the overlay preload exposes as `window.murmurFocus`. */
export interface MurmurFocusApi {
  ready(): Promise<FocusOverlayState>;
  onState(handler: (state: FocusOverlayState) => void): () => void;
  goBack(): Promise<void>;
  pause(): Promise<void>;
  turnOff(): Promise<void>;
}
