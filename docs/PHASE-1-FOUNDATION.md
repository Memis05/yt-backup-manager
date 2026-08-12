# Phase 1 foundation

This implementation intentionally establishes only the boundaries needed by
later backup phases.

## Deliberate decisions

- UTC timestamps are persisted as integer epoch milliseconds throughout the
  SQLite schema.
- Channels use the normalized `account_channels` mapping so one logical YouTube
  channel can be accessible through multiple Google identities.
- Video copies live in `media_copies`; `media_artifacts` is reserved for
  thumbnail and metadata sidecars so there is no duplicate video truth.
- The worker singleton is enforced with a user-scoped OS named-pipe listener.
  It is abstracted behind an interface and uses a Unix-domain socket equivalent
  in cross-platform tests. This avoids a native mutex dependency while retaining
  kernel-enforced exclusivity on Windows.
- Worker RPC uses a per-user random bearer token stored outside SQLite and a
  user-scoped named pipe. The token is never logged. Later hardening can bind the
  token file to an explicit Windows ACL without changing the RPC contract.
- Credentials use an encrypted file-store abstraction backed by Electron
  `safeStorage`/Windows DPAPI. Google OAuth and YouTube session acquisition are
  not implemented in this phase.
- SQLite FTS5 is initialized as derived data. Repository APIs, not renderer
  processes, will own rebuild and synchronization in later catalog work.

## Deferred by scope

Source providers, download/FFmpeg adapters, destination implementations,
Windows Task Scheduler registration, durable job execution, manifests,
integrity workflows, and recovery are represented by package boundaries or
schema only. Their actual behavior belongs to later phases.
