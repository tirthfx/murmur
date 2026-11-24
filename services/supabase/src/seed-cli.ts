import { writeFileSync } from "node:fs";
import { latestSeed, nextMigrationName, seedSql, statementsOf } from "./seed.ts";

// When the matrices in their sources differ from the newest seed migration, writes a new one that
// replaces the rows. Nothing is written when they agree.
const latest = latestSeed();
if (statementsOf(latest.sql) === statementsOf(seedSql())) {
  console.log(`${latest.name} is up to date.`);
} else {
  const name = nextMigrationName(
    "seed_matrices_" + (Number(/_(\d+)\.sql$/.exec(latest.name)?.[1] ?? "1") + 1),
  );
  writeFileSync(new URL(`../migrations/${name}`, import.meta.url), seedSql(true));
  console.log(`Wrote ${name}. Apply it to the project.`);
}
