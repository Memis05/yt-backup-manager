# YouTube Backup Manager — Phase 5: Disaster Recovery & Catalog Reconstruction

Status: **Implementation specification for Phase 5**  
Target branch: `feat/disaster-recovery`  
Recovery sources: **Local backup, Google Drive backup, or both**

> This document is normative for Phase 5 and extends the existing MVP, architecture, database, job-engine, and Phase 4 specifications.

## 1. Goal

Close the disaster-recovery loop.

After losing `app.db`, the user must be able to reconstruct the operational catalog from:

- Local backup only
- Google Drive backup only
- Local + Google Drive
- multiple local destinations
- multiple Google Drive destinations/accounts
- partially complete destinations

Recovery MUST NOT require re-downloading video from YouTube.

Recovery MUST NOT require a working YouTube connection just to reconstruct archived content.

Credentials, schedules, notification preferences, and UI preferences are intentionally not restored from backup.

## 2. Mandatory scenarios

### Local only

```text
app.db lost
-> Restore existing backup
-> select E:\YouTube Backup
-> scan manifest/metadata/playlists
-> rebuild SQLite
```

No Google login required.

### Google Drive only

```text
app.db lost
-> Restore existing backup
-> connect Google
-> discover app-created Drive backup
-> read Drive manifests/metadata
-> rebuild SQLite
```

Do not download full media during catalog reconstruction.

### Local + Drive

```text
Local scan + Drive scan
-> merge by stable YouTube IDs
-> one logical media item
-> multiple media_copies
```

### Partial sources

If Local contains 800 media and Drive contains 1,000, result is 1,000 logical media with copy records only where each destination actually contains them.

## 3. Recovery is a dedicated workflow

Recovery is not normal source sync.

Recovery MUST NOT:

- call yt-dlp
- run media acquisition
- upload media
- delete local backup files
- delete Drive objects
- modify YouTube
- automatically repair content during import
- import credentials from metadata

Recovery MAY:

- read filesystem backup data
- call Drive API to discover/read app-created backup objects
- download small JSON sidecars
- stat media
- rebuild SQLite/FTS
- optionally schedule verification after import

## 4. Stable identity

Never use title or folder name as identity.

Canonical identities:

```text
channel  = source_provider + provider_channel_id
media    = source_provider + provider_media_id
playlist = source_provider + provider_playlist_id
copy     = media_item + destination
```

For v1, source provider is YouTube.

Drive object identity is `provider_file_id`.

## 5. Recovery architecture

Create a worker-side recovery module/package, preferably:

```text
packages/recovery/
```

Suggested components:

- RecoveryCoordinator
- LocalBackupScanner
- GoogleDriveBackupScanner
- ManifestParser
- MetadataParser
- PlaylistParser
- RecoveryCandidateBuilder
- RecoveryConflictResolver
- RecoveryImporter
- RecoveryVerificationPlanner

Renderer must never parse arbitrary backup paths or Drive objects directly.

## 6. Two-phase design

### A — Scan / Preview

```text
select sources
-> scan
-> validate
-> persist candidates
-> detect warnings/conflicts
-> preview
```

No canonical catalog mutation yet.

### B — Import / Merge

```text
user confirms
-> bounded transactional merge
-> rebuild FTS
-> recovery summary
```

Do not build a 50,000-item restore as one giant in-memory object.

## 7. Recovery-session persistence

Use durable candidate/session tables or an equally robust persisted design.

Recommended concepts:

```text
recovery_sessions
recovery_sources
recovery_channels
recovery_media
recovery_playlists
recovery_playlist_items
recovery_copies
recovery_warnings
```

Session statuses:

```text
SCANNING
READY_FOR_REVIEW
IMPORTING
COMPLETED
COMPLETED_WITH_WARNINGS
FAILED
CANCELLED
```

Import must be resumable/idempotent after worker crash.

## 8. Local scanner

Use native folder picker and existing Phase 3 path hardening.

Scan:

```text
.ytbackup/version.json
.ytbackup/manifest.json
Videos/**/metadata.json
Shorts/**/metadata.json
Live/**/metadata.json
Playlists/**/playlist.json
actual media files
```

Requirements:

- root confinement
- no traversal
- no junction/reparse escape
- physical path validation
- strict JSON validation
- bounded JSON sizes
- malformed one-item metadata must not crash the full scan

Do not trust manifest-relative paths until resolved safely inside selected root.

## 9. Fast recovery vs full integrity

Default scan is fast.

Validate:

- manifest and sidecar schemas
- file existence
- expected size where known
- expected SHA-256 value from metadata
- relative path safety

Do NOT calculate SHA-256 for every multi-GB local file during initial restore.

After import the user can run full integrity verification.

Recovery must accurately preserve verification strength/timestamps and must not pretend a fresh hash was computed.

## 10. Google Drive recovery

After database loss, local Drive provider IDs are gone.

The application must rediscover the backup using Google Drive API with the existing `drive.file` capability.

Drive API `files.list` supports `drive.file`, and Drive search supports private `appProperties`. Use these to rediscover application-created backup objects.

Do not rely only on the folder name `YouTube Backup Manager`.

The user may rename or move it.

Preferred root markers:

```text
ytbm=1
ytbmObjectType=backup-root
ytbmSchemaVersion=1
```

Recommended stable appProperties:

### Channel

```text
ytbm=1
ytbmObjectType=channel
sourceProvider=youtube
providerChannelId=UC...
```

### Media/artifacts

```text
ytbm=1
ytbmObjectType=media|video|metadata|thumbnail
sourceProvider=youtube
providerChannelId=UC...
providerMediaId=...
```

### Playlist

```text
ytbm=1
ytbmObjectType=playlist
providerChannelId=UC...
providerPlaylistId=PL...
```

No secrets in appProperties.

## 11. Phase 4 backward compatibility

Support the actual Phase 4 Drive layout already implemented.

If existing Phase 4 objects do not contain enough appProperties for reliable DB-loss discovery, Phase 5 may add a backward-compatible metadata enhancement to existing app-created objects.

Do not re-upload video bytes just to add recovery metadata.

Do not require users to recreate Drive backups.

## 12. Drive discovery flow

```text
connect Google
-> authorize Drive capability
-> files.list with appProperties queries
-> find valid backup roots
-> list app-created hierarchy
-> fetch version/manifest/metadata/playlist JSON
-> stat video objects
-> build candidates
```

Initial Drive recovery MUST NOT download full videos.

Use:

- pagination
- selective `fields`
- bounded concurrency
- retries/backoff
- token refresh
- 429/5xx handling

If multiple valid backup roots exist, show them in preview and let the user select.

## 13. Manifest parser

Implement explicit schema-version parsing.

Current expected schema:

```json
{"schemaVersion":1}
```

Requirements:

- runtime validation
- unsupported schema -> actionable warning/error
- no code execution
- no prototype-pollution behavior
- bounded file size/depth
- no credential import
- safe forward-compatible handling of unknown fields
- no mutation of original backup during import

Normalize supported manifest versions into internal Recovery DTOs.

Manifest schema version is independent of application version.

## 14. Merge rules — channels/media/playlists

Channels merge by:

```text
YOUTUBE + provider_channel_id
```

Media merge by:

```text
YOUTUBE + provider_media_id
```

Playlists merge by stable provider playlist ID.

Same logical video on Local and Drive remains one `media_items` row.

A video appearing in five playlists remains one media item.

## 15. Merge rules — copies

Different destinations produce independent copies.

Example:

```text
Media A
  Local D:
  Local E:
  Google Drive:
```

Same media + same destination is reconciled, not duplicated.

Recovery may update an existing copy record if the candidate represents the same physical/provider copy.

## 16. Metadata conflicts

Never use title as identity.

Preferred metadata precedence:

1. existing catalog metadata if clearly newer
2. newest valid timestamped metadata sidecar
3. manifest metadata
4. folder title only as fallback

Do not replace fresh current source metadata with stale archive metadata.

Title changes must not create duplicate media.

## 17. Hash and quality conflicts

Different hashes do not automatically mean corruption.

First inspect:

- quality profile
- resolution
- codec
- container
- archive generation metadata

If same canonical copy unexpectedly has incompatible hashes and no legitimate quality explanation, produce:

```text
HASH_CONFLICT
```

Do not overwrite or delete either file during recovery.

Do not introduce full media-versioning as a new product feature in this phase.

## 18. Playlist reconstruction

Restore:

- playlist ID
- title
- source status
- ordered membership

Playlist JSON references stable media IDs.

If a playlist references media not present on that destination but found on another recovery source, merge correctly.

Unknown references become warnings rather than invented identities.

## 19. Source status

Do not call YouTube just to resolve source state during recovery.

Import archived source status/timestamps.

Future normal source synchronization can refresh it.

## 20. Destination reconstruction — Local

Create/reconcile Local destination records using:

- selected backup root
- volume GUID/serial/filesystem where available
- current mount
- availability state

Same physical drive should not become duplicate destination.

Ambiguous/conflicting volume identity must produce a warning/user decision.

## 21. Destination reconstruction — Drive

Create/reconcile:

```text
destination_type=GOOGLE_DRIVE
account_id=<authorized Google account>
provider_root_id=<discovered root>
```

Persist discovered Drive IDs for:

- root
- channel folder
- media/video
- thumbnail
- metadata
- playlists
- manifest/version artifacts

After recovery, Phase 4 operations must recognize these existing Drive objects and must not re-upload unchanged content.

## 22. Verification semantics after restore

Do not overstate verification.

Local fast restore can establish:

```text
manifest valid
file exists
size matches
expected SHA known
```

Drive can establish:

```text
provider ID exists
size/provider metadata match
expected SHA known from archive metadata
```

A fresh `DOWNLOADED_SHA256` or Local SHA-256 should only be recorded after those operations actually happen.

Use existing verification-strength fields.

## 23. Idempotency

Running the same recovery twice must not duplicate:

- channels
- media
- playlists
- destinations
- copies

Mandatory:

```text
Restore E:
-> 1000 media

Restore E: again
-> still 1000 logical media
```

Also test:

```text
Local -> Drive -> Local again
```

## 24. Import transactions and crash safety

Do not use one transaction for huge restore.

Use bounded batches.

No network/filesystem scan inside long DB write transaction.

If worker dies during import:

- committed canonical batches remain valid
- session remains resumable/re-runnable
- duplicate rows are prevented
- backup source is untouched

## 25. Cancellation

During scan:

- stop safely
- canonical catalog unchanged

During import:

- stop at safe batch boundary
- already imported rows valid
- re-run safe

Cancel never deletes backup data.

## 26. FTS

After import:

- rebuild/update FTS
- global Library search works
- channel filtering works
- playlist title search works

Search must continue working when a recovered external disk becomes disconnected.

## 27. Post-recovery operational requirement

Recovery must restore operational state, not just visual records.

After recovery:

- Library works
- Channels work
- Playlists work
- Local copy status works
- Drive copy status works
- Open Folder works
- Open in Drive works
- backup planner recognizes existing copies
- Local -> Drive reuse still works
- Drive -> Local reuse still works
- next Backup does not re-download/re-upload unchanged archived media

This is release-critical.

## 28. Credentials

Never restore credentials from:

- manifest
- metadata.json
- appProperties
- recovery tables

Local-only restore requires no Google login.

Drive restore requires normal Google authorization.

YouTube synchronization can be reconnected later.

## 29. Recovery UI

Provide:

```text
Welcome
[Set up new]
[Restore existing backup]
```

And Settings/Recovery entry.

Wizard:

### Step 1 — Sources

```text
[+ Local Backup]
[+ Google Drive Backup]
```

Multiple sources allowed.

### Step 2 — Scan

Progressive counts.

### Step 3 — Preview

```text
Channels: 2
Media: 1842
Playlists: 36

Copies:
Local: 1819
Google Drive: 1842

Warnings: 5
```

### Step 4 — Warnings

Grouped/actionable, not thousands of trivial prompts.

### Step 5 — Restore catalog

Explicit confirmation.

### Step 6 — Result

Show restored counts and items needing attention.

## 30. Typed warnings

At minimum:

```text
MANIFEST_MISSING
MANIFEST_INVALID
UNSUPPORTED_SCHEMA
METADATA_INVALID
PLAYLIST_INVALID
FILE_MISSING
SIZE_MISMATCH
HASH_CONFLICT
DUPLICATE_OBJECT
AMBIGUOUS_DESTINATION
DRIVE_ROOT_DUPLICATE
DRIVE_OBJECT_MISSING
DRIVE_AUTH_REQUIRED
PARTIAL_BACKUP
ORPHAN_MEDIA_FILE
ORPHAN_METADATA
UNSAFE_PATH
UNKNOWN_MEDIA_REFERENCE
```

Warnings must be safe DTOs.

## 31. Security

Treat all recovery inputs as attacker-controlled.

Test:

- `../`
- absolute paths
- junction/reparse escape
- malformed JSON
- huge JSON
- unexpected object shapes
- malicious URLs
- duplicate IDs
- prototype-pollution-like keys
- oversized Drive sidecars

Recovery never executes imported values.

Drive scanning is worker-only.

No arbitrary path/URL RPC.

No remote delete.

## 32. Performance

Support tens of thousands of media items.

Requirements:

- streaming directory traversal
- paginated Drive lists
- selective Drive fields
- bounded JSON fetches
- bounded concurrency
- persisted recovery candidates
- batch DB writes
- virtualized UI tables where needed
- no thumbnail/media bulk loading

## 33. Mandatory automated tests

### Local

- valid restore
- invalid manifest
- unsupported schema
- missing media
- size mismatch
- unsafe path
- junction/reparse escape
- malformed metadata
- malformed playlist
- old folder title vs current metadata title

### Drive

- renamed root found through appProperties
- moved root
- multiple roots
- pagination
- 429/5xx
- token refresh
- revoked auth
- malformed/oversized JSON
- provider IDs reconstructed
- no media download during initial scan

### Merge

- Local+Drive -> one media identity
- multiple Local copies
- partial source sets
- playlist merge
- title conflict
- hash conflict
- quality difference

### Idempotency/crash

- same Local restore twice
- same Drive restore twice
- Local -> Drive -> Local
- kill during scan
- kill during import
- resume/re-run
- FTS rebuild retry

### Operational

- restored Drive IDs can be stat/opened
- restored Local copy reused
- backup planner skips YouTube for unchanged recovered copy
- Library search works while Local disk disconnected

## 34. Manual destructive smoke tests

Always safety-copy the DB before destructive test.

### A — Local only

```text
create Local backup
-> close app
-> safety-copy/remove app.db
-> start app
-> Restore Local
-> no Google login
-> verify Library/Channels/Playlists
-> disconnect disk
-> Library search still works
-> reconnect
-> later connect YouTube
-> Backup again
-> no unnecessary redownload
```

### B — Drive only

```text
create Drive-only backup
-> safety-copy/remove app.db
-> start app
-> connect same Google account
-> discover Drive backup
-> restore without video downloads
-> verify provider IDs/status
-> Backup again
-> no duplicate upload/download
```

### C — Local + Drive

Recover both and verify one logical catalog with independent copies.

### D — renamed/moved Drive root

Rename or move root in Drive before DB loss.

Recovery must find it using app-created metadata, not exact name.

### E — damaged backup

Intentionally:

- delete one media file
- corrupt one metadata JSON
- alter one local media byte
- delete one Drive media object

Recovery must import healthy data and surface warnings without deleting anything.

## 35. Documentation

Add:

```text
docs/PHASE-5-DISASTER-RECOVERY.md
```

Document implementation, schemas, Drive discovery, merge rules, verification strength, security, performance, tests, manual restore, and limitations.

Do not modify approved root specifications.

## 36. Validation

Run:

- repository-wide format
- lint
- strict TypeScript
- unit/integration
- recovery tests
- Local scanner tests
- Drive scanner tests
- build
- package:dir
- packaged worker smoke
- packaged Electron E2E where environment permits
- `git diff --check`

Audit:

- recovery never invokes yt-dlp
- recovery never uploads media
- recovery never deletes backups
- no broad Drive scope
- no YouTube write scope
- no credentials imported/logged
- no generic path/URL RPC

## 37. Phase 5 acceptance criteria

- [ ] Empty DB -> Local restore works without Google.
- [ ] Empty DB -> Drive-only restore works without video download.
- [ ] Local+Drive merge works by stable IDs.
- [ ] Multiple destinations remain independent copies.
- [ ] Partial backups merge correctly.
- [ ] Same restore twice is idempotent.
- [ ] Crash during scan/import is safe.
- [ ] Unsafe/malformed input is isolated.
- [ ] FTS works after restore.
- [ ] Recovered Drive provider IDs are operational.
- [ ] Recovered Local volume/path state is operational.
- [ ] Subsequent backup does not re-download/re-upload unchanged media.

## 38. Recommended next phase

Phase 6:

**Scheduling, periodic integrity, notifications, and repair workflow**

Targets:

- Windows Task Scheduler
- daily/weekly/custom backup
- startup backup
- scheduled integrity verification
- destination reconnect behavior
- notification policy
- repair UI
- health summaries
