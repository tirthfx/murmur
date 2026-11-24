import { writeFileSync } from "node:fs";
import { SEED_FILE, seedSql } from "./seed.ts";

// Rewrites the seed migration from its sources.
writeFileSync(SEED_FILE, seedSql());
console.log("Seed migration written.");
