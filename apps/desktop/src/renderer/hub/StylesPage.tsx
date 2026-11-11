import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { EmailSection } from "./EmailSection";
import {
  APP_CATEGORIES,
  applyStyleRules,
  CATEGORY_LABELS,
  PRESETS,
  STYLE_EXAMPLE_INPUT,
  STYLE_INSTRUCTIONS_MAX,
  STYLE_PRESETS,
  type AppCategory,
  type Style,
  type StylePreset,
  type StylesView,
} from "@murmur/shared";

const CATEGORY_HINT: Record<Style["category"], string> = {
  personal: "Messages to friends and family.",
  work: "Team chat, documents and work tools.",
  email: "Mail apps and webmail pages.",
  other: "Every other app.",
};

const PRESET_OPTIONS = STYLE_PRESETS.map((preset) => ({
  value: preset,
  label: PRESETS[preset].label,
}));
const CATEGORY_OPTIONS = APP_CATEGORIES.map((category) => ({
  value: category,
  label: CATEGORY_LABELS[category],
}));

/** What the preset does to the example sentence, made by the same rules as a dictation. */
export function presetExample(preset: StylePreset): string {
  return applyStyleRules(STYLE_EXAMPLE_INPUT, PRESETS[preset].flags);
}

function StyleCard({
  style,
  onSave,
}: {
  style: Style;
  onSave: (preset: StylePreset, instructions: string) => Promise<void>;
}) {
  const [instructions, setInstructions] = useState(style.instructions);
  useEffect(() => setInstructions(style.instructions), [style.instructions]);
  const note = PRESETS[style.preset].instruction;
  const label = CATEGORY_LABELS[style.category];
  return (
    <section className="hub-style-card" aria-labelledby={`style-${style.category}`}>
      <VStack gap={2}>
        <VStack gap={0}>
          <Heading level={2} id={`style-${style.category}`}>
            {label}
          </Heading>
          <Text size="sm" color="secondary">
            {CATEGORY_HINT[style.category]}
          </Text>
        </VStack>
        <Selector
          label={`${label} style`}
          options={PRESET_OPTIONS}
          value={style.preset}
          onChange={(preset) => void onSave(preset as StylePreset, instructions)}
        />
        <Text size="sm" data-testid={`example-${style.category}`}>
          Example: {presetExample(style.preset)}
        </Text>
        {note ? (
          <Text size="sm" color="secondary">
            The cleanup model is also told: {note}
          </Text>
        ) : null}
        <TextArea
          label={`Your own instructions for ${label}`}
          description={`Up to ${STYLE_INSTRUCTIONS_MAX} characters, for example “Use British spelling”.`}
          rows={2}
          value={instructions}
          onChange={(value) => setInstructions(value.slice(0, STYLE_INSTRUCTIONS_MAX))}
        />
        <div>
          <Button
            size="sm"
            variant="secondary"
            label={`Save ${label} instructions`}
            isDisabled={instructions === style.instructions}
            onClick={() => void onSave(style.preset, instructions)}
          >
            Save instructions
          </Button>
        </div>
      </VStack>
    </section>
  );
}

/** The Styles page (PZ-11 to PZ-13): a style per kind of app, and which app is which. */
export function StylesPage() {
  const [view, setView] = useState<StylesView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [bundleId, setBundleId] = useState("");
  const [category, setCategory] = useState<AppCategory>("work");

  useEffect(() => {
    window.murmur.stylesView().then(setView, () => setProblem("Styles could not be read."));
  }, []);

  async function run(action: () => Promise<StylesView>) {
    try {
      setView(await action());
      setProblem(null);
    } catch {
      setProblem("That change could not be saved.");
    }
  }

  if (!view) return problem ? <Banner status="error" title={problem} /> : null;
  const override = (app: { bundleId: string; appName: string | null }, chosen: AppCategory) =>
    run(() =>
      window.murmur.stylesSetOverride({
        bundleId: app.bundleId,
        appName: app.appName,
        category: chosen,
      }),
    );

  return (
    <VStack gap={4}>
      <Text color="secondary">
        Murmur picks a style from the app you dictate into. The style decides capitals and full
        stops, and what the cleanup model is told about your writing.
      </Text>
      {problem ? <Banner status="error" title={problem} /> : null}
      <div className="hub-style-grid">
        {view.styles.map((style) => (
          <StyleCard
            key={style.id}
            style={style}
            onSave={(preset, instructions) =>
              run(() =>
                window.murmur.stylesUpdate({ category: style.category, preset, instructions }),
              )
            }
          />
        ))}
      </div>

      <EmailSection />

      <section aria-labelledby="app-categories-heading">
        <VStack gap={2}>
          <Heading level={2} id="app-categories-heading">
            Apps
          </Heading>
          <Text size="sm" color="secondary">
            Mail, chat, work and developer apps are known already; browsers are placed by the page
            title. Choose a category to change how an app is treated.
          </Text>
          {view.recentApps.length > 0 ? (
            <ul className="hub-dictionary-list" aria-label="Recently used apps">
              {view.recentApps.map((app) => (
                <li key={app.bundleId}>
                  <HStack gap={2} align="center" justify="between">
                    <VStack gap={0}>
                      <Text weight="semibold">{app.appName ?? app.bundleId}</Text>
                      <Text size="sm" color="secondary">
                        {app.source === "user"
                          ? "Your choice"
                          : app.source === "default"
                            ? "Known app"
                            : "Not known: Other"}
                      </Text>
                    </VStack>
                    <Selector
                      label={`Category for ${app.appName ?? app.bundleId}`}
                      isLabelHidden
                      options={CATEGORY_OPTIONS}
                      value={app.category}
                      onChange={(value) => void override(app, value as AppCategory)}
                    />
                  </HStack>
                </li>
              ))}
            </ul>
          ) : (
            <Text size="sm" color="secondary">
              Apps you dictate into will be listed here.
            </Text>
          )}
          {view.overrides.length > 0 ? (
            <VStack gap={1}>
              <Text weight="semibold">Your choices</Text>
              <ul className="hub-dictionary-list" aria-label="Your app categories">
                {view.overrides.map((item) => (
                  <li key={item.bundleId}>
                    <HStack gap={2} align="center" justify="between">
                      <Text>
                        {item.appName ?? item.bundleId}: {CATEGORY_LABELS[item.category]}
                      </Text>
                      <Button
                        size="sm"
                        variant="ghost"
                        label={`Forget the choice for ${item.appName ?? item.bundleId}`}
                        onClick={() =>
                          void run(() => window.murmur.stylesClearOverride(item.bundleId))
                        }
                      >
                        Use the default
                      </Button>
                    </HStack>
                  </li>
                ))}
              </ul>
            </VStack>
          ) : null}
          <HStack gap={2} align="end" wrap="wrap">
            <TextInput
              label="App bundle id"
              description="For an app not listed above, for example com.example.app."
              value={bundleId}
              onChange={setBundleId}
            />
            <Selector
              label="Category"
              options={CATEGORY_OPTIONS}
              value={category}
              onChange={(value) => setCategory(value as AppCategory)}
            />
            <Button
              label="Add app"
              isDisabled={!/^[\w.-]{3,255}$/.test(bundleId.trim())}
              onClick={() => {
                void override({ bundleId: bundleId.trim(), appName: null }, category);
                setBundleId("");
              }}
            >
              Add
            </Button>
          </HStack>
        </VStack>
      </section>
    </VStack>
  );
}
