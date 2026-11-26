import { writeFileSync } from "node:fs";
import { matrixSql } from "./matrix.ts";

writeFileSync(new URL("../tests/matrix.sql", import.meta.url), matrixSql());
console.log("Wrote tests/matrix.sql.");
