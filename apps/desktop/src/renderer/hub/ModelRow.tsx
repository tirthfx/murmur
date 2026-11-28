import { useCallback, useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { ModelId, ModelStatus } from "@murmur/shared";
import { formatBytes, modelProgress } from "./setup-steps";

/** How often a model that is downloading or being checked is read again. */
const POLL_MS = 1000;

const NAMES: Record<ModelId, { name: string; use: string }> = {
  speech: { name: "Speech model", use: "Turns your voice into text. Dictation needs it." },
  fast: {
    name: "Fast language model (default)",
    use: "Cleans up dictation, and writes Rewrites, summaries and drafts. Without it, cleanup uses rules only.",
  },
  quality: {
    name: "Quality language model",
    use: "Slower than Fast but writes better drafts. Optional.",
  },
};

const STATE_TEXT: Record<ModelStatus["state"], string> = {
  missing: "Not downloaded",
  corrupt: "Damaged: a file failed its check. Download it again to repair it",
  downloading: "Downloading",
  preparing: "Being checked",
  ready: "Ready. Every file passed its check",
  failed: "Not ready",
};

/** The models on this Mac and a way to read them again, following downloads (HB-15). */
export function useModels() {
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const read = useCallback(
    () =>
      window.murmur.modelsList().then(
        (next) => setModels(next),
        () => setProblem("Could not read the models."),
      ),
    [],
  );
  useEffect(() => void read(), [read]);
  const busy = models.some((m) => m.state === "downloading" || m.state === "preparing");
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void read(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [busy, read]);

  const act = useCallback((run: () => Promise<ModelStatus>) => {
    setProblem(null);
    run().then(
      (next) => setModels((all) => all.map((m) => (m.id === next.id ? next : m))),
      () => setProblem("That did not work."),
    );
  }, []);
  return { models, problem, act };
}

/** One model: what it is for, its size and state, and download, cancel or delete. */
export function ModelRow({
  model,
  act,
}: {
  model: ModelStatus;
  act: (run: () => Promise<ModelStatus>) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { name, use } = NAMES[model.id];
  const size = formatBytes(model.totalBytes);
  const absent = model.state === "missing" || model.state === "corrupt" || model.state === "failed";
  return (
    <VStack gap={1} role="group" aria-label={name}>
      <Text weight="semibold">{name}</Text>
      <Text size="sm" color="secondary">
        {use}
      </Text>
      <Text size="sm" color="secondary">
        {model.label}. Download {size}; about the same in memory while in use.
        {model.diskBytes > 0 ? ` On disk: ${formatBytes(model.diskBytes)}.` : ""}
      </Text>
      <Text size="sm" role="status">
        {STATE_TEXT[model.state]}.{model.message ? ` ${model.message}` : ""}
      </Text>
      {model.state === "downloading" ? (
        <VStack gap={1}>
          <ProgressBar label={`${name} download`} value={modelProgress(model)} max={100} />
          <Text size="sm" color="secondary">
            {formatBytes(model.downloadedBytes)} of {size} from {model.host}
          </Text>
        </VStack>
      ) : null}
      {absent ? (
        <Text size="sm" color="secondary">
          Downloads from {model.host}.
        </Text>
      ) : null}
      <HStack gap={2}>
        {absent ? (
          <Button
            size="sm"
            variant="secondary"
            label={`Download the ${name.toLowerCase()}`}
            onClick={() => act(() => window.murmur.modelDownload(model.id))}
          >
            {model.state === "missing" ? `Download (${size})` : "Download again"}
          </Button>
        ) : null}
        {model.state === "downloading" ? (
          <Button
            size="sm"
            variant="secondary"
            label={`Cancel the ${name.toLowerCase()} download`}
            onClick={() => act(() => window.murmur.modelCancel(model.id))}
          >
            Cancel download
          </Button>
        ) : null}
        {model.state !== "downloading" && model.diskBytes > 0 ? (
          confirming ? (
            <>
              <Button
                size="sm"
                variant="destructive"
                label={`Delete the ${name.toLowerCase()} files`}
                onClick={() => {
                  setConfirming(false);
                  act(() => window.murmur.modelRemove(model.id));
                }}
              >
                Delete {formatBytes(model.diskBytes)}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                label={`Keep the ${name.toLowerCase()}`}
                onClick={() => setConfirming(false)}
              >
                Keep it
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              label={`Remove the ${name.toLowerCase()}`}
              onClick={() => setConfirming(true)}
            >
              Delete…
            </Button>
          )
        ) : null}
      </HStack>
    </VStack>
  );
}

/** Every model on this Mac, or only one of them. */
export function Models({ only }: { only?: ModelId }) {
  const { models, problem, act } = useModels();
  return (
    <VStack gap={3}>
      {models
        .filter((model) => !only || model.id === only)
        .map((model) => (
          <ModelRow key={model.id} model={model} act={act} />
        ))}
      {problem ? (
        <Text size="sm" role="status">
          {problem}
        </Text>
      ) : null}
    </VStack>
  );
}
