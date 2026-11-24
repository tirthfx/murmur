import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyImport, describePlan, planImport, projectApi, verifyImport } from "./migrate.ts";

/**
 * Moves a local team server's data into a Supabase project, and checks it afterwards.
 *
 *   node src/migrate-cli.ts plan   --from <server database>
 *   node src/migrate-cli.ts apply  --from <server database> --out <folder>
 *   node src/migrate-cli.ts verify --from <server database>
 *
 * The project's address and service key come from the environment (MURMUR_SUPABASE_URL and
 * MURMUR_SUPABASE_SERVICE_KEY), never from the command line, so they are not left in a shell's
 * history. `apply` is for an empty project and writes the accounts' temporary passwords to a file
 * that only its owner can read, and the old audit log, as it was, next to it.
 */
const [command, ...rest] = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = rest.indexOf(`--${name}`);
  return at >= 0 ? rest[at + 1] : undefined;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const from = flag("from");
if (!command || !["plan", "apply", "verify"].includes(command) || !from)
  fail("Usage: migrate-cli.ts plan|apply|verify --from <server database> [--out <folder>]");

const db = new DatabaseSync(resolve(from), { readOnly: true });
const plan = planImport(db);

function project() {
  const url = process.env["MURMUR_SUPABASE_URL"];
  const key = process.env["MURMUR_SUPABASE_SERVICE_KEY"];
  if (!url || !key)
    fail("Set MURMUR_SUPABASE_URL and MURMUR_SUPABASE_SERVICE_KEY in the environment first.");
  return projectApi(url, key);
}

async function main(): Promise<void> {
  if (command === "plan") {
    console.log(describePlan(plan));
  } else if (command === "apply") {
    const out = flag("out");
    if (!out) fail("Say where to write the passwords and the old audit log: --out <folder>");
    console.log(describePlan(plan), "\n");
    mkdirSync(out, { recursive: true });
    // The old log is kept as it was, whole, before anything is written to the project.
    const events = db.prepare("SELECT * FROM audit_events ORDER BY seq").all();
    writeFileSync(
      join(out, "audit-archive.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      {
        mode: 0o600,
      },
    );
    const report = await applyImport(plan, project());
    const csv = [
      "email,temporary_password",
      ...report.accounts.map((a) => `${a.email},${a.temporaryPassword}`),
    ];
    writeFileSync(join(out, "accounts.csv"), csv.join("\n") + "\n", { mode: 0o600 });
    console.log("Written:");
    for (const [table, n] of Object.entries(report.written))
      console.log(`  ${table.padEnd(22)} ${n}`);
    console.log(
      `\nTemporary passwords: ${join(out, "accounts.csv")} (hand each person theirs, then delete the file).`,
    );
    console.log(`The old audit log: ${join(out, "audit-archive.jsonl")}`);
  } else {
    const lines = await verifyImport(plan, project());
    let bad = 0;
    for (const line of lines) {
      if (!line.ok) bad += 1;
      console.log(
        `${line.ok ? "ok " : "BAD"} ${line.table.padEnd(22)} server ${line.local}  project ${line.remote}`,
      );
    }
    if (bad > 0) fail(`\n${bad} table(s) do not match.`);
    console.log("\nEvery table matches.");
  }
}

main().catch((error: unknown) =>
  fail(error instanceof Error ? error.message : "That did not work."),
);
