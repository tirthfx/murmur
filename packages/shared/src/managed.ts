import { z } from "zod";
import { POLICY_KEY_SCHEMAS } from "./policy";

/**
 * The managed configuration file (TM-21). An organisation's device management would put it on
 * the Mac; Murmur only reads it and never installs a profile or changes one. The file is the
 * contract: what it may hold, and what is done with it when it is wrong.
 */
export const MANAGED_CONFIG_PATH = "/Library/Application Support/Murmur/managed.json";

export const UPDATE_POLICIES = ["automatic", "notify", "off"] as const;
export type UpdatePolicy = (typeof UPDATE_POLICIES)[number];

export const managedConfigSchema = z.strictObject({
  version: z.literal(1),
  /** The team server to use. */
  serverUrl: z
    .url({ protocol: /^https?$/ })
    .max(300)
    .optional(),
  /** Policy values that apply on top of the team's and that cannot be changed in the app. */
  policy: z.strictObject(POLICY_KEY_SCHEMAS).partial().optional(),
  updates: z
    .strictObject({
      policy: z.enum(UPDATE_POLICIES),
      /** Where updates come from, when the organisation hosts its own feed. */
      feedUrl: z
        .url({ protocol: /^https$/ })
        .max(300)
        .optional(),
    })
    .optional(),
});
export type ManagedConfig = z.infer<typeof managedConfigSchema>;

export type ManagedParse = { ok: true; config: ManagedConfig } | { ok: false; message: string };

/** Reads the file's text. An invalid file is reported and ignored, never half applied. */
export function parseManagedConfig(text: string): ManagedParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "The managed configuration is not valid JSON." };
  }
  const parsed = managedConfigSchema.safeParse(raw);
  if (parsed.success) return { ok: true, config: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue && issue.path.length > 0 ? ` (${issue.path.join(".")})` : "";
  return {
    ok: false,
    message: `The managed configuration is not valid${where}: ${issue?.message ?? "unknown problem"}.`,
  };
}

/** The update policy in force: the managed one, or "notify" when nothing is managed. */
export function updatePolicyOf(config: ManagedConfig | null): UpdatePolicy {
  return config?.updates?.policy ?? "notify";
}

/** Whether the Hub's check-for-updates button can be used: not when updates are managed at all. */
export function canCheckForUpdates(config: ManagedConfig | null): boolean {
  return config?.updates === undefined;
}

export const MANAGED_MESSAGES = {
  badge: "Managed by your organization",
  updates: "Updates are managed by your organization",
} as const;
