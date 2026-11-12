import { CheckboxList, CheckboxListItem } from "@astryxdesign/core/CheckboxList";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { REWRITE_CATEGORIES, type Rewrite, type RewriteAutoApply } from "@murmur/shared";

const CATEGORY_NAMES: Record<(typeof REWRITE_CATEGORIES)[number], string> = {
  personal: "Personal",
  work: "Work",
  email: "Email",
  other: "Other",
};

/**
 * Auto-apply (RW-05): run this Rewrite on every dictation after cleanup, with a minimum
 * length and the kinds of apps it applies in. `shadowedBy` names an auto-apply Rewrite
 * earlier in the list, which runs instead.
 */
export function RewriteAutoApplyControl({
  rewrite,
  shadowedBy,
  onChanged,
}: {
  rewrite: Rewrite;
  shadowedBy: string | null;
  onChanged: () => void;
}) {
  const current: RewriteAutoApply = {
    enabled: rewrite.autoApply,
    minWords: rewrite.autoApplyMinWords,
    categories: rewrite.autoApplyCategories,
  };
  const save = async (patch: Partial<RewriteAutoApply>) => {
    await window.murmur.rewritesSetAutoApply(rewrite.id, { ...current, ...patch });
    onChanged();
  };
  return (
    <VStack gap={1}>
      <Switch
        label="Apply to every dictation"
        description="Runs after cleanup; if it takes over 3 seconds, the text goes in as cleaned."
        value={rewrite.autoApply}
        onChange={(enabled) => void save({ enabled })}
      />
      {rewrite.autoApply ? (
        <>
          {shadowedBy ? (
            <Text size="sm" color="secondary">
              Only one Rewrite runs per dictation: {shadowedBy} is earlier in the list, so it runs
              instead.
            </Text>
          ) : null}
          <NumberInput
            label="Minimum words"
            description="Shorter dictations go in without it. 0 runs it on every dictation."
            value={rewrite.autoApplyMinWords}
            min={0}
            max={1000}
            step={1}
            onChange={(minWords) => void save({ minWords: Math.max(0, Math.round(minWords ?? 0)) })}
          />
          <CheckboxList
            label="In these apps"
            value={rewrite.autoApplyCategories}
            onChange={(values) =>
              void save({
                categories: REWRITE_CATEGORIES.filter((category) => values.includes(category)),
              })
            }
          >
            {REWRITE_CATEGORIES.map((category) => (
              <CheckboxListItem key={category} label={CATEGORY_NAMES[category]} value={category} />
            ))}
          </CheckboxList>
        </>
      ) : null}
    </VStack>
  );
}
