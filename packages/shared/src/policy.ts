import { z } from "zod";

/**
 * Team policy (TM-13 to TM-16): what an organisation can switch off, block or limit. The server
 * keeps the values for the organisation, a department and a single member, and merges them into
 * one effective policy; the app enforces that policy before a feature runs.
 *
 * This file imports nothing but `zod`, so the local server can load it directly as well.
 */

export const POLICY_FEATURES = [
  "notetaker",
  "scratchpad",
  "transforms",
  "connectors",
  "shareLinksTeam",
  "shareLinksAnyone",
  "exportToFile",
  "mcp",
  "skillSharing",
] as const;
export type PolicyFeature = (typeof POLICY_FEATURES)[number];

export const POLICY_LIMITS = {
  blockedApps: 200,
  blockedDomains: 500,
  disabledConnectors: 50,
  retentionDays: 3650,
  adminContact: 200,
} as const;

const days = z.number().int().min(1).max(POLICY_LIMITS.retentionDays).nullable();

/** An app by bundle identifier, or by its path when it has none. */
export const blockedAppSchema = z.strictObject({
  bundleId: z.string().trim().min(1).max(300),
  name: z.string().trim().max(100).default(""),
});
export type BlockedApp = z.infer<typeof blockedAppSchema>;

/** A host name as written in a policy, normalised to lower case and punycode. */
export const domainSchema = z
  .string()
  .max(253)
  .transform((value, ctx) => {
    const host = normalizeDomain(value);
    if (host === null) {
      ctx.addIssue({ code: "custom", message: "That is not a domain name." });
      return z.NEVER;
    }
    return host;
  });

/** Every setting a policy layer can hold, each with the check for its value. */
export const POLICY_KEY_SCHEMAS = {
  blockedApps: z.array(blockedAppSchema).max(POLICY_LIMITS.blockedApps),
  "blockedApps.appliesTo": z.enum(["dictation", "dictation_and_notetaker"]),
  "features.notetaker": z.boolean(),
  "features.scratchpad": z.boolean(),
  "features.transforms": z.boolean(),
  "features.connectors": z.boolean(),
  "features.shareLinksTeam": z.boolean(),
  "features.shareLinksAnyone": z.boolean(),
  "features.exportToFile": z.boolean(),
  "features.mcp": z.boolean(),
  "features.skillSharing": z.boolean(),
  "connectors.disabled": z
    .array(z.string().regex(/^[A-Za-z0-9_-]{2,40}$/))
    .max(POLICY_LIMITS.disabledConnectors),
  "retention.audio.max": days,
  "retention.audio.min": days,
  "retention.transcript.max": days,
  "retention.transcript.min": days,
  blockedDomains: z.array(domainSchema).max(POLICY_LIMITS.blockedDomains),
  adminContact: z.string().trim().max(POLICY_LIMITS.adminContact),
} as const;

export type PolicyKey = keyof typeof POLICY_KEY_SCHEMAS;
export const POLICY_KEYS = Object.keys(POLICY_KEY_SCHEMAS) as PolicyKey[];
export type PolicyValues = { [K in PolicyKey]?: z.output<(typeof POLICY_KEY_SCHEMAS)[K]> };

export function isPolicyKey(value: string): value is PolicyKey {
  return Object.hasOwn(POLICY_KEY_SCHEMAS, value);
}

/** Checks one value for a key; the cleaned value, or the reason it is refused. */
export function checkPolicyValue(
  key: PolicyKey,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; message: string } {
  const parsed = POLICY_KEY_SCHEMAS[key].safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    message: `${key}: ${parsed.error.issues[0]?.message ?? "not a valid value"}`,
  };
}

export interface RetentionLimit {
  /** The longest anything may be kept, in days; null for no limit. */
  max: number | null;
  /** The shortest it may be kept, in days; null for no limit. */
  min: number | null;
}

export interface EffectivePolicy {
  blockedApps: BlockedApp[];
  appliesTo: "dictation" | "dictation_and_notetaker";
  features: Record<PolicyFeature, boolean>;
  /** Connector ids switched off, on top of `features.connectors`. */
  connectorsDisabled: string[];
  retention: { audio: RetentionLimit; transcript: RetentionLimit };
  blockedDomains: string[];
  /** Whom to ask: shown next to a block. */
  adminContact: string;
}

/** No policy: everything allowed. */
export const OPEN_POLICY: EffectivePolicy = {
  blockedApps: [],
  appliesTo: "dictation",
  features: Object.fromEntries(POLICY_FEATURES.map((name) => [name, true])) as Record<
    PolicyFeature,
    boolean
  >,
  connectorsDisabled: [],
  retention: { audio: { max: null, min: null }, transcript: { max: null, min: null } },
  blockedDomains: [],
  adminContact: "",
};

export const effectivePolicySchema = z.strictObject({
  blockedApps: z.array(blockedAppSchema),
  appliesTo: z.enum(["dictation", "dictation_and_notetaker"]),
  features: z.strictObject(
    Object.fromEntries(POLICY_FEATURES.map((name) => [name, z.boolean()])) as Record<
      PolicyFeature,
      z.ZodBoolean
    >,
  ),
  connectorsDisabled: z.array(z.string()),
  retention: z.strictObject({
    audio: z.strictObject({ max: days, min: days }),
    transcript: z.strictObject({ max: days, min: days }),
  }),
  blockedDomains: z.array(z.string()),
  adminContact: z.string(),
});

/**
 * One policy from the layers that apply to a person: the organisation first, then their
 * department, then the member's own. A layer can only take away. A feature is off if any layer
 * turns it off (an organisation's "off" cannot be undone below it), lists are added together,
 * and a retention limit is the strictest one given.
 */
export function mergePolicy(layers: readonly PolicyValues[]): EffectivePolicy {
  const out: EffectivePolicy = structuredClone(OPEN_POLICY);
  const seenApps = new Set<string>();
  const seenDomains = new Set<string>();

  for (const layer of layers) {
    for (const app of layer.blockedApps ?? []) {
      const id = app.bundleId.toLowerCase();
      if (seenApps.has(id)) continue;
      seenApps.add(id);
      out.blockedApps.push({ bundleId: app.bundleId, name: app.name });
    }
    if (layer["blockedApps.appliesTo"] === "dictation_and_notetaker")
      out.appliesTo = "dictation_and_notetaker";
    for (const name of POLICY_FEATURES) {
      if (layer[`features.${name}`] === false) out.features[name] = false;
    }
    for (const id of layer["connectors.disabled"] ?? []) {
      if (!out.connectorsDisabled.includes(id)) out.connectorsDisabled.push(id);
    }
    for (const kind of ["audio", "transcript"] as const) {
      const max = layer[`retention.${kind}.max`];
      const min = layer[`retention.${kind}.min`];
      const limit = out.retention[kind];
      if (typeof max === "number") limit.max = limit.max === null ? max : Math.min(limit.max, max);
      if (typeof min === "number") limit.min = limit.min === null ? min : Math.max(limit.min, min);
    }
    for (const domain of layer.blockedDomains ?? []) {
      if (!seenDomains.has(domain)) {
        seenDomains.add(domain);
        out.blockedDomains.push(domain);
      }
    }
    if (out.adminContact === "" && layer.adminContact) out.adminContact = layer.adminContact;
  }
  // A minimum above the maximum cannot both hold; keeping less is the safer way to settle it.
  for (const kind of ["audio", "transcript"] as const) {
    const limit = out.retention[kind];
    if (limit.max !== null && limit.min !== null && limit.min > limit.max) limit.min = limit.max;
  }
  return out;
}

// ---- domains (TM-16) ----

/**
 * A host as a policy lists it: the scheme, a path, a port and a leading `www.` are dropped, the
 * name is lower-cased and written in punycode. Null when it is not a host name.
 */
export function normalizeDomain(input: string): string | null {
  let text = input.trim().toLowerCase();
  if (text === "") return null;
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  text = text.split(/[/?#]/)[0] ?? "";
  text = text
    .replace(/^[^@]*@/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  if (text === "" || /[\s_]/.test(text)) return null;
  let host: string;
  try {
    host = new URL(`http://${text}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "");
  if (
    host.length > 253 ||
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)
  )
    return null;
  if (host.split(".").some((label) => label.length > 63)) return null;
  return host;
}

/** Whether a host, or a URL, is on the list or is a subdomain of an entry on it. */
export function domainBlocked(hostOrUrl: string, blocked: readonly string[]): boolean {
  const host = normalizeDomain(hostOrUrl);
  if (host === null) return false;
  // `www.` is dropped on both sides, so "www.example.com" and "example.com" are the same host.
  return blocked.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/** The domain in a blocked-list match, if the URL is blocked. */
export function blockingDomain(hostOrUrl: string, blocked: readonly string[]): string | null {
  const host = normalizeDomain(hostOrUrl);
  if (host === null) return null;
  return blocked.find((entry) => host === entry || host.endsWith(`.${entry}`)) ?? null;
}

// ---- apps (TM-13) ----

export interface PolicyApp {
  bundleId?: string | null;
  path?: string | null;
}

/**
 * Whether dictation (or Notetaker, when the policy says so) is blocked in an app. An entry is a
 * bundle identifier, or an absolute path for an app that has none.
 */
export function appBlocked(
  app: PolicyApp,
  policy: Pick<EffectivePolicy, "blockedApps" | "appliesTo">,
  use: "dictation" | "notetaker",
): BlockedApp | null {
  if (use === "notetaker" && policy.appliesTo !== "dictation_and_notetaker") return null;
  const bundle = app.bundleId?.toLowerCase() ?? "";
  const path = app.path ?? "";
  return (
    policy.blockedApps.find((entry) => {
      const id = entry.bundleId.toLowerCase();
      return entry.bundleId.startsWith("/")
        ? path !== "" && entry.bundleId === path
        : bundle !== "" && id === bundle;
    }) ?? null
  );
}

// ---- features (TM-14) ----

/** Whether a feature is on, and for connectors, whether this one is. */
export function featureAllowed(
  policy: Pick<EffectivePolicy, "features" | "connectorsDisabled">,
  feature: PolicyFeature,
  connectorId?: string,
): boolean {
  if (!policy.features[feature]) return false;
  if (feature === "connectors" && connectorId && policy.connectorsDisabled.includes(connectorId))
    return false;
  return true;
}

// ---- retention (TM-15) ----

export interface RetentionChoice {
  /** Days to keep; null means forever. */
  days: number | null;
  /** True when the organisation changed the person's choice. */
  limited: boolean;
  /** Why, in words for the Hub ("Set by your organization"). */
  reason: string;
}

export const POLICY_NOTICES = {
  setByOrganization: "Set by your organization",
  appBlocked: "Dictation is turned off in this app",
  featureOff: "Turned off by your organization",
  domainBlocked: "Your organization does not allow this address",
} as const;

/**
 * A person's retention choice (days, or null for forever) kept inside what the policy allows:
 * not longer than the maximum, not shorter than the minimum.
 */
export function clampRetention(limit: RetentionLimit, chosen: number | null): RetentionChoice {
  if (limit.max !== null && (chosen === null || chosen > limit.max))
    return { days: limit.max, limited: true, reason: POLICY_NOTICES.setByOrganization };
  if (limit.min !== null && chosen !== null && chosen < limit.min)
    return { days: limit.min, limited: true, reason: POLICY_NOTICES.setByOrganization };
  return { days: chosen, limited: false, reason: "" };
}
