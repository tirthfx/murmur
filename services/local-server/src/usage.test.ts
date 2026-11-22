import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dayOf, streaks } from "./usage.ts";
import { startHarness, type Harness, type Json } from "./test-helpers.ts";

let h: Harness & { owner: { id: string; token: string } };
let team = "";
let sales = "";
let support = "";
const p: Record<string, { id: string; token: string }> = {};

const DAY = 86_400_000;
/** A day, n days before the harness clock's today. */
const ago = (n: number) => dayOf(h.clock.now - n * DAY);
let batch = 0;

beforeAll(async () => {
  h = await startHarness();
  team = (await h.call("POST", "/v1/teams", { token: h.owner.token, body: { name: "Acme" } }))
    .json!["id"] as string;
  const dept = async (name: string, costCenter: string) =>
    (
      await h.call("POST", `/v1/teams/${team}/departments`, {
        token: h.owner.token,
        body: { name, costCenter },
      })
    ).json!["id"] as string;
  sales = await dept("Sales", "CC-100");
  support = await dept("Support", "CC-200");
  const add = async (
    name: string,
    role: "admin" | "manager" | "member" | "viewer",
    department: string | null,
  ) => {
    p[name] = await h.person(name);
    h.server.teams.addMember(team, p[name]!.id, role, department, { actorId: null, via: "test" });
  };
  await add("Ada", "admin", null);
  await add("Bea", "manager", sales);
  await add("Cy", "member", sales);
  await add("Dee", "member", support);
  await add("Fay", "member", null);
  await add("Eve", "viewer", sales);
});
afterAll(() => h.close());

const tok = (name: string) => p[name]!.token;
const base = () => `/v1/teams/${team}`;
const send = (who: string, events: unknown[], batchId = `batch-${++batch}-padding`) =>
  h.call("POST", `${base()}/usage`, { token: tok(who), body: { batchId, events } });
const dash = (who: string, query = "") =>
  h.call("GET", `${base()}/usage${query}`, { token: tok(who) });
const board = (who: string, query = "") =>
  h.call("GET", `${base()}/leaderboard${query}`, { token: tok(who) });

describe("sending counts", () => {
  it("adds them to the day's rollup, and a resent batch is not counted twice", async () => {
    const events = [
      { day: ago(0), metric: "words", count: 120, bucket: "mail" },
      { day: ago(0), metric: "dictations", count: 4, bucket: "mail" },
      { day: ago(0), metric: "skills_run", count: 2 },
      { day: ago(1), metric: "meeting_minutes_recorded", count: 45 },
    ];
    const first = await send("Cy", events, "batch-same-id-1");
    expect(first.json).toEqual({ accepted: 4, duplicate: false });
    const again = await send("Cy", events, "batch-same-id-1");
    expect(again.json).toEqual({ accepted: 0, duplicate: true });
    await send("Cy", [{ day: ago(0), metric: "words", count: 30, bucket: "mail" }]);
    const rows = h.server.db
      .prepare("SELECT count FROM usage_daily WHERE user_id = ? AND metric = 'words' AND day = ?")
      .all(p["Cy"]!.id, ago(0)) as { count: number }[];
    expect(rows).toEqual([{ count: 150 }]);
  });

  it("is open to every role in the team, and not to an outsider or someone signed out", async () => {
    expect(
      (await send("Eve", [{ day: ago(0), metric: "words", count: 10, bucket: "code" }])).status,
    ).toBe(200);
    const stranger = await h.person("Stranger");
    expect(
      (
        await h.call("POST", `${base()}/usage`, {
          token: stranger.token,
          body: { batchId: "batch-x-padding", events: [] },
        })
      ).status,
    ).toBe(403);
    expect((await h.call("POST", `${base()}/usage`, { body: {} })).status).toBe(401);
  });

  it("refuses a bad batch, event, day, metric or count", async () => {
    const code = async (body: unknown) =>
      (await h.call("POST", `${base()}/usage`, { token: tok("Cy"), body })).json!["error"]?.code;
    const ok = { day: ago(0), metric: "words", count: 1 };
    expect(await code({ events: [ok] })).toBe("invalid_batch");
    expect(await code({ batchId: "short", events: [ok] })).toBe("invalid_batch");
    expect(await code({ batchId: "batch-empty-1", events: [] })).toBe("invalid_batch");
    expect(
      await code({ batchId: "batch-many-1", events: Array.from({ length: 501 }, () => ok) }),
    ).toBe("invalid_batch");
    expect(await code({ batchId: "batch-bad-ev1", events: ["x"] })).toBe("invalid_event");
    expect(await code({ batchId: "batch-bad-ev2", events: [{ ...ok, day: "2001-02-30" }] })).toBe(
      "invalid_event",
    );
    expect(await code({ batchId: "batch-bad-ev3", events: [{ ...ok, day: ago(36) }] })).toBe(
      "invalid_event",
    );
    expect(await code({ batchId: "batch-bad-ev4", events: [{ ...ok, day: ago(-3) }] })).toBe(
      "invalid_event",
    );
    expect(
      await code({ batchId: "batch-bad-ev5", events: [{ ...ok, metric: "typed_text" }] }),
    ).toBe("invalid_event");
    expect(await code({ batchId: "batch-bad-ev6", events: [{ ...ok, count: -1 }] })).toBe(
      "invalid_event",
    );
    expect(await code({ batchId: "batch-bad-ev7", events: [{ ...ok, count: 1.5 }] })).toBe(
      "invalid_event",
    );
    expect(await code({ batchId: "batch-bad-ev8", events: [{ ...ok, count: 1_000_001 }] })).toBe(
      "invalid_event",
    );
    // A refused batch leaves nothing behind, and its id can be used again.
    expect((await send("Cy", [ok], "batch-bad-ev8")).status).toBe(200);
  });

  it("keeps an app group, never a real app name unless the team allows it", async () => {
    const id = p["Dee"]!.id;
    await send("Dee", [
      { day: ago(0), metric: "words", count: 5, bucket: "mail", appName: "Secret Project Mail" },
      { day: ago(0), metric: "words", count: 6, bucket: "spaceship" },
      { day: ago(0), metric: "words", count: 7 },
      { day: ago(0), metric: "meetings_recorded", count: 1, bucket: "mail", appName: "Zoom" },
    ]);
    const buckets = (
      h.server.db
        .prepare("SELECT metric, bucket, count FROM usage_daily WHERE user_id = ?")
        .all(id) as Json[]
    ).map((row) => [row["metric"], row["bucket"], row["count"]]);
    expect(buckets).toEqual(
      expect.arrayContaining([
        ["words", "mail", 5],
        ["words", "other", 13],
        ["meetings_recorded", "", 1],
      ]),
    );
    expect(JSON.stringify(buckets)).not.toContain("Secret Project");

    await h.call("PUT", `${base()}/usage/settings`, {
      token: tok("Ada"),
      body: { appNames: true },
    });
    await send("Dee", [
      { day: ago(0), metric: "words", count: 9, bucket: "mail", appName: "  Figma  " },
    ]);
    expect(
      (
        h.server.db
          .prepare("SELECT bucket FROM usage_daily WHERE user_id = ? AND bucket = 'Figma'")
          .all(id) as Json[]
      ).length,
    ).toBe(1);
    await h.call("PUT", `${base()}/usage/settings`, {
      token: tok("Ada"),
      body: { appNames: false },
    });
  });

  it("ignores any field that is not a count, so text cannot be stored", async () => {
    await send("Fay", [
      {
        day: ago(0),
        metric: "words",
        count: 3,
        bucket: "notes",
        text: "my secret dictation",
        transcript: "more secret",
      },
    ]);
    const everything = JSON.stringify([
      h.server.db.prepare("SELECT * FROM usage_daily").all(),
      h.server.db.prepare("SELECT * FROM usage_batches").all(),
      (await dash("Ada")).raw,
      (await h.call("GET", `${base()}/usage/export?format=json`, { token: tok("Ada") })).raw,
      (await board("Ada")).raw,
    ]);
    expect(everything).not.toContain("secret");
  });
});

describe("the dashboard", () => {
  beforeAll(async () => {
    await send("Cy", [
      { day: ago(2), metric: "words", count: 400, bucket: "browser" },
      { day: ago(2), metric: "dictations", count: 10, bucket: "browser" },
      { day: ago(2), metric: "ask_sessions", count: 3 },
      { day: ago(2), metric: "meeting_minutes_processed", count: 30 },
    ]);
    await send("Dee", [
      { day: ago(1), metric: "words", count: 800, bucket: "mail" },
      { day: ago(1), metric: "dictations", count: 20, bucket: "mail" },
    ]);
  });

  it("gives an admin totals, every day of the range, top apps and time saved", async () => {
    const result = (await dash("Ada", `?from=${ago(6)}&to=${ago(0)}`)).json!;
    expect(result["range"]).toEqual({ from: ago(6), to: ago(0) });
    expect(result["totals"].words).toBeGreaterThan(1000);
    expect(result["totals"].timeSavedMinutes).toBe(Math.round(result["totals"].words / 40));
    expect(result["totals"]).toMatchObject({
      ask_sessions: 3,
      meeting_minutes_processed: 30,
      skills_run: 2,
      meeting_minutes_recorded: 45,
    });
    expect((result["daily"] as Json[]).map((d) => d["day"])).toEqual(
      [6, 5, 4, 3, 2, 1, 0].map(ago),
    );
    const mail = (result["topApps"] as Json[]).find((a) => a["app"] === "mail")!;
    expect(mail["dictations"]).toBe(24);
    expect((result["topApps"] as Json[])[0]!["app"]).toBe("mail");
    expect((result["departments"] as Json[]).map((d) => d["name"]).sort()).toEqual([
      "No department",
      "Sales",
      "Support",
    ]);
  });

  it("filters by department, and shows people only when asked", async () => {
    const result = (await dash("Ada", `?department=${support}`)).json!;
    expect(result["totals"].words).toBe(827);
    expect((result["departments"] as Json[]).map((d) => d["name"])).toEqual(["Support"]);
    expect(result["members"]).toBeUndefined();
    const detailed = (await dash("Ada", `?department=${support}&detail=members`)).json!;
    expect((detailed["members"] as Json[]).map((m) => m["name"])).toEqual(["Dee"]);
    const one = (await dash("Ada", `?member=${p["Cy"]!.id}`)).json!;
    expect(one["filters"].memberId).toBe(p["Cy"]!.id);
    expect(one["totals"].ask_sessions).toBe(3);
  });

  it("uses the typing speed the team sets", async () => {
    await h.call("PUT", `${base()}/usage/settings`, {
      token: tok("Ada"),
      body: { typingWpm: 100 },
    });
    const result = (await dash("Ada")).json!;
    expect(result["totals"].timeSavedMinutes).toBe(Math.round(result["totals"].words / 100));
    await h.call("PUT", `${base()}/usage/settings`, { token: tok("Ada"), body: { typingWpm: 40 } });
  });

  it("limits a Manager to their own department, and refuses a Member", async () => {
    const own = (await dash("Bea", "?detail=members")).json!;
    expect((own["departments"] as Json[]).map((d) => d["name"])).toEqual(["Sales"]);
    expect((own["members"] as Json[]).map((m) => m["name"]).sort()).toEqual(["Cy", "Eve"]);
    expect((await dash("Bea", `?department=${sales}`)).status).toBe(200);
    expect((await dash("Bea", `?department=${support}`)).status).toBe(403);
    expect((await dash("Bea", `?member=${p["Dee"]!.id}`)).status).toBe(403);
    expect((await dash("Bea", `?member=${p["Cy"]!.id}`)).status).toBe(200);
    expect((await dash("Cy")).status).toBe(403);
    expect((await dash("Eve")).status).toBe(403);
  });

  it("refuses a Manager with no department", async () => {
    const lone = await h.person("Lone");
    h.server.teams.addMember(team, lone.id, "manager", null, { actorId: null, via: "test" });
    const result = await h.call("GET", `${base()}/usage`, { token: lone.token });
    expect(result.status).toBe(403);
    expect(result.json!["error"].message).toContain("no department");
  });

  it("checks the dates and the people", async () => {
    expect((await dash("Ada", "?from=2001-13-01")).json!["error"].code).toBe("invalid_range");
    expect((await dash("Ada", `?from=${ago(0)}&to=${ago(5)}`)).json!["error"].code).toBe(
      "invalid_range",
    );
    expect((await dash("Ada", "?from=1990-01-01&to=2001-09-09")).json!["error"].code).toBe(
      "invalid_range",
    );
    expect((await dash("Ada", "?department=nope")).status).toBe(404);
    expect((await dash("Ada", "?member=nobody")).status).toBe(404);
    expect((await dash("Ada", `?department=${support}&member=${p["Cy"]!.id}`)).status).toBe(400);
  });

  it("moves a person's history with them when they change department", async () => {
    const before = (await dash("Ada", `?department=${sales}`)).json!["totals"].words as number;
    await h.call("PATCH", `${base()}/members/${p["Cy"]!.id}`, {
      token: tok("Ada"),
      body: { departmentId: support },
    });
    expect((await dash("Ada", `?department=${sales}`)).json!["totals"].words).toBeLessThan(before);
    await h.call("PATCH", `${base()}/members/${p["Cy"]!.id}`, {
      token: tok("Ada"),
      body: { departmentId: sales },
    });
    expect((await dash("Ada", `?department=${sales}`)).json!["totals"].words).toBe(before);
  });

  it("holds only counts and names of groups: no field that could carry text", async () => {
    const allowed = new Set([
      "range",
      "from",
      "to",
      "filters",
      "departmentId",
      "memberId",
      "typingWpm",
      "totals",
      "daily",
      "day",
      "topApps",
      "app",
      "dictations",
      "words",
      "departments",
      "name",
      "costCenter",
      "members",
      "userId",
      "department",
      "timeSavedMinutes",
      ...[
        "words",
        "dictations",
        "meeting_minutes_recorded",
        "meeting_minutes_processed",
        "meetings_recorded",
        "skills_run",
        "ask_sessions",
      ],
    ]);
    const keys = (value: unknown, found = new Set<string>()): Set<string> => {
      if (Array.isArray(value)) value.forEach((item) => keys(item, found));
      else if (value && typeof value === "object")
        for (const [key, inner] of Object.entries(value)) {
          found.add(key);
          keys(inner, found);
        }
      return found;
    };
    const result = (await dash("Ada", "?detail=members")).json!;
    expect([...keys(result)].filter((key) => !allowed.has(key))).toEqual([]);
  });
});

describe("export", () => {
  const exportOf = (who: string, query = "") =>
    h.call("GET", `${base()}/usage/export${query}`, { token: tok(who) });

  it("writes CSV with the department and the cost center for exactly the filtered rows", async () => {
    const result = await exportOf("Ada", `?department=${sales}&from=${ago(6)}&to=${ago(0)}`);
    const lines = result.raw.trimEnd().split("\n");
    expect(lines[0]).toBe("day,member,email,department,cost_center,metric,app,count");
    const dbRows = h.server.db
      .prepare(
        `SELECT COUNT(*) AS n FROM usage_daily u JOIN team_members m ON m.team_id = u.team_id AND m.user_id = u.user_id
         WHERE u.team_id = ? AND m.department_id = ? AND u.day >= ? AND u.day <= ?`,
      )
      .get(team, sales, ago(6), ago(0)) as { n: number };
    expect(lines.length - 1).toBe(dbRows.n);
    expect(lines.slice(1).every((line) => line.includes(",Sales,CC-100,"))).toBe(true);
    expect(lines.slice(1).some((line) => line.includes("Dee"))).toBe(false);
  });

  it("writes JSON, limited for a Manager, and records the export", async () => {
    const result = await exportOf("Bea", "?format=json");
    const rows = JSON.parse(result.raw) as Json[];
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every((row) => row["department"] === "Sales" && row["costCenter"] === "CC-100"),
    ).toBe(true);
    expect(Object.keys(rows[0]!).sort()).toEqual([
      "app",
      "costCenter",
      "count",
      "day",
      "department",
      "email",
      "member",
      "metric",
    ]);
    const events = (
      await h.call("GET", "/v1/audit?action=usage.exported", { token: h.owner.token })
    ).json!["events"] as Json[];
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]!["detail"]).toMatchObject({ format: "json", scoped: true });
    expect((await exportOf("Bea", `?department=${support}`)).status).toBe(403);
    expect((await exportOf("Cy")).status).toBe(403);
    expect((await exportOf("Ada", "?format=xml")).json!["error"].code).toBe("invalid_format");
  });

  it("defuses a name that a spreadsheet would run as a formula, and quotes commas", async () => {
    const odd = await h.person("Odd");
    h.server.db
      .prepare("UPDATE users SET name = ? WHERE id = ?")
      .run('=HYPERLINK("http://x","y"),', odd.id);
    h.server.teams.addMember(team, odd.id, "member", sales, { actorId: null, via: "test" });
    await h.call("POST", `${base()}/usage`, {
      token: odd.token,
      body: {
        batchId: "batch-formula-1",
        events: [{ day: ago(0), metric: "skills_run", count: 1 }],
      },
    });
    const csv = (await exportOf("Ada", `?member=${odd.id}`)).raw;
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y""),"`);
    expect(csv.split("\n")[1]!.startsWith(ago(0))).toBe(true);
  });
});

describe("the leaderboard", () => {
  beforeAll(async () => {
    // Words this week: Dee 822+, Cy 580+, Fay 3, Eve 10, Ada 0, Bea 0 (set below for ties).
    await send("Ada", [{ day: ago(0), metric: "words", count: 3, bucket: "other" }]);
    await send("Bea", [{ day: ago(0), metric: "words", count: 3, bucket: "other" }]);
    await send("Fay", [{ day: ago(20), metric: "words", count: 5000, bucket: "other" }]);
    await send("Cy", [{ day: ago(0), metric: "meetings_recorded", count: 2 }]);
  });

  it("ranks by words for the week, ties share a rank, and shows counts only to the person and admins", async () => {
    const asAdmin = (await board("Ada", "?period=week")).json!;
    expect(asAdmin["enabled"]).toBe(true);
    expect(asAdmin["metric"]).toBe("words");
    const ranks = asAdmin["ranks"] as Json[];
    const value = (r: Json) => r["value"] as number;
    // Sorted from most to least, and every rank is one more than the people ahead of it, so a
    // tie shares a rank and the next rank skips (1, 1, 3).
    expect(ranks.map(value)).toEqual([...ranks.map(value)].sort((x, y) => y - x));
    for (const entry of ranks)
      expect(entry["rank"]).toBe(1 + ranks.filter((other) => value(other) > value(entry)).length);
    const tied = ranks.filter((r) => value(r) === 3);
    expect(tied.length).toBeGreaterThanOrEqual(2);
    expect(new Set(tied.map((r) => r["rank"])).size).toBe(1);
    const next = ranks.find((r) => value(r) < 3)!;
    expect(next["rank"]).toBe((tied[0]!["rank"] as number) + tied.length);

    const asMember = (await board("Cy")).json!;
    const others = (asMember["ranks"] as Json[]).filter((r) => !r["isMe"]);
    expect(others.every((r) => r["value"] === null)).toBe(true);
    const mine = (asMember["ranks"] as Json[]).find((r) => r["isMe"])!;
    expect(mine["value"]).toBe(asMember["me"].value);
    expect(asMember["me"].rank).toBe(mine["rank"]);
  });

  it("uses the last seven days for the week and everything for all time", async () => {
    const week = (await board("Ada", "?period=week")).json!;
    const all = (await board("Ada", "?period=all")).json!;
    expect((week["ranks"] as Json[]).find((r) => r["name"] === "Fay")!["value"]).toBe(3);
    expect((all["ranks"] as Json[]).find((r) => r["name"] === "Fay")!["value"]).toBe(5003);
    expect((all["ranks"] as Json[])[0]!["name"]).toBe("Fay");
    expect(all["total"]).toBeGreaterThan(week["total"] as number);
  });

  it("can rank by meetings or by streak", async () => {
    const meetings = (await board("Ada", "?metric=meetings")).json!;
    expect((meetings["ranks"] as Json[])[0]).toMatchObject({ name: "Cy", value: 2, rank: 1 });
    const streak = (await board("Ada", "?metric=streak&period=week")).json!;
    expect(
      (streak["ranks"] as Json[]).find((r) => r["name"] === "Cy")!["value"],
    ).toBeGreaterThanOrEqual(3);
    expect((await board("Ada", "?metric=speed")).json!["error"].code).toBe("invalid_metric");
    expect((await board("Ada", "?period=year")).json!["error"].code).toBe("invalid_period");
  });

  it("leaves an opted-out member out of every response, and counts them in the total", async () => {
    const before = (await board("Ada")).json!;
    expect(
      (
        await h.call("PUT", `${base()}/leaderboard/me`, {
          token: tok("Dee"),
          body: { visible: false },
        })
      ).json,
    ).toEqual({ visible: false });
    for (const who of ["Ada", "Cy", "Bea", "Dee"]) {
      for (const query of ["", "?period=all", "?metric=meetings", "?metric=streak"]) {
        const result = (await board(who, query)).json!;
        expect(
          (result["ranks"] as Json[]).some((r) => r["name"] === "Dee"),
          `${who} ${query}`,
        ).toBe(false);
        expect(JSON.stringify(result["ranks"])).not.toContain(p["Dee"]!.id);
      }
    }
    const after = (await board("Ada")).json!;
    expect(after["hiddenCount"]).toBe(1);
    expect(after["total"]).toBe(before["total"]);
    expect((await board("Dee")).json!["me"]).toMatchObject({ visible: false, rank: null });
    expect(
      (
        await h.call("PUT", `${base()}/leaderboard/me`, {
          token: tok("Dee"),
          body: { visible: "no" },
        })
      ).status,
    ).toBe(400);
    await h.call("PUT", `${base()}/leaderboard/me`, { token: tok("Dee"), body: { visible: true } });
  });

  it("can be turned off for everyone, and be hidden by default", async () => {
    const settings = (body: unknown) =>
      h.call("PUT", `${base()}/leaderboard/settings`, { token: tok("Ada"), body });
    expect((await settings({ enabled: false })).json).toMatchObject({ enabled: false });
    for (const who of ["Ada", "Cy", "Eve"])
      expect((await board(who)).json).toEqual({ enabled: false });
    await settings({ enabled: true, visibleByDefault: false });
    const hidden = (await board("Ada")).json!;
    // Dee chose to be listed; nobody else did.
    expect((hidden["ranks"] as Json[]).map((r) => r["name"])).toEqual(["Dee"]);
    await settings({ visibleByDefault: true, metric: "meetings" });
    expect((await board("Ada")).json!["metric"]).toBe("meetings");
    await settings({ metric: "words" });
    expect((await settings({ metric: "speed" })).status).toBe(400);
    expect((await settings({ nothing: true })).status).toBe(400);
    expect(
      (await h.call("PUT", `${base()}/leaderboard/settings`, { token: tok("Cy"), body: {} }))
        .status,
    ).toBe(403);
    expect(
      (
        (
          await h.call("GET", "/v1/audit?action=leaderboard.settings_changed", {
            token: h.owner.token,
          })
        ).json!["events"] as Json[]
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe("streaks", () => {
  it("count a run that ends today or yesterday, and the longest run", () => {
    expect(streaks([], "2026-11-22")).toEqual({ current: 0, longest: 0 });
    expect(streaks(["2026-11-20", "2026-11-21", "2026-11-22"], "2026-11-22")).toEqual({
      current: 3,
      longest: 3,
    });
    expect(streaks(["2026-11-20", "2026-11-21"], "2026-11-22")).toEqual({ current: 2, longest: 2 });
    expect(streaks(["2026-11-19", "2026-11-20"], "2026-11-22")).toEqual({ current: 0, longest: 2 });
    expect(
      streaks(
        ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-10", "2026-11-22", "2026-11-22"],
        "2026-11-22",
      ),
    ).toEqual({ current: 1, longest: 3 });
    expect(streaks(["2026-12-31", "2027-01-01"], "2027-01-01")).toEqual({ current: 2, longest: 2 });
  });
});

describe("keeping the rollups", () => {
  it("removes days older than the team's retention", async () => {
    h.server.db
      .prepare(
        "INSERT OR REPLACE INTO usage_daily (team_id, user_id, day, metric, bucket, count) VALUES (?, ?, '2000-01-01', 'words', '', 1)",
      )
      .run(team, p["Cy"]!.id);
    expect(h.server.usage.prune()).toBeGreaterThanOrEqual(1);
    expect(
      h.server.db.prepare("SELECT 1 FROM usage_daily WHERE day = '2000-01-01'").all(),
    ).toHaveLength(0);
    expect(
      (
        await h.call("PUT", `${base()}/usage/settings`, {
          token: tok("Ada"),
          body: { retentionDays: 5 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.call("PUT", `${base()}/usage/settings`, {
          token: tok("Ada"),
          body: { typingWpm: 5 },
        })
      ).status,
    ).toBe(400);
    expect(
      (await h.call("PUT", `${base()}/usage/settings`, { token: tok("Ada"), body: { bogus: 1 } }))
        .status,
    ).toBe(400);
    expect((await h.call("GET", `${base()}/usage/settings`, { token: tok("Ada") })).json).toEqual({
      typingWpm: 40,
      retentionDays: 400,
      appNames: false,
    });
  });
});
