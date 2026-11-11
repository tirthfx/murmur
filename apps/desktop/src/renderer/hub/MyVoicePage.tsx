import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  CATEGORY_LABELS,
  PROFILE_MIN_SESSIONS,
  STYLE_CATEGORIES,
  type Settings,
  type VoiceProfileView,
} from "@murmur/shared";

/** The My Voice page (PZ-15 to PZ-17): what Murmur has learned about how you write. */
export function MyVoicePage() {
  const [view, setView] = useState<VoiceProfileView | null>(null);
  const [flags, setFlags] = useState<Settings["voiceProfile"] | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    window.murmur.voiceProfileView().then(setView, () => setView(null));
    window.murmur.getSettings().then(
      (settings) => setFlags(settings.settings.voiceProfile),
      () => setFlags(null),
    );
  }, []);

  async function update(patch: Partial<Settings["voiceProfile"]>) {
    if (!flags) return;
    const next = await window.murmur.updateSettings({ voiceProfile: { ...flags, ...patch } });
    setFlags(next.settings.voiceProfile);
  }

  return (
    <VStack gap={4}>
      <Text color="secondary">
        Murmur learns how you write from the final text of each dictation: sentence length,
        punctuation, phrases you use often. It keeps numbers and short phrases only, never your
        sentences or audio, and nothing leaves this Mac.
      </Text>
      {flags ? (
        <VStack gap={2}>
          <Switch
            label="Learn my voice profile"
            value={flags.enabled}
            onChange={(enabled) => void update({ enabled })}
          />
          <Switch
            label="Use it in cleanup"
            description="Gives the cleanup model a short summary of how you write."
            value={flags.useInCleanup}
            onChange={(useInCleanup) => void update({ useInCleanup })}
          />
          <Switch
            label="Ask me to read a passage now and then"
            description="At most once a week, never while you dictate."
            value={flags.prompts}
            onChange={(prompts) => void update({ prompts })}
          />
        </VStack>
      ) : null}

      {view ? (
        <>
          <section aria-labelledby="voice-summary">
            <VStack gap={2}>
              <Heading level={2} id="voice-summary">
                Summary
              </Heading>
              <Text>
                {view.sessions} dictations in the last 30 days ·{" "}
                {view.totalWords.toLocaleString("en")} words in all
              </Text>
              <Text color="secondary">
                {view.summary ??
                  `Not enough data yet: a summary needs ${PROFILE_MIN_SESSIONS} dictations.`}
              </Text>
              <ul className="hub-dictionary-list" aria-label="Measures">
                {view.measures.map((measure) => (
                  <li key={measure.id}>
                    <Text>
                      {measure.label}: {measure.value ?? "Not enough data yet"}
                    </Text>
                  </li>
                ))}
              </ul>
              {view.topPhrases.length > 0 ? (
                <Text size="sm" color="secondary">
                  Phrases you use often: {view.topPhrases.join(", ")}
                </Text>
              ) : null}
              {view.milestones.length > 0 ? (
                <Text size="sm" color="secondary">
                  Milestones:{" "}
                  {view.milestones
                    .map(
                      (m) =>
                        `${m.words.toLocaleString("en")} words (${new Date(m.at).toLocaleDateString()})`,
                    )
                    .join(", ")}
                </Text>
              ) : null}
            </VStack>
          </section>

          <section aria-labelledby="voice-passage">
            <VStack gap={1}>
              <Heading level={2} id="voice-passage">
                Read a passage
              </Heading>
              <Text size="sm" color="secondary">
                Dictate this passage into any app to give the profile a fresh sample.
              </Text>
              <Text>{view.passage}</Text>
            </VStack>
          </section>

          <section aria-labelledby="voice-examples">
            <VStack gap={2}>
              <Heading level={2} id="voice-examples">
                Before and after
              </Heading>
              {STYLE_CATEGORIES.map((category) => (
                <VStack gap={1} key={category}>
                  <Text weight="semibold">{CATEGORY_LABELS[category]}</Text>
                  {view.examples[category].length === 0 ? (
                    <Text size="sm" color="secondary">
                      No dictations here in the last 30 days.
                    </Text>
                  ) : (
                    view.examples[category].map((example) => (
                      <VStack gap={0} key={example.at}>
                        <Text size="sm" color="secondary">
                          Said: {example.raw}
                        </Text>
                        <Text size="sm">Written: {example.final}</Text>
                      </VStack>
                    ))
                  )}
                </VStack>
              ))}
              <Text size="sm" color="secondary">
                Style instructions for each kind of app are on the Styles page.
              </Text>
            </VStack>
          </section>

          <div>
            <Button
              variant={confirming ? "destructive" : "secondary"}
              label={confirming ? "Confirm resetting the voice profile" : "Reset voice profile"}
              onClick={async () => {
                if (!confirming) {
                  setConfirming(true);
                  return;
                }
                setConfirming(false);
                setView(await window.murmur.voiceProfileReset());
              }}
            >
              {confirming ? "Reset: delete all profile data" : "Reset voice profile"}
            </Button>
          </div>
        </>
      ) : (
        <Banner status="error" title="The voice profile could not be read." />
      )}
    </VStack>
  );
}
