/**
 * A SCIM provider for the simulation (TM-19): it runs the usual sequence against a server, the
 * way an identity provider would (make a user, find it, change it, turn it off, make a group,
 * change its members, remove things). No real provider calls the server in a local build; this
 * does. Run it with `npm run scim:test --workspace @murmur/local-server -- <url> <token>`.
 */
export interface ScimStep {
  step: string;
  ok: boolean;
  detail: string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function runScimSequence(options: {
  baseUrl: string;
  token: string;
  /** The email for the user it makes; the default is made from the time. */
  email?: string;
  fetch?: Fetch;
}): Promise<ScimStep[]> {
  const send: Fetch = options.fetch ?? fetch;
  const base = `${options.baseUrl.replace(/\/$/, "")}/scim/v2`;
  const email = options.email ?? `scim.${Date.now()}@example.com`;
  const steps: ScimStep[] = [];

  async function call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> | null }> {
    const res = await send(base + path, {
      method,
      headers: {
        authorization: `Bearer ${options.token}`,
        ...(body !== undefined ? { "content-type": "application/scim+json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return {
      status: res.status,
      json: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    };
  }
  const record = (step: string, ok: boolean, detail: string) => steps.push({ step, ok, detail });

  const config = await call("GET", "/ServiceProviderConfig");
  record("read the service configuration", config.status === 200, `status ${config.status}`);
  if (config.status !== 200) return steps;

  const created = await call("POST", "/Users", {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName: email,
    externalId: `ext-${email}`,
    name: { givenName: "Scim", familyName: "Tester" },
    active: true,
  });
  const id = typeof created.json?.["id"] === "string" ? created.json["id"] : "";
  record("create a user", created.status === 201 && id !== "", `status ${created.status}`);
  if (id === "") return steps;

  const found = await call("GET", `/Users?filter=${encodeURIComponent(`userName eq "${email}"`)}`);
  record(
    "find the user by userName",
    found.json?.["totalResults"] === 1,
    `${String(found.json?.["totalResults"])} found`,
  );

  const renamed = await call("PATCH", `/Users/${id}`, {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    Operations: [{ op: "replace", path: "name.givenName", value: "Renamed" }],
  });
  record(
    "change the name",
    renamed.status === 200 && String(renamed.json?.["displayName"]).startsWith("Renamed"),
    `status ${renamed.status}`,
  );

  const group = await call("POST", "/Groups", {
    displayName: `Group ${Date.now()}`,
    members: [{ value: id }],
  });
  const groupId = typeof group.json?.["id"] === "string" ? group.json["id"] : "";
  record(
    "create a group with the user",
    group.status === 201 && groupId !== "",
    `status ${group.status}`,
  );
  if (groupId !== "") {
    const removed = await call("PATCH", `/Groups/${groupId}`, {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "remove", path: `members[value eq "${id}"]` }],
    });
    record(
      "take the user out of the group",
      removed.status === 200 && (removed.json?.["members"] as unknown[]).length === 0,
      `status ${removed.status}`,
    );
    const gone = await call("DELETE", `/Groups/${groupId}`);
    record("delete the group", gone.status === 204, `status ${gone.status}`);
  }

  const off = await call("PATCH", `/Users/${id}`, {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    Operations: [{ op: "replace", path: "active", value: false }],
  });
  record(
    "turn the user off",
    off.status === 200 && off.json?.["active"] === false,
    `status ${off.status}`,
  );

  const again = await call("GET", `/Users/${id}`);
  record(
    "see that the user is off",
    again.json?.["active"] === false,
    `active ${String(again.json?.["active"])}`,
  );
  return steps;
}
