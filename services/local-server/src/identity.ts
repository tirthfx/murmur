import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { normalizeDomain } from "../../../packages/shared/src/policy.ts";
import type { Accounts, SessionGrant, UserView } from "./accounts.ts";
import type { AuditInput } from "./audit.ts";
import type { DevIdp } from "./dev-idp.ts";
import { fail, type Failure } from "./http.ts";
import { parseIdpMetadata } from "./xml.ts";
import type { Teams } from "./teams.ts";
import type { Role } from "./permissions.ts";

/**
 * Single sign-on, SCIM settings and company domains (TM-18 to TM-20). SSO, SCIM and the DNS
 * check are SIMULATIONS: they are built to the shape of the real thing so the screens and the
 * rules can be tried, and nothing here has been checked against a real identity provider. Every
 * response that describes them carries `SIMULATION`.
 */
export const SIMULATION = {
  label: "Simulation",
  notice:
    "This is a simulation. It is built to the shape of single sign-on, SCIM and domain verification, but it does not check anything with a real identity provider or a real DNS record.",
} as const;

export const SSO_REQUEST_MINUTES = 10;
/** A domain's DNS record is looked at no more than once in this long. */
export const DOMAIN_CHECK_MINUTES = 10;
const MINUTE = 60_000;

export type TxtResolver = (name: string) => Promise<string[][]>;

export interface IdentityDeps {
  db: DatabaseSync;
  now(): number;
  audit(input: AuditInput): void;
  teams: Teams;
  accounts: Accounts;
  /** The simulated identity provider; null unless the server was started with it on. */
  devIdp: DevIdp | null;
  resolveTxt: TxtResolver;
}

type Ok<T> = { ok: true } & T;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

interface SsoRow {
  team_id: string;
  enabled: number;
  jit_create: number;
  enforce: number;
  idp_entity_id: string;
  idp_sso_url: string;
  cert_fingerprint: string;
  cert_subject: string;
  cert_not_after: number | null;
  metadata_xml: string;
}

interface DomainRow {
  id: string;
  team_id: string;
  domain: string;
  token: string;
  verified_at: number | null;
  last_checked_at: number | null;
  default_role: Exclude<Role, "owner">;
  capture: number;
  restrict_signup: number;
  created_at: number;
}

export interface GroupMapEntry {
  group: string;
  departmentId?: string;
  role?: "admin" | "manager" | "member" | "viewer";
}

export function createIdentity(deps: IdentityDeps) {
  const { db, teams } = deps;
  const log = (actorId: string | null, input: Omit<AuditInput, "actorId">) =>
    deps.audit({ ...input, actorId });

  const sp = (teamId: string, host: string) => ({
    entityId: `urn:murmur:team:${teamId}`,
    acsUrl: `http://${host}/v1/sso/acs`,
  });

  const ssoRow = (teamId: string) =>
    db.prepare("SELECT * FROM identity_sso WHERE team_id = ?").get(teamId) as SsoRow | undefined;

  const domainRows = (teamId: string) =>
    db
      .prepare("SELECT * FROM identity_domains WHERE team_id = ? ORDER BY domain")
      .all(teamId) as unknown as DomainRow[];

  const domainView = (row: DomainRow) => ({
    id: row.id,
    domain: row.domain,
    verified: row.verified_at !== null,
    verifiedAt: row.verified_at,
    lastCheckedAt: row.last_checked_at,
    defaultRole: row.default_role,
    capture: row.capture === 1,
    restrictSignup: row.restrict_signup === 1,
    // What to put in DNS, and where.
    record: {
      name: `_murmur-challenge.${row.domain}`,
      type: "TXT",
      value: `murmur-verify=${row.token}`,
    },
  });

  /** The verified domain of a team that an email address belongs to, if any. */
  function verifiedDomainFor(teamId: string, email: string): DomainRow | null {
    const at = email.lastIndexOf("@");
    const host = at < 0 ? null : normalizeDomain(email.slice(at + 1));
    if (!host) return null;
    return (
      domainRows(teamId).find((row) => row.verified_at !== null && row.domain === host) ?? null
    );
  }

  return {
    SIMULATION,

    // ---- single sign-on ----

    /** The test identity provider's metadata, or null when it is off. */
    devMetadata: (host: string): string | null =>
      deps.devIdp ? deps.devIdp.metadataXml(`http://${host}/dev-idp/authorize`) : null,

    sso(teamId: string, host: string) {
      const row = ssoRow(teamId);
      return {
        simulation: SIMULATION,
        enabled: row?.enabled === 1,
        jitCreate: row?.jit_create === 1,
        enforce: row?.enforce === 1,
        configured: row !== undefined && row.idp_entity_id !== "",
        idp: row?.idp_entity_id
          ? {
              entityId: row.idp_entity_id,
              ssoUrl: row.idp_sso_url,
              certificate: {
                subject: row.cert_subject,
                fingerprint: row.cert_fingerprint,
                notAfter: row.cert_not_after,
              },
            }
          : null,
        sp: sp(teamId, host),
        devIdp: deps.devIdp
          ? { available: true, entityId: deps.devIdp.entityId, metadataPath: "/dev-idp/metadata" }
          : { available: false },
      };
    },

    /** Saves the metadata and the three switches. The metadata is checked for structure only. */
    configureSso(
      actorId: string,
      teamId: string,
      input: { metadataXml?: string; enabled?: boolean; jitCreate?: boolean; enforce?: boolean },
    ): Ok<object> | Failure {
      if (!db.prepare("SELECT 1 FROM teams WHERE id = ?").get(teamId))
        return fail(404, "not_found", "There is no such team.");
      const current = ssoRow(teamId);
      let entityId = current?.idp_entity_id ?? "";
      let ssoUrl = current?.idp_sso_url ?? "";
      let fingerprint = current?.cert_fingerprint ?? "";
      let subject = current?.cert_subject ?? "";
      let notAfter = current?.cert_not_after ?? null;
      let xml = current?.metadata_xml ?? "";

      if (input.metadataXml !== undefined) {
        const parsed = parseIdpMetadata(input.metadataXml, deps.now());
        if (!parsed.ok) return fail(400, "invalid_metadata", parsed.message);
        entityId = parsed.metadata.entityId;
        ssoUrl = parsed.metadata.ssoUrl;
        fingerprint = parsed.metadata.certificate.fingerprint;
        subject = parsed.metadata.certificate.subject;
        notAfter = parsed.metadata.certificate.notAfter;
        xml = input.metadataXml.trim();
      }
      const enabled = input.enabled ?? current?.enabled === 1;
      const jit = input.jitCreate ?? current?.jit_create === 1;
      const enforce = input.enforce ?? current?.enforce === 1;
      if (enabled && entityId === "")
        return fail(
          400,
          "not_configured",
          "Add the identity provider's metadata before turning single sign-on on.",
        );
      if (enforce && !enabled)
        return fail(400, "not_enabled", "Turn single sign-on on before requiring it.");

      db.prepare(
        `INSERT INTO identity_sso (team_id, enabled, jit_create, enforce, idp_entity_id, idp_sso_url,
                                   cert_fingerprint, cert_subject, cert_not_after, metadata_xml, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (team_id) DO UPDATE SET enabled = excluded.enabled, jit_create = excluded.jit_create,
           enforce = excluded.enforce, idp_entity_id = excluded.idp_entity_id, idp_sso_url = excluded.idp_sso_url,
           cert_fingerprint = excluded.cert_fingerprint, cert_subject = excluded.cert_subject,
           cert_not_after = excluded.cert_not_after, metadata_xml = excluded.metadata_xml,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      ).run(
        teamId,
        enabled ? 1 : 0,
        jit ? 1 : 0,
        enforce ? 1 : 0,
        entityId,
        ssoUrl,
        fingerprint,
        subject,
        notAfter,
        xml,
        actorId,
        deps.now(),
      );
      log(actorId, {
        action: "identity.sso_changed",
        targetType: "team",
        targetId: teamId,
        detail: {
          enabled,
          jitCreate: jit,
          enforce,
          metadataChanged: input.metadataXml !== undefined,
          simulation: true,
        },
      });
      return { ok: true };
    },

    /** "Test connection": the saved metadata is read again and its structure is reported. */
    testSso(teamId: string): Ok<{
      simulation: typeof SIMULATION;
      checks: { name: string; ok: boolean; message: string }[];
      passed: boolean;
    }> {
      const row = ssoRow(teamId);
      const checks: { name: string; ok: boolean; message: string }[] = [];
      if (!row || row.metadata_xml === "") {
        checks.push({ name: "metadata", ok: false, message: "No metadata has been added yet." });
      } else {
        const parsed = parseIdpMetadata(row.metadata_xml, deps.now());
        if (!parsed.ok) checks.push({ name: "metadata", ok: false, message: parsed.message });
        else {
          checks.push({
            name: "metadata",
            ok: true,
            message: `An identity provider: ${parsed.metadata.entityId}.`,
          });
          checks.push({ name: "sign-on address", ok: true, message: parsed.metadata.ssoUrl });
          checks.push({
            name: "signing certificate",
            ok: true,
            message: `${parsed.metadata.certificate.subject}, valid until ${new Date(parsed.metadata.certificate.notAfter).toISOString().slice(0, 10)}.`,
          });
        }
      }
      checks.push({
        name: "real provider",
        ok: false,
        message: "Not checked. Nothing here has been tried against a real identity provider.",
      });
      return {
        ok: true,
        simulation: SIMULATION,
        checks,
        passed: checks.slice(0, -1).every((check) => check.ok),
      };
    },

    /** Begins a sign-in: the identity provider is asked, and the answer must come back for this request. */
    startSso(
      teamId: string,
      host: string,
    ): Ok<{ requestId: string; redirectUrl: string; simulation: typeof SIMULATION }> | Failure {
      const row = ssoRow(teamId);
      if (!row || row.enabled !== 1)
        return fail(404, "sso_off", "Single sign-on is not turned on for this team.");
      if (!deps.devIdp)
        return fail(
          503,
          "dev_idp_off",
          "The test identity provider is off. Start the server with MURMUR_DEV_IDP=1 to try the simulation.",
        );
      const id = `req_${randomBytes(16).toString("base64url")}`;
      const now = deps.now();
      db.prepare(
        "INSERT INTO sso_requests (id, team_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      ).run(id, teamId, now, now + SSO_REQUEST_MINUTES * MINUTE);
      return {
        ok: true,
        requestId: id,
        redirectUrl: `http://${host}/dev-idp/authorize`,
        simulation: SIMULATION,
      };
    },

    /** The test identity provider's login: it signs an assertion for whoever asks. */
    devAuthorize(
      host: string,
      input: { requestId: string; email: string; name: string },
    ): Ok<{ samlResponse: string; acsUrl: string; simulation: typeof SIMULATION }> | Failure {
      if (!deps.devIdp) return fail(404, "not_found", "There is nothing at that address.");
      const request = db
        .prepare("SELECT team_id FROM sso_requests WHERE id = ?")
        .get(input.requestId) as { team_id: string } | undefined;
      if (!request) return fail(404, "unknown_request", "That sign-in was not started here.");
      const email = input.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return fail(400, "invalid_email", "Write a real email address.");
      const target = sp(request.team_id, host);
      return {
        ok: true,
        simulation: SIMULATION,
        acsUrl: target.acsUrl,
        samlResponse: deps.devIdp.issue({
          audience: target.entityId,
          inResponseTo: input.requestId,
          email,
          name: input.name.trim() || email,
        }),
      };
    },

    /**
     * The assertion consumer: checks the answer for the sign-in it belongs to, then signs the person
     * in, making the account and the membership when just-in-time creation is on.
     */
    consumeAssertion(
      samlResponse: string,
      clientId: string,
    ):
      | Ok<{
          session: SessionGrant;
          teamId: string;
          created: boolean;
          simulation: typeof SIMULATION;
        }>
      | Failure {
      const reject = (code: string, message: string, status = 401) => {
        log(null, { action: "sso.rejected", detail: { reason: code, simulation: true } });
        return fail(status, code, message);
      };
      if (!deps.devIdp) return fail(503, "dev_idp_off", "The test identity provider is off.");
      const opened = deps.devIdp.open(samlResponse);
      if (!opened.ok) return reject("invalid_assertion", opened.message);
      const a = opened.assertion;

      const request = db.prepare("SELECT * FROM sso_requests WHERE id = ?").get(a.inResponseTo) as
        { id: string; team_id: string; expires_at: number; used_at: number | null } | undefined;
      if (!request) return reject("unknown_request", "That sign-in was not started here.");
      if (request.used_at !== null)
        return reject("replayed", "That sign-in response was already used.");
      if (request.expires_at <= deps.now())
        return reject("expired_request", "That sign-in took too long. Start again.");
      const row = ssoRow(request.team_id);
      if (!row || row.enabled !== 1)
        return reject("sso_off", "Single sign-on is not turned on for this team.", 403);
      if (a.issuer !== row.idp_entity_id)
        return reject(
          "issuer_mismatch",
          "The response is from an identity provider this team does not trust.",
        );
      if (a.audience !== `urn:murmur:team:${request.team_id}`)
        return reject("audience_mismatch", "The response is for another service.");
      // One use, whatever happens next.
      db.prepare("UPDATE sso_requests SET used_at = ? WHERE id = ?").run(deps.now(), request.id);

      const teamId = request.team_id;
      const email = a.email.trim().toLowerCase();
      const domains = domainRows(teamId).filter(
        (domain) => domain.restrict_signup === 1 && domain.verified_at !== null,
      );
      if (domains.length > 0 && !verifiedDomainFor(teamId, email))
        return reject(
          "domain_not_allowed",
          "Sign-ups from that email domain are not allowed for this team.",
          403,
        );

      let user = deps.accounts.findByEmail(email);
      let created = false;
      if (user && user.status !== "active")
        return reject("deactivated", "This account has been turned off.", 403);
      if (!user) {
        if (row.jit_create !== 1)
          return reject(
            "not_provisioned",
            "No account exists for that email, and creating one on sign-in is off.",
            403,
          );
        const made = deps.accounts.createAccount(
          { name: a.name || email, email, password: randomBytes(32).toString("base64url") },
          null,
          clientId,
          { provisionedBy: "sso" },
        );
        if (!made.ok) return reject(made.code, made.message, 400);
        user = made.user;
        created = true;
      }
      if (!teams.member(teamId, user.id)) {
        if (row.jit_create !== 1)
          return reject(
            "not_provisioned",
            "That account is not in this team, and adding people on sign-in is off.",
            403,
          );
        const role = verifiedDomainFor(teamId, email)?.default_role ?? "member";
        teams.addMember(teamId, user.id, role, null, { actorId: user.id, via: "sso" });
      }
      const session = deps.accounts.startSession(user.id, clientId);
      if (!session) return reject("deactivated", "This account has been turned off.", 403);
      log(user.id, {
        action: created ? "sso.jit_created" : "sso.sign_in",
        targetType: "team",
        targetId: teamId,
        detail: { simulation: true },
        ...(clientId ? { clientId } : {}),
      });
      return { ok: true, session, teamId, created, simulation: SIMULATION };
    },

    /** Whether a password may sign this person in: not when a team they are in requires single sign-on. */
    passwordAllowed(userId: string): boolean {
      const user = deps.accounts.findById(userId);
      if (!user || user.isOwner) return true;
      const required = db
        .prepare(
          `SELECT 1 FROM team_members m JOIN identity_sso s ON s.team_id = m.team_id
           WHERE m.user_id = ? AND s.enabled = 1 AND s.enforce = 1 LIMIT 1`,
        )
        .get(userId);
      return required === undefined;
    },

    // ---- SCIM settings ----

    scim(teamId: string, host: string) {
      const row = db.prepare("SELECT * FROM identity_scim WHERE team_id = ?").get(teamId) as
        { enabled: number; token_hash: string | null; group_map_json: string } | undefined;
      return {
        simulation: SIMULATION,
        enabled: row?.enabled === 1,
        tokenSet: row?.token_hash != null,
        endpoint: `http://${host}/scim/v2`,
        groupMap: row ? (JSON.parse(row.group_map_json) as GroupMapEntry[]) : [],
        note: "No real provider calls these endpoints in a local build. The test client in the repository does.",
      };
    },

    configureScim(
      actorId: string,
      teamId: string,
      input: { enabled?: boolean; groupMap?: unknown },
    ): Ok<{ token: string | null }> | Failure {
      if (!db.prepare("SELECT 1 FROM teams WHERE id = ?").get(teamId))
        return fail(404, "not_found", "There is no such team.");
      const current = db.prepare("SELECT * FROM identity_scim WHERE team_id = ?").get(teamId) as
        { enabled: number; token_hash: string | null; group_map_json: string } | undefined;
      let groupMap = current ? (JSON.parse(current.group_map_json) as GroupMapEntry[]) : [];
      if (input.groupMap !== undefined) {
        const checked = this.checkGroupMap(teamId, input.groupMap);
        if (!checked.ok) return checked;
        groupMap = checked.map;
      }
      const enabled = input.enabled ?? current?.enabled === 1;
      // The first time SCIM is turned on, a token is made and shown once.
      let token: string | null = null;
      let tokenHash = current?.token_hash ?? null;
      if (enabled && tokenHash === null) {
        token = `scim_${randomBytes(32).toString("base64url")}`;
        tokenHash = hashToken(token);
      }
      db.prepare(
        `INSERT INTO identity_scim (team_id, enabled, token_hash, group_map_json, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (team_id) DO UPDATE SET enabled = excluded.enabled, token_hash = excluded.token_hash,
           group_map_json = excluded.group_map_json, updated_at = excluded.updated_at`,
      ).run(teamId, enabled ? 1 : 0, tokenHash, JSON.stringify(groupMap), deps.now());
      log(actorId, {
        action: "identity.scim_changed",
        targetType: "team",
        targetId: teamId,
        detail: {
          enabled,
          mappings: groupMap.length,
          credentialMade: token !== null,
          simulation: true,
        },
      });
      return { ok: true, token };
    },

    checkGroupMap(teamId: string, value: unknown): Ok<{ map: GroupMapEntry[] }> | Failure {
      if (!Array.isArray(value) || value.length > 100)
        return fail(400, "invalid_group_map", "The group map is a list of up to 100 entries.");
      const map: GroupMapEntry[] = [];
      for (const raw of value as Record<string, unknown>[]) {
        const group = typeof raw?.["group"] === "string" ? raw["group"].trim() : "";
        if (group === "" || group.length > 100)
          return fail(400, "invalid_group_map", "Each entry names a group (up to 100 characters).");
        const departmentId = raw["departmentId"];
        const role = raw["role"];
        if ((departmentId === undefined) === (role === undefined))
          return fail(
            400,
            "invalid_group_map",
            `"${group}" maps to a department or a role, not both and not neither.`,
          );
        if (departmentId !== undefined) {
          if (typeof departmentId !== "string" || teams.department(departmentId)?.teamId !== teamId)
            return fail(
              400,
              "invalid_group_map",
              `"${group}": that department is not in this team.`,
            );
          map.push({ group, departmentId });
        } else {
          if (role !== "admin" && role !== "manager" && role !== "member" && role !== "viewer")
            return fail(
              400,
              "invalid_group_map",
              `"${group}": a role is admin, manager, member or viewer.`,
            );
          map.push({ group, role });
        }
      }
      return { ok: true, map };
    },

    /** A new token, shown once; the old one stops working. */
    rotateScimToken(actorId: string, teamId: string): Ok<{ token: string }> | Failure {
      const current = db.prepare("SELECT 1 FROM identity_scim WHERE team_id = ?").get(teamId);
      if (!current) return fail(400, "scim_off", "Turn SCIM on first.");
      const token = `scim_${randomBytes(32).toString("base64url")}`;
      db.prepare("UPDATE identity_scim SET token_hash = ?, updated_at = ? WHERE team_id = ?").run(
        hashToken(token),
        deps.now(),
        teamId,
      );
      log(actorId, {
        action: "identity.scim_token_rotated",
        targetType: "team",
        targetId: teamId,
        detail: { simulation: true },
      });
      return { ok: true, token };
    },

    /** The team a SCIM token belongs to, when SCIM is on for it. */
    scimTeamFor(token: string): string | null {
      const row = db
        .prepare("SELECT team_id FROM identity_scim WHERE token_hash = ? AND enabled = 1")
        .get(hashToken(token)) as { team_id: string } | undefined;
      return row?.team_id ?? null;
    },

    groupMap(teamId: string): GroupMapEntry[] {
      const row = db
        .prepare("SELECT group_map_json FROM identity_scim WHERE team_id = ?")
        .get(teamId) as { group_map_json: string } | undefined;
      return row ? (JSON.parse(row.group_map_json) as GroupMapEntry[]) : [];
    },

    // ---- domains ----

    domains(teamId: string) {
      return { simulation: SIMULATION, domains: domainRows(teamId).map(domainView) };
    },

    addDomain(
      actorId: string,
      teamId: string,
      input: { domain: string; defaultRole?: unknown; capture?: unknown; restrictSignup?: unknown },
    ): Ok<{ domain: ReturnType<typeof domainView> }> | Failure {
      if (!db.prepare("SELECT 1 FROM teams WHERE id = ?").get(teamId))
        return fail(404, "not_found", "There is no such team.");
      const host = normalizeDomain(input.domain);
      if (!host || !host.includes("."))
        return fail(400, "invalid_domain", "That is not a domain name, like example.com.");
      const role = input.defaultRole ?? "member";
      if (role !== "admin" && role !== "manager" && role !== "member" && role !== "viewer")
        return fail(400, "invalid_role", "A role is admin, manager, member or viewer.");
      if (
        db
          .prepare("SELECT 1 FROM identity_domains WHERE team_id = ? AND domain = ?")
          .get(teamId, host)
      )
        return fail(409, "domain_exists", "That domain is already listed.");
      const id = randomUUID();
      db.prepare(
        `INSERT INTO identity_domains (id, team_id, domain, token, default_role, capture, restrict_signup, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        teamId,
        host,
        randomBytes(16).toString("hex"),
        role,
        input.capture === true ? 1 : 0,
        input.restrictSignup === true ? 1 : 0,
        deps.now(),
      );
      log(actorId, {
        action: "domain.added",
        targetType: "domain",
        targetId: id,
        detail: { teamId, simulation: true },
      });
      return {
        ok: true,
        domain: domainView(
          db.prepare("SELECT * FROM identity_domains WHERE id = ?").get(id) as unknown as DomainRow,
        ),
      };
    },

    updateDomain(
      actorId: string,
      teamId: string,
      id: string,
      patch: { defaultRole?: unknown; capture?: unknown; restrictSignup?: unknown },
    ): Ok<{ domain: ReturnType<typeof domainView> }> | Failure {
      const row = db
        .prepare("SELECT * FROM identity_domains WHERE id = ? AND team_id = ?")
        .get(id, teamId) as DomainRow | undefined;
      if (!row) return fail(404, "not_found", "There is no such domain.");
      let role = row.default_role;
      if (patch.defaultRole !== undefined) {
        if (
          patch.defaultRole !== "admin" &&
          patch.defaultRole !== "manager" &&
          patch.defaultRole !== "member" &&
          patch.defaultRole !== "viewer"
        )
          return fail(400, "invalid_role", "A role is admin, manager, member or viewer.");
        role = patch.defaultRole;
      }
      const capture = patch.capture === undefined ? row.capture : patch.capture === true ? 1 : 0;
      const restrict =
        patch.restrictSignup === undefined
          ? row.restrict_signup
          : patch.restrictSignup === true
            ? 1
            : 0;
      if ((capture === 1 || restrict === 1) && row.verified_at === null)
        return fail(
          400,
          "not_verified",
          "Verify the domain before using it for capture or sign-up limits.",
        );
      db.prepare(
        "UPDATE identity_domains SET default_role = ?, capture = ?, restrict_signup = ? WHERE id = ?",
      ).run(role, capture, restrict, id);
      log(actorId, {
        action: "domain.changed",
        targetType: "domain",
        targetId: id,
        detail: {
          teamId,
          defaultRole: role,
          capture: capture === 1,
          restrictSignup: restrict === 1,
        },
      });
      return {
        ok: true,
        domain: domainView(
          db.prepare("SELECT * FROM identity_domains WHERE id = ?").get(id) as unknown as DomainRow,
        ),
      };
    },

    removeDomain(actorId: string, teamId: string, id: string): Ok<object> | Failure {
      const result = db
        .prepare("DELETE FROM identity_domains WHERE id = ? AND team_id = ?")
        .run(id, teamId);
      if (Number(result.changes) === 0) return fail(404, "not_found", "There is no such domain.");
      log(actorId, {
        action: "domain.removed",
        targetType: "domain",
        targetId: id,
        detail: { teamId },
      });
      return { ok: true };
    },

    /** Looks for the verification record. At most once every ten minutes for a domain. */
    async verifyDomain(
      actorId: string,
      teamId: string,
      id: string,
    ): Promise<Ok<{ domain: ReturnType<typeof domainView> }> | Failure> {
      const row = db
        .prepare("SELECT * FROM identity_domains WHERE id = ? AND team_id = ?")
        .get(id, teamId) as DomainRow | undefined;
      if (!row) return fail(404, "not_found", "There is no such domain.");
      if (row.verified_at !== null) return { ok: true, domain: domainView(row) };
      const now = deps.now();
      if (
        row.last_checked_at !== null &&
        now - row.last_checked_at < DOMAIN_CHECK_MINUTES * MINUTE
      ) {
        const failure = fail(
          429,
          "too_soon",
          `The record was looked at a moment ago. Try again in ${Math.ceil((DOMAIN_CHECK_MINUTES * MINUTE - (now - row.last_checked_at)) / MINUTE)} minutes.`,
        );
        failure.extra = {
          retryAfterSeconds: Math.ceil(
            (DOMAIN_CHECK_MINUTES * MINUTE - (now - row.last_checked_at)) / 1000,
          ),
        };
        return failure;
      }
      db.prepare("UPDATE identity_domains SET last_checked_at = ? WHERE id = ?").run(now, id);
      let records: string[][];
      try {
        records = await deps.resolveTxt(`_murmur-challenge.${row.domain}`);
      } catch {
        return fail(502, "dns_failed", "The DNS lookup failed. Try again later.");
      }
      const expected = `murmur-verify=${row.token}`;
      const found = records.some((chunks) => chunks.join("") === expected);
      if (!found) {
        log(actorId, {
          action: "domain.verify_failed",
          targetType: "domain",
          targetId: id,
          detail: { teamId },
        });
        return fail(
          422,
          "not_verified",
          "The TXT record was not found. It can take a while to appear.",
        );
      }
      const other = db
        .prepare(
          "SELECT 1 FROM identity_domains WHERE domain = ? AND verified_at IS NOT NULL AND team_id != ?",
        )
        .get(row.domain, teamId);
      if (other) return fail(409, "domain_taken", "Another team has already verified that domain.");
      db.prepare("UPDATE identity_domains SET verified_at = ? WHERE id = ?").run(now, id);
      log(actorId, {
        action: "domain.verified",
        targetType: "domain",
        targetId: id,
        detail: { teamId, simulation: true },
      });
      return {
        ok: true,
        domain: domainView(
          db.prepare("SELECT * FROM identity_domains WHERE id = ?").get(id) as unknown as DomainRow,
        ),
      };
    },

    /** Whether an email may make an account for a team that limits sign-ups to its verified domains. */
    signupAllowed(teamId: string, email: string): boolean {
      const limited = domainRows(teamId).some(
        (row) => row.restrict_signup === 1 && row.verified_at !== null,
      );
      return !limited || verifiedDomainFor(teamId, email) !== null;
    },

    /** A person with an address in a verified domain asks to join without an invite. */
    domainJoin(user: UserView, teamId: string): Ok<{ requestId: string; role: string }> | Failure {
      const team = db.prepare("SELECT id FROM teams WHERE id = ?").get(teamId);
      const domain = team ? verifiedDomainFor(teamId, user.email) : null;
      if (!domain)
        return fail(
          403,
          "domain_not_allowed",
          "Your email domain is not a verified domain of this team.",
        );
      if (teams.member(teamId, user.id))
        return fail(409, "already_member", "You are already in this team.");
      const pending = db
        .prepare(
          "SELECT 1 FROM join_requests WHERE team_id = ? AND user_id = ? AND status = 'pending'",
        )
        .get(teamId, user.id);
      if (pending) return fail(409, "request_pending", "You already asked to join this team.");
      const id = randomUUID();
      db.prepare(
        `INSERT INTO join_requests (id, team_id, invite_id, user_id, role, department_id, created_at)
         VALUES (?, ?, NULL, ?, ?, NULL, ?)`,
      ).run(id, teamId, user.id, domain.default_role, deps.now());
      log(user.id, {
        action: "join_request.created",
        targetType: "join_request",
        targetId: id,
        detail: { teamId, role: domain.default_role, via: "domain" },
      });
      return { ok: true, requestId: id, role: domain.default_role };
    },

    // ---- capture ----

    /** Teams that offer a person with this email to join, because their domain is verified for capture. */
    captureOffers(user: UserView) {
      const rows = db
        .prepare(
          `SELECT d.*, t.name AS team_name FROM identity_domains d JOIN teams t ON t.id = d.team_id
           WHERE d.verified_at IS NOT NULL AND d.capture = 1`,
        )
        .all() as unknown as (DomainRow & { team_name: string })[];
      return {
        simulation: SIMULATION,
        offers: rows
          .filter((row) => {
            const at = user.email.lastIndexOf("@");
            return (
              at >= 0 &&
              normalizeDomain(user.email.slice(at + 1)) === row.domain &&
              !teams.member(row.team_id, user.id) &&
              !db
                .prepare("SELECT 1 FROM capture_declines WHERE team_id = ? AND user_id = ?")
                .get(row.team_id, user.id)
            );
          })
          .map((row) => ({
            teamId: row.team_id,
            teamName: row.team_name,
            domain: row.domain,
            role: row.default_role,
          })),
      };
    },

    /** The person says yes: they join with the domain's default role. Nothing moves without this. */
    acceptCapture(user: UserView, teamId: string): Ok<{ role: string }> | Failure {
      const offer = this.captureOffers(user).offers.find((entry) => entry.teamId === teamId);
      if (!offer) return fail(404, "no_offer", "That team has no offer for you.");
      teams.addMember(teamId, user.id, offer.role as Exclude<Role, "owner">, null, {
        actorId: user.id,
        via: "domain_capture",
      });
      log(user.id, {
        action: "domain.capture_accepted",
        targetType: "team",
        targetId: teamId,
        detail: { domain: offer.domain },
      });
      return { ok: true, role: offer.role };
    },

    declineCapture(user: UserView, teamId: string): Ok<object> | Failure {
      const offer = this.captureOffers(user).offers.find((entry) => entry.teamId === teamId);
      if (!offer) return fail(404, "no_offer", "That team has no offer for you.");
      db.prepare("INSERT OR IGNORE INTO capture_declines (team_id, user_id) VALUES (?, ?)").run(
        teamId,
        user.id,
      );
      log(user.id, {
        action: "domain.capture_declined",
        targetType: "team",
        targetId: teamId,
        detail: { domain: offer.domain },
      });
      return { ok: true };
    },
  };
}

export type Identity = ReturnType<typeof createIdentity>;
