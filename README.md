# YouTube Backup Manager

A local-first Windows desktop application for durable, incremental backups of
YouTube channels owned or managed by the signed-in user.

This repository contains the Phase 1 foundation and the Phase 2 read-only source catalog:

- an Electron, React, Vite, and Tailwind desktop shell;
- a separate headless worker with user-scoped singleton protection;
- authenticated, schema-validated local RPC and a narrow renderer bridge;
- worker-owned SQLite persistence with Drizzle repositories and migrations;
- typed settings, structured redacted logging, and encrypted credential-store
  abstractions;
- unit and integration coverage for the Phase 1 security and persistence
  boundaries.
- Google Desktop OAuth with PKCE, a system browser, state validation, and an
  ephemeral `127.0.0.1` callback;
- multiple encrypted Google account connections and normalized channel access;
- paginated YouTube channel, upload, playlist, and playlist-membership sync;
- idempotent catalog reconciliation, metadata history, Activity, and local FTS;
- functional Accounts, Channels, Library, and Playlists desktop views.

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

## Development Google OAuth

Create a Google OAuth client of type **Desktop app** in the maintainer's Google
Cloud project, enable YouTube Data API v3, and configure the OAuth consent
screen/test users as required by Google. Set the generated desktop client
credentials outside committed source before launching:

```powershell
$env:YTBM_GOOGLE_OAUTH_CLIENT_ID='your-client-id.apps.googleusercontent.com'
$env:YTBM_GOOGLE_OAUTH_CLIENT_SECRET='your-desktop-client-secret'
corepack pnpm dev
```

The client secret is sent only from the privileged worker to Google's token
endpoint. It is never exposed to the renderer, persisted in SQLite or the
credential store, or written to application logs. The application requests
only `openid`, `email`, `profile`, and
`https://www.googleapis.com/auth/youtube.readonly`. The callback binds to an
ephemeral port on `127.0.0.1`; no redirect URI port is hard-coded.

See `docs/PHASE-2-SOURCE-CATALOG.md` for source synchronization and
classification details.

Runtime data defaults to the current Windows user's application-data folders.
Development and tests can override paths with the variables documented in
`.env.example`.

Downloads, destinations, Google Drive, scheduling registration, manifests,
integrity, and backup execution remain intentionally deferred to later phases.
