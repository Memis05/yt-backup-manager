# Repository Instructions

Before making architectural or implementation decisions, read the project specifications in this order:

1. `MVP.md`
2. `ARCHITECTURE.md`
3. `DATABASE.md`
4. `JOB-ENGINE.md`
5. `CODEX-HANDOFF.md`

These documents define the approved product and architecture.

## Specification authority

Treat the specification files as normative requirements.

* `MVP.md` defines product scope and acceptance criteria.
* `ARCHITECTURE.md` defines system and process architecture.
* `DATABASE.md` defines persistence rules and schema invariants.
* `JOB-ENGINE.md` defines durable execution, retries, recovery, and job-state behavior.

If specifications appear to conflict, do not silently invent a new architecture. Identify the conflict and explain it before changing the design.

Do not modify the specification files unless explicitly asked.

## v1.0 scope

v1.0 is:

* Windows 10/11 desktop application.
* Electron + React + TypeScript.
* Local-first.
* No application backend/server.
* YouTube as the only source provider.
* Local filesystem and Google Drive as backup destinations.
* Google OAuth owned/configured by this application.
* Multiple Google accounts.
* Multiple YouTube channels.
* Incremental and resumable backups.
* SQLite catalog owned exclusively by the backup worker.
* `yt-dlp` for media acquisition.
* FFmpeg for media processing.
* SHA-256 integrity verification.
* Manifest-based disaster recovery.

Dropbox and OneDrive are NOT part of v1.0.

## YouTube safety invariant

YouTube is permanently READ ONLY.

Never add:

* upload capabilities;
* delete capabilities;
* title/metadata editing;
* playlist modification;
* channel modification;
* YouTube write OAuth scopes.

Use only the minimum required read-only permissions.

## Security

Never commit or log:

* OAuth client secrets;
* OAuth access tokens;
* OAuth refresh tokens;
* authorization codes;
* browser cookies;
* Authorization headers;
* other credentials.

Renderer processes must not have unrestricted Node.js access.

Use validated and narrowly scoped IPC contracts.

Do not expose generic shell execution, SQL execution, or arbitrary filesystem access to the renderer.

## Persistence

Only the backup worker owns and opens the SQLite database.

The renderer and normal Electron main process must communicate with the worker through typed IPC/RPC APIs.

Do not bypass this architecture for convenience.

## Reliability

Backup durability is more important than implementation speed or visual polish.

Long-running operations must be:

* resumable where possible;
* retryable;
* idempotent;
* crash recoverable.

Never report a copy as verified before the actual verification step succeeds.

Never automatically delete verified backup data because the YouTube source disappeared.

## Development practices

Use TypeScript strict mode.

Use pnpm workspaces.

Prefer small, testable modules and explicit interfaces.

Do not introduce unnecessary infrastructure such as Redis, PostgreSQL, Docker, RabbitMQ, or a hosted backend.

Use stable dependency versions available at implementation time and commit the lockfile.

Do not perform large unrelated refactors while implementing a scoped task.

Before finishing an implementation task, run all applicable:

* formatting;
* linting;
* TypeScript type checking;
* unit tests;
* integration tests;
* build/package validation.

Report any tests or checks that could not be run.

Do not commit or push changes unless explicitly requested.
