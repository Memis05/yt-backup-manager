# Phase 5 disaster recovery implementation

Phase 5 rebuilds the worker-owned SQLite catalog from app-created local and Google Drive
backups. It supports Local-only, Drive-only, and combined recovery without requiring a YouTube
connection or acquiring media again.

## Workflow and persistence

The renderer can create a recovery session, choose local folders through Electron's native folder
picker, attach Drive-authorized Google accounts, start a scan, inspect counts and safe warnings,
and explicitly confirm import. Renderer IPC never accepts a filesystem path or URL.

The worker persists scan state in migration `0006` using `recovery_sessions`, `recovery_sources`,
candidate channel/media/playlist/copy/artifact tables, warnings, and raw paginated Drive-object
inventory. Canonical tables are unchanged during scan. Import processes stable identities and
copies in bounded transactions, can be rerun after partial progress, rebuilds `media_search`, and
records a safe recovery activity event. A worker restart marks interrupted scans failed and makes
interrupted imports ready for an idempotent retry.

## Local scan

The local scanner uses the Phase 3 physical path checks and never follows a symlink, junction, or
reparse escape. JSON has type-specific byte limits and a maximum nesting depth. It reads the
version marker, channel manifest, metadata sidecars, playlist sidecars, and media filesystem
metadata. A malformed manifest can fall back to independently valid media and playlist sidecars;
one malformed item does not stop other healthy candidates.

The fast scan checks existence and expected size but does not hash multi-gigabyte media. It
preserves the archived expected SHA-256 and verification timestamp but leaves local
`verification_strength` unset, because `LOCAL_SHA256` means the current filesystem bytes were
freshly hashed. A later integrity job may establish that stronger claim.

## Google Drive discovery

Drive recovery uses the existing `drive.file` authorization. A Drive-only account can be
authorized after database loss; it does not imply or request a YouTube grant. Discovery uses a
paginated `files.list` query for app-created schema markers, selective fields, stable
`ytbmObjectKey` values, and the `backup-root` marker. Folder names and locations are not identity,
so renamed or moved roots remain discoverable. Existing Phase 4 keys remain supported.

Only bounded version, manifest, metadata, and playlist JSON is fetched. Response streams are
stopped when their byte limit is exceeded. Video objects are inspected through listed provider
metadata; their content is never downloaded during scan. Retryable 429/5xx responses are retried
with bounded backoff, while the provider's existing authorization path performs one token refresh
after a 401. Recovered provider IDs are persisted in `provider_objects`, allowing Phase 4 stat,
open, reuse, and reconciliation paths to recognize existing objects.

Newly created/touched Phase 4 objects now also carry `ytbm=1`, an explicit object type, stable
provider identities, and schema version. No media bytes are re-uploaded merely to add recovery
metadata.

## Merge and verification rules

- Channels merge by `YOUTUBE + provider_channel_id`.
- Media merge by `YOUTUBE + provider_media_id`; archive titles are never identity.
- Playlists merge by provider playlist ID, and membership is reconciled through provider media
  IDs across all selected sources.
- Newer existing catalog metadata wins over older archive metadata. Otherwise, the newest valid
  timestamped sidecar wins, followed by manifest and folder fallbacks.
- Each reconstructed local volume/root and each Drive account/root is an independent destination.
  The same media and destination is reconciled instead of duplicated.
- Local and Drive copies remain independent records. Quality/container/codec/resolution are
  retained. Incompatible hashes for otherwise equivalent candidates produce `HASH_CONFLICT` and
  neither backup object is changed or removed.
- Drive fast verification uses `PROVIDER_METADATA_SIZE`. It confirms provider identity, size, and
  the app's expected SHA metadata, not a Google-computed content hash.

Recovery imports no credentials, callback values, cookies, or authorization headers. It invokes
neither yt-dlp nor FFmpeg, uploads nothing, calls no YouTube API, and has no remote-delete path.

## Automated validation

The recovery integration suite covers:

- Local preview before canonical mutation, valid import, title precedence, playlist recovery, FTS,
  planner reuse without `FORMAT_PROBE`/`DOWNLOAD_MEDIA`, and same-session reimport idempotency.
- Drive-only discovery, renamed root markers, pagination, provider-ID reconstruction, no video
  content fetch, and combined Local+Drive stable-ID merge.
- Hash-conflict warning, unsafe path isolation, unsupported versions, malformed-manifest sidecar
  fallback, and worker-restart transitions for interrupted scan/import.
- Drive list query fields/pagination and streaming oversized-sidecar rejection.
- standalone Drive OAuth after database loss without a YouTube scope or YouTube connection.

The repository validation commands are listed in `README.md`. Real Google Drive authorization and
provider behavior still require the manual smoke procedure below because automated tests use a
protocol-faithful fake endpoint.

## Manual destructive restore procedure

Always close the app and make a safety copy of the active user-data directory before moving its
`app.db`. Do not remove the encrypted credential directory unless the scenario explicitly tests a
fresh authorization.

1. Create and verify a representative Local backup, Drive-only backup, or both.
2. Close the app and copy `app.db`, `app.db-wal`, and `app.db-shm` (when present) to a separate
   safety directory.
3. Move the original database files out of the active user-data directory. Keep all backup media
   and sidecars unchanged.
4. Start the app, choose **Restore existing backup** or **Settings > Disaster recovery**, add the
   relevant sources, scan, review warnings, and confirm restore.
5. Verify Channels, Library search, playlists, Local copy state/Open Folder, and Drive state/Open
   in Drive. Disconnect and reconnect a Local disk to confirm search remains catalog-backed.
6. Reconnect YouTube only after catalog recovery if desired. Run Backup again and confirm verified
   recovered copies do not cause a YouTube re-download or unchanged Drive re-upload.
7. Repeat after renaming/moving the Drive root. For a damaged-backup case, safety-copy first, then
   remove one media object and corrupt one sidecar; healthy items must import and warnings must be
   actionable.

Restore the safety copy if the smoke test must be rolled back. These destructive real-profile
tests are intentionally not automated.

## Current limitations

- Initial recovery is a fast metadata/size pass; full content integrity remains a separate job.
- Multiple discovered Drive roots are shown with durable per-root selectors. Changing a selection
  returns the session to draft so a fresh preview contains only the chosen roots.
- The preview renders at most 200 detailed warning rows while retaining the full warning count in
  SQLite, preventing huge damaged archives from flooding the renderer.
