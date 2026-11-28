import { Switch } from "@astryxdesign/core/Switch";
import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { availableTours, type AppInfo, type SettingsView, type Tour } from "@murmur/shared";

/** Help (HB-08): guided tours, setup again, the version and a local problem report. */
export function HelpPage({
  onStartTour,
  onRunSetup,
}: {
  onStartTour: (tour: Tour, step: number) => void;
  onRunSetup: () => void;
}) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void window.murmur.getSettings().then(setView, () => {});
    void window.murmur.getAppInfo().then(setInfo, () => {});
  }, []);

  const tours = availableTours(view?.settings.experimental.commandMode ?? false);
  const progress = view?.settings.help.tours ?? {};

  async function report() {
    const result = await window.murmur.reportProblem();
    if (result.message) setMessage(result.message);
  }

  return (
    <VStack gap={4}>
      <section aria-labelledby="tours-heading">
        <VStack gap={2}>
          <Heading level={2} id="tours-heading">
            Guided tours
          </Heading>
          {view ? (
            <Switch
              label="Offer a tour the first time a page is opened"
              value={view.settings.help.offerTours}
              onChange={(offerTours) =>
                void window.murmur
                  .updateSettings({ help: { ...view.settings.help, offerTours } })
                  .then(setView)
              }
            />
          ) : null}
          <ul className="hub-history-list" aria-label="Tours">
            {tours.map((tour) => {
              const saved = progress[tour.id];
              const step = saved && !saved.done ? Math.min(saved.step, tour.steps.length - 1) : 0;
              return (
                <li key={tour.id} className="hub-history-row">
                  <HStack gap={2} align="center" justify="between" wrap="wrap">
                    <VStack gap={0}>
                      <Text weight="semibold">
                        {tour.title}
                        {saved?.done ? " · done" : ""}
                      </Text>
                      <Text size="sm" color="secondary">
                        {tour.summary} {tour.steps.length}{" "}
                        {tour.steps.length === 1 ? "step" : "steps"}.
                      </Text>
                    </VStack>
                    <Button
                      size="sm"
                      variant="secondary"
                      label={
                        step > 0
                          ? `Resume ${tour.title} at step ${step + 1}`
                          : `Start ${tour.title}`
                      }
                      onClick={() => onStartTour(tour, step)}
                    >
                      {step > 0 ? `Resume (step ${step + 1})` : saved?.done ? "Again" : "Start"}
                    </Button>
                  </HStack>
                </li>
              );
            })}
          </ul>
        </VStack>
      </section>

      <section aria-labelledby="more-help-heading">
        <VStack gap={2}>
          <Heading level={2} id="more-help-heading">
            More
          </Heading>
          <HStack gap={2} wrap="wrap">
            <Button variant="secondary" label="Restart the setup tutorial" onClick={onRunSetup}>
              Restart tutorial
            </Button>
            <Button
              variant="secondary"
              label="Open the guide"
              onClick={() => void window.murmur.openGuide()}
            >
              Open the guide
            </Button>
            <Button variant="secondary" label="Report a problem" onClick={() => void report()}>
              Report a problem
            </Button>
          </HStack>
          <Text size="sm" color="secondary">
            Report a problem saves a diagnostics folder where you choose: versions, settings and
            counts, never anything you dictated. Nothing is uploaded; share it yourself if you want
            to.
          </Text>
          {message ? (
            <Text size="sm" role="status">
              {message}
            </Text>
          ) : null}
          {info ? (
            <Text size="sm" color="secondary" data-testid="help-version">
              {info.name} {info.version}
            </Text>
          ) : null}
        </VStack>
      </section>
    </VStack>
  );
}
