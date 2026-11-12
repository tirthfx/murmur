import { useEffect, useState } from "react";
import { Heading } from "@astryxdesign/core/Heading";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { JARGON_PACKS, type JargonPacks } from "@murmur/shared";
import { DeveloperToolsSection } from "./DeveloperToolsSection";

/** Developer word packs (PZ-27): which bundled term lists help in code editors and terminals. */
export function JargonPacksSection() {
  const [packs, setPacks] = useState<JargonPacks | null>(null);

  useEffect(() => {
    window.murmur.getSettings().then(
      (view) => setPacks(view.settings.jargonPacks),
      () => setPacks(null),
    );
  }, []);

  if (!packs) return null;
  return (
    <section aria-labelledby="jargon-packs-heading">
      <VStack gap={2}>
        <Heading level={2} id="jargon-packs-heading">
          Developer word packs
        </Heading>
        <Text size="sm" color="secondary">
          In code editors and terminals (the Developer category), the packs that are on help the
          speech model hear technical terms and write them as spelled. Spoken syntax such as “camel
          case user id” or “dash dash help” is written as code there too.
        </Text>
        {JARGON_PACKS.map((pack) => (
          <Switch
            key={pack.id}
            label={pack.label}
            description={`For example: ${pack.example}.`}
            value={packs[pack.id]}
            onChange={async (on) => {
              const next = await window.murmur.updateSettings({
                jargonPacks: { ...packs, [pack.id]: on },
              });
              setPacks(next.settings.jargonPacks);
            }}
          />
        ))}
        <DeveloperToolsSection />
      </VStack>
    </section>
  );
}
