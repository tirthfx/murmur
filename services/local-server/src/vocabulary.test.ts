import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCsv } from "./csv.ts";
import { startHarness, type Harness, type Json } from "./test-helpers.ts";

let h: Harness & { owner: { id: string; token: string } };
let team = "";
let sales = "";
let support = "";
const p: Record<string, { id: string; token: string }> = {};

beforeAll(async () => {
  h = await startHarness();
  team = (await h.call("POST", "/v1/teams", { token: h.owner.token, body: { name: "Acme" } }))
    .json!["id"] as string;
  const dept = async (name: string) =>
    (
      await h.call("POST", `/v1/teams/${team}/departments`, {
        token: h.owner.token,
        body: { name },
      })
    ).json!["id"] as string;
  sales = await dept("Sales");
  support = await dept("Support");
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
  await add("Eve", "viewer", sales);
  await add("Fay", "member", null);
});
afterAll(() => h.close());

const tok = (name: string) => p[name]!.token;
const base = () => `/v1/teams/${team}`;
const setMode = (mode: string) =>
  h.call("PUT", `${base()}/vocabulary/settings`, {
    token: tok("Ada"),
    body: { governanceMode: mode },
  });
const propose = (who: string, body: unknown, kind = "dictionary") =>
  h.call("POST", `${base()}/${kind}`, { token: tok(who), body });
const merged = async (who: string) =>
  (await h.call("GET", `${base()}/vocabulary/merged`, { token: tok(who) })).json!;
const terms = async (who: string) =>
  ((await merged(who))["dictionary"] as Json[]).map((e) => e["term"] as string).sort();
const item = (id: string, suffix = "") => `${base()}/vocabulary/items/${id}${suffix}`;
const eventsOf = async (prefix: string) =>
  (
    (await h.call("GET", `/v1/audit?action=${prefix}`, { token: h.owner.token })).json![
      "events"
    ] as Json[]
  ).map((event) => event["action"] as string);

describe("review mode (the default)", () => {
  it("keeps a Member's entry out of dictation until an admin approves it", async () => {
    expect(
      (await h.call("GET", `${base()}/vocabulary/settings`, { token: tok("Cy") })).json,
    ).toMatchObject({
      governanceMode: "review",
    });
    const made = await propose("Cy", { term: "Kubernetes", replacement: "K8s", scope: "company" });
    expect(made.status).toBe(202);
    expect(made.json).toMatchObject({ live: false, item: { status: "pending", version: 1 } });
    expect(await terms("Dee")).toEqual([]);

    const queue = (await h.call("GET", `${base()}/vocabulary/pending`, { token: tok("Ada") }))
      .json!["items"] as Json[];
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ proposerName: "Cy", payload: { term: "Kubernetes" } });

    const before = (await merged("Dee"))["revision"];
    const approved = await h.call("POST", item(made.json!["item"].id, "/approve"), {
      token: tok("Ada"),
    });
    expect(approved.json).toMatchObject({ status: "active", version: 1 });
    // The next sync sees it: the revision moved and the entry is in the list.
    expect((await merged("Dee"))["revision"]).toBeGreaterThan(before);
    expect(await terms("Dee")).toEqual(["Kubernetes"]);
    expect(await eventsOf("vocabulary.")).toEqual(
      expect.arrayContaining(["vocabulary.proposed", "vocabulary.approved"]),
    );
  });

  it("makes a reviewer's own entries live at once", async () => {
    const made = await propose("Ada", { term: "Murmur", scope: "company" });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ live: true, item: { status: "active" } });
    expect(await terms("Fay")).toContain("Murmur");
  });

  it("does not let a Viewer propose, though they can read", async () => {
    expect((await propose("Eve", { term: "Nope" })).status).toBe(403);
    expect((await h.call("GET", `${base()}/dictionary`, { token: tok("Eve") })).status).toBe(200);
  });

  it("tells the proposer when a proposal is rejected, once", async () => {
    const made = await propose("Dee", { term: "Zendesk", scope: "company" });
    const rejected = await h.call("POST", item(made.json!["item"].id, "/reject"), {
      token: tok("Ada"),
      body: { comment: "Too generic" },
    });
    expect(rejected.json).toMatchObject({ status: "rejected" });
    expect(await terms("Dee")).not.toContain("Zendesk");

    const mine = (await h.call("GET", `${base()}/vocabulary/mine`, { token: tok("Dee") })).json!;
    expect(mine["notices"]).toMatchObject([
      { kind: "rejected", summary: "Zendesk", note: "Too generic" },
    ]);
    expect((mine["items"] as Json[]).map((i) => i["status"])).toContain("rejected");
    expect(
      (await h.call("POST", `${base()}/vocabulary/notices/seen`, { token: tok("Dee") })).json,
    ).toEqual({ marked: 1 });
    expect(
      (await h.call("GET", `${base()}/vocabulary/mine`, { token: tok("Dee") })).json![
        "notices"
      ] as Json[],
    ).toEqual([]);
    // A rejected term can be proposed again.
    expect((await propose("Dee", { term: "Zendesk", scope: "company" })).status).toBe(202);
  });

  it("holds a change to an active entry until it is approved, and one at a time", async () => {
    const made = await propose("Ada", {
      term: "Postgres",
      replacement: "PostgreSQL",
      scope: "company",
    });
    const id = made.json!["item"].id as string;
    const change = await h.call("PATCH", item(id), {
      token: tok("Cy"),
      body: { replacement: "Postgres DB" },
    });
    expect(change.status).toBe(202);
    expect(change.json!["item"]).toMatchObject({
      version: 1,
      payload: { replacement: "PostgreSQL" },
      pending: { action: "update", payload: { replacement: "Postgres DB" } },
    });
    // Dictation still uses the approved text.
    expect(
      ((await merged("Dee"))["dictionary"] as Json[]).find((e) => e["term"] === "Postgres")![
        "replacement"
      ],
    ).toBe("PostgreSQL");
    expect(
      (await h.call("PATCH", item(id), { token: tok("Dee"), body: { replacement: "X" } })).json![
        "error"
      ].code,
    ).toBe("change_pending");
    const approved = await h.call("POST", item(id, "/approve"), { token: tok("Ada") });
    expect(approved.json).toMatchObject({
      version: 2,
      payload: { replacement: "Postgres DB" },
      pending: null,
    });

    // A rejected change leaves the entry as it was.
    await h.call("PATCH", item(id), { token: tok("Cy"), body: { replacement: "pg" } });
    await h.call("POST", item(id, "/reject"), { token: tok("Ada"), body: {} });
    expect(
      ((await merged("Dee"))["dictionary"] as Json[]).find((e) => e["term"] === "Postgres")![
        "replacement"
      ],
    ).toBe("Postgres DB");

    // A proposed deletion waits too.
    const removal = await h.call("DELETE", item(id), { token: tok("Cy") });
    expect(removal.status).toBe(202);
    expect(await terms("Dee")).toContain("Postgres");
    await h.call("POST", item(id, "/approve"), { token: tok("Ada") });
    expect(await terms("Dee")).not.toContain("Postgres");
  });

  it("lets the proposer edit or withdraw a proposal that was never approved", async () => {
    const made = await propose("Cy", { term: "Draftterm", scope: "company" });
    const id = made.json!["item"].id as string;
    const edited = await h.call("PATCH", item(id), {
      token: tok("Cy"),
      body: { term: "Draftterm2" },
    });
    expect(edited.json!["item"]).toMatchObject({
      status: "pending",
      payload: { term: "Draftterm2" },
    });
    expect(
      (await h.call("PATCH", item(id), { token: tok("Dee"), body: { term: "Hijack" } })).status,
    ).toBe(403);
    expect((await h.call("DELETE", item(id), { token: tok("Cy") })).status).toBe(202);
    expect(
      (
        (await h.call("GET", `${base()}/vocabulary/pending`, { token: tok("Ada") })).json![
          "items"
        ] as Json[]
      ).some((i) => i["id"] === id),
    ).toBe(false);
  });
});

describe("departments and managers", () => {
  it("lets a Manager approve only what is shared with their own department", async () => {
    const mine = await propose("Cy", { term: "SalesTerm", scope: "department" });
    expect(mine.json!["item"]).toMatchObject({ scope: "department", departmentId: sales });
    const theirs = await propose("Dee", { term: "SupportTerm", scope: "department" });
    const company = await propose("Cy", { term: "CompanyTerm", scope: "company" });

    const queue = (await h.call("GET", `${base()}/vocabulary/pending`, { token: tok("Bea") }))
      .json!["items"] as Json[];
    expect(queue.map((i) => i["payload"].term)).toEqual(["SalesTerm"]);
    expect(
      (await h.call("POST", item(theirs.json!["item"].id, "/approve"), { token: tok("Bea") }))
        .status,
    ).toBe(403);
    expect(
      (await h.call("POST", item(company.json!["item"].id, "/approve"), { token: tok("Bea") }))
        .status,
    ).toBe(403);
    expect(
      (await h.call("POST", item(mine.json!["item"].id, "/approve"), { token: tok("Bea") })).status,
    ).toBe(200);
    // A Member is not a reviewer.
    expect(
      (await h.call("POST", item(theirs.json!["item"].id, "/approve"), { token: tok("Cy") }))
        .status,
    ).toBe(403);
  });

  it("makes a Manager's own entry for their department live, but not one for the whole team", async () => {
    expect((await propose("Bea", { term: "BeaDept", scope: "department" })).json).toMatchObject({
      live: true,
    });
    expect((await propose("Bea", { term: "BeaCompany", scope: "company" })).json).toMatchObject({
      live: false,
    });
  });

  it("shows a department's entries only to that department", async () => {
    expect(await terms("Cy")).toContain("SalesTerm");
    expect(await terms("Dee")).not.toContain("SalesTerm");
    expect(await terms("Fay")).not.toContain("SalesTerm");
    expect(
      (await h.call("GET", `${base()}/dictionary`, { token: tok("Dee") })).json!["items"].map(
        (i: Json) => i["payload"].term,
      ),
    ).not.toContain("SalesTerm");
  });

  it("lets a department's entry win over the team's for the same term, for that department only", async () => {
    await propose("Ada", { term: "Acme", replacement: "Acme Inc.", scope: "company" });
    await propose("Ada", {
      term: "Acme",
      replacement: "Acme Sales",
      scope: "department",
      departmentId: sales,
    });
    const forSales = ((await merged("Cy"))["dictionary"] as Json[]).filter(
      (e) => e["term"] === "Acme",
    );
    expect(forSales).toMatchObject([{ replacement: "Acme Sales", scope: "department" }]);
    const forSupport = ((await merged("Dee"))["dictionary"] as Json[]).filter(
      (e) => e["term"] === "Acme",
    );
    expect(forSupport).toMatchObject([{ replacement: "Acme Inc.", scope: "company" }]);
    const conflicts = (await h.call("GET", `${base()}/vocabulary/conflicts`, { token: tok("Ada") }))
      .json!;
    expect(conflicts["terms"]).toMatchObject([{ term: "acme", entries: [{}, {}] }]);
  });

  it("refuses an entry for another department, and a duplicate in the same place", async () => {
    expect(
      (await propose("Cy", { term: "Sneaky", scope: "department", departmentId: support })).status,
    ).toBe(403);
    expect(
      (await propose("Cy", { term: "Sneaky", scope: "department", departmentId: "nope" })).status,
    ).toBe(400);
    expect((await propose("Cy", { term: "x", scope: "galaxy" })).status).toBe(400);
    expect((await propose("Ada", { term: "ACME", scope: "company" })).json!["error"].code).toBe(
      "duplicate",
    );
  });

  it("puts an entry from someone with no department in the whole team by default", async () => {
    const made = await propose("Fay", { term: "FayTerm" });
    expect(made.json!["item"]).toMatchObject({ scope: "company", departmentId: null });
    expect(
      (await propose("Fay", { term: "FayDept", scope: "department" })).json!["error"].code,
    ).toBe("no_department");
  });
});

describe("open and locked", () => {
  it("makes a Member's entry live at once in open mode, visible to admins in the history", async () => {
    await setMode("open");
    const made = await propose("Dee", { term: "OpenTerm", scope: "company" });
    expect(made.status).toBe(201);
    expect(await terms("Cy")).toContain("OpenTerm");
    const id = made.json!["item"].id as string;
    expect(
      (await h.call("PATCH", item(id), { token: tok("Dee"), body: { replacement: "open" } })).json,
    ).toMatchObject({ live: true });
    const detail = (await h.call("GET", item(id), { token: tok("Ada") })).json!;
    expect(
      (detail["versions"] as Json[]).map((v) => [v["version"], v["action"], v["changedByName"]]),
    ).toEqual([
      [2, "updated", "Dee"],
      [1, "created", "Dee"],
    ]);
    expect(await eventsOf("vocabulary.created")).toContain("vocabulary.created");
    await setMode("review");
  });

  it("lets only admins change anything in locked mode", async () => {
    await setMode("locked");
    expect((await propose("Cy", { term: "LockedOut" })).json!["error"].code).toBe("locked");
    expect((await propose("Bea", { term: "LockedOut", scope: "department" })).status).toBe(403);
    expect((await propose("Ada", { term: "AdminOnly", scope: "company" })).status).toBe(201);
    const id = (await h.call("GET", `${base()}/dictionary`, { token: tok("Ada") })).json![
      "items"
    ].find((i: Json) => i["payload"].term === "AdminOnly").id;
    expect(
      (await h.call("PATCH", item(id), { token: tok("Cy"), body: { replacement: "x" } })).status,
    ).toBe(403);
    expect((await h.call("DELETE", item(id), { token: tok("Bea") })).status).toBe(403);
    await setMode("review");
  });

  it("validates the settings and writes a change to the log", async () => {
    const put = (body: unknown) =>
      h.call("PUT", `${base()}/vocabulary/settings`, { token: tok("Ada"), body });
    expect((await put({ governanceMode: "free" })).status).toBe(400);
    expect((await put({ rollbackRetentionDays: 0 })).status).toBe(400);
    expect((await put({ syncMinutes: 2000 })).status).toBe(400);
    expect((await put({ allowVariables: ["date", "shell"] })).status).toBe(400);
    expect((await put({ defaultScope: "world" })).status).toBe(400);
    expect((await put({ allowRichText: "yes" })).status).toBe(400);
    expect((await put({ syncMinutes: 10 })).json).toMatchObject({ syncMinutes: 10 });
    expect(
      (await h.call("PUT", `${base()}/vocabulary/settings`, { token: tok("Cy"), body: {} })).status,
    ).toBe(403);
    expect(await eventsOf("vocabulary.settings_changed")).toContain("vocabulary.settings_changed");
    await put({ syncMinutes: 5 });
  });
});

describe("history and rollback", () => {
  it("goes back to an earlier version as a new version, with an audit entry", async () => {
    const made = await propose("Ada", { term: "Roll", replacement: "one", scope: "company" });
    const id = made.json!["item"].id as string;
    await h.call("PATCH", item(id), { token: tok("Ada"), body: { replacement: "two" } });
    await h.call("PATCH", item(id), { token: tok("Ada"), body: { replacement: "three" } });
    const back = await h.call("POST", item(id, "/rollback"), {
      token: tok("Ada"),
      body: { version: 1 },
    });
    expect(back.json).toMatchObject({
      version: 4,
      payload: { replacement: "one" },
      status: "active",
    });
    const detail = (await h.call("GET", item(id), { token: tok("Ada") })).json!;
    expect((detail["versions"] as Json[]).map((v) => [v["version"], v["action"]])).toEqual([
      [4, "rolled_back"],
      [3, "updated"],
      [2, "updated"],
      [1, "created"],
    ]);
    const event = (
      await h.call("GET", "/v1/audit?action=vocabulary.rolled_back", { token: h.owner.token })
    ).json!["events"][0];
    expect(event.detail).toMatchObject({ from: 3, to: 1, version: 4 });
    // Only admins roll back.
    expect(
      (await h.call("POST", item(id, "/rollback"), { token: tok("Bea"), body: { version: 2 } }))
        .status,
    ).toBe(403);
    expect(
      (await h.call("POST", item(id, "/rollback"), { token: tok("Ada"), body: { version: 99 } }))
        .status,
    ).toBe(404);
    expect(
      (await h.call("POST", item(id, "/rollback"), { token: tok("Ada"), body: {} })).status,
    ).toBe(400);
  });

  it("brings back a deleted entry", async () => {
    const id = (await propose("Ada", { term: "Gone", scope: "company" })).json!["item"]
      .id as string;
    await h.call("DELETE", item(id), { token: tok("Ada") });
    expect(await terms("Cy")).not.toContain("Gone");
    const deleted = (await h.call("GET", item(id), { token: tok("Ada") })).json!;
    const wasDeleted = (deleted["versions"] as Json[]).find((v) => v["action"] === "deleted")!;
    expect(
      (
        await h.call("POST", item(id, "/rollback"), {
          token: tok("Ada"),
          body: { version: wasDeleted["version"] },
        })
      ).status,
    ).toBe(400);
    const restored = await h.call("POST", item(id, "/rollback"), {
      token: tok("Ada"),
      body: { version: 1 },
    });
    expect(restored.json).toMatchObject({ status: "active", version: 3 });
    expect(await terms("Cy")).toContain("Gone");
  });

  it("keeps versions for the rollback time and then drops the old ones, but never the newest", async () => {
    const id = (await propose("Ada", { term: "Aging", replacement: "a", scope: "company" })).json![
      "item"
    ].id as string;
    await h.call("PATCH", item(id), { token: tok("Ada"), body: { replacement: "b" } });
    // Sessions last 30 days, so the clock goes forward only for the work and then comes back.
    const later = 200 * 86_400_000;
    h.clock.now += later;
    const fresh = h.server.accounts.signIn(`ada@example.com`, "a long enough password");
    expect(fresh.ok).toBe(true);
    const adaLater = fresh.ok ? fresh.session.token : "";
    await h.call("PATCH", item(id), { token: adaLater, body: { replacement: "c" } });
    const removed = h.server.vocabulary.pruneHistory();
    const versionsNow = (
      (await h.call("GET", item(id), { token: adaLater })).json!["versions"] as Json[]
    ).map((v) => v["version"]);
    const gone = await h.call("POST", item(id, "/rollback"), {
      token: adaLater,
      body: { version: 1 },
    });
    h.clock.now -= later;
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(versionsNow).toEqual([3]);
    expect(gone.status).toBe(404);
  });

  it("collects review comments on an entry", async () => {
    const id = (await propose("Cy", { term: "Commented", scope: "department" })).json!["item"]
      .id as string;
    expect(
      (
        await h.call("POST", item(id, "/comments"), {
          token: tok("Bea"),
          body: { body: "Is this spelled right?" },
        })
      ).status,
    ).toBe(201);
    expect(
      (await h.call("POST", item(id, "/comments"), { token: tok("Bea"), body: { body: "" } }))
        .status,
    ).toBe(400);
    expect(
      (await h.call("POST", item(id, "/comments"), { token: tok("Cy"), body: { body: "Yes" } }))
        .status,
    ).toBe(403);
    const detail = (await h.call("GET", item(id), { token: tok("Bea") })).json!;
    expect(detail["comments"]).toMatchObject([{ author: "Bea", body: "Is this spelled right?" }]);
  });
});

describe("snippets", () => {
  const snip = (who: string, body: Json) => propose(who, { scope: "company", ...body }, "snippets");

  it("keeps variables to the allowed set and to the team's own list", async () => {
    expect(
      (
        await snip("Ada", {
          trigger: "greet",
          expansion: "Hi {{me}}, today is {{date}} at {{team}}",
        })
      ).status,
    ).toBe(201);
    const bad = await snip("Ada", { trigger: "evil", expansion: "{{exec rm}}" });
    expect(bad.status).toBe(400);
    expect(bad.json!["error"].code).toBe("variable_not_allowed");
    expect(
      (await snip("Ada", { trigger: "evil2", expansion: "{{ DATE }} and {{shell}}" })).status,
    ).toBe(400);
    await h.call("PUT", `${base()}/vocabulary/settings`, {
      token: tok("Ada"),
      body: { allowVariables: ["date"] },
    });
    expect((await snip("Ada", { trigger: "needsme", expansion: "Hi {{me}}" })).status).toBe(400);
    expect((await snip("Ada", { trigger: "dateonly", expansion: "Today {{date}}" })).status).toBe(
      201,
    );
    await h.call("PUT", `${base()}/vocabulary/settings`, {
      token: tok("Ada"),
      body: { allowVariables: ["date", "me", "team"] },
    });
  });

  it("is plain text only when the team says so", async () => {
    expect(
      (await snip("Ada", { trigger: "rich", expansion: "**bold**", format: "markdown" })).status,
    ).toBe(201);
    await h.call("PUT", `${base()}/vocabulary/settings`, {
      token: tok("Ada"),
      body: { allowRichText: false },
    });
    expect(
      (await snip("Ada", { trigger: "rich2", expansion: "**bold**", format: "markdown" })).json![
        "error"
      ].code,
    ).toBe("rich_text_off");
    expect((await snip("Ada", { trigger: "plain2", expansion: "plain" })).status).toBe(201);
    await h.call("PUT", `${base()}/vocabulary/settings`, {
      token: tok("Ada"),
      body: { allowRichText: true },
    });
  });

  it("checks the trigger and the text", async () => {
    expect((await snip("Ada", { trigger: "a", expansion: "x" })).json!["error"].code).toBe(
      "invalid_trigger",
    );
    expect((await snip("Ada", { trigger: "ok", expansion: "  " })).json!["error"].code).toBe(
      "invalid_expansion",
    );
    expect(
      (await snip("Ada", { trigger: "ok", expansion: "x".repeat(20 * 1024 + 1) })).status,
    ).toBe(400);
    expect(
      (await snip("Ada", { trigger: "ok", expansion: "x", format: "html" })).json!["error"].code,
    ).toBe("invalid_format");
  });

  it("cannot be edited by a Member when an admin locked it", async () => {
    const made = await snip("Ada", { trigger: "legal", expansion: "Confidential" });
    const id = made.json!["item"].id as string;
    const locked = await h.call("POST", item(id, "/lock"), {
      token: tok("Ada"),
      body: { locked: true },
    });
    expect(locked.json).toMatchObject({ locked: true });
    expect(
      (await h.call("PATCH", item(id), { token: tok("Cy"), body: { expansion: "Changed" } })).json![
        "error"
      ].code,
    ).toBe("locked");
    expect((await h.call("DELETE", item(id), { token: tok("Bea") })).status).toBe(403);
    expect(
      (await h.call("PATCH", item(id), { token: tok("Ada"), body: { expansion: "Admin changed" } }))
        .status,
    ).toBe(200);
    expect(
      (await h.call("POST", item(id, "/lock"), { token: tok("Cy"), body: { locked: false } }))
        .status,
    ).toBe(403);
    const forClient = ((await merged("Cy"))["snippets"] as Json[]).find(
      (s) => s["trigger"] === "legal",
    )!;
    expect(forClient).toMatchObject({ locked: true, expansion: "Admin changed" });
    expect(await eventsOf("vocabulary.lock_changed")).toContain("vocabulary.lock_changed");
    // Only snippets lock.
    const term = (await propose("Ada", { term: "Lockless", scope: "company" })).json!["item"].id;
    expect(
      (await h.call("POST", item(term, "/lock"), { token: tok("Ada"), body: { locked: true } }))
        .status,
    ).toBe(400);
  });

  it("flags a trigger that is also a dictionary term or its replacement", async () => {
    await propose("Ada", { term: "ASAP", replacement: "as soon as possible", scope: "company" });
    await snip("Ada", {
      trigger: "asap",
      expansion: "right now",
      scope: "department",
      departmentId: sales,
    });
    await snip("Ada", {
      trigger: "as soon as possible",
      expansion: "whenever",
      scope: "department",
      departmentId: support,
    });
    const conflicts = (await h.call("GET", `${base()}/vocabulary/conflicts`, { token: tok("Ada") }))
      .json!;
    expect((conflicts["snippetTriggers"] as Json[]).map((c) => c["trigger"]).sort()).toEqual([
      "as soon as possible",
      "asap",
    ]);
  });

  it("gives the client the name and team for the variables, and nothing when nothing changed", async () => {
    const first = await merged("Cy");
    expect(first["context"]).toEqual({ me: "Cy", team: "Acme" });
    const again = (
      await h.call("GET", `${base()}/vocabulary/merged?since=${first["revision"]}`, {
        token: tok("Cy"),
      })
    ).json!;
    expect(again).toMatchObject({ unchanged: true, revision: first["revision"] });
    expect(again["dictionary"]).toBeUndefined();
  });
});

describe("importing from CSV", () => {
  const send = (csv: string, confirm = false, who = "Ada") =>
    h.call("POST", `${base()}/dictionary/import`, { token: tok(who), body: { csv, confirm } });

  it("parses quoted fields, escaped quotes and line breaks", () => {
    expect(parseCsv('term,replacement\n"a,b","say ""hi"""\r\nplain,\n\n"multi\nline",x')).toEqual([
      ["term", "replacement"],
      ["a,b", 'say "hi"'],
      ["plain", ""],
      ["multi\nline", "x"],
    ]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("﻿a,b")).toEqual([["a", "b"]]);
  });

  it("reports every duplicate and imports nothing until confirmed", async () => {
    await propose("Ada", { term: "Existing", scope: "company" });
    const csv =
      "term,replacement,scope\nNewOne,new one,\nexisting,,company\nNewOne,again,\nSalesOnly,so,Sales\nBadDept,x,Nowhere\n,empty,";
    const preview = await send(csv);
    expect(preview.json).toMatchObject({ confirmed: false, imported: 0, rows: 6 });
    expect(preview.json!["duplicates"]).toEqual([
      { line: 2, term: "existing", scope: "company", reason: "exists" },
      { line: 3, term: "NewOne", scope: "company", reason: "in_file" },
    ]);
    expect(preview.json!["errors"]).toMatchObject([{ line: 5 }, { line: 6 }]);
    expect((preview.json!["wouldImport"] as Json[]).map((e) => e["term"])).toEqual([
      "NewOne",
      "SalesOnly",
    ]);
    expect(await terms("Fay")).not.toContain("NewOne");

    const done = await send(csv, true);
    expect(done.json).toMatchObject({ confirmed: true, imported: 2 });
    expect(await terms("Fay")).toContain("NewOne");
    expect(await terms("Cy")).toContain("SalesOnly");
    expect(await terms("Dee")).not.toContain("SalesOnly");
    // Doing it again finds only duplicates.
    expect((await send(csv, true)).json).toMatchObject({ imported: 0 });
    expect(await eventsOf("vocabulary.imported")).toContain("vocabulary.imported");
  });

  it("is for admins, and refuses an empty file and too many rows", async () => {
    expect((await send("term\nx", true, "Cy")).status).toBe(403);
    expect((await send("term,replacement\n")).json!["error"].code).toBe("empty_csv");
    const many = Array.from({ length: 1001 }, (_, i) => `t${i}`).join("\n");
    expect((await send(many)).json!["error"].code).toBe("too_many_rows");
  });
});

describe("what the audit log holds", () => {
  it("never holds a term, a trigger or a snippet's text", async () => {
    const secret = "ProjectNightingale";
    await propose("Ada", { term: secret, replacement: "classified replacement", scope: "company" });
    await propose(
      "Ada",
      { trigger: "secretsnip", expansion: "classified expansion", scope: "company" },
      "snippets",
    );
    const log = (await h.call("GET", "/v1/audit/export", { token: h.owner.token })).raw;
    for (const text of [
      secret,
      "classified replacement",
      "secretsnip",
      "classified expansion",
      "Is this spelled right?",
      "Too generic",
    ])
      expect(log).not.toContain(text);
  });
});
