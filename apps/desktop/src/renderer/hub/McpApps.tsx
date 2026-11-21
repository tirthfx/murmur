import { useCallback, useEffect, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  MCP_CLIENT_KINDS,
  MCP_CLIENT_KIND_TEXT,
  MCP_CLIENT_NAME_MAX,
  type McpActionResult,
  type McpAuditEntry,
  type McpClientInfo,
  type McpClientKind,
  type McpClientsView,
  type McpConfigPreview,
  type McpStatus,
} from "@murmur/shared";

const when = (at: number) => new Date(at).toLocaleString();

/** The marks in front of a line of the diff, so it reads without colour. */
const MARK = { add: "+ ", remove: "- ", same: "  ", skip: "… " } as const;

/**
 * The apps the owner approved for the local MCP server (CN-11, part 2): add one, write its config
 * file after approving the changes, copy or replace its token, remove it, and see what was
 * called. No token is ever shown here; the window only asks main to copy or write it.
 */
export function McpApps({ status }: { status: McpStatus | null }) {
  const [view, setView] = useState<McpClientsView | null>(null);
  const [audit, setAudit] = useState<McpAuditEntry[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<McpClientKind>("claude-desktop");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [preview, setPreview] = useState<McpConfigPreview | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: "rotate" | "revoke" } | null>(null);
  const [manual, setManual] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [clients, calls] = await Promise.all([
        window.murmur.mcpClients(),
        window.murmur.mcpAudit(),
      ]);
      setView(clients);
      setAudit(calls);
    } catch {
      setMessage({ text: "The apps could not be read.", ok: false });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const report = (result: McpActionResult, done?: string) => {
    setMessage({
      text: result.ok ? (done ?? result.message ?? "Done.") : result.message,
      ok: result.ok,
    });
    void reload();
  };

  async function add() {
    const result = await window.murmur.mcpIssue(name, kind);
    report(result);
    if (result.ok) setName("");
  }

  async function showChanges(client: McpClientInfo) {
    setMessage(null);
    const result = await window.murmur.mcpConfigPreview(client.id);
    if (result.ok) setPreview(result.preview);
    else {
      setPreview(null);
      setMessage({ text: result.message, ok: false });
    }
  }

  async function writeFile(current: McpConfigPreview) {
    const result = await window.murmur.mcpConfigWrite(current.previewId);
    setPreview(null);
    report(result);
  }

  async function act(client: McpClientInfo, action: "rotate" | "revoke") {
    setConfirm(null);
    setPreview(null);
    report(
      await (action === "rotate"
        ? window.murmur.mcpRotate(client.id)
        : window.murmur.mcpRevoke(client.id)),
    );
  }

  if (!view) return null;
  const configurable = (client: McpClientInfo) => client.kind !== "other";

  return (
    <VStack gap={3}>
      <section aria-labelledby="mcp-apps-heading">
        <VStack gap={2}>
          <Text weight="semibold" id="mcp-apps-heading">
            Apps that may use Murmur
          </Text>
          <Text size="sm" color="secondary">
            Each app has its own token, kept in the Keychain. Removing an app or making a new token
            stops the old one at once.
          </Text>
          {message ? (
            <Banner status={message.ok ? "success" : "error"} title={message.text} role="status" />
          ) : null}
          {view.clients.length === 0 ? (
            <Text size="sm">No app has been added yet.</Text>
          ) : (
            <ul className="hub-connector-list" aria-label="Apps that may use Murmur">
              {view.clients.map((client) => (
                <li key={client.id}>
                  <VStack gap={1}>
                    <HStack gap={2} align="center" wrap="wrap">
                      <Text weight="semibold">{client.name}</Text>
                      <Badge variant="neutral" label={MCP_CLIENT_KIND_TEXT[client.kind]} />
                      <Text size="sm" color="secondary">
                        {client.lastUsedAt
                          ? `Last used ${when(client.lastUsedAt)}`
                          : "Not used yet"}
                      </Text>
                    </HStack>
                    <HStack gap={2} wrap="wrap">
                      {configurable(client) ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          label={`Show the changes to ${client.name}'s config`}
                          onClick={() => void showChanges(client)}
                        >
                          Set up…
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          label={`Show how to connect ${client.name}`}
                          onClick={() => setManual(manual === client.id ? null : client.id)}
                        >
                          How to connect
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        label={`Copy the token of ${client.name}`}
                        onClick={() =>
                          void window.murmur.mcpCopyToken(client.id).then((r) => report(r))
                        }
                      >
                        Copy token
                      </Button>
                      {confirm?.id === client.id ? (
                        <HStack gap={1}>
                          <Button
                            size="sm"
                            variant="destructive"
                            label={
                              confirm.action === "revoke"
                                ? `Remove ${client.name} and stop its access`
                                : `Make a new token for ${client.name} and stop the old one`
                            }
                            onClick={() => void act(client, confirm.action)}
                          >
                            {confirm.action === "revoke" ? "Remove it" : "Make a new token"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            label="Keep things as they are"
                            onClick={() => setConfirm(null)}
                          >
                            Cancel
                          </Button>
                        </HStack>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            label={`New token for ${client.name}`}
                            onClick={() => setConfirm({ id: client.id, action: "rotate" })}
                          >
                            New token…
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            label={`Remove ${client.name}`}
                            onClick={() => setConfirm({ id: client.id, action: "revoke" })}
                          >
                            Remove…
                          </Button>
                        </>
                      )}
                    </HStack>
                    {manual === client.id ? (
                      <VStack gap={1}>
                        <Text size="sm">
                          Run this command, with the token in the environment variable
                          MURMUR_MCP_TOKEN (use Copy token) and the socket in MURMUR_MCP_SOCKET:
                        </Text>
                        <code className="hub-code">{view.command}</code>
                        <code className="hub-code">{view.socketPath}</code>
                        {status?.http.listening && status.http.url ? (
                          <Text size="sm">
                            Or, for an app that takes a web address, use {status.http.url} with the
                            header Authorization: Bearer followed by the token.
                          </Text>
                        ) : null}
                      </VStack>
                    ) : null}
                  </VStack>
                </li>
              ))}
            </ul>
          )}

          {preview ? (
            <div className="hub-connector" role="group" aria-label="Changes to the config file">
              <VStack gap={2}>
                <Text weight="semibold">Changes to {preview.clientName}</Text>
                <Text size="sm">
                  {preview.path}
                  {preview.exists ? "" : " (it does not exist yet and will be made)"}
                </Text>
                {preview.changed ? (
                  <>
                    <pre className="hub-diff" aria-label="What would change">
                      {preview.lines.map((line, index) => (
                        <span key={index} className={`hub-diff-${line.kind}`}>
                          {MARK[line.kind]}
                          {line.text}
                          {"\n"}
                        </span>
                      ))}
                    </pre>
                    <Text size="sm" color="secondary">
                      The token is hidden here but is written in the file.
                      {preview.backupPath
                        ? ` A copy of the file as it is now is kept as ${preview.backupPath}.`
                        : ""}
                    </Text>
                    <HStack gap={2}>
                      <Button
                        variant="primary"
                        size="sm"
                        label="Write this file"
                        onClick={() => void writeFile(preview)}
                      >
                        Write this file
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        label="Do not write it"
                        onClick={() => setPreview(null)}
                      >
                        Cancel
                      </Button>
                    </HStack>
                  </>
                ) : (
                  <>
                    <Text size="sm">The file already has this app. Nothing to change.</Text>
                    <div>
                      <Button
                        variant="secondary"
                        size="sm"
                        label="Close"
                        onClick={() => setPreview(null)}
                      >
                        Close
                      </Button>
                    </div>
                  </>
                )}
              </VStack>
            </div>
          ) : null}

          <HStack gap={2} align="end" wrap="wrap">
            <TextInput
              label="Add an app"
              description={`A name you will recognise, up to ${MCP_CLIENT_NAME_MAX} characters.`}
              value={name}
              onChange={setName}
              onEnter={() => name.trim() !== "" && void add()}
            />
            <Selector
              label="Kind of app"
              value={kind}
              options={MCP_CLIENT_KINDS.map((value) => ({
                value,
                label: MCP_CLIENT_KIND_TEXT[value],
              }))}
              onChange={(value) => setKind(value as McpClientKind)}
            />
            <Button
              variant="primary"
              size="sm"
              label="Add the app"
              isDisabled={name.trim() === ""}
              onClick={() => void add()}
            >
              Add
            </Button>
          </HStack>
        </VStack>
      </section>

      <section aria-labelledby="mcp-calls-heading">
        <VStack gap={2}>
          <HStack gap={2} align="center" wrap="wrap">
            <Text weight="semibold" id="mcp-calls-heading">
              Recent calls
            </Text>
            <Button
              size="sm"
              variant="ghost"
              label="Reload the calls"
              onClick={() => void reload()}
            >
              Reload
            </Button>
            {audit.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                label="Clear the log of calls"
                onClick={() => void window.murmur.mcpAuditClear().then(reload)}
              >
                Clear
              </Button>
            ) : null}
          </HStack>
          <Text size="sm" color="secondary">
            Who called what, and how much came back. What was asked and what was answered is never
            kept.
          </Text>
          {audit.length === 0 ? (
            <Text size="sm">No calls yet.</Text>
          ) : (
            <ul className="hub-connector-list" aria-label="Recent calls">
              {audit.map((entry) => (
                <li key={entry.id}>
                  <HStack gap={2} align="center" wrap="wrap">
                    <Text size="sm">{when(entry.at)}</Text>
                    <Text size="sm" weight="semibold">
                      {entry.client}
                    </Text>
                    <Text size="sm">{entry.tool}</Text>
                    {entry.write ? <Badge variant="info" label="Writes" /> : null}
                    <Badge
                      variant={entry.ok ? "success" : "warning"}
                      label={entry.ok ? "Done" : "Refused"}
                    />
                    <Text size="sm" color="secondary">
                      {entry.resultBytes.toLocaleString()} bytes
                    </Text>
                  </HStack>
                </li>
              ))}
            </ul>
          )}
        </VStack>
      </section>
    </VStack>
  );
}
