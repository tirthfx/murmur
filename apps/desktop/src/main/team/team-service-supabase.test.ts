import { describe, expect, it, vi } from "vitest";
import type { Keychain, TeamView } from "@murmur/shared";
import { createSharedVocabulary } from "./shared-vocabulary";
import { decodeSupabaseToken } from "./supabase-team-client";
import { TEAM_KEYCHAIN, createTeamService } from "./team-service";

/**
 * The team service choosing a backend from what it is connected to: an address with a project key
 * is a Supabase project, an address without one is a Murmur team server. A fake service answers
 * for both, so the choice, the key sent, the reset on a change and the token a renewal brings
 * back to the Keychain are all seen from the service.
 */
const SUPABASE = "https://abc.supabase.co";
const KEY = "public-project-key";

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function rig() {
  const seen: Seen[] = [];
  const keys = new Map<string, string>();
  const file = { text: null as string | null };
  const views: TeamView[] = [];
  let teamsCalls = 0;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetchFake = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const entry: Seen = {
      url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    seen.push(entry);
    if (url === `${SUPABASE}/rest/v1/rpc/murmur_health`) return json(200, { setUp: true });
    if (url === "http://127.0.0.1:7830/v1/health") return json(200, { ok: true, setUp: true });
    if (url === `${SUPABASE}/auth/v1/token?grant_type=password`)
      return json(200, {
        access_token: "access-1",
        refresh_token: "refresh-1",
        user: { email: "ada@example.com", user_metadata: { name: "Ada" } },
      });
    if (url === `${SUPABASE}/auth/v1/token?grant_type=refresh_token`)
      return json(200, { access_token: "access-2", refresh_token: "refresh-2" });
    if (url === `${SUPABASE}/auth/v1/logout?scope=local`)
      return new Response(null, { status: 204 });
    if (url === `${SUPABASE}/rest/v1/rpc/my_teams`) {
      teamsCalls += 1;
      // The first call finds the access token expired; after a renewal it works.
      return entry.headers["authorization"] === "Bearer access-2"
        ? json(200, [{ id: "t1", name: "Acme", myRole: "member" }])
        : json(401, { code: "PGRST301", message: "JWT expired" });
    }
    if (url.includes("/rest/v1/rpc/")) return json(200, { unchanged: true });
    return json(404, { message: "not in the fake" });
  });

  const keychain: Keychain = {
    get: async (service, account) => keys.get(`${service}/${account}`) ?? null,
    set: async (service, account, value) => void keys.set(`${service}/${account}`, value),
    delete: async (service, account) => keys.delete(`${service}/${account}`),
  };
  const service = createTeamService({
    readFile: () => file.text,
    writeFile: (text) => (file.text = text),
    keychain,
    fetch: fetchFake as unknown as typeof fetch,
    now: () => 1_000_000_000_000,
    idleSeconds: () => 0,
    networkCheck: () => undefined,
    vocabulary: createSharedVocabulary(),
    insights: { days: () => [] },
    meetings: { list: () => [] },
    onChange: (view) => views.push(view),
    setInterval: () => 1,
    clearInterval: () => undefined,
  });
  return { service, seen, keys, file, views, teamsCalls: () => teamsCalls };
}

describe("the team service and its backend", () => {
  it("is a Supabase project when a project key comes with the address", async () => {
    const { service, seen, file } = rig();
    const result = await service.connect({ serverUrl: SUPABASE, projectKey: KEY });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.view.backend).toBe("supabase");
    expect(seen[0]?.url).toBe(`${SUPABASE}/rest/v1/rpc/murmur_health`);
    expect(seen[0]?.headers["apikey"]).toBe(KEY);
    const saved = JSON.parse(file.text ?? "{}") as { backend: string; projectKey: string };
    expect(saved).toMatchObject({ backend: "supabase", projectKey: KEY });
  });

  it("is a team server when there is no key, and does not ask Supabase anything", async () => {
    const { service, seen } = rig();
    const result = await service.connect({ serverUrl: "http://127.0.0.1:7830" });
    expect(result.ok && result.view.backend).toBe("local");
    expect(seen.map((s) => s.url)).toEqual(["http://127.0.0.1:7830/v1/health"]);
  });

  it("takes a bare address as https for a project and refuses plain http beyond this Mac", async () => {
    const { service, seen } = rig();
    await service.connect({ serverUrl: "abc.supabase.co", projectKey: KEY });
    expect(seen[0]?.url.startsWith("https://abc.supabase.co/")).toBe(true);
    const refused = await service.connect({ serverUrl: "http://abc.supabase.co", projectKey: KEY });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toMatch(/https/);
  });

  it("allows a local stack over http on this Mac", async () => {
    const { service } = rig();
    // The fake has no answer for this address, so the connect fails on that, not on the scheme.
    const result = await service.connect({ serverUrl: "http://127.0.0.1:54321", projectKey: KEY });
    if (!result.ok) expect(result.message).not.toMatch(/https/);
  });

  it("forgets the old server's session when the backend changes", async () => {
    const { service, keys } = rig();
    await service.connect({ serverUrl: SUPABASE, projectKey: KEY });
    await service.signIn({ email: "ada@example.com", password: "a long enough password" });
    expect(keys.get(`${TEAM_KEYCHAIN.service}/${TEAM_KEYCHAIN.account}`)).toBeDefined();
    const back = await service.connect({ serverUrl: "http://127.0.0.1:7830" });
    expect(back.ok && back.view.backend).toBe("local");
    expect(back.ok && back.view.user).toBeNull();
    expect(keys.get(`${TEAM_KEYCHAIN.service}/${TEAM_KEYCHAIN.account}`)).toBeUndefined();
  });

  it("keeps the session a renewal brings back, in the Keychain, where a sign-in's is kept", async () => {
    const { service, keys, teamsCalls } = rig();
    await service.connect({ serverUrl: SUPABASE, projectKey: KEY });
    // Signing in syncs at once: the first call finds the access token expired, the client renews
    // it, and the call goes through with the new one.
    await service.signIn({ email: "ada@example.com", password: "a long enough password" });
    expect(teamsCalls()).toBe(2);
    const slot = `${TEAM_KEYCHAIN.service}/${TEAM_KEYCHAIN.account}`;
    await vi.waitFor(() =>
      expect(decodeSupabaseToken(keys.get(slot) ?? "")).toEqual({
        access: "access-2",
        refresh: "refresh-2",
      }),
    );
  });
});
