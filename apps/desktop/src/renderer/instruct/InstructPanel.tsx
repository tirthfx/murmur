import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import {
  INSTRUCT_SOURCE_LABELS,
  type InstructPanelState,
  type InstructSource,
  type MurmurInstructApi,
} from "@murmur/shared";

type Shown = Exclude<InstructPanelState, { stage: "hidden" }>;

/**
 * The context chips (RW-17): one per source this draft could use. Pressed means used; pressing
 * one turns it off (or back on) for this thread and writes the draft again.
 */
function SourceChips({ api, state }: { api: MurmurInstructApi; state: Shown }) {
  if (state.available.length === 0) return null;
  const used = state.stage === "draft" ? state.used : null;
  return (
    <HStack gap={1} wrap="wrap" role="group" aria-label="Context used">
      {state.available.map((source: InstructSource) => {
        const on = !state.off.includes(source);
        const label = INSTRUCT_SOURCE_LABELS[source];
        return (
          <ToggleButton
            key={source}
            size="sm"
            label={on ? `Stop using ${label} for this draft` : `Use ${label} for this draft`}
            isPressed={used ? used.includes(source) : on}
            isDisabled={state.stage === "running"}
            onPressedChange={() => void api.toggleSource(source)}
          >
            {label}
          </ToggleButton>
        );
      })}
    </HStack>
  );
}

/** The Instruct panel (RW-11). Main holds the thread; this page shows it. */
export function InstructPanel({ api }: { api: MurmurInstructApi }) {
  const [state, setState] = useState<InstructPanelState>({ stage: "hidden" });
  const insertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = api.onState(setState);
    void api.ready().then(setState);
    return unsubscribe;
  }, [api]);

  // Escape closes from anywhere in the panel.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void api.close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api]);

  const draftText = state.stage === "draft" ? state.text : null;
  useEffect(() => {
    if (draftText !== null) insertRef.current?.querySelector("button")?.focus();
  }, [draftText]);

  if (state.stage === "hidden") return null;
  return (
    <div className="rewrite-card" role="dialog" aria-label="Instruct">
      <Text weight="semibold">Instruct</Text>
      <Text size="sm" color="secondary" className="instruct-asked">
        “{state.instruction}”
      </Text>
      <SourceChips api={api} state={state} />
      {state.stage === "running" ? (
        <div className="rewrite-output" aria-live="polite" aria-busy="true">
          {state.text || (state.loading ? "Loading model…" : "Writing…")}
        </div>
      ) : null}
      {state.stage === "draft" ? (
        <>
          <div className="rewrite-output" aria-label="Draft">
            {state.text}
          </div>
          {state.note ? (
            <Text size="sm" className="instruct-note" role="note">
              {state.note}
            </Text>
          ) : null}
        </>
      ) : null}
      {state.stage === "message" ? (
        <div className="rewrite-output" role="status">
          {state.message}
        </div>
      ) : null}
      <HStack gap={2} justify="end" wrap="wrap">
        {state.stage === "running" ? (
          <Button variant="ghost" label="Discard" onClick={() => void api.close()}>
            Discard
          </Button>
        ) : (
          <>
            <Button variant="ghost" label="Discard" onClick={() => void api.close()}>
              Discard
            </Button>
            <Button variant="ghost" label="Write it again" onClick={() => void api.regenerate()}>
              {state.stage === "message" && state.canRetry ? "Try again" : "Regenerate"}
            </Button>
          </>
        )}
        {state.stage === "draft" ? (
          <>
            <Button variant="secondary" label="Copy" onClick={() => void api.copy()}>
              Copy
            </Button>
            <div ref={insertRef}>
              <Button label="Insert at the caret" onClick={() => void api.insert()}>
                Insert
              </Button>
            </div>
          </>
        ) : null}
      </HStack>
    </div>
  );
}
