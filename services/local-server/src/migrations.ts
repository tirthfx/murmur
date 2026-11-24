import type { DatabaseSync } from "node:sqlite";

/**
 * The server's own schema, in numbered steps. Each step runs once, in a transaction, and is
 * recorded. A step is never edited after it has shipped: a change is a new step.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "accounts_and_sessions",
    sql: `
      CREATE TABLE users (
        id                  TEXT PRIMARY KEY,
        email               TEXT NOT NULL UNIQUE,
        name                TEXT NOT NULL,
        password_hash       TEXT NOT NULL,
        is_owner            INTEGER NOT NULL DEFAULT 0,
        status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
        created_at          INTEGER NOT NULL,
        password_changed_at INTEGER NOT NULL
      );
      -- At most one owner.
      CREATE UNIQUE INDEX users_one_owner ON users (is_owner) WHERE is_owner = 1;

      CREATE TABLE password_history (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        password_hash TEXT NOT NULL,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX password_history_user ON password_history (user_id, id);

      -- Only the hash of a session token is kept.
      CREATE TABLE sessions (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        token_hash   TEXT NOT NULL UNIQUE,
        client_id    TEXT NOT NULL DEFAULT '',
        created_at   INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        revoked_at   INTEGER
      );
      CREATE INDEX sessions_user ON sessions (user_id);

      -- Wrong passwords in a row for an address, whether or not an account has it.
      CREATE TABLE sign_in_throttle (
        email        TEXT PRIMARY KEY,
        failures     INTEGER NOT NULL,
        locked_until INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
  {
    version: 2,
    name: "settings_audit_siem",
    sql: `
      -- Server settings, one JSON value each (the audit and SIEM options now; policy later).
      CREATE TABLE server_settings (
        key        TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Append-only and hash-chained: each row holds the hash of the one before it (TM-12).
      CREATE TABLE audit_events (
        seq         INTEGER PRIMARY KEY,
        ts          INTEGER NOT NULL,
        actor_id    TEXT,
        action      TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT '',
        target_id   TEXT NOT NULL DEFAULT '',
        detail_json TEXT NOT NULL DEFAULT '{}',
        client_id   TEXT NOT NULL DEFAULT '',
        prev_hash   TEXT NOT NULL,
        hash        TEXT NOT NULL UNIQUE
      );
      CREATE INDEX audit_events_ts ON audit_events (ts);
      CREATE INDEX audit_events_actor ON audit_events (actor_id);
      CREATE INDEX audit_events_action ON audit_events (action);

      -- Where the chain starts after old rows were removed by retention.
      CREATE TABLE audit_anchor (
        id        INTEGER PRIMARY KEY CHECK (id = 1),
        last_seq  INTEGER NOT NULL,
        last_hash TEXT NOT NULL
      );

      -- Events waiting to be sent to the SIEM file or webhook.
      CREATE TABLE siem_queue (
        seq             INTEGER PRIMARY KEY REFERENCES audit_events (seq) ON DELETE CASCADE,
        status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
        attempts        INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        last_error      TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX siem_queue_status ON siem_queue (status, next_attempt_at);
    `,
  },
  {
    version: 3,
    name: "teams_departments_invites",
    sql: `
      CREATE TABLE teams (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES users (id),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- One level: a department may have a parent that has none (TM-05). The cost centre is a
      -- label for usage export and carries no billing.
      CREATE TABLE departments (
        id          TEXT PRIMARY KEY,
        team_id     TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        cost_center TEXT NOT NULL DEFAULT '',
        parent_id   TEXT REFERENCES departments (id) ON DELETE SET NULL,
        created_at  INTEGER NOT NULL,
        UNIQUE (team_id, name)
      );

      CREATE TABLE team_members (
        team_id       TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        role          TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'member', 'viewer')),
        department_id TEXT REFERENCES departments (id) ON DELETE SET NULL,
        joined_at     INTEGER NOT NULL,
        PRIMARY KEY (team_id, user_id)
      );
      CREATE INDEX team_members_user ON team_members (user_id);

      -- Only the hash of an invite code is kept.
      CREATE TABLE invites (
        id                TEXT PRIMARY KEY,
        team_id           TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        code_hash         TEXT NOT NULL UNIQUE,
        role              TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'member', 'viewer')),
        department_id     TEXT REFERENCES departments (id) ON DELETE SET NULL,
        created_by        TEXT NOT NULL REFERENCES users (id),
        created_at        INTEGER NOT NULL,
        expires_at        INTEGER NOT NULL,
        max_uses          INTEGER NOT NULL,
        uses              INTEGER NOT NULL DEFAULT 0,
        approval_required INTEGER NOT NULL,
        revoked_at        INTEGER
      );
      CREATE INDEX invites_team ON invites (team_id);

      -- A request to join, made with an invite that needs approval. It stays until decided or
      -- until it expires. A rejection leaves no membership.
      CREATE TABLE join_requests (
        id            TEXT PRIMARY KEY,
        team_id       TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        invite_id     TEXT REFERENCES invites (id) ON DELETE SET NULL,
        user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        role          TEXT NOT NULL,
        department_id TEXT REFERENCES departments (id) ON DELETE SET NULL,
        status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
        created_at    INTEGER NOT NULL,
        decided_by    TEXT REFERENCES users (id),
        decided_at    INTEGER
      );
      CREATE INDEX join_requests_team ON join_requests (team_id, status);
      CREATE INDEX join_requests_user ON join_requests (user_id);
    `,
  },
  {
    version: 4,
    name: "shared_vocabulary",
    sql: `
      -- Team settings, one JSON value each (governance mode, snippet rules).
      CREATE TABLE team_settings (
        team_id    TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        key        TEXT NOT NULL,
        value_json TEXT NOT NULL,
        PRIMARY KEY (team_id, key)
      );

      -- Goes up whenever shared content changes, so a client can ask "anything new since?".
      CREATE TABLE team_revisions (
        team_id  TEXT PRIMARY KEY REFERENCES teams (id) ON DELETE CASCADE,
        revision INTEGER NOT NULL DEFAULT 0
      );

      -- Shared dictionary entries and snippets (TM-06, TM-07). Governance state is on the row.
      -- A department that is deleted takes its entries with it.
      CREATE TABLE vocabulary_items (
        id            TEXT PRIMARY KEY,
        team_id       TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        kind          TEXT NOT NULL CHECK (kind IN ('dictionary', 'snippet')),
        scope         TEXT NOT NULL CHECK (scope IN ('company', 'department')),
        department_id TEXT REFERENCES departments (id) ON DELETE CASCADE,
        key           TEXT NOT NULL,
        payload_json  TEXT NOT NULL,
        status        TEXT NOT NULL CHECK (status IN ('active', 'pending', 'rejected', 'deleted')),
        pending_json  TEXT,
        locked        INTEGER NOT NULL DEFAULT 0,
        proposed_by   TEXT REFERENCES users (id),
        approved_by   TEXT REFERENCES users (id),
        version       INTEGER NOT NULL DEFAULT 1,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        CHECK ((scope = 'company') = (department_id IS NULL))
      );
      CREATE INDEX vocabulary_items_team ON vocabulary_items (team_id, kind, status);
      -- One live entry per term (or trigger) in a place.
      CREATE UNIQUE INDEX vocabulary_items_unique
        ON vocabulary_items (team_id, kind, scope, COALESCE(department_id, ''), key)
        WHERE status IN ('active', 'pending');

      -- Who changed an entry, when, and what it was: the way back for a rollback.
      CREATE TABLE vocabulary_versions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id      TEXT NOT NULL REFERENCES vocabulary_items (id) ON DELETE CASCADE,
        version      INTEGER NOT NULL,
        action       TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status       TEXT NOT NULL,
        changed_by   TEXT REFERENCES users (id),
        changed_at   INTEGER NOT NULL
      );
      CREATE INDEX vocabulary_versions_item ON vocabulary_versions (item_id, version);

      CREATE TABLE vocabulary_comments (
        id         TEXT PRIMARY KEY,
        item_id    TEXT NOT NULL REFERENCES vocabulary_items (id) ON DELETE CASCADE,
        author_id  TEXT NOT NULL REFERENCES users (id),
        body       TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX vocabulary_comments_item ON vocabulary_comments (item_id);

      -- Told to a proposer at their next sign-in when their proposal was rejected.
      CREATE TABLE vocabulary_notices (
        id         TEXT PRIMARY KEY,
        team_id    TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        item_id    TEXT NOT NULL,
        kind       TEXT NOT NULL,
        summary    TEXT NOT NULL,
        note       TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        seen_at    INTEGER
      );
      CREATE INDEX vocabulary_notices_user ON vocabulary_notices (user_id, seen_at);
    `,
  },
  {
    version: 5,
    name: "policy",
    sql: `
      -- One row per setting per layer. The layers are the whole team, a department and one
      -- member; the scope id is '' for the team. source says who set it (an admin, or a
      -- compliance bundle), so the console can show "Set by compliance mode".
      CREATE TABLE policy_values (
        team_id    TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        scope      TEXT NOT NULL CHECK (scope IN ('team', 'department', 'member')),
        scope_id   TEXT NOT NULL DEFAULT '',
        key        TEXT NOT NULL,
        value_json TEXT NOT NULL,
        source     TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'compliance')),
        updated_by TEXT REFERENCES users (id),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (team_id, scope, scope_id, key)
      );
      ALTER TABLE team_revisions ADD COLUMN policy_revision INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 6,
    name: "usage_and_leaderboard",
    sql: `
      -- Daily counts per person, metric and app group. Counts only: never a word of text.
      -- A person's department is read when a report is run, so moving them moves their history
      -- with them (TM-05).
      CREATE TABLE usage_daily (
        team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        day     TEXT NOT NULL,
        metric  TEXT NOT NULL,
        bucket  TEXT NOT NULL DEFAULT '',
        count   INTEGER NOT NULL,
        PRIMARY KEY (team_id, user_id, day, metric, bucket)
      );
      CREATE INDEX usage_daily_day ON usage_daily (team_id, day);

      -- A batch that was received, so a client that sends it again is not counted twice.
      CREATE TABLE usage_batches (
        team_id     TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        batch_id    TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        PRIMARY KEY (team_id, user_id, batch_id)
      );

      -- A member's own choice about showing on the leaderboard.
      CREATE TABLE leaderboard_choices (
        team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        visible INTEGER NOT NULL,
        PRIMARY KEY (team_id, user_id)
      );
    `,
  },
  {
    version: 7,
    name: "identity_sso_scim_domains",
    sql: `
      -- An account can come from outside: SCIM or a first single sign-on (TM-18, TM-19).
      ALTER TABLE users ADD COLUMN external_id TEXT;
      ALTER TABLE users ADD COLUMN provisioned_by TEXT NOT NULL DEFAULT '';
      CREATE INDEX users_external_id ON users (external_id);

      -- Single sign-on settings for a team. A SIMULATION: nothing here talks to a real identity
      -- provider. The metadata is only checked for its structure.
      CREATE TABLE identity_sso (
        team_id          TEXT PRIMARY KEY REFERENCES teams (id) ON DELETE CASCADE,
        enabled          INTEGER NOT NULL DEFAULT 0,
        jit_create       INTEGER NOT NULL DEFAULT 0,
        enforce          INTEGER NOT NULL DEFAULT 0,
        idp_entity_id    TEXT NOT NULL DEFAULT '',
        idp_sso_url      TEXT NOT NULL DEFAULT '',
        cert_fingerprint TEXT NOT NULL DEFAULT '',
        cert_subject     TEXT NOT NULL DEFAULT '',
        cert_not_after   INTEGER,
        metadata_xml     TEXT NOT NULL DEFAULT '',
        updated_by       TEXT REFERENCES users (id),
        updated_at       INTEGER NOT NULL
      );

      -- A sign-in that was started and is waiting for the identity provider's answer. One use.
      CREATE TABLE sso_requests (
        id         TEXT PRIMARY KEY,
        team_id    TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at    INTEGER
      );

      -- SCIM provisioning for a team (a simulation: no real provider calls it). Only the hash of
      -- the token is kept.
      CREATE TABLE identity_scim (
        team_id        TEXT PRIMARY KEY REFERENCES teams (id) ON DELETE CASCADE,
        enabled        INTEGER NOT NULL DEFAULT 0,
        token_hash     TEXT UNIQUE,
        group_map_json TEXT NOT NULL DEFAULT '[]',
        updated_at     INTEGER NOT NULL
      );
      CREATE TABLE scim_groups (
        id           TEXT PRIMARY KEY,
        team_id      TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        external_id  TEXT,
        created_at   INTEGER NOT NULL,
        UNIQUE (team_id, display_name)
      );
      CREATE TABLE scim_group_members (
        group_id TEXT NOT NULL REFERENCES scim_groups (id) ON DELETE CASCADE,
        user_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        PRIMARY KEY (group_id, user_id)
      );

      -- Company domains of a team, verified with a DNS TXT record (TM-20; the lookup can be
      -- pointed at a file of fake records for tests).
      CREATE TABLE identity_domains (
        id              TEXT PRIMARY KEY,
        team_id         TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        domain          TEXT NOT NULL,
        token           TEXT NOT NULL,
        verified_at     INTEGER,
        last_checked_at INTEGER,
        default_role    TEXT NOT NULL DEFAULT 'member' CHECK (default_role IN ('admin', 'manager', 'member', 'viewer')),
        capture         INTEGER NOT NULL DEFAULT 0,
        restrict_signup INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL,
        UNIQUE (team_id, domain)
      );
      CREATE TABLE capture_declines (
        team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        PRIMARY KEY (team_id, user_id)
      );
    `,
  },
  {
    version: 8,
    name: "admin_mfa",
    sql: `
      -- A time-based one-time password (RFC 6238) for the admin console. The secret has to be
      -- kept to check a code, so it is stored as it is; the database is not encrypted at rest
      -- (the same open question as the rest of the file). last_step stops a code being used twice.
      CREATE TABLE account_mfa (
        user_id      TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
        secret       TEXT NOT NULL,
        confirmed_at INTEGER,
        last_step    INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL
      );

      -- One-use recovery codes, shown once; only their hashes are kept.
      CREATE TABLE mfa_recovery (
        user_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        used_at   INTEGER,
        PRIMARY KEY (user_id, code_hash)
      );
    `,
  },
  {
    version: 9,
    name: "shared_skills_and_folders",
    sql: `
      -- Skills a team publishes (NT-16): the Skill file as text, read-only for members, a new
      -- version for each change. A department's Skills are seen by that department.
      CREATE TABLE team_skills (
        id            TEXT PRIMARY KEY,
        team_id       TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        description   TEXT NOT NULL DEFAULT '',
        body          TEXT NOT NULL,
        scope         TEXT NOT NULL CHECK (scope IN ('company', 'department')),
        department_id TEXT REFERENCES departments (id) ON DELETE CASCADE,
        version       INTEGER NOT NULL DEFAULT 1,
        status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
        created_by    TEXT REFERENCES users (id),
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        CHECK ((scope = 'company') = (department_id IS NULL))
      );
      CREATE UNIQUE INDEX team_skills_name
        ON team_skills (team_id, scope, COALESCE(department_id, ''), lower(name))
        WHERE status = 'active';

      CREATE TABLE team_skill_versions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_id   TEXT NOT NULL REFERENCES team_skills (id) ON DELETE CASCADE,
        version    INTEGER NOT NULL,
        name       TEXT NOT NULL,
        body       TEXT NOT NULL,
        changed_by TEXT REFERENCES users (id),
        changed_at INTEGER NOT NULL
      );
      CREATE INDEX team_skill_versions_skill ON team_skill_versions (skill_id, version);

      -- Folders of shared meeting notes (NT-17): named people, a department, or the company.
      CREATE TABLE shared_folders (
        id            TEXT PRIMARY KEY,
        team_id       TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        kind          TEXT NOT NULL CHECK (kind IN ('shared', 'department', 'company')),
        department_id TEXT REFERENCES departments (id) ON DELETE CASCADE,
        status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
        created_by    TEXT REFERENCES users (id),
        created_at    INTEGER NOT NULL,
        CHECK ((kind = 'department') = (department_id IS NOT NULL))
      );
      CREATE INDEX shared_folders_team ON shared_folders (team_id, status);

      -- Who is in a "shared" folder, and whether they may add to it. (Department and company
      -- folders follow the department and the team, so they have no rows here.)
      CREATE TABLE folder_members (
        folder_id TEXT NOT NULL REFERENCES shared_folders (id) ON DELETE CASCADE,
        user_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        can_write INTEGER NOT NULL DEFAULT 1,
        added_by  TEXT REFERENCES users (id),
        added_at  INTEGER NOT NULL,
        PRIMARY KEY (folder_id, user_id)
      );

      -- What a person chose to share into a folder: a copy of the notes, never audio.
      CREATE TABLE folder_items (
        id         TEXT PRIMARY KEY,
        folder_id  TEXT NOT NULL REFERENCES shared_folders (id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        body_md    TEXT NOT NULL,
        source_ref TEXT NOT NULL DEFAULT '',
        shared_by  TEXT REFERENCES users (id),
        shared_at  INTEGER NOT NULL
      );
      CREATE INDEX folder_items_folder ON folder_items (folder_id, shared_at);

      -- Goes up whenever Skills or folders change, so a client can ask "anything new since?".
      ALTER TABLE team_revisions ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0;
    `,
  },
];

export function migrate(db: DatabaseSync, migrations: readonly Migration[] = MIGRATIONS): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
  const done = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map(
      (row) => row.version,
    ),
  );
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1)
      throw new Error(`Migrations must be numbered from 1 with no gaps (found ${migration.name})`);
  });
  for (const migration of migrations) {
    if (done.has(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        Date.now(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return migrations.length;
}
