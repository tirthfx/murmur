import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PORT, createLocalServer } from "./server.ts";

/** Runs the local server: `npm start --workspace @murmur/local-server`. */
const dir = process.env["MURMUR_SERVER_DIR"] ?? join(homedir(), ".murmur-server");
const port = Number(process.env["MURMUR_SERVER_PORT"] ?? DEFAULT_PORT);

const server = createLocalServer({
  dbPath: join(dir, "murmur-server.db"),
  port,
  devIdp: process.env["MURMUR_DEV_IDP"] === "1",
  ...(process.env["MURMUR_DNS_RECORDS"]
    ? { dnsRecordsFile: process.env["MURMUR_DNS_RECORDS"] }
    : {}),
  log: (line) => console.log(line),
});
const { host, port: bound } = await server.listen();
console.log(`Murmur local server on http://${host}:${bound}`);

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => void server.close().then(() => process.exit(0)));
