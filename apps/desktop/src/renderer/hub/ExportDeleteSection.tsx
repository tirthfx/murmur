import { useCallback, useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
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
} from "@murmur/shared";

function size(bytes: number): string {
  if (bytes === 0) return "";
  return bytes < 1024 * 1024
    ? ` · ${Math.ceil(bytes / 1024)} KB`
    : ` · ${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** HB-46: export chosen categories to a folder the user picks. */
function ExportPart() {
  const [chosen, setChosen] = useState<Set<ExportCategory>>(new Set(DEFAULT_EXPORT));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.murmur.dataExport({
        categories: EXPORT_CATEGORIES.filter((category) => chosen.has(category)),
      });
      if (result.ok) {
        const total = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
        setMessage({
          text: `Exported ${total.toLocaleString()} items to ${result.folder}.`,
          error: false,
        });
      } else if (!result.canceled) {
        setMessage({ text: result.message, error: true });
      }
    } finally {
      setBusy(false);
    }
  }

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
            isDisabled={busy || chosen.size === 0}
            onClick={() => void run()}
          >
            {busy ? "Exporting…" : "Export…"}
          </Button>
        </div>
        {message ? (
          message.error ? (
            <Banner status="error" title={message.text} />
          ) : (
            <Text size="sm" role="status">
              {message.text}
            </Text>
          )
        ) : null}
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
