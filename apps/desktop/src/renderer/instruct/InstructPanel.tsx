import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import {
  INSTRUCT_LIMITS,
  INSTRUCT_MESSAGES,
  INSTRUCT_SOURCE_LABELS,
  type InstructPanelState,
  type InstructSource,
  type MurmurInstructApi,
} from "@murmur/shared";

type InThread = Exclude<InstructPanelState, { stage: "hidden" } | { stage: "empty" }>;

/**
 * The context chips (RW-17): one per source this draft could use. Pressed means used; pressing
 * one turns it off (or back on) for this thread and writes the draft again.
 */
function SourceChips({ api, state }: { api: MurmurInstructApi; state: InThread }) {
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

/** The model for the next request (RW-15). Quality waits for its download. */
function ModelSwitch({ api, state }: { api: MurmurInstructApi; state: InThread }) {
  return (
    <HStack gap={2} align="center" wrap="wrap">
      <SegmentedControl
        size="sm"
        label="Model for the next request"
        value={state.model}
        onChange={(value) => void api.setModel(value === "quality" ? "quality" : "fast")}
      >
        <SegmentedControlItem value="fast" label="Fast" />
        <SegmentedControlItem value="quality" label="Quality" />
      </SegmentedControl>
      {state.qualityAvailable ? null : (
        <Text size="sm" color="secondary">
          {INSTRUCT_MESSAGES.downloadQuality}
        </Text>
      )}
    </HStack>
  );
}

/** Typed requests (RW-12): a follow-up, or a new thread's first request. */
function AskField({
  api,
  label,
  disabled,
}: {
  api: MurmurInstructApi;
  label: string;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const send = () => {
    const request = text.trim();
    if (request === "" || disabled) return;
    setText("");
    void api.followUp(request.slice(0, INSTRUCT_LIMITS.followUpChars));
  };
  return (
    <HStack gap={2} align="end">
      <TextInput
        label={label}
        isLabelHidden
        placeholder={label}
        value={text}
        onChange={setText}
        onEnter={send}
        isDisabled={disabled}
        width="100%"
      />
      <Button
        size="sm"
        variant="secondary"
        label="Send the request"
        isDisabled={disabled || text.trim() === ""}
        onClick={send}
      >
        Send
      </Button>
    </HStack>
  );
}

/** The Instruct panel (RW-11, RW-12). Main holds the thread; this page shows it. */
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
      // Control+Z (panel only, RW-13): take the last inserted draft out of the app again.
      // Command+Z stays the text box's own undo.
      if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void api.undo();
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
  if (state.stage === "empty") {
    return (
      <div className="rewrite-card" role="dialog" aria-label="Instruct">
        <Text weight="semibold">Instruct</Text>
        <div className="rewrite-output" role="status">
          {INSTRUCT_MESSAGES.newThread}
        </div>
        <AskField api={api} label="What should Murmur write?" disabled={false} />
        <HStack gap={2} justify="end">
          <Button variant="ghost" label="Close" onClick={() => void api.close()}>
            Close
          </Button>
        </HStack>
      </div>
    );
  }
  const atLimit = state.turns >= INSTRUCT_LIMITS.turns;
  return (
    <div className="rewrite-card" role="dialog" aria-label="Instruct">
      <HStack gap={2} align="center" justify="between">
        <Text weight="semibold">Instruct</Text>
        <Button
          size="sm"
          variant="ghost"
          label="Start a new thread"
          onClick={() => void api.newThread()}
        >
          New thread
        </Button>
      </HStack>
      {state.earlier.length > 0 ? (
        <ol className="instruct-earlier" aria-label="Earlier requests">
          {state.earlier.map((request, index) => (
            <li key={index}>{request}</li>
          ))}
        </ol>
      ) : null}
      <Text size="sm" color="secondary" className="instruct-asked">
        “{state.instruction}”
      </Text>
      <SourceChips api={api} state={state} />
      <ModelSwitch api={api} state={state} />
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
      {state.stage === "draft" ? (
        atLimit ? (
          <Text size="sm" className="instruct-note" role="status">
            {INSTRUCT_MESSAGES.turnLimit}
          </Text>
        ) : (
          <AskField api={api} label="Ask for a change" disabled={false} />
        )
      ) : null}
      <HStack gap={2} justify="end" wrap="wrap">
        <Button variant="ghost" label="Discard" onClick={() => void api.close()}>
          Discard
        </Button>
        {state.stage !== "running" ? (
          <Button variant="ghost" label="Write it again" onClick={() => void api.regenerate()}>
            {state.stage === "message" && state.canRetry ? "Try again" : "Regenerate"}
          </Button>
        ) : null}
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
