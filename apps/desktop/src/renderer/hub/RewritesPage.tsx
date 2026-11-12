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
import { REWRITE_LIMITS, type Rewrite, type RewriteSaveResult } from "@murmur/shared";

interface Draft {
  id?: string;
  name: string;
  instruction: string;
  example: string;
  enabled: boolean;
}

const EMPTY: Draft = { name: "", instruction: "", example: "", enabled: true };

/** The Rewrites page (RW-02, RW-03): the built-ins and the owner's own instructions. */
export function RewritesPage() {
  const [items, setItems] = useState<Rewrite[] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [problem, setProblem] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await window.murmur.rewritesList());
    } catch {
      setItems([]);
      setProblem("Rewrites could not be read.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Shows a refusal, or reloads; true when it worked. */
  async function settle(result: RewriteSaveResult | null): Promise<boolean> {
    if (result && !result.ok) {
      setProblem(result.message);
      return false;
    }
    setProblem(null);
    await reload();
    return true;
  }

  async function save() {
    const done = await settle(
      await window.murmur.rewritesSave({
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name,
        instruction: draft.instruction,
        example: draft.example.trim() === "" ? null : draft.example,
        enabled: draft.enabled,
      }),
    );
    if (done) setDraft(EMPTY);
  }

  const customCount = (items ?? []).filter((item) => item.builtinKey === null).length;
  const tooLong = draft.instruction.trim().length > REWRITE_LIMITS.instruction;

  return (
    <VStack gap={4}>
      <Text color="secondary">
        Select text in any app and run a Rewrite on it. The five built-in ones can be switched off,
        moved and copied; add your own for anything else, for example a warm customer reply. Each
        runs on this Mac with the local model, after Murmur's rules: names, numbers and links stay
        as they are, and nothing is invented.
      </Text>

      <section aria-labelledby="rewrite-form-heading">
        <VStack gap={2}>
          <Text weight="semibold" id="rewrite-form-heading">
            {draft.id ? "Change Rewrite" : "Add a Rewrite"}
          </Text>
          <TextInput
            label="Name"
            description={`Up to ${REWRITE_LIMITS.name} characters. Shown in the Rewrite list.`}
            value={draft.name}
            onChange={(name) => setDraft({ ...draft, name })}
          />
          <TextArea
            label="Instruction"
            description={`What to do with the selected text. ${draft.instruction.trim().length.toLocaleString("en")} of ${REWRITE_LIMITS.instruction.toLocaleString("en")} characters.`}
            rows={3}
            value={draft.instruction}
            onChange={(instruction) => setDraft({ ...draft, instruction })}
          />
          <TextArea
            label="Example of the result"
            isOptional
            description="Helps the model match the shape and length you want."
            rows={2}
            value={draft.example}
            onChange={(example) => setDraft({ ...draft, example })}
          />
          <HStack gap={2}>
            <Button
              label={draft.id ? "Save changes" : "Add Rewrite"}
              isDisabled={draft.name.trim() === "" || draft.instruction.trim() === "" || tooLong}
              onClick={() => void save()}
            >
              {draft.id ? "Save changes" : "Add Rewrite"}
            </Button>
            {draft.id ? (
              <Button variant="ghost" label="Cancel" onClick={() => setDraft(EMPTY)}>
                Cancel
              </Button>
            ) : null}
          </HStack>
          {tooLong ? (
            <Text size="sm" color="secondary">
              The instruction is over {REWRITE_LIMITS.instruction.toLocaleString("en")} characters.
            </Text>
          ) : null}
          {problem ? <Banner status="error" title={problem} /> : null}
        </VStack>
      </section>

      <section aria-labelledby="rewrite-list-heading">
        <VStack gap={2}>
          <Text weight="semibold" id="rewrite-list-heading">
            {items === null
              ? "Loading…"
              : `${items.length} Rewrites · ${customCount} of ${REWRITE_LIMITS.custom} of your own`}
          </Text>
          <ul className="hub-dictionary-list" aria-label="Rewrites">
            {(items ?? []).map((item, index) => (
              <li key={item.id}>
                <HStack gap={2} align="start" justify="between">
                  <VStack gap={0}>
                    <HStack gap={2} align="center" wrap="wrap">
                      <Text weight="semibold">{item.name}</Text>
                      {item.builtinKey ? <Badge variant="neutral" label="Built in" /> : null}
                      {!item.enabled ? <Badge variant="neutral" label="Off" /> : null}
                    </HStack>
                    <Text size="sm" color="secondary">
                      {item.builtinKey ? item.description : item.instruction}
                    </Text>
                  </VStack>
                  <HStack gap={1} align="center">
                    <Switch
                      label={`Use ${item.name}`}
                      isLabelHidden
                      value={item.enabled}
                      onChange={async (enabled) => {
                        await window.murmur.rewritesSetEnabled(item.id, enabled);
                        await reload();
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      label={`Move ${item.name} up`}
                      isDisabled={index === 0}
                      onClick={async () => {
                        await window.murmur.rewritesMove(item.id, -1);
                        await reload();
                      }}
                    >
                      Up
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      label={`Move ${item.name} down`}
                      isDisabled={index === (items?.length ?? 0) - 1}
                      onClick={async () => {
                        await window.murmur.rewritesMove(item.id, 1);
                        await reload();
                      }}
                    >
                      Down
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      label={`Duplicate ${item.name}`}
                      onClick={async () =>
                        void settle(await window.murmur.rewritesDuplicate(item.id))
                      }
                    >
                      Duplicate
                    </Button>
                    {item.builtinKey ? null : (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          label={`Edit ${item.name}`}
                          onClick={() =>
                            setDraft({
                              id: item.id,
                              name: item.name,
                              instruction: item.instruction,
                              example: item.example ?? "",
                              enabled: item.enabled,
                            })
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          label={`Delete ${item.name}`}
                          onClick={async () => {
                            await settle(await window.murmur.rewritesDelete(item.id));
                            if (draft.id === item.id) setDraft(EMPTY);
                          }}
                        >
                          Delete
                        </Button>
                      </>
                    )}
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
