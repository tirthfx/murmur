# CLAUDE.md

Project instructions for Claude Code working in this repository.

## Project summary

Murmur is a personal, single-owner Mac desktop app for voice dictation and meeting notes. It re-implements the behaviour of a commercial dictation app for the owner's private use. It is not a product, has no users other than the owner, and is not for distribution.

- Owner GitHub account: `tirthfx`
- Repository: private, `tirthfx/murmur`
- Status: pre-alpha

## Hard rules

- **Clean room.** Never copy code, UI text, artwork, sounds, names or branding from the reference commercial app into this repo. Re-implement observed behaviour only, in our own words and our own design. Do not commit reverse-engineering output (decompiled code, string catalogues, bundle dumps, migration files, flag lists) from any third-party app.
- **Private repo.** The repository stays private. Do not add public badges, publish packages, or enable Pages.
- **No payments.** No real payment, billing or subscription integration. Plan tiers (free, paid, team) are a local setting that unlocks features for testing.
- **Local-only AI.** Speech recognition and text cleanup or rewriting run on-device. The speech model runs in the Swift helper. Cleanup and rewrites use a local LLM. No cloud AI APIs, no telemetry that sends transcripts or audio off the machine.
- **Secrets.** No API keys, tokens or `.env` files in git. Model files (`*.gguf`, `*.mlmodelc`, `models/`) are never committed.

## Architecture

Stack:

- **Desktop UI:** Electron, built with Electron Forge, Vite, TypeScript and React. Lives in `apps/desktop`.
- **Design system:** Meta's Astryx (`@astryxdesign/core`) with the Neutral theme (`@astryxdesign/theme-neutral`). Astryx is beta, so pin both packages to exact versions, not ranges. Fonts are bundled locally because the app is offline-first. Components the design system does not provide (the floating Bar window, tray menus, shortcut recorder, audio level meter) are custom.
- **Package manager:** npm workspaces only. Do not use any other package manager.
- **Native helper:** a Swift Package executable in `native/helper-mac`. It handles global hotkeys, accessibility text context, pasting into other apps, microphone capture, system-audio capture and the on-device speech model.
- **Shared code:** `packages/shared` holds shared TypeScript types and the helper protocol definitions.
- **Local server:** `services/local-server` is a bundled local backend for team, sync and admin features. Supabase comes later.
- **Storage:** local SQLite with numbered migrations.
- **Docs:** `docs/` for in-repo technical docs only. The product spec lives in the vault (see Vault protocol).

Helper protocol (idea, to be formalised in `packages/shared`):

- Electron main spawns the Swift helper as a child process.
- Messages are newline-delimited JSON over stdin and stdout.
- Each request carries an `id`, a `type` and a payload. Each response or event carries the matching `id` (or none for events) and a `type`.
- Events cover hotkey down and up, audio chunks or levels, partial and final transcripts, focused-field context, and errors.
- Protocol types are versioned and shared between main and helper. Breaking changes need a version bump.

Platform rule: all platform-specific code sits behind an interface, so a Windows helper can be added later without touching the rest of the app. Mac code must not leak into `apps/desktop` or `packages/shared`.

Layout:

| Path | Purpose |
|---|---|
| `apps/desktop` | Electron app (main, preload, renderer) |
| `native/helper-mac` | Swift helper package |
| `packages/shared` | Shared types and helper protocol |
| `services/local-server` | Local backend for team, sync and admin |
| `docs/` | In-repo technical documentation |
| `.github/` | Issue and PR templates, CI workflow |

## Workflow

Every change goes through this sequence. Nothing is committed straight to `main` after the initial scaffold commit.

1. **Issue.** Open a GitHub issue with the matching template (feature or bug). Add a milestone and labels.
2. **Branch.** Name it `<type>/<issue-number>-<short-slug>`, where type is `feat`, `fix`, `chore` or `docs`. Example: `feat/12-push-to-talk`.
3. **Commit.** Conventional Commits, for example `feat(helper): add push-to-talk hotkey`. Keep commits focused.
4. **Pull request.** Open a PR from the branch. The body must contain `Closes #<n>`. Fill in the PR template.
5. **CI.** Wait for CI to pass.
6. **Merge.** Squash-merge into `main`.

Commit and PR rules:

- No AI attribution lines, no `Co-authored-by` trailers, no generated-by footers in commits or PR descriptions.
- Commit messages describe the change, not the process.

## Orchestration

- The main Claude session is an orchestrator. It plans, splits work into issues, reviews results, and writes and edits vault notes itself.
- Subagents are used for code and for large first drafts: the Agent tool with `model: "haiku"`.
- Run one subagent at a time unless the owner says otherwise. Check each agent's output before starting the next.
- One issue per agent. Never run two agents that edit the same files at the same time. Serialise work that touches shared files such as `packages/shared` or the root config.
- The orchestrator checks each agent's diff, runs the checks and opens the PR.

## Vault protocol

The notes vault is an Obsidian-style folder at `/Users/tirthsandipshendage/Developer/murmur-vault`. It is outside this repo and is not in git. The spec lives there.

- **Session start:** read `00 Home.md` and the latest session note.
- **Spec reading order:** read `02 Spec/05 Canonical Rules` before any other spec file.
- **Open decisions:** tracked in `06 Backlog/Open Questions`.
- **During a session:** add a decision note for each decision made, including the reason and the alternatives rejected.
- **Session end:** write a session note summarising what was done, what is open and what is next.
- **Spec changes:** update the relevant spec note in the vault. Do not put the product spec in the repo.
- A PR is not done until the vault reflects it.

## Commands

To be filled in when the app is scaffolded.

- Install: `TBD`
- Dev (desktop): `TBD`
- Test: `TBD`
- Lint: `TBD`
- Typecheck: `TBD`
- Build desktop: `TBD`
- Build helper (Swift): `TBD`

## Definition of done for a PR

- Builds locally with the commands above.
- Tests pass and new behaviour has tests where practical.
- Lint and typecheck pass.
- CI is green.
- The vault is updated: session note, and decision notes if any decision was made.
- The issue is linked with `Closes #<n>` in the PR body.
- Clean-room check done: no third-party code, text, assets or names added.
- No secrets, model files or database files committed.
