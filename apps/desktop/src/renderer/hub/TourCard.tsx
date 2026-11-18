import { useEffect } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { Tour } from "@murmur/shared";

const HIGHLIGHT = "hub-tour-target";

/**
 * One step of a guided tour (HB-08): the page is shown, its part highlighted, and the card
 * says what it is. Back, Next and Stop; the step is remembered so a tour can be resumed.
 */
export function TourCard({
  tour,
  step,
  onStep,
  onStop,
}: {
  tour: Tour;
  step: number;
  onStep: (step: number) => void;
  onStop: (finished: boolean) => void;
}) {
  const current = tour.steps[step];

  useEffect(() => {
    if (!current) return;
    if (window.location.hash !== current.hash) window.location.hash = current.hash;
    let tries = 0;
    let timer = 0;
    let target: Element | null = null;
    const find = () => {
      target = document.querySelector(current.target);
      if (target) {
        target.classList.add(HIGHLIGHT);
        (target as HTMLElement).scrollIntoView?.({ block: "center" });
        return;
      }
      if (++tries < 30) timer = window.setTimeout(find, 100);
    };
    find();
    return () => {
      window.clearTimeout(timer);
      target?.classList.remove(HIGHLIGHT);
    };
  }, [current]);

  if (!current) return null;
  const last = step === tour.steps.length - 1;

  return (
    <div className="hub-tour" role="dialog" aria-label={`${tour.title}, step ${step + 1}`}>
      <VStack gap={2}>
        <Text size="sm" color="secondary">
          {tour.title} · step {step + 1} of {tour.steps.length}
        </Text>
        <Text weight="semibold">{current.title}</Text>
        <Text>{current.text}</Text>
        <HStack gap={1} justify="between">
          <Button size="sm" variant="ghost" label="Stop the tour" onClick={() => onStop(false)}>
            Stop
          </Button>
          <HStack gap={1}>
            <Button
              size="sm"
              variant="ghost"
              label="Previous step"
              isDisabled={step === 0}
              onClick={() => onStep(step - 1)}
            >
              Back
            </Button>
            <Button
              size="sm"
              label={last ? "Finish the tour" : "Next step"}
              onClick={() => (last ? onStop(true) : onStep(step + 1))}
            >
              {last ? "Finish" : "Next"}
            </Button>
          </HStack>
        </HStack>
      </VStack>
    </div>
  );
}
