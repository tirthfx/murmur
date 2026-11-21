import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { argsHash, AUDIT_DAYS, AUDIT_KEEP, canonicalJson, createMcpAudit } from "./mcp-audit";

const event = (over: Partial<Parameters<ReturnType<typeof createMcpAudit>["record"]>[0]> = {}) => ({
  at: 1_000,
  client: "Claude desktop",
  tool: "get_meeting",
  args: { meetingId: "m-1" },
  ok: true,
  resultBytes: 120,
  write: false,
  ...over,
});

describe("MCP call log (CN-11)", () => {
  it("keeps the app, the tool, a hash of the arguments and the size, newest first", () => {
    const db = openDatabase(":memory:");
    const audit = createMcpAudit(db);
    audit.record(event());
    audit.record(
      event({ at: 2_000, tool: "create_task", write: true, ok: false, resultBytes: 40 }),
    );
    expect(audit.list()).toEqual([
      {
        id: 2,
        at: 2_000,
        client: "Claude desktop",
        tool: "create_task",
        ok: false,
        resultBytes: 40,
        write: true,
      },
      {
        id: 1,
        at: 1_000,
        client: "Claude desktop",
        tool: "get_meeting",
        ok: true,
        resultBytes: 120,
        write: false,
      },
    ]);
    expect(audit.list(1)).toHaveLength(1);
  });

  it("never keeps the arguments: the row has only their hash", () => {
    const db = openDatabase(":memory:");
    const audit = createMcpAudit(db);
    audit.record(event({ args: { title: "The merger with Acme", notes: "secret plans" } }));
    const rows = JSON.stringify(db.prepare("SELECT * FROM mcp_audit").all());
    expect(rows).not.toContain("merger");
    expect(rows).not.toContain("secret");
    expect(rows).toContain(argsHash({ notes: "secret plans", title: "The merger with Acme" }));
  });

  it("hashes the same arguments the same, whatever the order of the keys", () => {
    expect(argsHash({ a: 1, b: { d: 2, c: [3, { y: 1, x: 2 }] } })).toBe(
      argsHash({ b: { c: [3, { x: 2, y: 1 }], d: 2 }, a: 1 }),
    );
    expect(argsHash({ a: 1 })).not.toBe(argsHash({ a: 2 }));
    expect(canonicalJson({ b: undefined, a: 1 })).toBe('{"a":1}');
    expect(canonicalJson(undefined)).toBe("null");
  });

  it("drops lines older than 90 days and keeps at most 5,000", () => {
    const db = openDatabase(":memory:");
    const audit = createMcpAudit(db);
    const day = 86_400_000;
    audit.record(event({ at: 0 }));
    audit.record(event({ at: (AUDIT_DAYS - 1) * day }));
    audit.record(event({ at: (AUDIT_DAYS + 1) * day }));
    expect(audit.list().map((entry) => entry.at)).toEqual([
      (AUDIT_DAYS + 1) * day,
      (AUDIT_DAYS - 1) * day,
    ]);
    for (let i = 0; i < AUDIT_KEEP + 10; i++)
      audit.record(event({ at: (AUDIT_DAYS + 2) * day + i }));
    expect(db.prepare("SELECT COUNT(*) AS n FROM mcp_audit").get()).toEqual({ n: AUDIT_KEEP });
  });

  it("clears the log", () => {
    const db = openDatabase(":memory:");
    const audit = createMcpAudit(db);
    audit.record(event());
    audit.clear();
    expect(audit.list()).toEqual([]);
  });
});
