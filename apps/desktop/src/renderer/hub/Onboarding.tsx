import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { VStack } from "@astryxdesign/core/VStack";
import type {
  PermissionKind,
  PermissionsInfo,
  RequestablePermissionKind,
  SettingsView,
  SetupStatus,
} from "@murmur/shared";
import { PERMISSION_COPY, STATUS_BADGE_VARIANT, STATUS_LABEL } from "./permissions";
import { ShortcutField } from "./ShortcutField";
import {
  SETUP_STEPS,
  STEP_TITLES,
  blockerLines,
  formatBytes,
  isPermissionStep,
  modelProgress,
  type SetupStepId,
} from "./setup-steps";

/** How often the model and readiness status is read while the setup screen is open. */
const POLL_MS = 1000;

interface OnboardingProps {
  /** True when opened again from Settings: the flow can be closed at any step. */
  isRevisit: boolean;
  /** Called after the last step, or when a revisit is closed. */
  onFinished: () => void;
}

/**
 * First-run setup (DC-44): permissions, the speech model, the shortcut and a test dictation.
 * Nothing here needs an account, and nothing is requested from the system until the user
 * presses a button. Statuses are read again each time the window regains focus.
 */
export function Onboarding({ isRevisit, onFinished }: OnboardingProps) {
  const [index, setIndex] = useState(0);
  const [permissions, setPermissions] = useState<PermissionsInfo | null>(null);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [view, setView] = useState<SettingsView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState("");
  const mounted = useRef(true);
  const sampleBox = useRef<HTMLTextAreaElement>(null);
  const step: SetupStepId = SETUP_STEPS[index] ?? "welcome";

  const refresh = useCallback(() => {
    window.murmur.getPermissions().then(
      (value) => mounted.current && setPermissions(value),
      () => mounted.current && setProblem("Could not read permission status."),
    );
    window.murmur.getSetupStatus().then(
      (value) => mounted.current && setStatus(value),
      () => undefined,
    );
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    window.murmur.getSettings().then(
      (value) => mounted.current && setView(value),
      () => undefined,
    );
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(() => {
      window.murmur.getSetupStatus().then(
        (value) => mounted.current && setStatus(value),
        () => undefined,
      );
    }, POLL_MS);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (step === "try") sampleBox.current?.focus();
  }, [step]);

  const next = () => {
    setProblem(null);
    setIndex((value) => Math.min(value + 1, SETUP_STEPS.length - 1));
  };
  const back = () => {
    setProblem(null);
    setIndex((value) => Math.max(value - 1, 0));
  };

  const request = (kind: RequestablePermissionKind) => {
    setBusy(true);
    window.murmur
      .requestPermission(kind)
      .then(
        (value) => {
          if (!mounted.current) return;
          setPermissions(value);
          setProblem(null);
        },
        () => mounted.current && setProblem(`Could not request ${PERMISSION_COPY[kind].title}.`),
      )
      .finally(() => mounted.current && setBusy(false));
  };

  const openSettings = (kind: PermissionKind) => {
    window.murmur.openPermissionSettings(kind).catch(() => {
      if (mounted.current) setProblem("Could not open System Settings.");
    });
  };

  const download = () => {
    window.murmur.downloadSpeechModel().then(
      (value) => mounted.current && setStatus(value),
      () => mounted.current && setProblem("The download could not start."),
    );
  };

  const finish = () => {
    setBusy(true);
    window.murmur.updateSettings({ setupComplete: true }).then(
      () => onFinished(),
      () => {
        if (!mounted.current) return;
        setBusy(false);
        setProblem("Setup could not be saved. Try again.");
      },
    );
  };

  const holdLabel = view?.shortcutLabels.hold ?? "the dictation key";
  const blockers = status?.blockers ?? [];
  let body: ReactNode;
  /** The main button of the step. */
  let primary = { text: "Continue", isDisabled: false, onClick: next };
  /** Shown next to the main button when the step can be left unfinished. */
  let canSkip = false;

  if (step === "welcome") {
    body = (
      <VStack gap={3}>
        <Text>Murmur turns what you say into text in whatever app you are using.</Text>
        <Text>
          Everything runs on this Mac. Your voice and your words are not sent anywhere, and there is
          no account to create.
        </Text>
        <Text color="secondary">
          The next steps ask for three macOS permissions, download the speech model, and let you try
          a first dictation. It takes about two minutes.
        </Text>
      </VStack>
    );
    primary = { ...primary, text: "Get started" };
  } else if (isPermissionStep(step)) {
    const kind = step;
    const copy = PERMISSION_COPY[kind];
    const current = permissions?.statuses[kind] ?? null;
    const granted = current === "granted";
    body = (
      <VStack gap={3}>
        <HStack gap={2} align="center">
          <Text weight="medium">Status</Text>
          <span data-testid="setup-permission-status">
            <Badge
              variant={current ? STATUS_BADGE_VARIANT[current] : "neutral"}
              label={current ? STATUS_LABEL[current] : "Checking"}
            />
          </span>
        </HStack>
        <Text>{copy.reason}</Text>
        {current === "denied" ? (
          <Banner
            status="warning"
            title={`Murmur does not have ${copy.title} access`}
            description="Turn it on in System Settings, then come back to this window. The status updates by itself."
          />
        ) : null}
        {granted ? null : (
          <HStack gap={2}>
            <Button
              variant="primary"
              label={`Allow ${copy.title}`}
              isDisabled={busy}
              onClick={() => request(kind)}
            >
              Allow
            </Button>
            <Button
              variant="secondary"
              label={`Open System Settings for ${copy.title}`}
              onClick={() => openSettings(kind)}
            >
              Open System Settings
            </Button>
          </HStack>
        )}
      </VStack>
    );
    primary = { ...primary, isDisabled: !granted };
    canSkip = !granted;
  } else if (step === "model") {
    const model = status?.model ?? null;
    const ready = model?.state === "ready";
    body = (
      <VStack gap={3}>
        <Text>
          The speech model turns your voice into text on this Mac. It is downloaded once
          {model ? ` (${model.label}, ${formatBytes(model.totalBytes)})` : ""} and every file is
          checked before it is used.
        </Text>
        {model === null || model.state === "preparing" ? (
          <Text color="secondary" data-testid="setup-model-state">
            Checking the model…
          </Text>
        ) : null}
        {ready ? <Banner status="success" title="The speech model is ready" /> : null}
        {model?.state === "downloading" ? (
          <VStack gap={1}>
            <ProgressBar label="Download progress" value={modelProgress(model)} max={100} />
            <Text size="sm" color="secondary" data-testid="setup-model-progress">
              {formatBytes(model.downloadedBytes)} of {formatBytes(model.totalBytes)}
            </Text>
          </VStack>
        ) : null}
        {model?.state === "failed" ? (
          <Banner
            status="error"
            title="The speech model is not ready"
            description={model.message ?? undefined}
          />
        ) : null}
        {model?.state === "missing" || model?.state === "failed" ? (
          <HStack gap={2}>
            <Button variant="primary" label="Download the speech model" onClick={download}>
              {model.state === "failed" ? "Try again" : "Download"}
            </Button>
          </HStack>
        ) : null}
      </VStack>
    );
    primary = { ...primary, isDisabled: !ready };
    canSkip = !ready;
  } else if (step === "shortcut") {
    body = (
      <VStack gap={3}>
        <Text>Hold this key to dictate and release it to insert the text.</Text>
        {view ? (
          <ShortcutField
            slot="hold"
            title="Push to talk"
            description="Works in every app."
            label={view.shortcutLabels.hold}
            canClear={false}
            onSaved={setView}
          />
        ) : null}
        <Text color="secondary">
          Tap it twice quickly to keep recording without holding. You can change shortcuts later in
          Settings.
        </Text>
      </VStack>
    );
  } else if (step === "try") {
    const lines = blockerLines(blockers);
    body = (
      <VStack gap={3}>
        <Text>
          Click in the box, hold {holdLabel}, say a sentence, then release. Your words appear in the
          box.
        </Text>
        {lines.length > 0 ? (
          <Banner
            status="warning"
            title="Dictation is not ready yet"
            description={lines.join(" ")}
          />
        ) : null}
        <TextArea
          ref={sampleBox}
          label="Test box"
          placeholder="Your words appear here"
          rows={4}
          value={sample}
          onChange={setSample}
        />
        {sample.trim().length > 0 ? <Banner status="success" title="It works" /> : null}
      </VStack>
    );
    primary = { ...primary, text: sample.trim().length > 0 ? "Continue" : "Skip" };
  } else {
    const lines = blockerLines(blockers);
    body =
      lines.length > 0 ? (
        <VStack gap={3}>
          <Banner
            status="warning"
            title="Dictation will not start until these are done"
            description={lines.join(" ")}
          />
          <Text color="secondary">
            You can finish them later: Settings has every step of this setup.
          </Text>
        </VStack>
      ) : (
        <VStack gap={3}>
          <Banner status="success" title="Murmur is ready" />
          <Text>
            Hold {holdLabel} in any app to dictate. The microphone in the menu bar has the same
            controls.
          </Text>
        </VStack>
      );
    primary = { text: "Finish", isDisabled: busy, onClick: finish };
  }

  return (
    <main className="hub-setup" data-testid="setup">
      <div className="hub-drag-region" aria-hidden="true" />
      <div className="hub-setup-card">
        <HStack gap={2} align="center" justify="between">
          <Text size="sm" color="secondary" data-testid="setup-progress">
            Step {index + 1} of {SETUP_STEPS.length}
          </Text>
          {isRevisit ? (
            <Button size="sm" variant="ghost" label="Close setup" onClick={onFinished}>
              Close
            </Button>
          ) : null}
        </HStack>
        <Heading level={1}>
          {step === "done" && blockers.length > 0 ? "Almost there" : STEP_TITLES[step]}
        </Heading>
        {body}
        {problem ? <Banner status="error" title={problem} /> : null}
        <HStack gap={2} className="hub-setup-actions">
          {index > 0 ? (
            <Button variant="ghost" label="Back" onClick={back}>
              Back
            </Button>
          ) : null}
          <span className="hub-setup-spacer" />
          {canSkip ? (
            <Button variant="secondary" label="Skip for now" onClick={next}>
              Skip for now
            </Button>
          ) : null}
          <Button
            variant="primary"
            label={primary.text}
            isDisabled={primary.isDisabled}
            onClick={primary.onClick}
          >
            {primary.text}
          </Button>
        </HStack>
      </div>
    </main>
  );
}
