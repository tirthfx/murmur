#!/usr/bin/env node
// murmur-mcp (Node version): lets an MCP client (Claude desktop, Cursor, ...) talk to Murmur over
// stdio. On Windows this is what `murmur-mcp.cmd` runs; the Mac keeps the shell script.
//
// The client starts this command and speaks JSON-RPC, one message per line, on stdin and stdout.
// It is passed on to the running Murmur app through its local socket (a named pipe on Windows),
// which only this user can open. Murmur must be running with the local MCP server turned on, and
// the app must have been added there: its token is in MURMUR_MCP_TOKEN. The token is sent first,
// on the connection, and is not shown in any process list.
//
// The address is the first argument, or MURMUR_MCP_SOCKET. It has no default here: the config
// that Murmur writes always sets it.
"use strict";

const net = require("node:net");
const { existsSync } = require("node:fs");

const address = process.argv[2] || process.env.MURMUR_MCP_SOCKET || "";
const token = process.env.MURMUR_MCP_TOKEN || "";
const isPipe = address.startsWith("\\\\.\\pipe\\");

function fail(message) {
  process.stderr.write(`murmur-mcp: ${message}\n`);
  process.exit(1);
}

if (!token) {
  fail(
    "MURMUR_MCP_TOKEN is not set. Add this app in Murmur (Connectors, Local MCP server) and write its config.",
  );
}
if (!address) {
  fail("no socket address. Write this app's config again in Murmur.");
}
// A named pipe cannot be tested with a file check; connecting tells.
if (!isPipe && !existsSync(address)) {
  fail(`Murmur is not running, or its local MCP server is off (${address} is not there).`);
}

const socket = net.connect({ path: address, allowHalfOpen: true });
socket.on("error", () => {
  fail(`Murmur is not running, or its local MCP server is off (${address} cannot be opened).`);
});
socket.on("connect", () => {
  socket.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "murmur/authorize", params: { token } })}\n`,
  );
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
});
// Ends when the app closes the connection; the client's end of stdin closing ends our side.
socket.on("close", () => process.exit(0));
