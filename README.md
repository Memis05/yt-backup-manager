# YouTube Backup Manager

A local-first Windows desktop application for durable, incremental backups of
YouTube channels owned or managed by the signed-in user.

This repository currently contains the Phase 1 architectural foundation:

- an Electron, React, Vite, and Tailwind desktop shell;
- a separate headless worker with user-scoped singleton protection;
- authenticated, schema-validated local RPC and a narrow renderer bridge;
- worker-owned SQLite persistence with Drizzle repositories and migrations;
- typed settings, structured redacted logging, and encrypted credential-store
  abstractions;
- unit and integration coverage for the Phase 1 security and persistence
  boundaries.

## Requirements

- Windows 10 or 11 (the production target)
- Node.js 22.13 or newer
- Corepack

## Development

```powershell
corepack pnpm install
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm package:dir
corepack pnpm test:e2e
```

`test:e2e` runs against the unpacked package produced by `package:dir`.

Run the desktop application in development mode with:

```powershell
corepack pnpm dev
```

Runtime data defaults to the current Windows user's application-data folders.
Development and tests can override paths with the variables documented in
`.env.example`.

YouTube integration, downloads, destinations, scheduling registration, and
backup execution are intentionally deferred to later phases.
