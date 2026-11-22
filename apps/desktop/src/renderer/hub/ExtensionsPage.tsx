import { useCallback, useEffect, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  type ExtensionActionId,
  type ExtensionState,
  type ExtensionsSettings,
  type ExtensionsView,
} from "@murmur/shared";

type Variant = "neutral" | "info" | "success" | "warning" | "error";

const STATE_TEXT: Record<ExtensionState, { label: string; variant: Variant }> = {
  ready: { label: "Ready", variant: "success" },
  off: { label: "Off", variant: "neutral" },
  "not-connected": { label: "Not connected", variant: "info" },
  blocked: { label: "Needs attention", variant: "warning" },
};

/**
 * Extensions (CN-12): what your connected apps can do for tasks and summaries. These are built-in
 * actions, not code from anywhere else. Each is off until you turn it on, shows you what it will do
 * and waits for your click, and a model can suggest one but never run it.
 */
export function ExtensionsPage() {
  const [view, setView] = useState<ExtensionsView | null>(null);
  const [settings, setSettings] = useState<ExtensionsSettings | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [current, all] = await Promise.all([
        window.murmur.extensionsView(),
        window.murmur.getSettings(),
      ]);
      setView(current);
      setSettings(all.settings.extensions);
    } catch {
      setMessage("The extensions could not be read.");
    }
  }, []);

  useEffect(() => {
    void load();
    // A sign-in made on the Connectors page changes what is ready.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  async function change(next: ExtensionsSettings) {
    await window.murmur.updateSettings({ extensions: next });
    await load();
  }

  if (!view || !settings) {
    return message ? <Banner status="error" title={message} /> : <Text>Loading…</Text>;
  }

  return (
    <VStack gap={4}>
      <Text color="secondary">
        Extensions are things your connected apps can do for a task or a summary, such as putting a
        draft in Gmail or creating a calendar event. They are built into Murmur: no code from
        anywhere else runs. Each one is off until you turn it on, shows you what it will do first,
        and waits for your click. A model may suggest an action, but it can never run one.
      </Text>

      <Switch
        label="Turn on extensions"
        value={settings.enabled}
        onChange={(enabled) => void change({ ...settings, enabled })}
      />

      <ul className="hub-connector-list" aria-label="Extensions">
        {view.actions.map((action) => {
          const state = STATE_TEXT[action.status.state];
          return (
            <li key={action.id} aria-label={action.name} className="hub-task">
              <VStack gap={1}>
                <Text weight="semibold">{action.name}</Text>
                <Badge variant={state.variant} label={state.label} />
                <Text size="sm" color="secondary">
                  {action.description}
                </Text>
                <Text size="sm">
                  Uses{" "}
                  {action.accounts.length > 0
                    ? action.accounts.join(", ")
                    : `a connected ${action.connectors.length === 1 ? "account" : "calendar"}`}
                  . It asks for: {action.permission}. Where: {action.surfaces.join(", ")}.
                </Text>
                <Text size="sm" color="secondary">
                  You always click to confirm it.
                </Text>
                {action.status.reason ? (
                  <Text size="sm" color="secondary">
                    {action.status.reason}
                  </Text>
                ) : null}
                <Switch
                  label={`Allow “${action.name}”`}
                  isDisabled={!settings.enabled}
                  value={settings.actions[action.id as ExtensionActionId]}
                  onChange={(on) =>
                    void change({
                      ...settings,
                      actions: { ...settings.actions, [action.id]: on },
                    })
                  }
                />
              </VStack>
            </li>
          );
        })}
      </ul>

      {view.planned.length > 0 ? (
        <VStack gap={1}>
          <Text weight="semibold">Not built yet</Text>
          <ul className="hub-connector-list" aria-label="Actions not built yet">
            {view.planned.map((item) => (
              <li key={item.name}>
                <Text size="sm">
                  {item.name}: {item.detail}
                </Text>
              </li>
            ))}
          </ul>
        </VStack>
      ) : null}
    </VStack>
  );
}
