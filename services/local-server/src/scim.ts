import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Accounts } from "./accounts.ts";
import type { AuditInput } from "./audit.ts";
import type { Identity } from "./identity.ts";
import type { Teams } from "./teams.ts";

/**
 * SCIM 2.0 for one team (TM-19), a SIMULATION: users and groups under `/scim/v2`, with a bearer
 * token per team. No real provider calls it in a local build; the test client in this folder
 * does. Filters are limited to `userName eq` and `externalId eq`. Turning a user off ends their
 * sessions and blocks sign-in; nothing is deleted.
 */
export const SCHEMAS = {
  user: "urn:ietf:params:scim:schemas:core:2.0:User",
  group: "urn:ietf:params:scim:schemas:core:2.0:Group",
  list: "urn:ietf:params:scim:api:messages:2.0:ListResponse",
  patch: "urn:ietf:params:scim:api:messages:2.0:PatchOp",
  error: "urn:ietf:params:scim:api:messages:2.0:Error",
} as const;

export class ScimError extends Error {
  status: number;
  scimType: string | undefined;
  constructor(status: number, message: string, scimType?: string) {
    super(message);
    this.status = status;
    this.scimType = scimType;
  }
}

export interface ScimDeps {
  db: DatabaseSync;
  now(): number;
  audit(input: AuditInput): void;
  accounts: Accounts;
  teams: Teams;
  identity: Identity;
}

type Json = Record<string, unknown>;

interface UserRow {
  id: string;
  email: string;
  name: string;
  status: "active" | "deactivated";
  external_id: string | null;
  created_at: number;
  is_owner: number;
}

export function createScim(deps: ScimDeps) {
  const { db, accounts, teams } = deps;
  const log = (
    action: string,
    id: string,
    detail: Record<string, string | number | boolean> = {},
  ) =>
    deps.audit({
      actorId: null,
      action,
      targetType: "scim",
      targetId: id,
      detail: { simulation: true, ...detail },
    });

  const userRow = (teamId: string, id: string): UserRow => {
    const row = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.status, u.external_id, u.created_at, u.is_owner
         FROM users u JOIN team_members m ON m.user_id = u.id WHERE u.id = ? AND m.team_id = ?`,
      )
      .get(id, teamId) as UserRow | undefined;
    if (!row) throw new ScimError(404, "That user is not in this team.");
    return row;
  };

  const userView = (row: UserRow, host: string): Json => {
    const [givenName, ...rest] = row.name.split(" ");
    return {
      schemas: [SCHEMAS.user],
      id: row.id,
      ...(row.external_id ? { externalId: row.external_id } : {}),
      userName: row.email,
      name: { formatted: row.name, givenName: givenName ?? row.name, familyName: rest.join(" ") },
      displayName: row.name,
      emails: [{ value: row.email, primary: true }],
      active: row.status === "active",
      meta: {
        resourceType: "User",
        created: new Date(row.created_at).toISOString(),
        location: `http://${host}/scim/v2/Users/${row.id}`,
      },
    };
  };

  /** A display name from what a provider sends. */
  function nameOf(body: Json, fallback: string): string {
    const name = body["name"] as Json | undefined;
    const formatted = typeof name?.["formatted"] === "string" ? name["formatted"].trim() : "";
    const given = typeof name?.["givenName"] === "string" ? name["givenName"].trim() : "";
    const family = typeof name?.["familyName"] === "string" ? name["familyName"].trim() : "";
    const display = typeof body["displayName"] === "string" ? body["displayName"].trim() : "";
    return formatted || `${given} ${family}`.trim() || display || fallback;
  }

  function emailOf(body: Json): string {
    const userName =
      typeof body["userName"] === "string" ? body["userName"].trim().toLowerCase() : "";
    if (userName) return userName;
    const emails = body["emails"];
    if (Array.isArray(emails)) {
      const primary = emails.find((e) => (e as Json)["primary"] === true) ?? emails[0];
      const value = (primary as Json | undefined)?.["value"];
      if (typeof value === "string") return value.trim().toLowerCase();
    }
    return "";
  }

  function guardOwner(row: UserRow): void {
    if (row.is_owner === 1)
      throw new ScimError(403, "The owner account cannot be changed through SCIM.", "mutability");
  }

  function setActive(teamId: string, row: UserRow, active: boolean): void {
    if (active === (row.status === "active")) return;
    accounts.setStatus(row.id, active ? "active" : "deactivated");
    log(active ? "scim.user_reactivated" : "scim.user_deactivated", row.id, { teamId });
  }

  /** The user filter, as the provider sends it: `userName eq "x"` or `externalId eq "x"`. */
  function parseFilter(filter: string): { field: "userName" | "externalId"; value: string } {
    const match = /^\s*(userName|externalId)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
    if (!match)
      throw new ScimError(
        400,
        'Only filters like userName eq "x" or externalId eq "x" are supported.',
        "invalidFilter",
      );
    return {
      field: match[1]!.toLowerCase() === "username" ? "userName" : "externalId",
      value: match[2]!.replace(/\\(.)/g, "$1"),
    };
  }

  // ---- groups ----

  const groupRow = (teamId: string, id: string) => {
    const row = db
      .prepare("SELECT * FROM scim_groups WHERE id = ? AND team_id = ?")
      .get(id, teamId) as
      | { id: string; display_name: string; external_id: string | null; created_at: number }
      | undefined;
    if (!row) throw new ScimError(404, "There is no such group.");
    return row;
  };

  const groupMembers = (id: string) =>
    (
      db
        .prepare(
          `SELECT u.id, u.email FROM scim_group_members g JOIN users u ON u.id = g.user_id WHERE g.group_id = ? ORDER BY u.email`,
        )
        .all(id) as { id: string; email: string }[]
    ).map((member) => ({ value: member.id, display: member.email }));

  const groupView = (
    row: { id: string; display_name: string; external_id: string | null; created_at: number },
    host: string,
  ): Json => ({
    schemas: [SCHEMAS.group],
    id: row.id,
    ...(row.external_id ? { externalId: row.external_id } : {}),
    displayName: row.display_name,
    members: groupMembers(row.id),
    meta: {
      resourceType: "Group",
      created: new Date(row.created_at).toISOString(),
      location: `http://${host}/scim/v2/Groups/${row.id}`,
    },
  });

  /** A group's mapping to a department or a role is applied to a person who joins or leaves it. */
  function applyMapping(teamId: string, groupName: string, userId: string, joined: boolean): void {
    const entry = deps.identity
      .groupMap(teamId)
      .find((candidate) => candidate.group.toLowerCase() === groupName.toLowerCase());
    if (!entry) return;
    const current = teams.member(teamId, userId);
    if (!current) return;
    if (entry.departmentId !== undefined) {
      if (joined) teams.applyMapping(teamId, userId, { departmentId: entry.departmentId }, "scim");
      else if (current.department_id === entry.departmentId)
        teams.applyMapping(teamId, userId, { departmentId: null }, "scim");
    } else if (entry.role !== undefined) {
      if (joined) teams.applyMapping(teamId, userId, { role: entry.role }, "scim");
      else if (current.role === entry.role)
        teams.applyMapping(teamId, userId, { role: "member" }, "scim");
    }
  }

  function memberIds(teamId: string, value: unknown): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new ScimError(400, "members is a list.", "invalidValue");
    const ids: string[] = [];
    for (const item of value) {
      const id = (item as Json | undefined)?.["value"];
      if (typeof id !== "string")
        throw new ScimError(400, "Each member needs a value (a user id).", "invalidValue");
      userRow(teamId, id);
      ids.push(id);
    }
    return ids;
  }

  function setMembers(
    teamId: string,
    group: { id: string; display_name: string },
    wanted: string[],
  ): void {
    const have = new Set(
      (
        db.prepare("SELECT user_id FROM scim_group_members WHERE group_id = ?").all(group.id) as {
          user_id: string;
        }[]
      ).map((r) => r.user_id),
    );
    for (const id of wanted) {
      if (!have.has(id)) {
        db.prepare("INSERT INTO scim_group_members (group_id, user_id) VALUES (?, ?)").run(
          group.id,
          id,
        );
        applyMapping(teamId, group.display_name, id, true);
      }
    }
    for (const id of have) {
      if (!wanted.includes(id)) {
        db.prepare("DELETE FROM scim_group_members WHERE group_id = ? AND user_id = ?").run(
          group.id,
          id,
        );
        applyMapping(teamId, group.display_name, id, false);
      }
    }
  }

  const page = (query: URLSearchParams) => {
    const start = Math.max(Number(query.get("startIndex") ?? 1) || 1, 1);
    const count = Math.min(Math.max(Number(query.get("count") ?? 50) || 0, 0), 100);
    return { start, count };
  };

  return {
    ScimError,

    serviceProviderConfig: () => ({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      patch: { supported: true },
      bulk: { supported: false },
      filter: { supported: true, maxResults: 100 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "Bearer token",
          description: "A token made in the admin console. Simulation.",
        },
      ],
    }),

    // ---- users ----

    listUsers(teamId: string, query: URLSearchParams, host: string): Json {
      const { start, count } = page(query);
      let rows = db
        .prepare(
          `SELECT u.id, u.email, u.name, u.status, u.external_id, u.created_at, u.is_owner
           FROM users u JOIN team_members m ON m.user_id = u.id WHERE m.team_id = ? ORDER BY u.email`,
        )
        .all(teamId) as unknown as UserRow[];
      const filter = query.get("filter");
      if (filter) {
        const parsed = parseFilter(filter);
        rows = rows.filter((row) =>
          parsed.field === "userName"
            ? row.email === parsed.value.toLowerCase()
            : row.external_id === parsed.value,
        );
      }
      const slice = rows.slice(start - 1, start - 1 + count);
      return {
        schemas: [SCHEMAS.list],
        totalResults: rows.length,
        startIndex: start,
        itemsPerPage: slice.length,
        Resources: slice.map((row) => userView(row, host)),
      };
    },

    getUser: (teamId: string, id: string, host: string): Json =>
      userView(userRow(teamId, id), host),

    createUser(teamId: string, body: Json, host: string): Json {
      const email = emailOf(body);
      if (email === "")
        throw new ScimError(400, "userName (an email address) is required.", "invalidValue");
      const externalId = typeof body["externalId"] === "string" ? body["externalId"] : undefined;
      const name = nameOf(body, email);
      const made = accounts.createAccount(
        { name, email, password: randomBytes(32).toString("base64url") },
        null,
        "scim",
        { provisionedBy: "scim", ...(externalId ? { externalId } : {}) },
      );
      if (!made.ok)
        throw new ScimError(
          made.code === "email_taken" ? 409 : 400,
          made.message,
          made.code === "email_taken" ? "uniqueness" : "invalidValue",
        );
      teams.addMember(teamId, made.user.id, "member", null, { actorId: null, via: "scim" });
      if (body["active"] === false) accounts.setStatus(made.user.id, "deactivated");
      log("scim.user_created", made.user.id, { teamId });
      return userView(userRow(teamId, made.user.id), host);
    },

    replaceUser(teamId: string, id: string, body: Json, host: string): Json {
      const row = userRow(teamId, id);
      guardOwner(row);
      const email = emailOf(body) || row.email;
      const result = accounts.updateProfile(id, { name: nameOf(body, row.name), email });
      if (!result.ok)
        throw new ScimError(
          result.code === "email_taken" ? 409 : 400,
          result.message,
          result.code === "email_taken" ? "uniqueness" : "invalidValue",
        );
      if (typeof body["externalId"] === "string")
        db.prepare("UPDATE users SET external_id = ? WHERE id = ?").run(body["externalId"], id);
      if (typeof body["active"] === "boolean") setActive(teamId, row, body["active"]);
      log("scim.user_updated", id, { teamId });
      return userView(userRow(teamId, id), host);
    },

    patchUser(teamId: string, id: string, body: Json, host: string): Json {
      const row = userRow(teamId, id);
      guardOwner(row);
      const operations = body["Operations"];
      if (!Array.isArray(operations) || operations.length === 0)
        throw new ScimError(400, "Operations is a list of changes.", "invalidSyntax");
      let name: string | undefined;
      let email: string | undefined;
      let given: string | undefined;
      let family: string | undefined;
      let active: boolean | undefined;
      let externalId: string | undefined;

      const apply = (path: string, value: unknown) => {
        switch (path) {
          case "active":
            if (typeof value === "boolean") active = value;
            else if (value === "True" || value === "true") active = true;
            else if (value === "False" || value === "false") active = false;
            else throw new ScimError(400, "active is true or false.", "invalidValue");
            break;
          case "username":
            if (typeof value !== "string")
              throw new ScimError(400, "userName is text.", "invalidValue");
            email = value.trim().toLowerCase();
            break;
          case "externalid":
            if (typeof value !== "string")
              throw new ScimError(400, "externalId is text.", "invalidValue");
            externalId = value;
            break;
          case "displayname":
          case "name.formatted":
            if (typeof value !== "string")
              throw new ScimError(400, "A name is text.", "invalidValue");
            name = value.trim();
            break;
          case "name.givenname":
            if (typeof value !== "string")
              throw new ScimError(400, "A name is text.", "invalidValue");
            given = value.trim();
            break;
          case "name.familyname":
            if (typeof value !== "string")
              throw new ScimError(400, "A name is text.", "invalidValue");
            family = value.trim();
            break;
          default:
            throw new ScimError(400, `"${path}" cannot be changed here.`, "invalidPath");
        }
      };

      for (const raw of operations) {
        const operation = raw as Json;
        const op = typeof operation["op"] === "string" ? operation["op"].toLowerCase() : "";
        if (op !== "add" && op !== "replace" && op !== "remove")
          throw new ScimError(400, "An operation is add, replace or remove.", "invalidSyntax");
        const path = typeof operation["path"] === "string" ? operation["path"].toLowerCase() : "";
        if (op === "remove")
          throw new ScimError(400, "Removing an attribute is not supported.", "invalidPath");
        if (path === "") {
          // A provider may send the whole change as an object with no path.
          const value = operation["value"] as Json | undefined;
          if (!value || typeof value !== "object")
            throw new ScimError(400, "The operation has no value.", "invalidValue");
          for (const [key, inner] of Object.entries(value)) {
            if (key === "name" && inner && typeof inner === "object") {
              for (const [part, text] of Object.entries(inner as Json))
                apply(`name.${part.toLowerCase()}`, text);
            } else apply(key.toLowerCase(), inner);
          }
        } else apply(path, operation["value"]);
      }

      const finalName =
        name ??
        (given !== undefined || family !== undefined
          ? `${given ?? row.name.split(" ")[0] ?? ""} ${family ?? row.name.split(" ").slice(1).join(" ")}`.trim()
          : undefined);
      if (finalName !== undefined || email !== undefined) {
        const result = accounts.updateProfile(id, {
          ...(finalName !== undefined ? { name: finalName } : {}),
          ...(email !== undefined ? { email } : {}),
        });
        if (!result.ok)
          throw new ScimError(
            result.code === "email_taken" ? 409 : 400,
            result.message,
            result.code === "email_taken" ? "uniqueness" : "invalidValue",
          );
      }
      if (externalId !== undefined)
        db.prepare("UPDATE users SET external_id = ? WHERE id = ?").run(externalId, id);
      if (active !== undefined) setActive(teamId, row, active);
      log("scim.user_updated", id, { teamId });
      return userView(userRow(teamId, id), host);
    },

    /** DELETE turns the user off; their data stays. */
    deleteUser(teamId: string, id: string): void {
      const row = userRow(teamId, id);
      guardOwner(row);
      setActive(teamId, row, false);
    },

    // ---- groups ----

    listGroups(teamId: string, query: URLSearchParams, host: string): Json {
      const { start, count } = page(query);
      let rows = db
        .prepare("SELECT * FROM scim_groups WHERE team_id = ? ORDER BY display_name")
        .all(teamId) as {
        id: string;
        display_name: string;
        external_id: string | null;
        created_at: number;
      }[];
      const filter = query.get("filter");
      if (filter) {
        const match = /^\s*displayName\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
        if (!match)
          throw new ScimError(
            400,
            'Only the filter displayName eq "x" is supported for groups.',
            "invalidFilter",
          );
        rows = rows.filter((row) => row.display_name.toLowerCase() === match[1]!.toLowerCase());
      }
      const slice = rows.slice(start - 1, start - 1 + count);
      return {
        schemas: [SCHEMAS.list],
        totalResults: rows.length,
        startIndex: start,
        itemsPerPage: slice.length,
        Resources: slice.map((row) => groupView(row, host)),
      };
    },

    getGroup: (teamId: string, id: string, host: string): Json =>
      groupView(groupRow(teamId, id), host),

    createGroup(teamId: string, body: Json, host: string): Json {
      const displayName = typeof body["displayName"] === "string" ? body["displayName"].trim() : "";
      if (displayName === "" || displayName.length > 100)
        throw new ScimError(400, "displayName is required.", "invalidValue");
      if (
        db
          .prepare("SELECT 1 FROM scim_groups WHERE team_id = ? AND display_name = ?")
          .get(teamId, displayName)
      )
        throw new ScimError(409, "A group with that name exists.", "uniqueness");
      const members = memberIds(teamId, body["members"]);
      const id = randomUUID();
      db.prepare(
        "INSERT INTO scim_groups (id, team_id, display_name, external_id, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(
        id,
        teamId,
        displayName,
        typeof body["externalId"] === "string" ? body["externalId"] : null,
        deps.now(),
      );
      setMembers(teamId, { id, display_name: displayName }, members);
      log("scim.group_created", id, { teamId, members: members.length });
      return groupView(groupRow(teamId, id), host);
    },

    replaceGroup(teamId: string, id: string, body: Json, host: string): Json {
      const group = groupRow(teamId, id);
      const displayName =
        typeof body["displayName"] === "string" ? body["displayName"].trim() : group.display_name;
      if (displayName !== group.display_name)
        db.prepare("UPDATE scim_groups SET display_name = ? WHERE id = ?").run(displayName, id);
      setMembers(teamId, { id, display_name: displayName }, memberIds(teamId, body["members"]));
      log("scim.group_changed", id, { teamId });
      return groupView(groupRow(teamId, id), host);
    },

    patchGroup(teamId: string, id: string, body: Json, host: string): Json {
      const group = groupRow(teamId, id);
      const operations = body["Operations"];
      if (!Array.isArray(operations) || operations.length === 0)
        throw new ScimError(400, "Operations is a list of changes.", "invalidSyntax");
      let members = groupMembers(id).map((m) => m.value);
      let displayName = group.display_name;
      for (const raw of operations) {
        const operation = raw as Json;
        const op = typeof operation["op"] === "string" ? operation["op"].toLowerCase() : "";
        const path = typeof operation["path"] === "string" ? operation["path"] : "";
        if (path.toLowerCase() === "displayname" && (op === "replace" || op === "add")) {
          if (typeof operation["value"] !== "string")
            throw new ScimError(400, "displayName is text.", "invalidValue");
          displayName = operation["value"].trim();
        } else if (path.toLowerCase() === "members" || path === "") {
          const value = operation["value"];
          if (op === "add") members = [...new Set([...members, ...memberIds(teamId, value)])];
          else if (op === "replace") members = memberIds(teamId, value);
          else if (op === "remove") {
            const remove = new Set(memberIds(teamId, value));
            members = members.filter((m) => !remove.has(m));
          } else
            throw new ScimError(400, "An operation is add, replace or remove.", "invalidSyntax");
        } else {
          // A removal like members[value eq "id"].
          const match = /^members\[value eq "([^"]+)"\]$/i.exec(path);
          if (op === "remove" && match) members = members.filter((m) => m !== match[1]);
          else throw new ScimError(400, `"${path}" cannot be changed here.`, "invalidPath");
        }
      }
      if (displayName !== group.display_name && displayName !== "")
        db.prepare("UPDATE scim_groups SET display_name = ? WHERE id = ?").run(displayName, id);
      setMembers(teamId, { id, display_name: displayName || group.display_name }, members);
      log("scim.group_changed", id, { teamId });
      return groupView(groupRow(teamId, id), host);
    },

    deleteGroup(teamId: string, id: string): void {
      const group = groupRow(teamId, id);
      for (const member of groupMembers(id))
        applyMapping(teamId, group.display_name, member.value, false);
      db.prepare("DELETE FROM scim_groups WHERE id = ?").run(id);
      log("scim.group_deleted", id, { teamId });
    },
  };
}

export type Scim = ReturnType<typeof createScim>;
