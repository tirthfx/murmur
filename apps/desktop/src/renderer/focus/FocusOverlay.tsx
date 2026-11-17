import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { focusBlockedText, type FocusOverlayState, type MurmurFocusApi } from "@murmur/shared";

/**
 * The Focus overlay (RW-21): what is blocked, and three ways out. Clicking outside the card
 * does nothing; there is no close button.
 */
export function FocusOverlay({ api }: { api: MurmurFocusApi }) {
  const [state, setState] = useState<FocusOverlayState>({ stage: "hidden" });
  const backRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = api.onState(setState);
    void api.ready().then(setState);
    return unsubscribe;
  }, [api]);

  const name = state.stage === "blocked" ? state.name : null;
  useEffect(() => {
    if (name !== null) backRef.current?.querySelector("button")?.focus();
  }, [name]);

  if (state.stage === "hidden") return null;
  return (
    <div className="focus-overlay">
      <div className="focus-card" role="alertdialog" aria-labelledby="focus-blocked">
        <Text size="lg" weight="semibold" id="focus-blocked">
          {focusBlockedText(state.name)}
        </Text>
        <HStack gap={2} justify="center" wrap="wrap">
          <div ref={backRef}>
            <Button label="Go back to the previous app" onClick={() => void api.goBack()}>
              Go back
            </Button>
          </div>
          <Button
            variant="secondary"
            label="Pause Focus for 10 minutes"
            onClick={() => void api.pause()}
          >
            Pause Focus for 10 minutes
          </Button>
          <Button variant="ghost" label="Turn off Focus" onClick={() => void api.turnOff()}>
            Turn off Focus
          </Button>
        </HStack>
      </div>
    </div>
  );
}
