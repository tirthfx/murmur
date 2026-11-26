import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAN_FEATURES } from "../../../packages/shared/src/plans.ts";
import { matrixSql, VISIBLE } from "./matrix.ts";
import { latestSeed, seedSql, statementsOf } from "./seed.ts";

/**
 * Checks on the migrations that need no database (SW-04). The SQL tests in `tests/rls.sql` run
 * each role against the real policies; these catch the mistakes that are visible in the text,
 * so CI fails before anyone applies a bad migration.
 */
const DIR = new URL("../migrations/", import.meta.url);
const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const all = files.map((name) => ({ name, sql: readFileSync(new URL(name, DIR), "utf8") }));
const text = all.map((file) => file.sql).join("\n");

/** SQL without comments, so a word in a comment is not read as code. */
const code = text.replace(/--[^\n]*/g, "");

const permissions = JSON.parse(
  readFileSync(new URL("../../local-server/src/permissions.json", import.meta.url), "utf8"),
) as { actions: Record<string, unknown> };

describe("the migrations", () => {
  it("are numbered in order, one file each", () => {
    expect(files.length).toBeGreaterThan(0);
    files.forEach((name, index) => {
      expect(name).toMatch(/^2026\d{8}0{0,}\d*_[a-z0-9_]+\.sql$/);
      expect(name.startsWith(`20261124${String(index + 1).padStart(6, "0")}_`)).toBe(true);
    });
  });

  it("carry the permission and plan matrices exactly as the sources write them", () => {
    // A change to a matrix needs a new seed migration (`npm run seed --workspace @murmur/supabase`);
    // the newest one must say what the sources say now.
    expect(statementsOf(latestSeed().sql)).toBe(statementsOf(seedSql()));
  });

  it("have the permission matrix test up to date, with every table in it", () => {
    // After a change: `npm run matrix --workspace @murmur/supabase`, then run it on a database.
    const written = readFileSync(new URL("../tests/matrix.sql", import.meta.url), "utf8");
    expect(written).toBe(matrixSql());
    const tables = [...code.matchAll(/create table public\.([a-z_]+)/g)].map((match) => match[1]);
    expect(Object.keys(VISIBLE).sort()).toEqual(tables.sort());
  });

  it("turn row-level security on for every table in public", () => {
    const tables = [...code.matchAll(/create table public\.([a-z_]+)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(10);
    for (const table of tables)
      expect(
        code.includes(`alter table public.${table} enable row level security`),
        `${table} has no row-level security`,
      ).toBe(true);
  });

  it("give a client no write policy on any table", () => {
    const writes = [...code.matchAll(/create policy [a-z_]+ on public\.[a-z_]+ for ([a-z]+)/g)].map(
      (m) => m[1],
    );
    expect(writes.length).toBeGreaterThan(5);
    expect(writes.filter((kind) => kind !== "select")).toEqual([]);
  });

  it("fix the search_path of every security definer function", () => {
    const headers = [
      ...code.matchAll(/create (?:or replace )?function ([\w.]+)\(([\s\S]*?)\bas \$\$/g),
    ];
    expect(headers.length).toBeGreaterThan(20);
    for (const [header, name] of headers)
      if (/security definer/.test(header ?? ""))
        expect(/set search_path = ''/.test(header ?? ""), `${name} has no fixed search_path`).toBe(
          true,
        );
  });

  it("never let anyone but a signed-in person run a function that changes data", () => {
    // A function is opened by name; by default none is open to the public or to anonymous callers.
    expect(code).toContain("revoke execute on functions from public, anon, authenticated");
    const anon = [...code.matchAll(/grant execute on function ([\w.]+)\([^)]*\) to anon/g)].map(
      (m) => m[1],
    );
    expect(anon.sort()).toEqual(["public.check_invite", "public.murmur_health"]);
  });

  it("name only actions that are in the permission matrix", () => {
    const used = [...code.matchAll(/private\.can\('([a-z.]+)'/g)].map((m) => m[1] ?? "");
    expect(used.length).toBeGreaterThan(10);
    for (const action of new Set(used))
      expect(action in permissions.actions, `${action} is not in permissions.json`).toBe(true);
  });

  it("name only features that are in the plan matrix", () => {
    const used = [...code.matchAll(/private\.require_team\([a-z_]+, '([A-Za-z]+)'\)/g)].map(
      (m) => m[1] ?? "",
    );
    expect(used.length).toBeGreaterThan(5);
    for (const feature of new Set(used))
      expect(
        (PLAN_FEATURES as readonly string[]).includes(feature),
        `${feature} is not a plan feature`,
      ).toBe(true);
  });

  it("make a private exports bucket that takes documents and never audio or video (SW-07)", () => {
    const bucket = all.find((file) => file.name.includes("shared_exports_bucket"))?.sql ?? "";
    const sql = bucket.replace(/--[^\n]*/g, "");
    expect(sql).toContain("'shared-exports', 'shared-exports', false");
    const types = [...sql.matchAll(/'((?:text|application|audio|video|image)\/[^']+)'/g)].map(
      (m) => m[1] ?? "",
    );
    expect(types.length).toBeGreaterThan(2);
    expect(types.filter((type) => /^(audio|video)\//.test(type))).toEqual([]);
    // The upload policy also refuses a file name that looks like audio or video, whatever it declares.
    const guard = /name !~\* '([^']+)'/.exec(sql)?.[1] ?? "";
    expect(guard).not.toBe("");
    for (const extension of [
      "wav",
      "mp3",
      "m4a",
      "flac",
      "ogg",
      "opus",
      "aiff",
      "mp4",
      "mov",
      "webm",
    ])
      expect(new RegExp(guard, "i").test(`call.${extension}`), `${extension} is not refused`).toBe(
        true,
      );
    expect(new RegExp(guard, "i").test("notes.md")).toBe(false);
    expect(new RegExp(guard, "i").test("summary.pdf")).toBe(false);
  });

  it("keep audio and transcripts out of the schema (SW-07)", () => {
    const columns = [
      ...code.matchAll(
        /^\s+([a-z_]+)\s+(?:text|bytea|jsonb|uuid|integer|bigint|boolean|date|timestamptz)\b/gm,
      ),
    ].map((m) => m[1] ?? "");
    expect(columns.filter((name) => /audio|transcript|recording/.test(name))).toEqual([]);
  });
});
