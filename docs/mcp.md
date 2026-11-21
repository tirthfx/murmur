# Local MCP server

Lets an AI app on this Mac (Claude desktop, Cursor, Claude Code, any client that speaks MCP) read meeting notes (CN-11, part 1). Murmur runs no model for the client: the client does its own thinking and calls Murmur for data. It is off until the owner turns it on, in the Connectors page, Local MCP server.

## What it is

A small MCP server written for Murmur (ADR-0084): JSON-RPC 2.0 with `initialize`, `ping`, `tools/list` and `tools/call`, which is all a client needs to read data. There is no SDK, no resources, no prompts and no streaming. Protocol versions 2025-06-18, 2025-03-26 and 2024-11-05 are accepted; a client that asks for another is offered the newest. Code: `apps/desktop/src/main/mcp/`.

## Ways to connect

| Way                   | For                               | How it is protected                                                                                                           |
| --------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Local socket**      | Desktop apps that start a command | `Application Support/Murmur/mcp.sock`, mode 0600, so only this user can open it. The `murmur-mcp` command relays stdio to it. |
| **HTTP on 127.0.0.1** | Apps that take a URL              | `POST http://127.0.0.1:7825/mcp` with `Authorization: Bearer <token>`. 401 without it, before the body is read.               |

The socket is on by default when the server is on; HTTP is off. The port (default 7825) can be changed; the server never binds to any other address. HTTP also checks the `Host` and `Origin` headers, so a web page cannot reach it by pointing a name at this address, and it answers only `POST /mcp` with JSON (no GET, no streams).

**The token** is 256 random bits, made the first time HTTP is turned on and kept in the Keychain (`com.murmur.mcp`, account `http-token`), never in the database, a file or a log. Issuing one per client, rotating and revoking come with MCP setup (#217); until then there is the one token. To read it for a manual check: `security find-generic-password -s com.murmur.mcp -a http-token -w`.

**The `murmur-mcp` command** is a shell script (`apps/desktop/packaging/murmur-mcp`, installed at `Contents/Resources/mcp/murmur-mcp` by `npm run package`) that runs `/usr/bin/nc -U` against the socket, so no Node or Electron starts for each client. It takes the socket path as an argument or in `MURMUR_MCP_SOCKET`; the default is `~/Library/Application Support/Murmur/mcp.sock`. Murmur must be running with the server on, or it says so and exits with 1.

## The six tools

All are read-only (`readOnlyHint`), take JSON arguments and return one JSON text block.

| Tool              | Arguments                                                   | Returns                                                                                                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_meetings` | `query`, `from`, `to`, `folder`, `limit` (max 25)           | Meetings with up to 3 matching passages each (source, the id and time of the line a passage starts at, the words around the match). Without a query: meetings newest first. Searches transcripts and summaries only, never the owner's notes. |
| `get_meeting`     | `meetingId`                                                 | Title, start, end, duration, status, source, folder, language, speaker names, number of summary versions, whether the transcript is still there.                                                                                              |
| `get_summary`     | `meetingId`, `version`                                      | The newest (or the chosen) summary as Markdown, its section headings and the versions there are. A time link `[12:34](seg:<id>)` names a transcript line.                                                                                     |
| `get_transcript`  | `meetingId`, `startMs`, `endMs`                             | Final lines with id, times and speaker name. **At most 20 minutes a call**; `nextStartMs` says where to carry on, or null at the end.                                                                                                         |
| `list_tasks`      | `status` (default open), `owner`, `from`, `to`, `meetingId` | Tasks with owner, due date and the meeting. `from` and `to` are due dates.                                                                                                                                                                    |
| `list_folders`    | none                                                        | Folder ids, names and meeting counts, and how many meetings are in the Inbox.                                                                                                                                                                 |

Dates are `2026-11-21` (that day on this Mac; a closing `to` includes the day) or a full date and time. A mistake in the arguments, an unknown meeting or a turned-off tool comes back as a text result with `isError`, so the client can read it; an unknown tool or method is a protocol error.

## Limits

- A reply is **never over 200 KB**: a bigger one is refused with a message to ask for less (a shorter time range, a smaller limit).
- **60 calls a minute** per connection (per client over HTTP); calls to tools count, listing does not. The limit is the setting `mcp.rateLimitPerMinute`. Over it, the result says how many seconds to wait.
- One message is at most 1 MiB.

## Never returned

Audio files and their paths, the data folder's paths, sign-ins and connector accounts, Keychain items, the connector config, dictation history, the owner's own notes (search skips them), Settings, and raw database access. A test seeds a meeting with an audio path and checks that no tool result carries it. Meeting text is returned as what was said; the server tells clients it is not instructions, but a client must treat it as untrusted.

## Settings (`mcp.settings`)

`enabled` false; `transport.stdio` true; `transport.http` false; `http.port` 7825; `rateLimitPerMinute` 60. Changing a setting starts or stops what it needs at once (the Connectors page waits for that). Turning the server off removes the socket file and closes the port: connecting is refused. If the port is taken, or the Keychain cannot give the token, the page says so and the other way keeps working. The server also stops when Murmur quits.

## Manual check

1. Connectors, Local MCP server: turn it on. The page shows the socket's path.
2. Socket: `printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n' | apps/desktop/packaging/murmur-mcp` lists the six tools (use the same file from `Contents/Resources/mcp/` in a packaged app).
3. HTTP: turn on the web address, then with `TOKEN=$(security find-generic-password -s com.murmur.mcp -a http-token -w)`: `curl -s -X POST http://127.0.0.1:7825/mcp -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`. Without the header it is 401.
4. Call `get_transcript` on a long meeting and check it stops at 20 minutes and says where to go on.
5. Turn the server off and check the socket file is gone and the port refuses connections.
