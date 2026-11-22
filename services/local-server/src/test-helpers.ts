import { createLocalServer, type LocalServer } from "./server.ts";

// Test responses are read loosely on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

export const PASSWORD = "a long enough password";

export interface Harness {
  server: LocalServer;
  base: string;
  clock: { now: number };
  call(
    method: string,
    path: string,
    options?: { body?: unknown; token?: string | null },
  ): Promise<{ status: number; json: Json | null; raw: string }>;
  /** Makes an account directly and signs it in; returns the id and a token. */
  person(name: string): Promise<{ id: string; email: string; token: string }>;
  close(): Promise<void>;
}

/** A server on a free port with the owner set up, and a way to call it. */
export async function startHarness(): Promise<Harness & { owner: { id: string; token: string } }> {
  const clock = { now: 1_000_000_000_000 };
  const server = createLocalServer({
    dbPath: ":memory:",
    port: 0,
    now: () => clock.now,
    siemAutoFlush: false,
  });
  const { host, port } = await server.listen();
  const base = `http://${host}:${port}`;

  async function call(
    method: string,
    path: string,
    options: { body?: unknown; token?: string | null } = {},
  ) {
    const withBody = options.body !== undefined && method !== "GET" && method !== "DELETE";
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(withBody ? { "content-type": "application/json" } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(withBody ? { body: JSON.stringify(options.body) } : {}),
    });
    const raw = await res.text();
    const json =
      raw && res.headers.get("content-type")?.includes("application/json")
        ? (JSON.parse(raw) as Json)
        : null;
    return { status: res.status, json, raw };
  }

  const setup = await call("POST", "/v1/setup", {
    body: { name: "Owner", email: "owner@example.com", password: PASSWORD },
  });
  const owner = { id: setup.json!["user"].id as string, token: setup.json!["token"] as string };

  async function person(name: string) {
    const email = `${name.toLowerCase().replace(/\W+/g, ".")}@example.com`;
    const made = server.accounts.createAccount({ name, email, password: PASSWORD }, owner.id);
    if (!made.ok) throw new Error(made.message);
    const signed = server.accounts.signIn(email, PASSWORD);
    if (!signed.ok) throw new Error(signed.message);
    return { id: made.user.id, email, token: signed.session.token };
  }

  return { server, base, clock, call, person, owner, close: () => server.close() };
}
