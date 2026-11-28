import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  FLAG_REGISTRY,
  type AxInspectResult,
  type Settings,
  type SettingsPatch,
  type TestingTool,
} from "@murmur/shared";

/** Seconds to switch to the app to inspect. */
const INSPECT_DELAY = 3;

const PERSONAL = [
  "dictionary",
  "snippets",
  "styles",
  "memory",
  "voiceProfile",
  "learnedCandidates",
];

/** HB-56: what Murmur can read from the app in front. Nothing is saved. */
function Inspector() {
  const [showValues, setShowValues] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [result, setResult] = useState<AxInspectResult | null | undefined>(undefined);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      setCountdown(null);
      void window.murmur.axInspect(showValues).then(setResult, () => setResult(null));
      return;
    }
    const timer = window.setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, showValues]);

  return (
    <section aria-labelledby="inspector-heading">
      <VStack gap={2}>
        <Heading level={3} id="inspector-heading">
          Accessibility inspector
        </Heading>
        <Text size="sm" color="secondary">
          Shows the focused window of the app in front: roles, titles, editable and secure fields.
          At most 6 levels and 500 elements. Nothing is saved.
        </Text>
        <Switch
          label="Show values"
          description="Shows the text inside fields. Secure fields never show a value."
          value={showValues}
          onChange={setShowValues}
        />
        {showValues ? (
          <Banner status="warning" title="Values may include private text on screen." />
        ) : null}
        <div>
          <Button
            variant="secondary"
            label={`Inspect the app in front in ${INSPECT_DELAY} seconds`}
            isDisabled={countdown !== null}
            onClick={() => setCountdown(INSPECT_DELAY)}
          >
            {countdown !== null ? `Switch to the app… ${countdown}` : "Inspect"}
          </Button>
        </div>
        {result === null ? (
          <Text size="sm" role="alert">
            The inspector needs the helper and Accessibility access.
          </Text>
        ) : result ? (
          <VStack gap={1}>
            <Text weight="semibold">
              {result.app ?? "No app"} {result.bundleId ? `(${result.bundleId})` : ""}
            </Text>
            <ul className="hub-inspector" aria-label="Accessibility tree">
              {result.nodes.map((node, index) => (
                <li key={index} style={{ paddingLeft: `${node.depth * 16}px` }}>
                  {node.role ?? "?"}
                  {node.subrole ? ` · ${node.subrole}` : ""}
                  {node.title ? ` · “${node.title}”` : ""}
                  {node.editable ? " · editable" : ""}
                  {node.secure ? " · secure: true" : ""}
                  {node.selectedRange ? ` · selection ${node.selectedRange.join("+")}` : ""}
                  {node.value !== null ? ` · value “${node.value}”` : ""}
                </li>
              ))}
            </ul>
            {result.truncated ? (
              <Text size="sm" color="secondary">
                Stopped at the limit of 6 levels or 500 elements.
              </Text>
            ) : null}
          </VStack>
        ) : null}
      </VStack>
    </section>
  );
}

/**
 * Settings, Testing (HB-20, HB-54 to HB-57): developer mode only. Flags, tools, engine
 * switches and the accessibility inspector.
 */
export function TestingSection({
  settings,
  update,
  onRunSetup,
}: {
  settings: Settings;
  update: (patch: SettingsPatch) => void;
  onRunSetup: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState<number | null>(null);
  const dev = settings.devMode;
  const [sandbox, setSandbox] = useState(false);
  useEffect(() => {
    let alive = true;
    void window.murmur.getAppInfo().then((info) => alive && setSandbox(info.sandbox));
    return () => {
      alive = false;
    };
  }, []);
  const experimental = settings.experimental as Record<string, boolean>;

  async function tool(name: TestingTool) {
    const result = await window.murmur.testingTool(name);
    if (result.message) setMessage(result.message);
    if (name === "restartOnboarding" && result.ok) onRunSetup();
  }

  async function resetPersonal() {
    if (confirmReset === null) {
      const counts = await window.murmur.dataCounts();
      setConfirmReset(
        counts.categories
          .filter((item) => PERSONAL.includes(item.category))
          .reduce((total, item) => total + item.count, 0),
      );
      return;
    }
    setConfirmReset(null);
    await tool("resetPersonalisation");
  }

  const setDev = (change: Partial<Settings["devMode"]>) =>
    update({ devMode: { ...dev, ...change } });

  return (
    <VStack gap={4}>
      <Banner status="warning" title="For testing. These tools can change or delete data." />
      <div data-setting="developer-mode" className="hub-setting-row">
        <Switch
          label="Developer mode"
          description="Turning it off hides this page again."
          value={dev.enabled}
          onChange={(enabled) => setDev({ enabled })}
        />
      </div>

      <section aria-labelledby="flags-heading" data-setting="flags" className="hub-setting-row">
        <VStack gap={2}>
          <Heading level={3} id="flags-heading">
            Feature flags
          </Heading>
          <ul className="hub-history-list" aria-label="Feature flags">
            {FLAG_REGISTRY.map((flag) => {
              const on = experimental[flag.key] ?? flag.default;
              const overridden = on !== flag.default;
              return (
                <li key={flag.key}>
                  <HStack gap={2} align="center" justify="between" wrap="wrap">
                    <Switch
                      label={`${flag.label}${overridden ? " · overridden" : ""}`}
                      description={`${flag.description} ${flag.milestone}; default off.`}
                      value={on}
                      onChange={(value) =>
                        update({ experimental: { ...settings.experimental, [flag.key]: value } })
                      }
                    />
                    {overridden ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        label={`Reset ${flag.label} to its default`}
                        onClick={() =>
                          update({
                            experimental: { ...settings.experimental, [flag.key]: flag.default },
                          })
                        }
                      >
                        Reset
                      </Button>
                    ) : null}
                  </HStack>
                </li>
              );
            })}
          </ul>
        </VStack>
      </section>

      <section aria-labelledby="tools-heading" data-setting="tools" className="hub-setting-row">
        <VStack gap={2}>
          <Heading level={3} id="tools-heading">
            Tools
          </Heading>
          <HStack gap={2} wrap="wrap">
            <Button
              size="sm"
              variant="secondary"
              label="Restart onboarding"
              onClick={() => void tool("restartOnboarding")}
            >
              Restart onboarding
            </Button>
            <Button
              size="sm"
              variant="secondary"
              label="Send a test notification"
              onClick={() => void tool("testNotification")}
            >
              Test notification
            </Button>
            <Button
              size="sm"
              variant="secondary"
              label="Show each Bar state"
              onClick={() => void tool("cycleBar")}
            >
              Cycle Bar states
            </Button>
            <Button
              size="sm"
              variant="secondary"
              label={sandbox ? "Leave the sandbox" : "Start the sandbox with demo data"}
              onClick={() => void tool("sandbox")}
            >
              {sandbox ? "Leave the sandbox" : "Sandbox with demo data"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              label="Create a diagnostics bundle"
              onClick={() => void tool("diagnostics")}
            >
              Diagnostics bundle
            </Button>
            <Button
              size="sm"
              variant={confirmReset !== null ? "destructive" : "secondary"}
              label={
                confirmReset !== null
                  ? "Confirm resetting personalisation"
                  : "Reset personalisation"
              }
              onClick={() => void resetPersonal()}
            >
              {confirmReset !== null
                ? `Delete ${confirmReset} items: this cannot be undone`
                : "Reset personalisation"}
            </Button>
          </HStack>
          <Text size="sm" color="secondary">
            Reset personalisation deletes the Dictionary, Snippets, Styles overrides, Memory, Voice
            Profile and learned suggestions. The diagnostics bundle holds versions, settings, counts
            and the log files, never dictated text, and is only saved where you choose. The sandbox
            starts Murmur again on made-up data in a folder of its own; your data is not opened, and
            quitting leaves it.
          </Text>
          {message ? (
            <Text size="sm" role="status">
              {message}
            </Text>
          ) : null}
        </VStack>
      </section>

      <section aria-labelledby="engine-heading" data-setting="engine" className="hub-setting-row">
        <VStack gap={2}>
          <Heading level={3} id="engine-heading">
            Engine switches
          </Heading>
          <Switch
            label="Turn off model cleanup"
            description="Only the fixed rules clean a dictation."
            value={dev.disableCleanup}
            onChange={(disableCleanup) => setDev({ disableCleanup })}
          />
          <Switch
            label="Force typed insertion"
            description="Types the text instead of pasting it."
            value={dev.forceTyped}
            onChange={(forceTyped) => setDev({ forceTyped })}
          />
          <Switch
            label="Show timings on the Bar"
            description="After a dictation: how long speech, cleanup and insertion took."
            value={dev.showTimings}
            onChange={(showTimings) => setDev({ showTimings })}
          />
          <Switch
            label="Turn off the shortcut listener"
            description="No Murmur shortcut works until this is off again."
            value={dev.disableKeys}
            onChange={(disableKeys) => setDev({ disableKeys })}
          />
          <Switch
            label="Turn off context reading"
            description="No text around the cursor is read, whatever Settings says."
            value={dev.disableContext}
            onChange={(disableContext) => setDev({ disableContext })}
          />
        </VStack>
      </section>

      <Inspector />
    </VStack>
  );
}
