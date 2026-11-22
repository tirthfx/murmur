import {
  POLICY_NOTICES,
  appBlocked,
  blockingDomain,
  canCheckForUpdates,
  clampRetention,
  combinePolicies,
  featureAllowed,
  mergePolicy,
  updatePolicyOf,
  withContact,
  type EffectivePolicy,
  type ManagedConfig,
  type PolicyApp,
  type PolicyFeature,
  type PolicyValues,
  type PolicyView,
  type RetentionChoice,
} from "@murmur/shared";
import type { ManagedState } from "../managed/managed-config";

/**
 * The policy in force on this Mac (TM-13 to TM-16, TM-21). It is the strictest of the team
 * policies last downloaded (kept for when the server is out of reach) and the policy in the
 * managed configuration file. Every place that acts for a feature, an app, an address or a
 * retention choice asks here first, in the main process, so the Hub only has to show it.
 */
export interface PolicyDeps {
  /** The managed configuration, read once at start. */
  managed(): ManagedState;
  onChange?(view: PolicyView): void;
}

export interface PolicyService {
  /** The team policies, one per team the person is in. Empty when signed out. */
  setTeam(policies: readonly EffectivePolicy[]): void;
  current(): EffectivePolicy;
  view(): PolicyView;
  /** Why dictation (or Notetaker) must not run in this app, or null. */
  appRefusal(app: PolicyApp, use: "dictation" | "notetaker"): string | null;
  /** Why a feature (and a connector, for connectors) is off, or null. */
  featureRefusal(feature: PolicyFeature, connectorId?: string): string | null;
  /** Why this address may not be opened, or null. */
  urlRefusal(url: string): string | null;
  /** A retention choice inside what the policy allows. */
  retention(kind: "audio" | "transcript", chosen: number | null): RetentionChoice;
}

const FEATURE_NAMES: Record<PolicyFeature, string> = {
  notetaker: "Notetaker",
  scratchpad: "The Scratchpad",
  transforms: "Rewrites",
  connectors: "Connectors",
  shareLinksTeam: "Sharing with the team",
  shareLinksAnyone: "Sharing with anyone",
  exportToFile: "Export",
  mcp: "The MCP server",
  skillSharing: "Sharing Skills",
};

export function createPolicyService(deps: PolicyDeps): PolicyService {
  const managedState = deps.managed();
  const managed: ManagedConfig | null = managedState.config;
  const managedPolicy = managed?.policy ? mergePolicy([managed.policy as PolicyValues]) : null;
  let team: EffectivePolicy[] = [];

  const build = (): EffectivePolicy =>
    combinePolicies([...team, ...(managedPolicy ? [managedPolicy] : [])]);
  let cached = build();

  const view = (): PolicyView => {
    const policy = cached;
    return {
      managed: managed !== null,
      managedProblem: managedState.invalid,
      updates: {
        policy: updatePolicyOf(managed),
        managed: managed?.updates !== undefined,
        canCheck: canCheckForUpdates(managed),
      },
      active: team.length > 0 || managedPolicy !== null,
      featuresOff: (Object.keys(policy.features) as PolicyFeature[]).filter(
        (name) => !policy.features[name],
      ),
      connectorsDisabled: policy.connectorsDisabled,
      retention: policy.retention,
      blockedAppCount: policy.blockedApps.length,
      blockedDomainCount: policy.blockedDomains.length,
      adminContact: policy.adminContact,
    };
  };

  return {
    setTeam(policies) {
      team = [...policies];
      cached = build();
      deps.onChange?.(view());
    },
    current: () => cached,
    view,
    appRefusal(app, use) {
      const hit = appBlocked(app, cached, use);
      if (!hit) return null;
      return withContact(
        hit.name !== "" ? `${POLICY_NOTICES.appBlocked} (${hit.name})` : POLICY_NOTICES.appBlocked,
        cached.adminContact,
      );
    },
    featureRefusal(feature, connectorId) {
      if (featureAllowed(cached, feature, connectorId)) return null;
      return withContact(
        `${FEATURE_NAMES[feature]}: ${POLICY_NOTICES.featureOff.toLowerCase()}`,
        cached.adminContact,
      );
    },
    urlRefusal(url) {
      const hit = blockingDomain(url, cached.blockedDomains);
      if (hit === null) return null;
      return withContact(`${POLICY_NOTICES.domainBlocked} (${hit})`, cached.adminContact);
    },
    retention: (kind, chosen) => clampRetention(cached.retention[kind], chosen),
  };
}
