import { useCallback, useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { type McpSettings, type McpStatus } from "@murmur/shared";
import { McpApps } from "./McpApps";
import { PolicyFeatureNotice } from "./PolicyNotice";

const validPort = (text: string) =>
  /^\d{4,5}$/.test(text) && Number(text) >= 1024 && Number(text) <= 65535;

/**
 * The local MCP server (CN-11): lets an AI app on this Mac read meeting notes. Off until turned
 * on. Apps are approved, one by one, with a token each (McpApps); the two tools that change
 * something are off until each has its own switch turned on.
 */
export function McpSection() {
  const [settings, setSettings] = useState<McpSettings | null>(null);
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [port, setPort] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setStatus(await window.murmur.mcpStatus());
    } catch {
      setProblem("The server's state could not be read.");
    }
  }, []);

  useEffect(() => {
    void reload();
    window.murmur.getSettings().then(
      (view) => {
        setSettings(view.settings.mcp);
        setPort(String(view.settings.mcp.http.port));
      },
      () => setSettings(null),
    );
  }, [reload]);

  async function change(patch: Partial<McpSettings>) {
    if (!settings) return;
    const view = await window.murmur.updateSettings({ mcp: { ...settings, ...patch } });
    setSettings(view.settings.mcp);
    await reload();
  }

  if (!settings) return null;
  const problems = [status?.stdio.problem, status?.http.problem].filter((text): text is string =>
    Boolean(text),
  );

  return (
    <section aria-labelledby="mcp-heading">
      <VStack gap={2}>
        <Text weight="semibold" id="mcp-heading">
          Local MCP server
        </Text>
        <PolicyFeatureNotice feature="mcp" />
        <Text color="secondary">
          Lets an AI app on this Mac, such as Claude or Cursor, read your meeting titles, summaries,
          transcripts and tasks. It runs only on this Mac, is off until you turn it on, and never
          gives out audio, sign-ins or your other files.
        </Text>
        <Switch
          label="Turn on the local MCP server"
          value={settings.enabled}
          onChange={(enabled) => void change({ enabled })}
        />
        {settings.enabled ? (
          <VStack gap={2}>
            <Switch
              label="Command for desktop apps"
              description="A local socket that the murmur-mcp command in the app connects to."
              value={settings.transport.stdio}
              onChange={(stdio) => void change({ transport: { ...settings.transport, stdio } })}
            />
            <Switch
              label="Web address with an access token"
              description="For apps that take a URL. It listens on this Mac only and needs the token."
              value={settings.transport.http}
              onChange={(http) => void change({ transport: { ...settings.transport, http } })}
            />
            {settings.transport.http ? (
              <HStack gap={2} align="end" wrap="wrap">
                <TextInput
                  label="Port"
                  description="1024 to 65535."
                  value={port}
                  onChange={setPort}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  label="Use this port"
                  isDisabled={!validPort(port) || Number(port) === settings.http.port}
                  onClick={() => void change({ http: { port: Number(port) } })}
                >
                  Use this port
                </Button>
              </HStack>
            ) : null}
            {problems.map((text) => (
              <Banner key={text} status="warning" title={text} />
            ))}
            {problem ? <Banner status="error" title={problem} /> : null}
            <Switch
              label="Let apps suggest tasks"
              description="The create_task tool adds a suggested task. You accept or dismiss it in My Tasks."
              value={settings.write.createTask}
              onChange={(createTask) => void change({ write: { ...settings.write, createTask } })}
            />
            <Switch
              label="Let apps add to My notes"
              description="The add_note tool adds text at the end of your notes on a meeting. It never changes what is there."
              value={settings.write.addNote}
              onChange={(addNote) => void change({ write: { ...settings.write, addNote } })}
            />
            <ul className="hub-connector-list" aria-label="Where the server is listening">
              {status?.stdio.wanted ? (
                <li>
                  <Text size="sm">
                    {status.stdio.listening
                      ? `Local socket on: ${status.stdio.path}`
                      : "Local socket: not listening."}
                  </Text>
                </li>
              ) : null}
              {status?.http.wanted ? (
                <li>
                  <Text size="sm">
                    {status.http.listening
                      ? `Web address on: ${status.http.url}`
                      : "Web address: not listening."}
                  </Text>
                </li>
              ) : null}
            </ul>
            <McpApps status={status} />
          </VStack>
        ) : null}
      </VStack>
    </section>
  );
}
