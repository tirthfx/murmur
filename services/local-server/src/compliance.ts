import type { AuditInput } from "./audit.ts";
import bundlesFile from "./compliance-bundles.json" with { type: "json" };
import { fail, type Failure } from "./http.ts";
import type { Policy } from "./policy.ts";
import {
  COMPLIANCE_MODES,
  type ComplianceMode,
  type createComplianceSettings,
} from "./team-settings.ts";

/**
 * Compliance mode (TM-23): a named bundle of policy values that an admin turns on as one switch.
 * It is a setting, not a certification: the notice below goes with every response, and the
 * values it writes are marked as set by compliance mode so the console can say so.
 */
export const COMPLIANCE_NOTICE =
  "A compliance mode is a bundle of settings. It is not a certification, and it does not make an organization compliant with any law or standard. Compliance depends on how the organization uses it.";

interface Bundle {
  title: string;
  policy: Record<string, unknown>;
  auditViews: boolean;
  auditDeletions: boolean;
}
const BUNDLES = bundlesFile as unknown as Record<Exclude<ComplianceMode, "none">, Bundle>;

type Ok<T> = { ok: true } & T;

export interface ComplianceDeps {
  settings: ReturnType<typeof createComplianceSettings>;
  policy: Policy;
  audit(input: AuditInput): void;
}

export function createCompliance(deps: ComplianceDeps) {
  const view = (teamId: string) => ({
    ...deps.settings.get(teamId),
    notice: COMPLIANCE_NOTICE,
    bundles: (Object.keys(BUNDLES) as (keyof typeof BUNDLES)[]).map((id) => ({
      id,
      title: BUNDLES[id].title,
      sets: Object.keys(BUNDLES[id].policy),
      auditViews: BUNDLES[id].auditViews,
      auditDeletions: BUNDLES[id].auditDeletions,
    })),
  });

  return {
    view,

    /**
     * Switches the bundle. What the old bundle wrote (and nobody has overridden) is cleared, then
     * the new bundle's values are written with the source `compliance`.
     */
    setMode(
      actorId: string,
      teamId: string,
      mode: unknown,
    ): Ok<{ compliance: ReturnType<typeof view> }> | Failure {
      if (typeof mode !== "string" || !(COMPLIANCE_MODES as readonly string[]).includes(mode))
        return fail(400, "invalid_mode", `The mode is ${COMPLIANCE_MODES.join(", ")}.`);
      const before = deps.settings.get(teamId).mode;
      const layer = deps.policy.read(teamId, "team", undefined);
      if (!layer.ok) return layer;
      const owned = Object.keys(layer.layer.sources).filter(
        (key) => layer.layer.sources[key] === "compliance",
      );
      if (owned.length > 0) {
        const cleared = deps.policy.set(
          actorId,
          teamId,
          { scope: "team", unset: owned },
          "compliance",
        );
        if (!cleared.ok) return cleared;
      }
      const bundle = mode === "none" ? null : BUNDLES[mode as keyof typeof BUNDLES];
      if (bundle) {
        const applied = deps.policy.set(
          actorId,
          teamId,
          { scope: "team", set: bundle.policy },
          "compliance",
        );
        if (!applied.ok) return applied;
      }
      deps.settings.set(teamId, {
        mode,
        auditViews: bundle?.auditViews ?? false,
        auditDeletions: bundle?.auditDeletions ?? false,
      });
      deps.audit({
        actorId,
        action: "compliance.mode_changed",
        targetType: "team",
        targetId: teamId,
        detail: { from: before, to: mode },
      });
      return { ok: true, compliance: view(teamId) };
    },

    /**
     * An app reports a meeting view, an export or a deletion. It is written to the audit log (an id
     * and a count, never content) only when the team's compliance settings ask for it.
     */
    report(
      userId: string,
      teamId: string,
      body: Record<string, unknown>,
    ): Ok<{ recorded: boolean }> | Failure {
      const settings = deps.settings.get(teamId);
      const text = (key: string, max: number) =>
        typeof body[key] === "string" && body[key].length > 0 && (body[key] as string).length <= max
          ? (body[key] as string)
          : null;
      const count = body["count"] === undefined ? 1 : body["count"];
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 10_000_000)
        return fail(400, "invalid_report", "The count is a whole number.");
      switch (body["event"]) {
        case "meeting_viewed": {
          const id = text("meetingId", 100);
          if (!id) return fail(400, "invalid_report", "Say which meeting.");
          if (!settings.auditViews) return { ok: true, recorded: false };
          deps.audit({
            actorId: userId,
            action: "compliance.meeting_viewed",
            targetType: "meeting",
            targetId: id,
            detail: {},
          });
          return { ok: true, recorded: true };
        }
        case "export": {
          const kind = text("kind", 40);
          if (!kind) return fail(400, "invalid_report", "Say what was exported.");
          if (!settings.auditViews) return { ok: true, recorded: false };
          deps.audit({
            actorId: userId,
            action: "compliance.exported",
            targetType: "team",
            targetId: teamId,
            detail: { kind, count },
          });
          return { ok: true, recorded: true };
        }
        case "deletion": {
          const kind = text("kind", 40);
          if (!kind) return fail(400, "invalid_report", "Say what was deleted.");
          if (!settings.auditDeletions) return { ok: true, recorded: false };
          deps.audit({
            actorId: userId,
            action: "compliance.deleted",
            targetType: "team",
            targetId: teamId,
            detail: { kind, count },
          });
          return { ok: true, recorded: true };
        }
        default:
          return fail(400, "invalid_report", "The event is meeting_viewed, export or deletion.");
      }
    },
  };
}

export type Compliance = ReturnType<typeof createCompliance>;
