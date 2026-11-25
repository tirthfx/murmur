# Local MCP server

Lets an AI app on this Mac (Claude desktop, Cursor, Claude Code, any client that speaks MCP) read meeting notes (CN-11, part 1). Murmur runs no model for the client: the client does its own thinking and calls Murmur for data. It is off until the owner turns it on, in the Connectors page, Local MCP server.

## What it is

A small MCP server written for Murmur (ADR-0084): JSON-RPC 2.0 with `initialize`, `ping`, `tools/list` and `tools/call`, which is all a client needs to read data. There is no SDK, no resources, no prompts and no streaming. Protocol versions 2025-06-18, 2025-03-26 and 2024-11-05 are accepted; a client that asks for another is offered the newest. Code: `apps/desktop/src/main/mcp/`.

## Ways to connect

| Way                   | For                               | How it is protected                                                                                                                                                               |
| --------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local socket**      | Desktop apps that start a command | `Application Support/Murmur/mcp.sock`, mode 0600, so only this user can open it, and the connection must begin with the app's token. The `murmur-mcp` command relays stdio to it. |
| **HTTP on 127.0.0.1** | Apps that take a URL              | `POST http://127.0.0.1:7825/mcp` with `Authorization: Bearer <token>`. 401 without a token that belongs to an approved app, before the body is read.                              |

The socket is on by default when the server is on; HTTP is off. The port (default 7825) can be changed; the server never binds to any other address. HTTP also checks the `Host` and `Origin` headers, so a web page cannot reach it by pointing a name at this address, and it answers only `POST /mcp` with JSON (no GET, no streams).

## Apps and tokens

Nothing connects until the owner adds the app (Connectors, Local MCP server, Apps that may use Murmur): a name (unique, up to 60 characters) and a kind (Claude desktop, Cursor, or another app).

- **One token per app.** 256 random bits, made when the app is added and kept in the Keychain (`com.murmur.mcp`, account `client:<id>`), never in a file of Murmur's or a log. The database has only the token's SHA-256 (`mcp_clients`, migration 0041), to tell whose a token is.
- **Removing an app** deletes its row first, so its token is refused from that moment (401), then deletes the Keychain item, and ends the app's open socket connections. **A new token** replaces the old one the same way: the old one stops at once, and the config file must be written again.
- **The app's name** in the log is the one the owner gave it, whatever the app calls itself.
- **Copy token** puts it on the clipboard through main (the window never receives it) and clears the clipboard after a minute if it is still there.

## Writing a client's config (Claude desktop, Cursor)

"Set up…" shows what would change in the app's config file and writes nothing. The owner sees the file's path, whether it exists, and a line by line before and after (the token hidden but for its last four characters). Only "Write this file" writes, and only that exact change:

- The file is read again at the click. If it has changed since it was shown (or has appeared), nothing is written and the owner is asked to look again.
- A preview is good for 10 minutes and for one write; a newer preview of the same app replaces the older one.
- A file that is not a JSON object (or whose `mcpServers` is not an object) is never touched.
- A copy of the file as it was is kept beside it as `<file>.murmur-backup`. The new file is written whole (a temporary file renamed over it), with mode 0600 because it holds a token. Every other part of the file is kept.

The entry is `mcpServers.murmur` with `command` (the `murmur-mcp` command), `env.MURMUR_MCP_SOCKET` and `env.MURMUR_MCP_TOKEN`. Files: Claude desktop `~/Library/Application Support/Claude/claude_desktop_config.json`, Cursor `~/.cursor/mcp.json`. The app has to be restarted to read the change. For another app, "How to connect" shows the command, the socket and the address.

**The `murmur-mcp` command** is a shell script (`apps/desktop/packaging/murmur-mcp`, installed at `Contents/Resources/mcp/murmur-mcp` by `npm run package`) that sends the token first (`{"jsonrpc":"2.0","method":"murmur/authorize","params":{"token":"..."}}`, from `MURMUR_MCP_TOKEN`; `printf` is built in, so the token is in no process list) and then relays stdio to the socket with `/usr/bin/nc -U`, so no Node or Electron starts for each client. It takes the socket path as an argument or in `MURMUR_MCP_SOCKET` (default `~/Library/Application Support/Murmur/mcp.sock`). Without a token, or with Murmur not running or the server off, it says so and exits with 1. A connection whose token is wrong, replaced or removed is answered with a JSON-RPC error (-32001) and closed.

## The tools

Six read tools (`readOnlyHint`) and two that write. All take JSON arguments and return one JSON text block.

| Tool              | Arguments                                                   | Returns                                                                                                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_meetings` | `query`, `from`, `to`, `folder`, `limit` (max 25)           | Meetings with up to 3 matching passages each (source, the id and time of the line a passage starts at, the words around the match). Without a query: meetings newest first. Searches transcripts and summaries only, never the owner's notes. |
| `get_meeting`     | `meetingId`                                                 | Title, start, end, duration, status, source, folder, language, speaker names, number of summary versions, whether the transcript is still there.                                                                                              |
| `get_summary`     | `meetingId`, `version`                                      | The newest (or the chosen) summary as Markdown, its section headings and the versions there are. A time link `[12:34](seg:<id>)` names a transcript line.                                                                                     |
| `get_transcript`  | `meetingId`, `startMs`, `endMs`                             | Final lines with id, times and speaker name. **At most 20 minutes a call**; `nextStartMs` says where to carry on, or null at the end.                                                                                                         |
| `list_tasks`      | `status` (default open), `owner`, `from`, `to`, `meetingId` | Tasks with owner, due date and the meeting. `from` and `to` are due dates.                                                                                                                                                                    |
| `list_folders`    | none                                                        | Folder ids, names and meeting counts, and how many meetings are in the Inbox.                                                                                                                                                                 |

**The two write tools are off** until the owner turns each one on (Connectors, Local MCP server). While a switch is off the tool is not listed, and a call to it is refused ("The create_task tool is turned off in Murmur.") and logged. The switch counts at once.

Dates are `2026-11-21` (that day on this Mac; a closing `to` includes the day) or a full date and time. A mistake in the arguments, an unknown meeting or a turned-off tool comes back as a text result with `isError`, so the client can read it; an unknown tool or method is a protocol error.

## Limits

- A reply is **never over 200 KB**: a bigger one is refused with a message to ask for less (a shorter time range, a smaller limit).
- **60 calls a minute** per connection (per client over HTTP); calls to tools count, listing does not. The limit is the setting `mcp.rateLimitPerMinute`. Over it, the result says how many seconds to wait.
- One message is at most 1 MiB.

## The call log

Every tool call is a line in `mcp_audit`: the time, the app's name, the tool, a SHA-256 of the arguments (keys in order, so the same arguments hash the same), the size of the result, whether it worked and whether the tool writes. **Never the arguments or the result.** Calls that are refused (a switch off, the rate limit, bad arguments) are logged too. The page shows the last 50 and can clear the log; the table keeps at most 5,000 lines and nothing older than 90 days. "Delete all data and reset" removes every app, its token and the log.

## Never returned

Audio files and their paths, the data folder's paths, sign-ins and connector accounts, Keychain items, the connector config, dictation history, the owner's own notes (search skips them), Settings, and raw database access. A test seeds a meeting with an audio path and checks that no tool result carries it. Meeting text is returned as what was said; the server tells clients it is not instructions, but a client must treat it as untrusted.

## Settings (`mcp.settings`)

`enabled` false; `transport.stdio` true; `transport.http` false; `http.port` 7825; `rateLimitPerMinute` 60; `write.createTask` false; `write.addNote` false. Changing a setting starts or stops what it needs at once (the Connectors page waits for that). Turning the server off removes the socket file and closes the port: connecting is refused. If the port is taken, or the Keychain cannot give the token, the page says so and the other way keeps working. The server also stops when Murmur quits.

## Manual check

1. Connectors, Local MCP server: turn it on. Add an app, for example Claude desktop. Choose Set up…, read the changes, and choose Write this file. Restart Claude desktop and check it lists the six tools (and, with the switches on, the two that write).
2. Ask Claude about a recent meeting, and check Recent calls shows each call by name and size only.
3. Remove the app and check Claude can no longer use Murmur (and that a second app added later is not affected).
4. Edit the config file in an editor after choosing Set up… and before Write this file, then write it: it must refuse and ask you to look again.
5. By hand: `printf '{"jsonrpc":"2.0","method":"murmur/authorize","params":{"token":"TOKEN"}}\n{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n' | nc -U "$HOME/Library/Application Support/Murmur/mcp.sock"`, with the token from Copy token; or with the web address on, `curl -s -X POST http://127.0.0.1:7825/mcp -H 'content-type: application/json' -H "authorization: Bearer TOKEN" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`. Without the token it is refused.
6. Call `get_transcript` on a long meeting and check it stops at 20 minutes and says where to go on.
7. Turn the server off and check the socket file is gone and the port refuses connections.

## On Windows

The address is a named pipe, `\\.\pipe\murmur-mcp-<user>`, instead of a socket file (a pipe has no file mode; its default access is for this user and administrators, and the token is still required). The command is `resources/mcp/murmur-mcp.cmd`, which runs the Node script `murmur-mcp.cjs` with the app's own Node (`ELECTRON_RUN_AS_NODE`); the script sends the token first and relays stdio, as the shell script does. Claude desktop's config is `%USERPROFILE%\AppData\Roaming\Claude\claude_desktop_config.json`. Squirrel keeps one folder per version, so after an update write the app's config again. `docs/platform.md` says what CI checks.
