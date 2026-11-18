import { useCallback, useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  formatSpan,
  tipFor,
  type HomeView,
  type SettingsView,
  type SetupStatus,
} from "@murmur/shared";

/** How often the checklist looks again while something is left (HB-02: within 2 s). */
const CHECK_MS = 1500;

function greeting(now: Date): string {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** Home (HB-02): a greeting, today, the last dictation, setup left to do, and a tip. */
export function HomePage() {
  const [home, setHome] = useState<HomeView | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const loadSetup = useCallback(async () => {
    try {
      setSetup(await window.murmur.getSetupStatus());
    } catch {
      // The checklist is a help, not a requirement.
    }
  }, []);

  useEffect(() => {
    let active = true;
    window.murmur.homeView().then(
      (value) => active && setHome(value),
      () => active && setProblem("Today's numbers could not be read."),
    );
    window.murmur.getSettings().then(
      (value) => active && setSettings(value),
      () => {},
    );
    void loadSetup();
    return () => {
      active = false;
    };
  }, [loadSetup]);

  const blockers = setup?.blockers ?? [];
  const model = setup?.model;
  const firstDone = (home?.totalDictations ?? 0) > 0;
  const checklistOpen = setup !== null && (blockers.length > 0 || !firstDone);

  // Tick items off soon after a permission is granted or the model is ready.
  useEffect(() => {
    if (!checklistOpen) return;
    const timer = window.setInterval(() => void loadSetup(), CHECK_MS);
    return () => window.clearInterval(timer);
  }, [checklistOpen, loadSetup]);

  async function download() {
    try {
      setSetup(await window.murmur.downloadSpeechModel());
    } catch {
      setProblem("The download could not start.");
    }
  }

  const profile = settings?.settings.profile;
  const name =
    profile?.showOnHome && profile.displayName.trim() ? profile.displayName.trim() : null;
  const permissionsLeft = blockers.some((item) =>
    ["microphone", "accessibility", "inputMonitoring", "helper"].includes(item),
  );

  return (
    <VStack gap={4}>
      <Heading level={2}>
        {name ? `${greeting(new Date())}, ${name}` : greeting(new Date())}
      </Heading>

      {model && (model.state === "missing" || model.state === "failed") ? (
        <Banner
          status="warning"
          title="The speech model is not on this Mac yet"
          description={
            model.message ?? "Dictation needs it. It is downloaded once and then works offline."
          }
          endContent={
            <Button
              variant="secondary"
              label="Download the speech model"
              onClick={() => void download()}
            >
              Download
            </Button>
          }
        />
      ) : model?.state === "downloading" ? (
        <Text size="sm" color="secondary" role="status">
          Downloading the speech model:{" "}
          {model.totalBytes > 0
            ? `${Math.floor((model.downloadedBytes / model.totalBytes) * 100)}%`
            : "starting"}
          .
        </Text>
      ) : null}

      {problem ? <Banner status="error" title={problem} /> : null}

      <div className="hub-insights-grid">
        <div className="hub-insights-card" role="group" aria-label="Words today">
          <Text size="sm" color="secondary">
            Words today
          </Text>
          <Text size="lg" weight="semibold">
            {(home?.todayWords ?? 0).toLocaleString()}
          </Text>
        </div>
        <div className="hub-insights-card" role="group" aria-label="Dictations today">
          <Text size="sm" color="secondary">
            Dictations today
          </Text>
          <Text size="lg" weight="semibold">
            {(home?.todayDictations ?? 0).toLocaleString()}
          </Text>
        </div>
        <div className="hub-insights-card" role="group" aria-label="Time saved today">
          <Text size="sm" color="secondary">
            Time saved today (estimate)
          </Text>
          <Text size="lg" weight="semibold">
            {formatSpan(home?.todayTimeSavedMs ?? 0)}
          </Text>
        </div>
      </div>

      {settings ? (
        <Text>
          Hold <strong>{settings.shortcutLabels.hold}</strong> to dictate, and let go to insert.
        </Text>
      ) : null}

      {home?.last ? (
        <VStack gap={1}>
          <Heading level={3}>Last dictation</Heading>
          <Text>{home.last.text}</Text>
          <Text size="sm" color="secondary">
            {[
              home.last.appName,
              new Date(home.last.at).toLocaleString(undefined, {
                timeStyle: "short",
                dateStyle: "medium",
              }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </VStack>
      ) : null}

      {checklistOpen ? (
        <VStack gap={1}>
          <Heading level={3}>Getting set up</Heading>
          <ul className="hub-checklist" aria-label="Setup checklist">
            <li data-done={!permissionsLeft}>
              {permissionsLeft ? "○" : "✓"} Permissions{" "}
              {permissionsLeft ? "(see Settings, General)" : "granted"}
            </li>
            <li data-done={model?.state === "ready"}>
              {model?.state === "ready" ? "✓" : "○"} Speech model{" "}
              {model?.state === "ready" ? "ready" : "not ready yet"}
            </li>
            <li data-done={firstDone}>{firstDone ? "✓" : "○"} First dictation</li>
          </ul>
        </VStack>
      ) : null}

      <VStack gap={1}>
        <Heading level={3}>Tip of the day</Heading>
        <Text color="secondary">{tipFor(new Date())}</Text>
      </VStack>
    </VStack>
  );
}
