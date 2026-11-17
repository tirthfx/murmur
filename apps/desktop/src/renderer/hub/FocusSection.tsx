import { useCallback, useEffect, useMemo, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  FOCUS_DURATIONS,
  FOCUS_LIMITS,
  focusAppInputSchema,
  focusDurationLabel,
  focusTimeLeft,
  type FocusDuration,
  type FocusRule,
  type FocusState,
  type InstalledApp,
  type SettingsView,
} from "@murmur/shared";
import { ShortcutField } from "./ShortcutField";

interface FocusSectionProps {
  view: SettingsView;
  onSaved: (view: SettingsView) => void;
}

const DURATION_OPTIONS = FOCUS_DURATIONS.map((duration) => ({
  value: String(duration),
  label: focusDurationLabel(duration),
}));

const parseDuration = (value: string): FocusDuration =>
  value === "untilOff" ? "untilOff" : (Number(value) as 25 | 50 | 90);

/** Most apps shown in the chooser at once; the filter narrows it. */
const MAX_CHOICES = 200;

function statusText(state: FocusState, now: number): string {
  if (state.status === "off") return "Focus is off.";
  if (state.status === "paused") {
    return `Focus is paused; it comes back in ${focusTimeLeft(state.resumeAt, now)}.`;
  }
  return state.endsAt === null
    ? "Focus is on until you turn it off."
    : `Focus is on: ${focusTimeLeft(state.endsAt, now)} left.`;
}

/** Focus Mode's shortcut, duration and blocked apps (RW-18, RW-19). */
export function FocusSection({ view, onSaved }: FocusSectionProps) {
  const [state, setState] = useState<FocusState>({ status: "off" });
  const [duration, setDuration] = useState<FocusDuration>(view.settings.focus.duration);
  const [rules, setRules] = useState<FocusRule[]>([]);
  const [installed, setInstalled] = useState<InstalledApp[]>([]);
  const [filter, setFilter] = useState("");
  const [choice, setChoice] = useState("");
  const [bundleId, setBundleId] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    const [nextState, nextRules] = await Promise.all([
      window.murmur.focusState(),
      window.murmur.focusApps(),
    ]);
    setState(nextState);
    setRules(nextRules);
  }, []);

  useEffect(() => {
    void reload().catch(() => setProblem("Focus Mode could not be read."));
    void window.murmur.focusInstalledApps().then(setInstalled, () => setInstalled([]));
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void window.murmur.focusState().then(setState, () => {});
    }, 1000);
    return () => window.clearInterval(timer);
  }, [reload]);

  useEffect(() => setDuration(view.settings.focus.duration), [view.settings.focus.duration]);

  const blocked = useMemo(() => new Set(rules.map((rule) => rule.value)), [rules]);
  const choices = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return installed
      .filter((app) => !blocked.has(app.bundleId))
      .filter(
        (app) =>
          query === "" ||
          app.name.toLowerCase().includes(query) ||
          app.bundleId.toLowerCase().includes(query),
      )
      .slice(0, MAX_CHOICES);
  }, [installed, blocked, filter]);

  async function add(input: { bundleId: string; label: string }) {
    const checked = focusAppInputSchema.safeParse(input);
    if (!checked.success) {
      setProblem(checked.error.issues[0]?.message ?? "That is not an app's bundle id.");
      return;
    }
    const result = await window.murmur.focusAddApp(checked.data);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setProblem(null);
    setChoice("");
    setBundleId("");
    await reload();
  }

  async function addChoice() {
    const app = installed.find((item) => item.bundleId === choice);
    if (app) await add({ bundleId: app.bundleId, label: app.name });
  }

  async function remove(id: string) {
    await window.murmur.focusRemoveApp(id);
    await reload();
  }

  async function start() {
    setState(await window.murmur.focusStart(duration));
  }

  async function stop() {
    setState(await window.murmur.focusStop());
  }

  const full = rules.length >= FOCUS_LIMITS.apps;

  return (
    <section className="hub-permissions" aria-labelledby="focus-heading">
      <VStack gap={3}>
        <Heading level={2} id="focus-heading">
          Focus Mode
        </Heading>
        <Text color="secondary" role="status">
          {statusText(state, now)}
        </Text>
        <HStack gap={2} align="end" wrap="wrap">
          <Selector
            label="How long"
            description="The shortcut and the tray use the last one chosen."
            options={DURATION_OPTIONS}
            value={String(duration)}
            onChange={(value) => setDuration(parseDuration(value))}
          />
          {state.status === "off" ? (
            <Button label="Start Focus" onClick={() => void start()}>
              Start Focus
            </Button>
          ) : (
            <Button variant="secondary" label="Turn off Focus" onClick={() => void stop()}>
              Turn off Focus
            </Button>
          )}
        </HStack>
        <ShortcutField
          slot="focus"
          title="Focus shortcut"
          description="Turns Focus on for the last duration chosen, or off."
          label={view.shortcutLabels.focus}
          canClear={view.settings.focusShortcut !== null}
          clear={{ label: "Turn off the Focus shortcut", text: "Turn off" }}
          onSaved={onSaved}
        />

        <Text weight="semibold">Blocked apps</Text>
        <Text size="sm" color="secondary">
          While Focus is on, these apps are covered with a notice when they come to the front. They
          are never quit. At most {FOCUS_LIMITS.apps}.
        </Text>
        {rules.length === 0 ? (
          <Text color="secondary">No apps are blocked yet.</Text>
        ) : (
          <ul className="hub-dictionary-list" aria-label="Blocked apps">
            {rules.map((rule) => (
              <li key={rule.id}>
                <HStack gap={2} align="center" justify="between">
                  <VStack gap={0}>
                    <Text weight="semibold">{rule.label}</Text>
                    <Text size="sm" color="secondary">
                      {rule.value}
                    </Text>
                  </VStack>
                  <Button
                    size="sm"
                    variant="ghost"
                    label={`Stop blocking ${rule.label}`}
                    onClick={() => void remove(rule.id)}
                  >
                    Remove
                  </Button>
                </HStack>
              </li>
            ))}
          </ul>
        )}
        {!full ? (
          <VStack gap={2}>
            <TextInput label="Find an app" value={filter} onChange={setFilter} hasClear />
            <HStack gap={2} align="end" wrap="wrap">
              <Selector
                label="App to block"
                options={[
                  { value: "", label: choices.length ? "Choose an app" : "No apps found" },
                  ...choices.map((app) => ({ value: app.bundleId, label: app.name })),
                ]}
                value={choice}
                onChange={setChoice}
              />
              <Button
                variant="secondary"
                label="Block the chosen app"
                isDisabled={choice === ""}
                onClick={() => void addChoice()}
              >
                Block
              </Button>
            </HStack>
            <HStack gap={2} align="end" wrap="wrap">
              <TextInput
                label="Or an app's bundle id"
                placeholder="com.example.App"
                value={bundleId}
                onChange={setBundleId}
                onEnter={() => void add({ bundleId: bundleId.trim(), label: bundleId.trim() })}
              />
              <Button
                variant="secondary"
                label="Block this bundle id"
                isDisabled={bundleId.trim() === ""}
                onClick={() => void add({ bundleId: bundleId.trim(), label: bundleId.trim() })}
              >
                Block
              </Button>
            </HStack>
          </VStack>
        ) : null}
        {problem ? <Banner status="error" title={problem} /> : null}
      </VStack>
    </section>
  );
}
