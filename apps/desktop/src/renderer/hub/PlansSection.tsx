import { useCallback, useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  PLAN_MESSAGES,
  TRIAL,
  trialDaysLeft,
  type PlanAction,
  type PlanTier,
  type PlanView,
} from "@murmur/shared";
import { PlanField } from "./PlanField";

const when = (epoch: number) =>
  new Date(epoch).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Settings, Plans (HB-19): the local tier switch, Free's weekly limit, a trial and a log. */
export function PlansSection({
  tier,
  onTier,
}: {
  tier: PlanTier;
  onTier: (tier: PlanTier) => void;
}) {
  const [view, setView] = useState<PlanView | null>(null);

  const load = useCallback(async () => {
    setView(await window.murmur.planView());
  }, []);

  useEffect(() => {
    void load().catch(() => {});
  }, [load, tier]);

  const act = async (action: PlanAction) => {
    setView(await window.murmur.planAct(action));
  };

  const trial = view?.state.trial ?? null;
  const daysLeft = trial ? trialDaysLeft(trial.endsAt, Date.now()) : 0;

  return (
    <VStack gap={4}>
      <Text weight="semibold" data-testid="no-charge">
        {PLAN_MESSAGES.noCharge}
      </Text>
      <PlanField plan={tier} onChange={onTier} />

      {view && view.weeklyLimit !== null ? (
        <section aria-labelledby="weekly-heading">
          <VStack gap={1}>
            <Heading level={3} id="weekly-heading">
              Weekly limit
            </Heading>
            <Text data-testid="weekly-usage">
              {view.weekWords.toLocaleString()} of {view.weeklyLimit.toLocaleString()} words this
              week.
            </Text>
            <Text size="sm" color="secondary">
              On Free, dictation stops at the limit with “{PLAN_MESSAGES.weeklyLimit}” History stays
              open. Any other plan has no limit.
            </Text>
          </VStack>
        </section>
      ) : null}

      <section aria-labelledby="trial-heading">
        <VStack gap={2}>
          <Heading level={3} id="trial-heading">
            Trial
          </Heading>
          {trial ? (
            <>
              <Text data-testid="trial-state">
                Trial of Pro: {daysLeft} {daysLeft === 1 ? "day" : "days"} left (ends{" "}
                {when(trial.endsAt)}).
              </Text>
              <HStack gap={2}>
                <Button
                  size="sm"
                  variant="secondary"
                  label={`Extend the trial by ${TRIAL.extendDays} days`}
                  isDisabled={trial.extended}
                  onClick={() => void act({ type: "extendTrial" })}
                >
                  {trial.extended ? "Already extended" : `Extend by ${TRIAL.extendDays} days`}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  label="End the trial now"
                  onClick={() => void act({ type: "endTrial" })}
                >
                  End trial
                </Button>
              </HStack>
            </>
          ) : (
            <>
              <Text size="sm" color="secondary">
                A {TRIAL.days}-day trial puts the plan on Pro, then goes back to the plan before. It
                can be extended once by {TRIAL.extendDays} days.
              </Text>
              <div>
                <Button
                  size="sm"
                  variant="secondary"
                  label={`Start a ${TRIAL.days}-day trial of Pro`}
                  onClick={() => void act({ type: "startTrial" })}
                >
                  Start trial
                </Button>
              </div>
            </>
          )}
        </VStack>
      </section>

      <Switch
        label="Student"
        description="A label only; it changes nothing else."
        value={view?.state.student ?? false}
        onChange={(on) => void act({ type: "student", on })}
      />

      {view && view.state.log.length > 0 ? (
        <section aria-labelledby="plan-log-heading">
          <VStack gap={1}>
            <Heading level={3} id="plan-log-heading">
              Changes
            </Heading>
            <ul className="hub-storage-list" aria-label="Plan changes">
              {view.state.log.map((entry) => (
                <li key={`${entry.at}-${entry.text}`}>
                  {when(entry.at)}: {entry.text}
                </li>
              ))}
            </ul>
          </VStack>
        </section>
      ) : null}
    </VStack>
  );
}
