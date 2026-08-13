# Phase 6 implementation guide

This guide complements `PHASE-6-SCHEDULING-INTEGRITY-REPAIR.md`. The Phase 6 specification remains the normative source.

## Architecture

- SQLite remains worker-owned. Schedule configuration, logical trigger deduplication, integrity history, repair jobs, and notification deduplication are persisted there.
- `@ytbm/scheduler-windows` is the only Task Scheduler adapter. It invokes `schtasks.exe` without a shell, accepts only UUID schedule IDs, and registers only the packaged application executable with fixed `--worker --scheduled <schedule-id>` arguments.
- App-owned tasks use `\YouTubeBackupManager-Schedule-<uuid>`. Reconciliation recreates missing tasks, updates an executable path change, and removes stale tasks only inside that namespace.
- Scheduled, startup, manual, integrity, and repair work all enter the existing durable worker and job engine. The renderer receives narrow DTO/RPC methods and never receives shell, SQL, provider-file, or arbitrary-path authority.
- Closing the window can leave the tray and worker running. Tray Quit asks the worker to finish active durable work and shut down when idle.

## Schedule behavior

Daily and weekly schedules store the selected local wall-clock time. Every-N-hours schedules use that local time as their interval anchor. The Windows task uses a floating local `StartBoundary`, so Windows applies the current time-zone and daylight-saving rules instead of converting the schedule permanently to UTC.

For a spring-forward time that does not occur, `StartWhenAvailable` runs one catch-up occurrence when catch-up is enabled. Repeated or ambiguous wall-clock triggers use the persisted logical occurrence key, so an equivalent occurrence is handled once. One or more missed equivalent triggers collapse into a single current catch-up. Opening the app, an overlapping manual backup, or a second Windows launch does not create duplicate per-channel acquisition work.

Production task registration is intentionally unavailable from development Electron. Build or package the application before performing a real Task Scheduler smoke test.

## Settings and notifications

Settings expose:

- start with Windows;
- start minimized;
- keep running in the tray when the window closes;
- global and per-channel automatic backup schedules;
- backup on application startup and missed-run catch-up;
- notification category preferences;
- weekly, monthly, or custom periodic integrity checks;
- provider metadata/size or downloaded SHA-256 Drive verification.

Notifications contain fixed safe summaries and validated internal section/entity routes. They do not contain tokens, provider response bodies, paths, or session data. The worker suppresses a repeated unresolved integrity, authentication, destination, or scheduling notification.

## Integrity and health

Manual verification supports one copy, media item, channel, destination, or all configured copies. Local verification streams the file and compares bytes plus SHA-256. A disconnected volume is `UNAVAILABLE`, never `MISSING`. Google Drive verification is explicitly labeled as either provider identity/size/app-metadata verification or a full downloaded SHA-256 check.

Periodic integrity uses a second fixed app-owned Windows maintenance task. Its daily local-time wake checks the persisted weekly, monthly, or custom calendar interval and scope before planning work, so no renderer or in-process timer is required and duplicate wakes remain harmless. The resulting durable jobs run at lower priority. A full Drive SHA-256 check consumes download bandwidth and application staging space; the temporary download is removed after verification or cancellation.

The Integrity screen reports descriptive counts (`COMPLETE`, `PARTIAL`, `PENDING`, `MISSING`, `CORRUPT`, `UNAVAILABLE`, and `AUTH_REQUIRED`). These are observations of configured copies, not a user-defined protection policy.

## Repair safety

Repair accepts a catalog copy UUID only. The worker resolves all local paths and Drive provider IDs. It selects a verified local copy first, then a verified Drive copy. YouTube is offered only when no verified archive copy exists and requires explicit confirmation.

Local replacement is staged and SHA-256 verified before atomic promotion. If staging or promotion fails, the existing unhealthy target is retained. Drive-sourced bytes are downloaded to staging and SHA-256 verified before reuse. A repaired copy is not marked `VERIFIED` until target verification succeeds. Repair never deletes or mutates the last healthy source copy.

## Automated validation

From the repository root:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm package:dir
corepack pnpm test:package-smoke
corepack pnpm test:e2e
git diff --check
```

The focused suites cover scheduler XML and namespace safety, schedule reconciliation/deduplication/catch-up, integrity persistence and execution, notification routing/deduplication, atomic local replacement, and all four archive repair DAG combinations.

## Manual Windows smoke

1. Package the app and configure a schedule a few minutes ahead.
2. Close the UI while keeping the tray enabled.
3. Confirm the app-owned task starts a worker and creates one scheduled run.
4. Open the UI during that run and confirm it attaches to the same worker.
5. Sleep across another trigger and confirm one catch-up run, not one run per missed interval.
6. Corrupt a safety-copied local target, run a copy check, and repair it from another verified destination.
7. Repeat with a missing Drive target. Confirm no yt-dlp acquisition occurs while a verified archive source exists.

## Troubleshooting

- `UNAVAILABLE` in a development build is expected for Task Scheduler registration. Production registration requires a packaged Windows executable.
- `ERROR` on a schedule means reconciliation failed. Keep the DB schedule; retry by opening Settings after confirming Task Scheduler is available and the packaged executable still exists.
- A disconnected local destination stays unavailable until the same volume identity returns. It is not converted to missing.
- `AUTH_REQUIRED` pauses Drive integrity or repair. Reconnect the same Google account; durable work resumes without changing the copy to missing.
- Full Drive SHA-256 checks can pause for network outages and need enough staging space for one downloaded object.
- If dependency installation reports `EPERM` for Electron or `better-sqlite3`, close running development app/worker processes before reinstalling.

## Packaging limitation

Phase 6 reconciles app-owned scheduled tasks while the application is installed. Installer/uninstaller cleanup of those tasks remains a documented Phase 7 release-hardening item.
