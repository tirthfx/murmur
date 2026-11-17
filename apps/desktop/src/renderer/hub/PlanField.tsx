import { Heading } from "@astryxdesign/core/Heading";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  FREE_LIMITS,
  PLAN_LABELS,
  PLAN_TIERS,
  planTierSchema,
  type PlanTier,
} from "@murmur/shared";

const OPTIONS = PLAN_TIERS.map((tier) => ({ value: tier, label: PLAN_LABELS[tier] }));

/**
 * The local plan switch (RW-22, HB-19): it only unlocks features for testing. The full Plans
 * page comes in M4.
 */
export function PlanField({
  plan,
  onChange,
}: {
  plan: PlanTier;
  onChange: (plan: PlanTier) => void;
}) {
  return (
    <section className="hub-permissions" aria-labelledby="plan-heading">
      <VStack gap={2}>
        <Heading level={2} id="plan-heading">
          Plan
        </Heading>
        <Text size="sm" color="secondary">
          A local switch for testing what each plan unlocks. Nothing is charged and nothing is sent
          anywhere. Free keeps the five built-in Rewrites, {FREE_LIMITS.customRewrites} custom
          Rewrites, {FREE_LIMITS.rewriteShortcuts} Rewrite shortcuts and the Fast model; auto-apply,
          Command Mode, the Quality model and Focus Mode need Pro or above.
        </Text>
        <Selector
          label="Plan"
          options={OPTIONS}
          value={plan}
          onChange={(value) => {
            const parsed = planTierSchema.safeParse(value);
            if (parsed.success) onChange(parsed.data);
          }}
        />
      </VStack>
    </section>
  );
}
