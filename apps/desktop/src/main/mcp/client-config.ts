import path from "node:path";
import type { McpClientKind, McpDiffLine } from "@murmur/shared";

/** The config file of each app Murmur can set up, under the owner's home folder. */
export function clientConfigPath(
  kind: Exclude<McpClientKind, "other">,
  home: string,
  /** Where Claude desktop keeps its settings under the home folder, which depends on the OS. */
  claudeFolder: readonly string[],
): string {
  return kind === "claude-desktop"
    ? path.join(home, ...claudeFolder, "claude_desktop_config.json")
    : path.join(home, ".cursor", "mcp.json");
}

/** What goes under `mcpServers.murmur`: the command to run, the socket it talks to and the token. */
export function serverEntry(input: { command: string; socketPath: string; token: string }) {
  return {
    command: input.command,
    args: [] as string[],
    env: { MURMUR_MCP_SOCKET: input.socketPath, MURMUR_MCP_TOKEN: input.token },
  };
}

export type MergeResult = { ok: true; text: string } | { ok: false; message: string };

/**
 * The file as it would be with Murmur's entry in `mcpServers`, every other part kept as it was.
 * A file that is not a JSON object is never touched: the owner fixes it first.
 */
export function mergeConfig(existing: string | null, entry: unknown): MergeResult {
  let root: Record<string, unknown> = {};
  if (existing !== null && existing.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        return {
          ok: false,
          message: "The file is not a JSON object, so Murmur will not change it.",
        };
      root = parsed as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        message: "The file is not valid JSON, so Murmur will not change it. Fix it and try again.",
      };
    }
  }
  const servers = root.mcpServers;
  if (
    servers !== undefined &&
    (typeof servers !== "object" || servers === null || Array.isArray(servers))
  )
    return {
      ok: false,
      message: "The file's mcpServers is not an object, so Murmur will not change it.",
    };
  const next = { ...root, mcpServers: { ...(servers as object | undefined), murmur: entry } };
  return { ok: true, text: `${JSON.stringify(next, null, 2)}\n` };
}

/** Hides a token for display: the last four characters stay. */
export const maskToken = (text: string, token: string) =>
  token === "" ? text : text.split(token).join(`••••••••${token.slice(-4)}`);

const CONTEXT = 2;

/**
 * A line by line before and after (longest common subsequence), with long runs of unchanged lines
 * folded into one `skip` line.
 */
export function diffLines(before: string, after: string): McpDiffLine[] {
  const a = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const b = after.replace(/\n$/, "").split("\n");
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const all: McpDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      all.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) all.push({ kind: "remove", text: a[i++]! });
    else all.push({ kind: "add", text: b[j++]! });
  }
  while (i < a.length) all.push({ kind: "remove", text: a[i++]! });
  while (j < b.length) all.push({ kind: "add", text: b[j++]! });

  // Fold unchanged lines that are further than CONTEXT from a change.
  const near = all.map((line, at) =>
    line.kind !== "same"
      ? true
      : all
          .slice(Math.max(0, at - CONTEXT), at + CONTEXT + 1)
          .some((other) => other.kind !== "same"),
  );
  const out: McpDiffLine[] = [];
  let hidden = 0;
  all.forEach((line, at) => {
    if (near[at]) {
      if (hidden > 0)
        out.push({ kind: "skip", text: `${hidden} unchanged ${hidden === 1 ? "line" : "lines"}` });
      hidden = 0;
      out.push(line);
    } else hidden++;
  });
  if (hidden > 0)
    out.push({ kind: "skip", text: `${hidden} unchanged ${hidden === 1 ? "line" : "lines"}` });
  return out;
}
