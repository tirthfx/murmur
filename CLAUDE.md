# CLAUDE.md

Project instructions for Claude Code working in this repository.

## Project summary

Murmur is a personal, single-owner Mac desktop app for voice dictation and meeting notes, built for the owner's own use. It is not a product and is not distributed as an app. The source is public.

- Owner GitHub account: `tirthfx`
- Repository: public, `tirthfx/murmur` (public since 2026-11-12)
- Status: pre-alpha

## Hard rules

- **Clean room.** Never copy code, UI text, artwork, sounds, names or branding from any other app into this repo. Re-implement observed behaviour only, in our own words and our own design. Do not commit reverse-engineering output (decompiled code, string catalogues, bundle dumps, migration files, flag lists) from any third-party app.
- **Public repo.** Everything committed is published. No secrets, personal data, recordings, transcripts or third-party material. Do not add badges, publish packages, or enable Pages.
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

| Path                    | Purpose                                |
| ----------------------- | -------------------------------------- |
| `apps/desktop`          | Electron app (main, preload, renderer) |
| `native/helper-mac`     | Swift helper package                   |
| `packages/shared`       | Shared types and helper protocol       |
| `services/local-server` | Local backend for team, sync and admin |
| `docs/`                 | In-repo technical documentation        |
| `.github/`              | Issue and PR templates, CI workflow    |

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

- The main Claude session does the work itself: it plans, splits work into issues, writes the code and tests, runs the checks, opens and merges pull requests, and writes and edits vault notes.
- Haiku subagents (the Agent tool with `model: "haiku"`) are only for subtasks: codebase search, reading files, summarizing logs, simple mechanical edits and formatting. The main session checks what they return before using it.
- Do not delegate coding to other subagents (no Sonnet coding agents).
- Run one subagent at a time unless the owner says otherwise. Never let a subagent edit files the main session is editing.

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

Run all commands from the repo root.

- Install: `npm install` (CI uses `npm ci`)
- Dev (desktop): `npm run dev` (starts Electron Forge with the Vite dev server; the Electron binary downloads on first run)
- Test: `npm test`
- Lint: `npm run lint`
- Format: `npm run format` (check only: `npm run format:check`)
- Typecheck: `npm run typecheck`
- Build desktop: `npm run package` (Electron Forge package; output in `apps/desktop/out/`). Run `npm run build:helper` first to include the helper at `Contents/Resources/helper/murmur-helper`.
- Build helper (Swift): `npm run build:helper` (runs `swift build -c release`; output in `native/helper-mac/.build/release/murmur-helper`). Needs macOS with Xcode or the Swift toolchain. In development the app finds the binary there, or at `MURMUR_HELPER_PATH`. If it is missing the app still starts and the Hub shows the helper as unavailable.
- Smoke test: `npm run smoke` (owner's Mac only; see `docs/smoke-test.md`).
- Helper tests: `npm run test:helper` (runs `swift test`). Not part of CI yet; run it locally when `native/helper-mac` changes.

Permissions (what each is for, granting in development vs a packaged build, `tccutil reset`): see `docs/permissions.md`.

Hotkeys (the listen-only key listener, default bindings, manual key test): see `docs/hotkeys.md`.

Microphone capture (where audio goes, gain and limiter, silent check, manual test): see `docs/audio.md`.

Speech recognition (model download and SHA-256 check, offline loading, manual test): see `docs/speech.md`. Download the models with `npm run model:download`.

Text insertion (paste with clipboard restore, typed fallback, manual test): see `docs/insertion.md`.

The Bar (states, the non-focusable window, drag and saved position, manual test): see `docs/bar.md`.

Context awareness (what is read around the caret, secure fields, nothing kept): see `docs/context.md`.

Dictionary (terms, replacements, starred words, where they act in a dictation): see `docs/dictionary.md`.

Snippets (triggers, rich-text bodies, HTML on the pasteboard): see `docs/snippets.md`.

Styles and app categories (presets, the default app table, what is read): see `docs/styles.md`.

Memory (facts, keywords, "remember that" on the Bar): see `docs/memory.md`.

Email (signature, email language and translation, writing samples): see `docs/email.md`.

Developer apps (spoken syntax, jargon packs, file tags, names on screen, coding tools): see `docs/developer.md`.

Voice Profile (what is learned and kept, summary, milestones, My Voice): see `docs/voice-profile.md`.

Transcript cleanup (rules, the local model and its guard, the 1.5 s budget, benchmark): see `docs/cleanup.md`.

Dictation history (database, tables, migrations): see `docs/history.md`.

Settings (shortcuts and their checks, microphone, language, cleanup level): see `docs/settings.md`.

Sounds and output mute (the tones, mute while dictating, crash recovery): see `docs/sounds.md`.

Typing reminder (what is counted, snooze): see `docs/typing-reminder.md`.

Experimental options (split into messages, pause media, headset, ring, phrases, style detection, pronunciation clips): see `docs/experimental.md`.

Tray menu (items, the status dot, when it is rebuilt, manual test): see `docs/tray.md`.

First-run setup (steps, what blocks dictation, a clean profile with `MURMUR_PROFILE_DIR`): see `docs/onboarding.md`.

End-to-end smoke test (`npm run smoke`, what it checks and needs): see `docs/smoke-test.md`.

## Definition of done for a PR

- Builds locally with the commands above.
- Tests pass and new behaviour has tests where practical.
- Lint and typecheck pass.
- CI is green.
- The vault is updated: session note, and decision notes if any decision was made.
- The issue is linked with `Closes #<n>` in the PR body.
- Clean-room check done: no third-party code, text, assets or names added.
- No secrets, model files or database files committed.
