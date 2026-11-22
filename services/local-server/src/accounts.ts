import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AuditInput } from "./audit.ts";
import {
  DUMMY_HASH,
  PASSWORD_HISTORY,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "./passwords.ts";

/** What the server says about an account. The password hash is never part of it. */
export interface UserView {
  id: string;
  email: string;
  name: string;
  isOwner: boolean;
  status: "active" | "deactivated";
  createdAt: number;
}

export interface SessionGrant {
  /** The bearer token. Shown once; only its hash is stored. */
  token: string;
  expiresAt: number;
  user: UserView;
}

export type AccountResult<T> =
  ({ ok: true } & T) | { ok: false; code: string; message: string; retryAfterSeconds?: number };

export interface AccountsConfig {
  sessionDays: number;
  now(): number;
  /** Writes an entry to the audit log (TM-12). Optional so the accounts can be tested alone. */
  audit?(input: AuditInput): void;
}

/** TM-01: five wrong passwords in a row, then the next attempt waits 30 seconds. */
export const THROTTLE = { failures: 5, delayMs: 30_000 } as const;

const DAY_MS = 86_400_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  is_owner: number;
  status: "active" | "deactivated";
  created_at: number;
}

const view = (row: UserRow): UserView => ({
  id: row.id,
  email: row.email,
  name: row.name,
  isOwner: row.is_owner === 1,
  status: row.status,
  createdAt: row.created_at,
});

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const fail = (code: string, message: string) => ({ ok: false as const, code, message });

export interface NewAccount {
  name: string;
  email: string;
  password: string;
}

export function createAccounts(db: DatabaseSync, config: AccountsConfig) {
  const userByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
  const userById = db.prepare("SELECT * FROM users WHERE id = ?");

  function checkNew(input: NewAccount): AccountResult<{ email: string; name: string }> {
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    if (name === "" || name.length > 100) return fail("invalid_name", "Write a name.");
    if (!EMAIL.test(email) || email.length > 200)
      return fail("invalid_email", "Write a real email address.");
    const problem = passwordProblem(input.password);
    if (problem) return fail("weak_password", problem);
    return { ok: true, email, name };
  }

  function insertUser(input: NewAccount, owner: boolean): AccountResult<{ user: UserView }> {
    const checked = checkNew(input);
    if (!checked.ok) return checked;
    if (userByEmail.get(checked.email))
      return fail("email_taken", "That email already has an account.");
    const id = randomUUID();
    const now = config.now();
    const hash = hashPassword(input.password);
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, is_owner, created_at, password_changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, checked.email, checked.name, hash, owner ? 1 : 0, now, now);
    db.prepare(
      "INSERT INTO password_history (user_id, password_hash, created_at) VALUES (?, ?, ?)",
    ).run(id, hash, now);
    return { ok: true, user: view(userById.get(id) as unknown as UserRow) };
  }

  function grant(user: UserRow, clientId: string): SessionGrant {
    const token = `mst_${randomBytes(32).toString("base64url")}`;
    const now = config.now();
    const expiresAt = now + config.sessionDays * DAY_MS;
    db.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, client_id, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), user.id, hashToken(token), clientId.slice(0, 100), now, expiresAt, now);
    return { token, expiresAt, user: view(user) };
  }

  const userCount = () => (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;

  return {
    /** Whether the first account has been made. */
    isSetUp: () => userCount() > 0,

    /** The first run: makes the owner account, and only when there is no account yet. */
    setupOwner(input: NewAccount, clientId = ""): AccountResult<{ session: SessionGrant }> {
      if (userCount() > 0) return fail("already_set_up", "This server already has an owner.");
      const made = insertUser(input, true);
      if (!made.ok) return made;
      config.audit?.({
        actorId: made.user.id,
        action: "server.setup",
        targetType: "user",
        targetId: made.user.id,
        clientId,
      });
      return {
        ok: true,
        session: grant(userById.get(made.user.id) as unknown as UserRow, clientId),
      };
    },

    /** A further local account, made by someone allowed to (the caller checks that). */
    createAccount(input: NewAccount, actorId: string | null = null, clientId = "") {
      const made = insertUser(input, false);
      if (made.ok)
        config.audit?.({
          actorId,
          action: "account.created",
          targetType: "user",
          targetId: made.user.id,
          clientId,
        });
      return made;
    },

    signIn(
      emailInput: string,
      password: string,
      clientId = "",
    ): AccountResult<{ session: SessionGrant }> {
      const email = emailInput.trim().toLowerCase();
      const now = config.now();
      const throttle = db
        .prepare("SELECT failures, locked_until FROM sign_in_throttle WHERE email = ?")
        .get(email) as { failures: number; locked_until: number } | undefined;
      if (throttle && throttle.locked_until > now)
        return {
          ok: false,
          code: "delayed",
          message: "Too many wrong passwords. Wait a little and try again.",
          retryAfterSeconds: Math.ceil((throttle.locked_until - now) / 1000),
        };

      const row = userByEmail.get(email) as unknown as UserRow | undefined;
      // Check against a stored hash even when there is no account, so the time says nothing.
      const matches =
        verifyPassword(password, row?.password_hash ?? DUMMY_HASH) && row !== undefined;
      if (!matches || row === undefined) {
        const failures = (throttle?.failures ?? 0) + 1;
        const lock = failures % THROTTLE.failures === 0 ? now + THROTTLE.delayMs : 0;
        db.prepare(
          `INSERT INTO sign_in_throttle (email, failures, locked_until) VALUES (?, ?, ?)
           ON CONFLICT (email) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until`,
        ).run(email, failures, lock);
        // The first miss and each lock are written; the ones between are not, so a flood of
        // wrong passwords cannot fill the log.
        if (failures === 1 || lock > 0)
          config.audit?.({
            actorId: row?.id ?? null,
            action: "auth.sign_in_failed",
            targetType: "email",
            targetId: email,
            detail: { failures, locked: lock > 0 },
            clientId,
          });
        return fail("invalid_credentials", "The email or the password is not right.");
      }
      if (row.status !== "active")
        return fail("deactivated", "This account has been turned off. Ask the owner.");
      db.prepare("DELETE FROM sign_in_throttle WHERE email = ?").run(email);
      config.audit?.({
        actorId: row.id,
        action: "auth.sign_in",
        targetType: "user",
        targetId: row.id,
        clientId,
      });
      return { ok: true, session: grant(row, clientId) };
    },

    /** The account a bearer token belongs to, or null when it is unknown, expired or revoked. */
    authenticate(token: string): UserView | null {
      const session = db
        .prepare("SELECT id, user_id, expires_at, revoked_at FROM sessions WHERE token_hash = ?")
        .get(hashToken(token)) as
        { id: string; user_id: string; expires_at: number; revoked_at: number | null } | undefined;
      const now = config.now();
      if (!session || session.revoked_at !== null || session.expires_at <= now) return null;
      const row = userById.get(session.user_id) as unknown as UserRow | undefined;
      if (!row || row.status !== "active") return null;
      db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now, session.id);
      return view(row);
    },

    signOut(token: string): void {
      db.prepare(
        "UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
      ).run(config.now(), hashToken(token));
    },

    /** Changes the password. Other sessions end; the one asking stays. */
    changePassword(
      userId: string,
      currentPassword: string,
      newPassword: string,
      keepToken: string,
    ): AccountResult<object> {
      const row = userById.get(userId) as unknown as UserRow | undefined;
      if (!row || !verifyPassword(currentPassword, row.password_hash))
        return fail("invalid_credentials", "The current password is not right.");
      const problem = passwordProblem(newPassword);
      if (problem) return fail("weak_password", problem);
      const recent = db
        .prepare(
          "SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY id DESC LIMIT ?",
        )
        .all(userId, PASSWORD_HISTORY) as { password_hash: string }[];
      if (recent.some((old) => verifyPassword(newPassword, old.password_hash)))
        return fail(
          "password_reused",
          `Choose a password that is not one of your last ${PASSWORD_HISTORY}.`,
        );
      const now = config.now();
      const hash = hashPassword(newPassword);
      db.prepare("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?").run(
        hash,
        now,
        userId,
      );
      db.prepare(
        "INSERT INTO password_history (user_id, password_hash, created_at) VALUES (?, ?, ?)",
      ).run(userId, hash, now);
      db.prepare(
        "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND token_hash != ? AND revoked_at IS NULL",
      ).run(now, userId, hashToken(keepToken));
      config.audit?.({
        actorId: userId,
        action: "auth.password_changed",
        targetType: "user",
        targetId: userId,
      });
      return { ok: true };
    },

    listUsers: (): UserView[] =>
      (
        db.prepare("SELECT * FROM users ORDER BY created_at, email").all() as unknown as UserRow[]
      ).map(view),
  };
}

export type Accounts = ReturnType<typeof createAccounts>;
