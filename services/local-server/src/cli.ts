import { homedir } from "node:os";
import { join } from "node:path";
import { createAudit } from "./audit.ts";
import { openDatabase } from "./database.ts";
import { createSettings } from "./settings.ts";

/** `npm run audit:verify --workspace @murmur/local-server`: checks the audit chain from its start. */
const dir = process.env["MURMUR_SERVER_DIR"] ?? join(homedir(), ".murmur-server");
const command = process.argv[2];

if (command === "verify") {
  const db = openDatabase(join(dir, "murmur-server.db"));
  const audit = createAudit({ db, settings: createSettings(db, Date.now), now: Date.now });
  const result = audit.verify();
  if (result.ok) {
    console.log(`The audit log is intact: ${result.count} entries.`);
  } else {
    console.error(`The audit log is broken at entry ${result.brokenSeq}: ${result.reason}`);
    process.exitCode = 1;
  }
  db.close();
} else if (command === "reset-allowlist") {
  // The owner's way back in after locking themselves out: run on the machine that hosts the server.
  const { createNetwork } = await import("./network.ts");
  const { createAudit } = await import("./audit.ts");
  const db = openDatabase(join(dir, "murmur-server.db"));
  const settings = createSettings(db, Date.now);
  const audit = createAudit({ db, settings, now: Date.now });
  createNetwork({ db, settings, now: Date.now, audit: (input) => audit.record(input) }).reset();
  console.log("The IP allowlist is back to this machine only.");
  db.close();
} else if (command === "scim-test") {
  const { runScimSequence } = await import("./scim-test-client.ts");
  const [baseUrl, token] = process.argv.slice(3);
  if (!baseUrl || !token) {
    console.error("Usage: node src/cli.ts scim-test <server url> <scim token>");
    process.exitCode = 2;
  } else {
    for (const step of await runScimSequence({ baseUrl, token })) {
      console.log(`${step.ok ? "ok  " : "FAIL"} ${step.step} (${step.detail})`);
      if (!step.ok) process.exitCode = 1;
    }
  }
} else {
  console.error(
    "Usage: node src/cli.ts verify | reset-allowlist | scim-test <server url> <scim token>",
  );
  process.exitCode = 2;
}
