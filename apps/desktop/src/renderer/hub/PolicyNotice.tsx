import { POLICY_NOTICES, type PolicyFeature, type RetentionLimit } from "@murmur/shared";
import { Text } from "@astryxdesign/core/Text";
import { usePolicy } from "./usePolicy";

/**
 * What the organization has set, shown where it matters (TM-14, TM-15). The app enforces it in
 * the main process; these lines only say why a control does nothing.
 */
export function PolicyFeatureNotice({ feature }: { feature: PolicyFeature }) {
  const policy = usePolicy();
  if (!policy.featuresOff.includes(feature)) return null;
  return (
    <div role="note" className="hub-policy-notice" data-testid={`policy-off-${feature}`}>
      <Text size="sm" color="secondary">
        {POLICY_NOTICES.featureOff}.
        {policy.adminContact !== "" ? ` Ask ${policy.adminContact}.` : ""}
      </Text>
    </div>
  );
}

const dayText = (days: number) => (days === 1 ? "1 day" : `${days} days`);

function limitText(name: string, limit: RetentionLimit): string | null {
  const parts: string[] = [];
  if (limit.max !== null) parts.push(`no longer than ${dayText(limit.max)}`);
  if (limit.min !== null) parts.push(`no shorter than ${dayText(limit.min)}`);
  return parts.length === 0 ? null : `${name}: ${parts.join(", ")}`;
}

/** "Set by your organization", with the limits, when the policy limits how long data is kept. */
export function RetentionPolicyNote() {
  const policy = usePolicy();
  const lines = [
    limitText("Recordings", policy.retention.audio),
    limitText("Text and transcripts", policy.retention.transcript),
  ].filter((line): line is string => line !== null);
  if (lines.length === 0) return null;
  return (
    <div role="note" className="hub-policy-notice" data-testid="policy-retention">
      <Text size="sm" color="secondary">
        {POLICY_NOTICES.setByOrganization}. {lines.join(". ")}. A longer choice below is cut to this
        when the data is kept or deleted.
      </Text>
    </div>
  );
}
