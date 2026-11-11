import { useCallback, useEffect, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { MEMORY_LIMITS, type MemoryItem, type Settings } from "@murmur/shared";

interface Draft {
  id?: string;
  text: string;
  keywords: string;
  enabled: boolean;
}

const EMPTY: Draft = { text: "", keywords: "", enabled: true };

/** "sign off, email" → ["sign off", "email"]; empty means pick them from the text. */
export function parseKeywords(value: string): string[] | null {
  const list = value
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

const dateOf = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** The Memory page (PZ-18, PZ-19): facts the cleanup model may use, all kept on this Mac. */
export function MemoryPage() {
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [settings, setSettings] = useState<Settings["memory"] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [problem, setProblem] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await window.murmur.memoryList());
    } catch {
      setItems([]);
      setProblem("Memory could not be read.");
    }
  }, []);

  useEffect(() => {
    void reload();
    window.murmur.getSettings().then(
      (view) => setSettings(view.settings.memory),
      () => setSettings(null),
    );
  }, [reload]);

  async function updateSettings(patch: Partial<Settings["memory"]>) {
    if (!settings) return;
    const view = await window.murmur.updateSettings({ memory: { ...settings, ...patch } });
    setSettings(view.settings.memory);
  }

  async function save(next: Draft) {
    const result = await window.murmur.memorySave({
      ...(next.id ? { id: next.id } : {}),
      text: next.text,
      keywords: parseKeywords(next.keywords),
      enabled: next.enabled,
    });
    if (!result.ok) {
      setProblem(result.message);
      return false;
    }
    setProblem(null);
    await reload();
    return true;
  }

  return (
    <VStack gap={4}>
      <Text color="secondary">
        Short facts for the cleanup model, for example “Sign emails as Tirth” or “The office is in
        Pune”. A fact is used only when one of its keywords is in what you dictate or on screen, and
        it never adds words to your text. Nothing leaves this Mac.
      </Text>

      {settings ? (
        <VStack gap={2}>
          <Switch
            label="Use Memory"
            description="Give relevant facts to the cleanup model."
            value={settings.enabled}
            onChange={(enabled) => void updateSettings({ enabled })}
          />
          <Switch
            label="Save facts by voice"
            description="Start a dictation with “remember that” to be asked whether to save the rest. Nothing is saved until you choose Save on the Bar."
            value={settings.fromDictation}
            onChange={(fromDictation) => void updateSettings({ fromDictation })}
          />
        </VStack>
      ) : null}

      <section aria-labelledby="memory-form-heading">
        <VStack gap={2}>
          <Text weight="semibold" id="memory-form-heading">
            {draft.id ? "Change fact" : "Add a fact"}
          </Text>
          <TextArea
            label="Fact"
            description={`Up to ${MEMORY_LIMITS.textLength} characters.`}
            rows={2}
            value={draft.text}
            onChange={(text) => setDraft({ ...draft, text })}
          />
          <TextInput
            label="Keywords"
            isOptional
            description="Separated by commas. Leave empty to pick them from the fact."
            value={draft.keywords}
            onChange={(keywords) => setDraft({ ...draft, keywords })}
          />
          <HStack gap={2}>
            <Button
              label={draft.id ? "Save changes" : "Add fact"}
              isDisabled={draft.text.trim() === ""}
              onClick={async () => {
                if (await save(draft)) setDraft(EMPTY);
              }}
            >
              {draft.id ? "Save changes" : "Add fact"}
            </Button>
            {draft.id ? (
              <Button variant="ghost" label="Cancel" onClick={() => setDraft(EMPTY)}>
                Cancel
              </Button>
            ) : null}
          </HStack>
          {problem ? <Banner status="error" title={problem} /> : null}
        </VStack>
      </section>

      <section aria-labelledby="memory-list-heading">
        <VStack gap={2}>
          <Text weight="semibold" id="memory-list-heading">
            {items === null
              ? "Loading…"
              : `${items.length} ${items.length === 1 ? "fact" : "facts"}`}
          </Text>
          {items !== null && items.length === 0 ? (
            <Text color="secondary">No facts saved yet.</Text>
          ) : null}
          <ul className="hub-dictionary-list" aria-label="Saved facts">
            {(items ?? []).map((item) => (
              <li key={item.id}>
                <HStack gap={2} align="start" justify="between">
                  <VStack gap={0}>
                    <HStack gap={2} align="center" wrap="wrap">
                      <Text weight="semibold">{item.text}</Text>
                      {item.source === "dictation" ? (
                        <Badge variant="neutral" label="By voice" />
                      ) : null}
                      {!item.enabled ? <Badge variant="neutral" label="Off" /> : null}
                    </HStack>
                    <Text size="sm" color="secondary">
                      Keywords: {item.keywords.join(", ") || "none"} · added{" "}
                      {dateOf(item.createdAt)}
                    </Text>
                  </VStack>
                  <HStack gap={1} align="center">
                    <Switch
                      label={`Use “${item.text}”`}
                      isLabelHidden
                      value={item.enabled}
                      onChange={(enabled) =>
                        void save({
                          id: item.id,
                          text: item.text,
                          keywords: item.autoKeywords ? "" : item.keywords.join(", "),
                          enabled,
                        })
                      }
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      label={`Edit “${item.text}”`}
                      onClick={() =>
                        setDraft({
                          id: item.id,
                          text: item.text,
                          keywords: item.autoKeywords ? "" : item.keywords.join(", "),
                          enabled: item.enabled,
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      label={`Delete “${item.text}”`}
                      onClick={async () => {
                        await window.murmur.memoryDelete(item.id);
                        await reload();
                      }}
                    >
                      Delete
                    </Button>
                  </HStack>
                </HStack>
              </li>
            ))}
          </ul>
        </VStack>
      </section>
    </VStack>
  );
}
