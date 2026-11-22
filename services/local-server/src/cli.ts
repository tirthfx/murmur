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
} else {
  console.error("Usage: node src/cli.ts verify");
  process.exitCode = 2;
}
