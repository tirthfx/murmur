import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startHarness, type Json } from "./test-helpers.ts";

/**
 * Shared Skills and folders (NT-16, NT-17): two people on one server share a Skill and a folder,
 * and each role gets what the matrix says and nothing else.
 */
let h: Awaited<ReturnType<typeof startHarness>>;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(() => h.close());

interface Crew {
  teamId: string;
  sales: string;
  support: string;
  admin: { id: string; token: string };
  boss: { id: string; token: string }; // manager of Sales
  sam: { id: string; token: string }; // member of Sales
  ines: { id: string; token: string }; // member of Support
  vera: { id: string; token: string }; // viewer, no department
}

/** A team with two departments and one person of each kind. */
async function crew(): Promise<Crew> {
  const teamId = (
    await h.call("POST", "/v1/teams", { token: h.owner.token, body: { name: "Acme" } })
  ).json!["id"] as string;
  const dept = async (name: string) =>
    (
      await h.call("POST", `/v1/teams/${teamId}/departments`, {
        token: h.owner.token,
        body: { name },
      })
    ).json!["id"] as string;
  const sales = await dept("Sales");
  const support = await dept("Support");
  const add = async (name: string, role: string, department: string | null) => {
    const person = await h.person(name);
    h.server.teams.addMember(teamId, person.id, role as never, department, {
      actorId: h.owner.id,
      via: "test",
    });
    return { id: person.id, token: person.token };
  };
  return {
    teamId,
    sales,
    support,
    admin: await add("Admin Person", "admin", null),
    boss: await add("Boss Person", "manager", sales),
    sam: await add("Sam Person", "member", sales),
    ines: await add("Ines Person", "member", support),
    vera: await add("Vera Person", "viewer", null),
  };
}

const skill = (name: string, extra: Json = {}) => ({
  name,
  description: "Sums up a call",
  body: `---\nname: ${name}\n---\nSummarise the call in five lines.`,
  ...extra,
});

describe("team Skills", () => {
  it("an admin publishes one for the team and every member reads it", async () => {
    const c = await crew();
    const made = await h.call("POST", `/v1/teams/${c.teamId}/skills`, {
      token: c.admin.token,
      body: skill("Call recap"),
    });
    expect(made.status).toBe(201);
    expect(made.json!["skill"]).toMatchObject({ name: "Call recap", version: 1, scope: "company" });
    for (const person of [c.boss, c.sam, c.ines, c.vera]) {
      const list = await h.call("GET", `/v1/teams/${c.teamId}/skills`, { token: person.token });
      expect(list.status).toBe(200);
      expect((list.json!["skills"] as Json[]).map((s) => s["name"])).toEqual(["Call recap"]);
    }
  });

  it("a member and a viewer cannot publish, change or remove one", async () => {
    const c = await crew();
    const id = (
      await h.call("POST", `/v1/teams/${c.teamId}/skills`, {
        token: c.admin.token,
        body: skill("Call recap"),
      })
    ).json!["skill"].id;
    for (const person of [c.sam, c.vera]) {
      expect(
        (
          await h.call("POST", `/v1/teams/${c.teamId}/skills`, {
            token: person.token,
            body: skill("Mine"),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await h.call("PATCH", `/v1/teams/${c.teamId}/skills/${id}`, {
            token: person.token,
            body: { name: "Hijacked" },
          })
        ).status,
      ).toBe(403);
      expect(
        (await h.call("DELETE", `/v1/teams/${c.teamId}/skills/${id}`, { token: person.token }))
          .status,
      ).toBe(403);
    }
    const still = await h.call("GET", `/v1/teams/${c.teamId}/skills`, { token: c.sam.token });
    expect((still.json!["skills"] as Json[])[0]).toMatchObject({ name: "Call recap", version: 1 });
  });

  it("a manager publishes to their own department only, and only that department sees it", async () => {
    const c = await crew();
    const own = await h.call("POST", `/v1/teams/${c.teamId}/skills`, {
      token: c.boss.token,
      body: skill("Pipeline review", { scope: "department" }),
    });
    expect(own.status).toBe(201);
    expect(own.json!["skill"].departmentId).toBe(c.sales);
    const other = await h.call("POST", `/v1/teams/${c.teamId}/skills`, {
      token: c.boss.token,
      body: skill("Ticket triage", { scope: "department", departmentId: c.support }),
    });
    expect(other.status).toBe(403);
    const company = await h.call("POST", `/v1/teams/${c.teamId}/skills`, {
      token: c.boss.token,
      body: skill("For everyone"),
    });
    expect(company.status).toBe(403);
    const names = async (person: { token: string }) =>
      (
        (await h.call("GET", `/v1/teams/${c.teamId}/skills`, { token: person.token })).json![
          "skills"
        ] as Json[]
      ).map((s) => s["name"]);
    expect(await names(c.sam)).toEqual(["Pipeline review"]);
    expect(await names(c.ines)).toEqual([]);
    expect(await names(c.admin)).toEqual(["Pipeline review"]);
  });

  it("a change is a new version that members see, and the old ones are kept", async () => {
    const c = await crew();
    const id = (
      await h.call("POST", `/v1/teams/${c.teamId}/skills`, {
        token: c.admin.token,
        body: skill("Call recap"),
      })
    ).json!["skill"].id;
    const same = await h.call("PATCH", `/v1/teams/${c.teamId}/skills/${id}`, {
      token: c.admin.token,
      body: { description: "Sums up a call" },
    });
    expect(same.json).toMatchObject({ changed: false });
    expect(same.json!["skill"].version).toBe(1);
    const changed = await h.call("PATCH", `/v1/teams/${c.teamId}/skills/${id}`, {
      token: c.admin.token,
      body: { body: "---\nname: Call recap\n---\nSummarise the call in three lines." },
    });
    expect(changed.json).toMatchObject({ changed: true });
    expect(changed.json!["skill"].version).toBe(2);
    const seen = await h.call("GET", `/v1/teams/${c.teamId}/skills`, { token: c.sam.token });
    expect((seen.json!["skills"] as Json[])[0]).toMatchObject({ version: 2 });
    const versions = await h.call("GET", `/v1/teams/${c.teamId}/skills/${id}/versions`, {
      token: c.sam.token,
    });
    expect((versions.json!["versions"] as Json[]).map((v) => v["version"])).toEqual([2, 1]);
    expect((versions.json!["versions"] as Json[])[1]!["body"]).toContain("five lines");
  });

  it("refuses a bad Skill, a duplicate name, and a publish that the team's policy forbids", async () => {
    const c = await crew();
    const post = (body: Json) =>
      h.call("POST", `/v1/teams/${c.teamId}/skills`, { token: c.admin.token, body });
    expect((await post({ name: "", body: "x" })).status).toBe(400);
    expect((await post({ name: "No prompt", body: "   " })).status).toBe(400);
    expect((await post({ name: "Huge", body: "x".repeat(20_001) })).status).toBe(400);
    expect((await post(skill("Dup"))).status).toBe(201);
    const dup = await post(skill("dup"));
    expect(dup.status).toBe(409);
    expect(dup.json!["error"].code).toBe("duplicate");
    await h.call("PUT", `/v1/teams/${c.teamId}/policy`, {
      token: c.admin.token,
      body: { scope: "team", set: { "features.notetaker": false } },
    });
    const blocked = await post(skill("After the policy"));
    expect(blocked.status).toBe(403);
    expect(blocked.json!["error"].code).toBe("blocked_by_policy");
  });

  it("a removed Skill is gone for everyone", async () => {
    const c = await crew();
    const id = (
      await h.call("POST", `/v1/teams/${c.teamId}/skills`, {
        token: c.admin.token,
        body: skill("Call recap"),
      })
    ).json!["skill"].id;
    expect(
      (await h.call("DELETE", `/v1/teams/${c.teamId}/skills/${id}`, { token: c.admin.token }))
        .status,
    ).toBe(204);
    expect(
      (await h.call("GET", `/v1/teams/${c.teamId}/skills`, { token: c.sam.token })).json![
        "skills"
      ] as Json[],
    ).toEqual([]);
    expect(
      (await h.call("GET", `/v1/teams/${c.teamId}/skills/${id}/versions`, { token: c.sam.token }))
        .status,
    ).toBe(404);
  });

  it("is for Team and up, and for people in the team", async () => {
    const c = await crew();
    const stranger = await h.person("Stranger Person");
    expect(
      (await h.call("GET", `/v1/teams/${c.teamId}/skills`, { token: stranger.token })).status,
    ).toBe(403);
    await h.call("PUT", "/v1/plan", { token: h.owner.token, body: { tier: "free" } });
    const free = await h.call("GET", `/v1/teams/${c.teamId}/skills`, { token: c.sam.token });
    expect(free.status).toBe(403);
    expect(free.json!["error"].code).toBe("plan_required");
  });
});

describe("shared folders", () => {
  const folder = (c: Crew, token: string, body: Json) =>
    h.call("POST", `/v1/teams/${c.teamId}/folders`, { token, body });

  it("two people share a folder: one adds meeting notes, the other reads them", async () => {
    const c = await crew();
    const made = await folder(c, c.sam.token, {
      name: "Q4 deal",
      kind: "shared",
      members: [c.ines.id],
    });
    expect(made.status).toBe(201);
    const id = made.json!["folder"].id as string;
    const shared = await h.call("POST", `/v1/teams/${c.teamId}/folders/${id}/items`, {
      token: c.sam.token,
      body: {
        title: "Kickoff call",
        body: "# Kickoff\n- Agreed on the date",
        sourceRef: "meeting:42",
      },
    });
    expect(shared.status).toBe(201);
    const list = await h.call("GET", `/v1/teams/${c.teamId}/folders`, { token: c.ines.token });
    const mine = (list.json!["folders"] as Json[])[0]!;
    expect(mine).toMatchObject({ name: "Q4 deal", kind: "shared", canWrite: true });
    expect(mine["items"]).toHaveLength(1);
    expect(JSON.stringify(mine["items"])).not.toContain("Agreed on the date");
    const read = await h.call(
      "GET",
      `/v1/teams/${c.teamId}/folders/${id}/items/${shared.json!["id"]}`,
      { token: c.ines.token },
    );
    expect(read.json!["item"]).toMatchObject({
      title: "Kickoff call",
      sharedBy: "Sam Person",
      sourceRef: "meeting:42",
    });
    expect(read.json!["item"].body).toContain("Agreed on the date");
  });

  it("a person who is not in a shared folder does not see it, and cannot read or add to it", async () => {
    const c = await crew();
    const id = (await folder(c, c.sam.token, { name: "Private-ish", kind: "shared" })).json![
      "folder"
    ].id;
    await h.call("POST", `/v1/teams/${c.teamId}/folders/${id}/items`, {
      token: c.sam.token,
      body: { title: "Note", body: "text" },
    });
    for (const person of [c.ines, c.vera, c.boss]) {
      const list = await h.call("GET", `/v1/teams/${c.teamId}/folders`, { token: person.token });
      expect(list.json!["folders"], "folder visible").toEqual([]);
      expect(
        (
          await h.call("POST", `/v1/teams/${c.teamId}/folders/${id}/items`, {
            token: person.token,
            body: { title: "x", body: "y" },
          })
        ).status,
      ).not.toBe(201);
    }
    // An admin sees every folder in the team.
    expect(
      (await h.call("GET", `/v1/teams/${c.teamId}/folders`, { token: c.admin.token })).json![
        "folders"
      ] as Json[],
    ).toHaveLength(1);
  });

  it("a viewer reads folders they are in and adds to none", async () => {
    const c = await crew();
    const id = (
      await folder(c, c.sam.token, { name: "Reading", kind: "shared", members: [c.vera.id] })
    ).json!["folder"].id;
    const list = await h.call("GET", `/v1/teams/${c.teamId}/folders`, { token: c.vera.token });
    expect((list.json!["folders"] as Json[])[0]).toMatchObject({ canWrite: false });
    const add = await h.call("POST", `/v1/teams/${c.teamId}/folders/${id}/items`, {
      token: c.vera.token,
      body: { title: "x", body: "y" },
    });
    expect(add.status).toBe(403);
    expect((await folder(c, c.vera.token, { name: "Mine", kind: "shared" })).status).toBe(403);
  });

  it("a member set to read-only reads and does not add", async () => {
    const c = await crew();
    const id = (
      await folder(c, c.sam.token, { name: "Team notes", kind: "shared", members: [c.ines.id] })
    ).json!["folder"].id;
    await h.call("PUT", `/v1/teams/${c.teamId}/folders/${id}/members/${c.ines.id}`, {
      token: c.sam.token,
      body: { canWrite: false },
    });
    const add = await h.call("POST", `/v1/teams/${c.teamId}/folders/${id}/items`, {
      token: c.ines.token,
      body: { title: "x", body: "y" },
    });
    expect(add.status).toBe(403);
    expect(
      (await h.call("GET", `/v1/teams/${c.teamId}/folders`, { token: c.ines.token })).json![
        "folders"
      ] as Json[],
    ).toHaveLength(1);
  });

  it("a department folder follows the department, a company folder the team", async () => {
    const c = await crew();
    expect((await folder(c, c.sam.token, { name: "Sales notes", kind: "department" })).status).toBe(
      403,
    );
    const dept = await folder(c, c.boss.token, { name: "Sales notes", kind: "department" });
    expect(dept.status).toBe(201);
    expect(dept.json!["folder"].departmentId).toBe(c.sales);
    expect(
      (
        await folder(c, c.boss.token, {
          name: "Support notes",
          kind: "department",
          departmentId: c.support,
        })
      ).status,
    ).toBe(403);
    expect((await folder(c, c.boss.token, { name: "All hands", kind: "company" })).status).toBe(
      403,
    );
    expect((await folder(c, c.admin.token, { name: "All hands", kind: "company" })).status).toBe(
      201,
    );
    const names = async (person: { token: string }) =>
      (
        (await h.call("GET", `/v1/teams/${c.teamId}/folders`, { token: person.token })).json![
          "folders"
        ] as Json[]
      )
        .map((f) => f["name"])
        .sort();
    expect(await names(c.sam)).toEqual(["All hands", "Sales notes"]);
    expect(await names(c.ines)).toEqual(["All hands"]);
    // Anyone who can write may add to a department or company folder they can see.
    const id = dept.json!["folder"].id;
    expect(
      (
        await h.call("POST", `/v1/teams/${c.teamId}/folders/${id}/items`, {
          token: c.sam.token,
          body: { title: "Pipeline", body: "text" },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await h.call("POST", `/v1/teams/${c.teamId}/folders/${id}/items`, {
          token: c.ines.token,
          body: { title: "x", body: "y" },
        })
      ).status,
    ).toBe(404);
  });

  it("only the person who shared a note, or the folder's managers, remove it", async () => {
    const c = await crew();
    const id = (
      await folder(c, c.sam.token, { name: "Q4", kind: "shared", members: [c.ines.id, c.boss.id] })
    ).json!["folder"].id;
    const item = (
      await h.call("POST", `/v1/teams/${c.teamId}/folders/${id}/items`, {
        token: c.ines.token,
        body: { title: "Note", body: "text" },
      })
    ).json!["id"];
    const path = `/v1/teams/${c.teamId}/folders/${id}/items/${item}`;
    expect((await h.call("DELETE", path, { token: c.boss.token })).status).toBe(403);
    expect((await h.call("DELETE", path, { token: c.sam.token })).status).toBe(204); // the folder's maker
    const again = (
      await h.call("POST", `/v1/teams/${c.teamId}/folders/${id}/items`, {
        token: c.ines.token,
        body: { title: "Note", body: "text" },
      })
    ).json!["id"];
    expect(
      (
        await h.call("DELETE", `/v1/teams/${c.teamId}/folders/${id}/items/${again}`, {
          token: c.ines.token,
        })
      ).status,
    ).toBe(204);
  });

  it("a person may leave a folder, and removing a folder removes the copies in it", async () => {
    const c = await crew();
    const id = (await folder(c, c.sam.token, { name: "Q4", kind: "shared", members: [c.ines.id] }))
      .json!["folder"].id;
    await h.call("POST", `/v1/teams/${c.teamId}/folders/${id}/items`, {
      token: c.sam.token,
      body: { title: "Note", body: "text" },
    });
    expect(
      (
        await h.call("DELETE", `/v1/teams/${c.teamId}/folders/${id}/members/${c.ines.id}`, {
          token: c.ines.token,
        })
      ).status,
    ).toBe(204);
    expect(
      (await h.call("GET", `/v1/teams/${c.teamId}/folders`, { token: c.ines.token })).json![
        "folders"
      ] as Json[],
    ).toEqual([]);
    expect(
      (await h.call("DELETE", `/v1/teams/${c.teamId}/folders/${id}`, { token: c.ines.token }))
        .status,
    ).not.toBe(204);
    expect(
      (await h.call("DELETE", `/v1/teams/${c.teamId}/folders/${id}`, { token: c.sam.token }))
        .status,
    ).toBe(204);
    const rows = h.server.db.prepare("SELECT COUNT(*) AS n FROM folder_items").get() as {
      n: number;
    };
    expect(rows.n).toBe(0);
  });

  it("refuses bad input, people outside the team, and notes that are too big", async () => {
    const c = await crew();
    expect((await folder(c, c.sam.token, { name: "", kind: "shared" })).status).toBe(400);
    expect((await folder(c, c.sam.token, { name: "Odd", kind: "secret" })).status).toBe(400);
    const stranger = await h.person("Stranger Person");
    expect(
      (await folder(c, c.sam.token, { name: "Out", kind: "shared", members: [stranger.id] }))
        .status,
    ).toBe(400);
    expect(
      (await folder(c, c.admin.token, { name: "Company", kind: "company", members: [c.sam.id] }))
        .status,
    ).toBe(400);
    const id = (await folder(c, c.sam.token, { name: "Q4", kind: "shared" })).json!["folder"].id;
    expect((await folder(c, c.sam.token, { name: "q4", kind: "shared" })).status).toBe(409);
    const big = await h.call("POST", `/v1/teams/${c.teamId}/folders/${id}/items`, {
      token: c.sam.token,
      body: { title: "Big", body: "x".repeat(60_001) },
    });
    expect(big.status).toBe(400);
    expect(
      (
        await h.call("POST", `/v1/teams/${c.teamId}/folders/${id}/items`, {
          token: c.sam.token,
          body: { title: "", body: "x" },
        })
      ).status,
    ).toBe(400);
  });
});

describe("keeping in step, and what is written down", () => {
  it("the content answer has a revision that moves with a change, and says unchanged when it has not", async () => {
    const c = await crew();
    const first = await h.call("GET", `/v1/teams/${c.teamId}/content`, { token: c.sam.token });
    const rev = first.json!["revision"] as number;
    expect(
      (await h.call("GET", `/v1/teams/${c.teamId}/content?since=${rev}`, { token: c.sam.token }))
        .json,
    ).toEqual({ revision: rev, unchanged: true });
    await h.call("POST", `/v1/teams/${c.teamId}/skills`, {
      token: c.admin.token,
      body: skill("Call recap"),
    });
    const next = await h.call("GET", `/v1/teams/${c.teamId}/content?since=${rev}`, {
      token: c.sam.token,
    });
    expect(next.json!["unchanged"]).toBe(false);
    expect(next.json!["revision"]).toBeGreaterThan(rev);
    expect(next.json!["skills"]).toHaveLength(1);
    expect(
      (await h.call("GET", `/v1/teams/${c.teamId}/content?since=nope`, { token: c.sam.token }))
        .status,
    ).toBe(400);
  });

  it("writes the changes to the audit log without a Skill's prompt or a note's text", async () => {
    const c = await crew();
    await h.call("POST", `/v1/teams/${c.teamId}/skills`, {
      token: c.admin.token,
      body: skill("Call recap", { body: "Secret prompt words" }),
    });
    const id = (
      await h.call("POST", `/v1/teams/${c.teamId}/folders`, {
        token: c.sam.token,
        body: { name: "Q4", kind: "shared" },
      })
    ).json!["folder"].id;
    await h.call("POST", `/v1/teams/${c.teamId}/folders/${id}/items`, {
      token: c.sam.token,
      body: { title: "Private title", body: "Private note text" },
    });
    const log = await h.call("GET", "/v1/audit?limit=200", { token: h.owner.token });
    const actions = (log.json!["events"] as Json[]).map((event) => event["action"]);
    expect(actions).toEqual(
      expect.arrayContaining(["skill.published", "folder.created", "folder.item_shared"]),
    );
    expect(log.raw).not.toContain("Secret prompt words");
    expect(log.raw).not.toContain("Private note text");
    expect(log.raw).not.toContain("Private title");
  });

  it("has no field that could take audio: a note is text with a size limit", () => {
    const columns = h.server.db.prepare("PRAGMA table_info(folder_items)").all() as {
      name: string;
      type: string;
    }[];
    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "folder_id",
      "title",
      "body_md",
      "source_ref",
      "shared_by",
      "shared_at",
    ]);
    expect(columns.some((column) => /blob/i.test(column.type))).toBe(false);
  });
});
