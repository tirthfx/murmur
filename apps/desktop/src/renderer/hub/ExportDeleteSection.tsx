import { useCallback, useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  DEFAULT_EXPORT,
  DELETE_LABELS,
  EXPORT_CATEGORIES,
  EXPORT_LABELS,
  type DataCounts,
  type DeleteCategory,
  type ExportCategory,
  type ExportStatus,
} from "@murmur/shared";

function size(bytes: number): string {
  if (bytes === 0) return "";
  return bytes < 1024 * 1024
    ? ` · ${Math.ceil(bytes / 1024)} KB`
    : ` · ${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** How often a running export is asked how far it is. */
const POLL_MS = 500;

/** HB-46: export chosen categories to a folder the user picks, in the background. */
function ExportPart() {
  const [chosen, setChosen] = useState<Set<ExportCategory>>(new Set(DEFAULT_EXPORT));
  const [status, setStatus] = useState<ExportStatus>({ state: "idle" });
  const [choosing, setChoosing] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const read = useCallback(
    () =>
      window.murmur.dataExportStatus().then(
        (next) => setStatus(next),
        () => setRefusal("The export could not be followed."),
      ),
    [],
  );
  // An export started earlier may still be running, or have finished while the page was closed.
  useEffect(() => void read(), [read]);
  const running = status.state === "running";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void read(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, read]);

  async function run() {
    setChoosing(true);
    setRefusal(null);
    try {
      const result = await window.murmur.dataExport({
        categories: EXPORT_CATEGORIES.filter((category) => chosen.has(category)),
      });
      if (result.ok) await read();
      else if (!result.canceled) setRefusal(result.message);
    } finally {
      setChoosing(false);
    }
  }

  const total =
    status.state === "done" ? Object.values(status.counts).reduce((sum, n) => sum + n, 0) : 0;

  return (
    <section data-setting="export" className="hub-setting-row">
      <VStack gap={2}>
        <Heading level={3}>Export</Heading>
        <Text size="sm" color="secondary">
          Writes a folder you choose, with a README listing the files and counts. Models and keys
          are never included.
        </Text>
        <VStack gap={1} role="group" aria-label="What to export">
          {EXPORT_CATEGORIES.map((category) => (
            <CheckboxInput
              key={category}
              label={EXPORT_LABELS[category]}
              value={chosen.has(category)}
              onChange={(on) =>
                setChosen((current) => {
                  const next = new Set(current);
                  if (on) next.add(category);
                  else next.delete(category);
                  return next;
                })
              }
            />
          ))}
        </VStack>
        <div>
          <Button
            variant="secondary"
            label="Export the chosen data"
            isDisabled={choosing || running || chosen.size === 0}
            onClick={() => void run()}
          >
            {running ? "Exporting…" : "Export…"}
          </Button>
        </div>
        {status.state === "running" ? (
          <VStack gap={1}>
            <ProgressBar label="Export progress" value={status.done} max={status.total} />
            <Text size="sm" color="secondary" role="status">
              Writing {EXPORT_LABELS[status.category]}. You can keep using Murmur.
            </Text>
          </VStack>
        ) : null}
        {status.state === "done" ? (
          <Text size="sm" role="status">
            Exported {total.toLocaleString()} items to {status.folder}.
          </Text>
        ) : null}
        {status.state === "failed" ? <Banner status="error" title={status.message} /> : null}
        {refusal ? <Banner status="error" title={refusal} /> : null}
      </VStack>
    </section>
  );
}

/** HB-47: delete one category, or everything and start again. */
function DeletePart() {
  const [counts, setCounts] = useState<DataCounts | null>(null);
  const [confirming, setConfirming] = useState<DeleteCategory | "all" | null>(null);
  const [withModels, setWithModels] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setCounts(await window.murmur.dataCounts());
  }, []);

  useEffect(() => {
    void load().catch(() => setMessage("The counts could not be read."));
  }, [load]);

  async function remove(category: DeleteCategory) {
    if (confirming !== category) {
      setConfirming(category);
      return;
    }
    setConfirming(null);
    const result = await window.murmur.dataDelete(category);
    setMessage(
      `${DELETE_LABELS[category]}: deleted ${result.rows.toLocaleString()} ${result.rows === 1 ? "item" : "items"}${
        result.files ? ` and ${result.files} files` : ""
      }.`,
    );
    await load();
  }

  async function reset() {
    if (confirming !== "all") {
      setConfirming("all");
      return;
    }
    setConfirming(null);
    await window.murmur.dataReset({ includeModels: withModels });
    setMessage("Everything was deleted. Murmur is starting again at first-run setup.");
  }

  return (
    <section data-setting="delete" className="hub-setting-row">
      <VStack gap={2}>
        <Heading level={3}>Delete data</Heading>
        <Text size="sm" color="secondary">
          Deleting is permanent and cannot be undone. Each category is deleted on its own.
        </Text>
        {counts ? (
          <ul className="hub-history-list" aria-label="Data by category">
            {counts.categories.map((item) => (
              <li key={item.category}>
                <HStack gap={2} align="center" justify="between" wrap="wrap">
                  <Text>
                    {DELETE_LABELS[item.category]}: {item.count.toLocaleString()}
                    {size(item.bytes)}
                  </Text>
                  <Button
                    size="sm"
                    variant={confirming === item.category ? "destructive" : "ghost"}
                    label={
                      confirming === item.category
                        ? `Confirm deleting ${DELETE_LABELS[item.category]}`
                        : `Delete ${DELETE_LABELS[item.category]}`
                    }
                    isDisabled={item.count === 0 && item.bytes === 0}
                    onClick={() => void remove(item.category)}
                  >
                    {confirming === item.category
                      ? `Delete ${item.count.toLocaleString()}: this cannot be undone`
                      : "Delete"}
                  </Button>
                </HStack>
              </li>
            ))}
          </ul>
        ) : null}
        {counts && counts.failedFiles > 0 ? (
          <HStack gap={2} align="center">
            <Text size="sm" role="alert">
              {counts.failedFiles} files could not be removed.
            </Text>
            <Button
              size="sm"
              variant="secondary"
              label="Try removing the files again"
              onClick={() => void window.murmur.dataRetryFailed().then(load)}
            >
              Retry
            </Button>
          </HStack>
        ) : null}
        <VStack gap={1}>
          <Text weight="semibold">Delete all data and reset</Text>
          <Text size="sm" color="secondary">
            Deletes every category above, your custom Rewrites, Focus lists and settings, then
            starts again at first-run setup.
          </Text>
          <CheckboxInput
            label="Also delete downloaded models"
            value={withModels}
            onChange={setWithModels}
          />
          <div>
            <Button
              variant={confirming === "all" ? "destructive" : "secondary"}
              label={
                confirming === "all" ? "Confirm deleting all data" : "Delete all data and reset"
              }
              onClick={() => void reset()}
            >
              {confirming === "all"
                ? "Delete everything: this cannot be undone"
                : "Delete all data…"}
            </Button>
          </div>
        </VStack>
        {confirming ? (
          <div>
            <Button
              size="sm"
              variant="ghost"
              label="Cancel deleting"
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
          </div>
        ) : null}
        {message ? (
          <Text size="sm" role="status">
            {message}
          </Text>
        ) : null}
      </VStack>
    </section>
  );
}

/** Settings, Data and Privacy: export and delete (HB-46, HB-47). */
export function ExportDeleteSection() {
  return (
    <VStack gap={4}>
      <ExportPart />
      <DeletePart />
    </VStack>
  );
}
