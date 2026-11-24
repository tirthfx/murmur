# The team backend on Supabase

Murmur's optional Team mode can talk to a Supabase project instead of the local server (SW-01, milestone M8). This page covers the database side: the schema, the row-level security, the functions the app calls, how to apply the migrations and how to test them. The app side is `SupabaseTeamClient` in `apps/desktop/src/main/team/supabase-team-client.ts`. It is built and tested, but the app does not choose it yet: today every team uses the local server, and picking a backend per team comes with shadow mode and cutover.

Nothing here is needed to use Murmur. Dictation and meeting notes work with no account. Sign-in exists only for Team mode.

## What lives in the database

Accounts (as profiles), teams, departments, members, invites and join requests, the shared dictionary and snippets with their review state, policy values, usage counts, plan tiers and the audit log. Raw audio, transcripts, prompts and model files never go to the database, and a test fails if a column name suggests otherwise.

## Layout

| Path                                   | What it is                                            |
| -------------------------------------- | ----------------------------------------------------- |
| `services/supabase/migrations/*.sql`   | The schema, in numbered steps, as plain SQL           |
| `services/supabase/tests/rls.sql`      | Runs each role against the policies and the functions |
| `services/supabase/src/schema.test.ts` | Checks on the migration text; runs in CI              |
| `services/supabase/src/seed.ts`        | Writes the matrices migration from its sources        |

A migration is never edited after it has been applied. A fix is a new file (`0004` fixes a name clash found by the SQL tests).

## The rules the schema follows

- Row-level security is on for every table in `public`. A test fails for a table without it.
- A client reads through select policies and writes only through functions. No table has an insert, update or delete policy.
- Functions that change data are `security definer`, with an empty `search_path`, and check `auth.uid()` themselves. The ones a client may call are in `public`; helpers are in `private`, which the API does not expose.
- Nothing is open by default: new tables and functions are closed to `anon` and `authenticated` until a migration grants them. Only `murmur_health` and `check_invite` are open to anonymous callers.
- Errors carry a PostgREST status code in the SQLSTATE (`PT403` is HTTP 403), so the client can tell forbidden from not found from a conflict.
- Who may do what comes from `services/local-server/src/permissions.json`, and which plan has which feature from `packages/shared/src/plans.ts`. Migration `0002` is generated from them (`npm run seed --workspace @murmur/supabase`), and a test fails if it differs from its sources.

## The functions

| Function                                                 | What it does                                               |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| `murmur_health`, `claim_owner`                           | Whether there is an owner; the first account takes it      |
| `create_team`, `my_teams`, `add_member`, `set_team_plan` | Teams and members                                          |
| `create_invite`, `check_invite`, `redeem_invite`         | Invites; a code is checked before an account is made       |
| `team_vocabulary`, `propose_item`, `review_item`         | Shared entries, with governance                            |
| `my_notices`, `mark_notices_seen`, `set_team_setting`    | Turned-down proposals and the team's vocabulary settings   |
| `policy_layers`, `set_policy_values`, `report_retention` | Policy layers (the client merges them), counts-only report |
| `send_usage`                                             | A batch of counts, counted once however often it is sent   |
| `verify_audit_chain`                                     | Walks a team's hash chain                                  |

## Applying and testing

The migrations are applied to the project with the Supabase CLI (`supabase db push`), the dashboard's SQL editor, or an MCP tool that applies migrations. They run in file order.

To test, run `services/supabase/tests/rls.sql` against a database with the migrations applied. It makes its own accounts, acts as each of them and ends by raising `ALL TESTS PASSED`, which undoes everything it did. A failed check raises `FAIL <what>`.

```bash
psql "$DATABASE_URL" -f services/supabase/tests/rls.sql
```

Run it against a development project or a local stack (`supabase start`), not one with data you care about, although it leaves nothing behind.

## The client

`createSupabaseTeamClient` implements `TeamClient` v1 over `fetch`, with no SDK: Supabase Auth for sign-up, sign-in, renewal and sign-out, and PostgREST for the functions above. Only the project's public key and a person's session go out; the service key is never in the app.

- **One opaque token.** The session token the app keeps holds the access token and the refresh token. An expired access token is renewed inside the client and the new token is handed to `saveToken`, so the app can store it (a refresh token works once). A token with no refresh token, or a refresh token that no longer works, is `unauthorized`.
- **Sign-out is immediate.** Migration `0005` makes every function check that the session named in the token still exists, so a token from a session that was signed out is refused, not just forgotten. Direct table reads can still use the token until it expires (at most the project's access token lifetime).
- **Account first, then the invite.** An invite is checked before an account is made for it, so a wrong code makes no account. Joining with an invite needs the project to allow sign-ups.
- **Passwords** are checked for Murmur's minimum of 12 before anything is sent.
- **Errors** map as the interface says: the database's own words with the status they carry (`PT403` is forbidden, `PT404` not found, `PT409` conflict, `PT400` invalid), Supabase Auth's own limits as `rate_limited` with the wait it gives, no session as `unauthorized`, no connection as `offline`.
- **Policy** is merged in the client from the three layers the database returns, with the same code the app uses to enforce it; a value the app does not accept is dropped.

## Running the contract suite

The suite that the local server passes also runs against a Supabase project, but only against a throwaway one, because every test starts by emptying it. To set one up:

1. Make a second Supabase project, apply the migrations, then apply `services/supabase/tests/reset.sql` to it. That file makes a reset function that works only with the service key and only on a project that ran the file.
2. In that project's Authentication settings, turn Confirm email off.
3. Run the suite with the project's details in the environment:

```bash
MURMUR_SUPABASE_TEST_URL=https://<ref>.supabase.co \
MURMUR_SUPABASE_TEST_ANON_KEY=<anon key> \
MURMUR_SUPABASE_TEST_SERVICE_KEY=<service role key> \
MURMUR_SUPABASE_TEST_WIPE=yes \
npx vitest run apps/desktop/src/main/team/supabase-contract.test.ts
```

Without those four variables the suite is skipped, so CI and a normal `npm test` never touch a project. One test is left out for Supabase: the wait after five wrong passwords is the local server's rule, and Supabase Auth has limits of its own (the contract's `signInLockout` capability).

## Settings the project needs

These are set in the Supabase dashboard (Authentication), not in SQL:

- **Confirm email** off, unless an email provider is set up. With it on, sign-up returns no session until the person follows a link.
- **Minimum password length** 12, matching Murmur's own minimum.
- **Allow new users to sign up** on. Joining a team needs an account, and the owner's first account is made the same way.

## Not built yet

Choosing the backend per team in the app, a run of the contract suite against a test project (the suite and its fixture are written and skipped until one exists), departments and member management functions beyond what the contract needs, shared Skills and folders, sync with an outbox, shadow mode and cutover, and SSO, SCIM and domain capture.
