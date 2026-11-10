# Murmur

Murmur is a personal, local-first voice dictation and meeting-notes app for Mac. It is built for one owner's private use.

- **Private project.** This repository is private and not intended for distribution.
- **Local first.** Speech recognition and text cleanup run on the machine. No cloud AI.
- **Status:** pre-alpha. The scaffold is in place; no features are complete yet.

## Layout

| Path                    | Purpose                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `apps/desktop`          | Electron app (Forge, Vite, TypeScript, React)                           |
| `native/helper-mac`     | Swift helper for hotkeys, text context, paste, audio capture and speech |
| `packages/shared`       | Shared types and the helper protocol                                    |
| `services/local-server` | Local backend for team, sync and admin features                         |
| `docs/`                 | Technical documentation                                                 |

## Getting started

Requires Node 22 or newer and npm.

```bash
npm install
npm run dev       # start the desktop app (Electron Forge + Vite)
npm run package   # package the desktop app into apps/desktop/out/
npm run lint && npm run format:check && npm run typecheck && npm test
```

The first `npm run dev` or `npm run package` downloads the Electron binary.

## Contributing

Read [CLAUDE.md](CLAUDE.md) for the project rules, architecture, workflow and definition of done.
