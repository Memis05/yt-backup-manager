# YouTube Backup Manager — Database Specification

Status: **Initial v1.0 schema contract**  
Database: **SQLite**  
ORM: **Drizzle ORM**  
Ownership: **Backup worker only**

> The schema may evolve through migrations, but its data model and invariants are normative. Codex must not bypass these invariants with ad-hoc JSON-only persistence.

---

## 1. Database role

SQLite is the operational catalog and durable job state.

It stores:

- connected account metadata;
- channel catalog;
- media catalog;
- playlist catalog;
- destination configuration;
- media-copy locations;
- hashes and verification state;
- backup runs;
- durable jobs;
- retry state;
- schedules;
- activity;
- settings.

SQLite is NOT the only backup source of truth.

Backup destinations also contain recoverable manifests and metadata.

---

## 2. Ownership rule

Only the headless backup worker opens the SQLite database.

The renderer does not open it.

The ordinary Electron main process does not directly mutate it.

All database access occurs through worker services/repositories.

This invariant must be enforced architecturally, not merely documented.

---

## 3. Location

Recommended logical path:

```text
%APPDATA%\YouTubeBackupManager\app.db
```

Application staging/cache should use local/non-roaming storage, e.g.:

```text
%LOCALAPPDATA%\YouTubeBackupManager\
```

Exact paths may use Electron path helpers, but:

- database location must be stable;
- staging must not accidentally roam;
- database must not be placed inside a backup destination;
- database must not be included in channel backup folders as the recovery mechanism.

---

## 4. SQLite configuration

At worker startup:

- enable foreign keys;
- use WAL mode if compatible with selected driver/runtime;
- configure a practical busy timeout;
- migrations run before worker accepts normal RPC;
- failed migration prevents backup execution and surfaces a clear error.

Recommended pragmas to evaluate:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

Do not blindly copy performance pragmas without understanding durability implications.

---

## 5. Time representation

Use UTC.

Store timestamps as one consistent representation across all tables.

Preferred:

- integer epoch milliseconds; or
- ISO UTC text.

Pick one during implementation and use it everywhere.

Do not mix formats.

UI converts to local timezone.

---

## 6. IDs

Internal primary keys:

- UUID/ULID/text IDs are acceptable.
- They are internal and do not become human-facing folder names.

External stable identity:

- YouTube channel -> provider + provider channel ID.
- YouTube media -> provider + provider media ID.
- YouTube playlist -> provider + provider playlist ID.
- Drive object -> provider file ID.

Never use title as identity.

---

## 7. Enums

Implement enums as validated text values unless a strong reason exists for integer mapping.

Application validation must reject unknown state transitions where required.

Core enums:

### Provider

```text
GOOGLE
YOUTUBE
```

Future-proof provider naming can distinguish auth provider from source provider.

### MediaType

```text
VIDEO
SHORT
LIVE
```

### SourceStatus

```text
AVAILABLE
PRIVATE
UNLISTED
REMOVED
UNAVAILABLE
UNKNOWN
```

`UNLISTED` may alternatively be represented as visibility metadata while `AVAILABLE` remains status. Choose one coherent model and document it.

### DestinationType

```text
FILESYSTEM
GOOGLE_DRIVE
```

Future:

```text
DROPBOX
ONEDRIVE
```

### DestinationAvailability

```text
AVAILABLE
DISCONNECTED
READ_ONLY
FULL
AUTH_REQUIRED
ERROR
UNKNOWN
```

### CopyStatus

```text
PENDING
TRANSFERRING
VERIFYING
VERIFIED
MISSING
CORRUPT
FAILED
UNAVAILABLE
```

### BackupRunTrigger

```text
MANUAL
CUSTOM_MANUAL
SCHEDULED
STARTUP
RECOVERY
REPAIR
VERIFY
```

### BackupRunStatus

```text
PENDING
RUNNING
PAUSED
COMPLETED
COMPLETED_WITH_ERRORS
FAILED
CANCELLED
INTERRUPTED
```

### JobStatus

```text
PENDING
READY
RUNNING
PAUSE_REQUESTED
PAUSED
RETRY_WAIT
CANCEL_REQUESTED
CANCELLED
COMPLETED
FAILED
INTERRUPTED
BLOCKED
```

### VerificationResult

```text
VERIFIED
MISSING
CORRUPT
UNAVAILABLE
ERROR
```

---

## 8. accounts

Represents a connected Google identity.

Columns:

```text
id                    TEXT PRIMARY KEY
provider              TEXT NOT NULL           -- GOOGLE
provider_account_id   TEXT                     -- stable Google subject ID if available
email                 TEXT
display_name          TEXT
avatar_url            TEXT

credential_ref        TEXT NOT NULL
capabilities_json     TEXT NOT NULL DEFAULT '{}'

connected_at          TIMESTAMP NOT NULL
last_auth_at          TIMESTAMP
last_error_code       TEXT
last_error_at         TIMESTAMP

created_at            TIMESTAMP NOT NULL
updated_at            TIMESTAMP NOT NULL
```

Do not store OAuth tokens here.

`credential_ref` points to encrypted credential storage.

`capabilities_json` can represent granted capabilities/scopes without storing secrets.

Indexes:

```text
UNIQUE(provider, provider_account_id) where provider_account_id not null
INDEX(email)
```

---

## 9. channels

Represents a YouTube channel available to a connected account.

```text
id                    TEXT PRIMARY KEY
account_id            TEXT NOT NULL REFERENCES accounts(id)

source_provider       TEXT NOT NULL           -- YOUTUBE
provider_channel_id   TEXT NOT NULL

title                 TEXT NOT NULL
handle                TEXT
thumbnail_url         TEXT

backup_enabled        INTEGER NOT NULL DEFAULT 0
source_status         TEXT NOT NULL DEFAULT 'AVAILABLE'

published_at          TIMESTAMP
first_seen_at         TIMESTAMP NOT NULL
last_seen_at          TIMESTAMP
last_sync_at          TIMESTAMP

created_at            TIMESTAMP NOT NULL
updated_at            TIMESTAMP NOT NULL
```

Constraint:

```text
UNIQUE(source_provider, provider_channel_id)
```

If multiple connected Google accounts can access the same YouTube channel, do not duplicate the logical channel.

If necessary, introduce `account_channels` mapping rather than weakening logical channel uniqueness.

Recommended normalized form:

### account_channels

```text
account_id
channel_id
relationship_metadata_json
created_at
```

Unique:

```text
(account_id, channel_id)
```

If implemented, remove direct ownership assumptions from `channels.account_id`.

This normalized mapping is preferred because agencies may have multiple identities with access to the same channel.

---

## 10. media_items

Canonical logical media table.

```text
id                    TEXT PRIMARY KEY
channel_id            TEXT NOT NULL REFERENCES channels(id)

source_provider       TEXT NOT NULL           -- YOUTUBE
provider_media_id     TEXT NOT NULL

media_type            TEXT NOT NULL           -- VIDEO/SHORT/LIVE

title                 TEXT NOT NULL
original_title        TEXT NOT NULL
source_url            TEXT NOT NULL

visibility            TEXT
source_status         TEXT NOT NULL DEFAULT 'AVAILABLE'

published_at          TIMESTAMP
duration_seconds      INTEGER

thumbnail_url         TEXT

first_seen_at         TIMESTAMP NOT NULL
last_seen_at          TIMESTAMP
removed_at            TIMESTAMP

metadata_version      INTEGER NOT NULL DEFAULT 1

created_at            TIMESTAMP NOT NULL
updated_at            TIMESTAMP NOT NULL
```

Constraint:

```text
UNIQUE(source_provider, provider_media_id)
```

Important:

- source identity never changes because title changes;
- folder path is not stored here as canonical identity;
- current source metadata is stored here;
- storage-specific details belong in `media_copies`.

Indexes:

```text
INDEX(channel_id, published_at DESC)
INDEX(channel_id, media_type)
INDEX(source_status)
INDEX(last_seen_at)
```

---

## 11. media_metadata_history

Stores meaningful metadata changes, not every polling snapshot.

```text
id                    TEXT PRIMARY KEY
media_item_id         TEXT NOT NULL REFERENCES media_items(id)

change_type           TEXT NOT NULL
old_value_json        TEXT
new_value_json        TEXT NOT NULL

captured_at           TIMESTAMP NOT NULL
backup_run_id         TEXT REFERENCES backup_runs(id)
```

Example `change_type`:

- TITLE_CHANGED
- THUMBNAIL_CHANGED
- SOURCE_STATUS_CHANGED

Do not create a row if nothing changed.

Index:

```text
INDEX(media_item_id, captured_at DESC)
```

---

## 12. playlists

```text
id                    TEXT PRIMARY KEY
channel_id            TEXT NOT NULL REFERENCES channels(id)

source_provider       TEXT NOT NULL
provider_playlist_id  TEXT NOT NULL

title                 TEXT NOT NULL
source_status         TEXT NOT NULL DEFAULT 'AVAILABLE'

first_seen_at         TIMESTAMP NOT NULL
last_seen_at          TIMESTAMP
removed_at            TIMESTAMP

created_at            TIMESTAMP NOT NULL
updated_at            TIMESTAMP NOT NULL
```

Constraint:

```text
UNIQUE(source_provider, provider_playlist_id)
```

Indexes:

```text
INDEX(channel_id)
INDEX(source_status)
```

---

## 13. playlist_items

Current playlist membership only.

```text
playlist_id           TEXT NOT NULL REFERENCES playlists(id)
media_item_id         TEXT NOT NULL REFERENCES media_items(id)

position              INTEGER
last_seen_at          TIMESTAMP

created_at            TIMESTAMP NOT NULL
updated_at            TIMESTAMP NOT NULL

PRIMARY KEY (playlist_id, media_item_id)
```

Playlist membership history is not versioned in v1.0.

Changes are recorded in Activity.

Never create another media file because a media item appears in multiple playlists.

---

## 14. destinations

Represents a configured storage destination.

```text
id                    TEXT PRIMARY KEY
destination_type      TEXT NOT NULL

account_id            TEXT REFERENCES accounts(id) -- Drive identity where applicable

root_path             TEXT                         -- filesystem
provider_root_id      TEXT                         -- Drive root folder ID

volume_guid           TEXT                         -- filesystem if available
volume_serial         TEXT
filesystem_type       TEXT
last_known_mount_path TEXT

credential_ref        TEXT                         -- if provider auth not shared through account
enabled               INTEGER NOT NULL DEFAULT 1

availability_status   TEXT NOT NULL DEFAULT 'UNKNOWN'
last_probe_at         TIMESTAMP
last_error_code       TEXT
last_error_at         TIMESTAMP

created_at            TIMESTAMP NOT NULL
updated_at            TIMESTAMP NOT NULL
```

Do not create a required user-defined display name field in v1.0.

Derived display labels can use:

- local path/volume;
- Google account identity;
- provider.

Indexes:

```text
INDEX(destination_type)
INDEX(account_id)
INDEX(volume_guid)
INDEX(volume_serial)
```

---

## 15. global_backup_settings

A singleton or key/value settings model can be used.

If normalized singleton:

```text
id                         INTEGER PRIMARY KEY CHECK(id = 1)

default_quality_profile    TEXT NOT NULL
default_schedule_id        TEXT REFERENCES schedules(id)

default_concurrent_downloads INTEGER NOT NULL
default_concurrent_local_copies INTEGER NOT NULL
default_concurrent_drive_uploads INTEGER NOT NULL

download_bandwidth_limit   INTEGER
upload_bandwidth_limit     INTEGER

created_at                 TIMESTAMP NOT NULL
updated_at                 TIMESTAMP NOT NULL
```

Destination defaults can use a mapping table.

### default_destinations

```text
destination_id
enabled
PRIMARY KEY(destination_id)
```

---

## 16. channel_settings

Per-channel overrides.

```text
channel_id                TEXT PRIMARY KEY REFERENCES channels(id)

quality_profile_override  TEXT
schedule_id_override      TEXT REFERENCES schedules(id)

created_at                TIMESTAMP NOT NULL
updated_at                TIMESTAMP NOT NULL
```

Null override means use global default.

### channel_destinations

```text
channel_id                TEXT NOT NULL REFERENCES channels(id)
destination_id            TEXT NOT NULL REFERENCES destinations(id)

enabled                   INTEGER NOT NULL DEFAULT 1

created_at                TIMESTAMP NOT NULL
updated_at                TIMESTAMP NOT NULL

PRIMARY KEY(channel_id, destination_id)
```

This table is authoritative for per-channel destination selection after global defaults are resolved into effective configuration.

Implementation may choose explicit inherited state, but behavior must be deterministic.

---

## 17. media_copies

Represents one physical/provider copy of one logical media item.

```text
id                    TEXT PRIMARY KEY
media_item_id         TEXT NOT NULL REFERENCES media_items(id)
destination_id        TEXT NOT NULL REFERENCES destinations(id)

relative_path         TEXT
provider_file_id      TEXT

container             TEXT
video_codec           TEXT
audio_codec           TEXT

width                 INTEGER
height                INTEGER
fps                    REAL

bytes                 INTEGER
sha256                TEXT

status                TEXT NOT NULL DEFAULT 'PENDING'

created_at            TIMESTAMP NOT NULL
updated_at            TIMESTAMP NOT NULL

verified_at           TIMESTAMP
last_checked_at       TIMESTAMP

missing_since         TIMESTAMP
corrupt_since         TIMESTAMP

last_error_code       TEXT
last_error_at         TIMESTAMP
```

Constraint:

A logical destination should normally have only one current canonical media copy for a media item.

Recommended:

```text
UNIQUE(media_item_id, destination_id)
```

If future versioning is introduced, schema must intentionally change rather than silently adding duplicates.

Indexes:

```text
INDEX(destination_id, status)
INDEX(media_item_id, status)
INDEX(status)
INDEX(provider_file_id)
```

`sha256` is the expected canonical hash for that copy.

Where all destination copies have identical bytes, hashes will match.

If a quality upgrade changes content bytes, the media copy record is updated only after new copy reaches verified state; do not destroy the last verified copy first.

---

## 18. media_artifacts

Recommended supporting table for non-video archived artifacts.

This prevents overloading `media_copies` if thumbnail/metadata verification later needs tracking.

```text
id                    TEXT PRIMARY KEY
media_item_id         TEXT NOT NULL REFERENCES media_items(id)
destination_id        TEXT NOT NULL REFERENCES destinations(id)

artifact_type         TEXT NOT NULL
                      -- VIDEO / THUMBNAIL / METADATA

relative_path         TEXT
provider_file_id      TEXT

bytes                 INTEGER
sha256                TEXT
status                TEXT NOT NULL

verified_at           TIMESTAMP
last_checked_at       TIMESTAMP

created_at            TIMESTAMP NOT NULL
updated_at            TIMESTAMP NOT NULL
```

Implementation decision:

- either model video inside `media_artifacts` too;
- or keep video in `media_copies` and use artifacts for sidecars.

Do not maintain conflicting truths in both.

The simpler v1.0 approach is acceptable if clearly documented.

---

## 19. backup_runs

One logical backup/verify/repair operation.

```text
id                    TEXT PRIMARY KEY
channel_id            TEXT REFERENCES channels(id)

trigger_type          TEXT NOT NULL
status                TEXT NOT NULL

effective_config_json TEXT NOT NULL

discovered_count      INTEGER NOT NULL DEFAULT 0
downloaded_count      INTEGER NOT NULL DEFAULT 0
local_copy_count      INTEGER NOT NULL DEFAULT 0
drive_upload_count    INTEGER NOT NULL DEFAULT 0
metadata_update_count INTEGER NOT NULL DEFAULT 0
failed_count          INTEGER NOT NULL DEFAULT 0

bytes_downloaded      INTEGER NOT NULL DEFAULT 0
bytes_transferred     INTEGER NOT NULL DEFAULT 0

started_at            TIMESTAMP
completed_at          TIMESTAMP

created_at            TIMESTAMP NOT NULL
updated_at            TIMESTAMP NOT NULL
```

Store the effective configuration snapshot so history remains understandable after user settings change.

Indexes:

```text
INDEX(channel_id, created_at DESC)
INDEX(status)
```

---

## 20. jobs

Durable queue table.

```text
id                    TEXT PRIMARY KEY
backup_run_id         TEXT REFERENCES backup_runs(id)
channel_id            TEXT REFERENCES channels(id)
media_item_id         TEXT REFERENCES media_items(id)
destination_id        TEXT REFERENCES destinations(id)

job_type              TEXT NOT NULL
status                TEXT NOT NULL

priority              INTEGER NOT NULL DEFAULT 0

attempt_count         INTEGER NOT NULL DEFAULT 0
max_attempts          INTEGER NOT NULL DEFAULT 5
next_retry_at         TIMESTAMP

progress_ratio        REAL
bytes_processed       INTEGER NOT NULL DEFAULT 0
bytes_total           INTEGER
speed_bytes_per_sec   INTEGER
eta_seconds           INTEGER

payload_json          TEXT NOT NULL DEFAULT '{}'
result_json           TEXT

idempotency_key       TEXT NOT NULL

lock_owner            TEXT
lease_until           TIMESTAMP
last_heartbeat_at     TIMESTAMP

error_code            TEXT
error_message_safe    TEXT

created_at            TIMESTAMP NOT NULL
started_at            TIMESTAMP
completed_at          TIMESTAMP
updated_at            TIMESTAMP NOT NULL
```

Constraint:

```text
UNIQUE(idempotency_key)
```

Indexes:

```text
INDEX(status, next_retry_at, priority DESC, created_at)
INDEX(backup_run_id, status)
INDEX(media_item_id, status)
INDEX(destination_id, status)
INDEX(lease_until)
```

`error_message_safe` must already be sanitized for persistence.

Never persist raw command output containing secrets.

---

## 21. job_dependencies

```text
job_id                TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE
depends_on_job_id     TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE

PRIMARY KEY(job_id, depends_on_job_id)
```

Rules:

- a job can become READY only when required dependencies are completed;
- failed/cancelled dependency can BLOCK dependent job;
- cycles are invalid and must be prevented by job planning.

Index:

```text
INDEX(depends_on_job_id)
```

---

## 22. job_attempts

Recommended for diagnostics and history.

```text
id                    TEXT PRIMARY KEY
job_id                TEXT NOT NULL REFERENCES jobs(id)

attempt_number        INTEGER NOT NULL

worker_instance_id    TEXT

started_at            TIMESTAMP NOT NULL
finished_at           TIMESTAMP

result_status         TEXT
error_code            TEXT
error_message_safe    TEXT

created_at            TIMESTAMP NOT NULL
```

Do not store every progress event here.

Progress belongs on current job state and structured log.

---

## 23. staging_artifacts

Tracks resumable local working files.

```text
id                    TEXT PRIMARY KEY
media_item_id         TEXT NOT NULL REFERENCES media_items(id)
job_id                TEXT REFERENCES jobs(id)

artifact_type         TEXT NOT NULL
path                  TEXT NOT NULL

bytes                 INTEGER
sha256                TEXT

state                 TEXT NOT NULL
                      -- PARTIAL / COMPLETE / VERIFIED / DELETE_PENDING

created_at            TIMESTAMP NOT NULL
updated_at            TIMESTAMP NOT NULL
```

This table allows safe cleanup after crashes.

Never delete a staging artifact merely because its job object is absent until a reconciliation pass proves it is orphaned.

---

## 24. schedules

```text
id                    TEXT PRIMARY KEY

schedule_type         TEXT NOT NULL
                      -- DAILY / WEEKLY / CUSTOM / STARTUP

config_json           TEXT NOT NULL

enabled               INTEGER NOT NULL DEFAULT 1

windows_task_id       TEXT

last_triggered_at     TIMESTAMP
next_expected_at      TIMESTAMP

created_at            TIMESTAMP NOT NULL
updated_at            TIMESTAMP NOT NULL
```

Windows Task Scheduler remains execution mechanism for closed-UI scheduled runs.

DB is the app's configuration truth.

---

## 25. integrity_checks

Represents checks at copy/artifact level.

```text
id                    TEXT PRIMARY KEY
media_copy_id         TEXT REFERENCES media_copies(id)
media_artifact_id     TEXT REFERENCES media_artifacts(id)
destination_id        TEXT NOT NULL REFERENCES destinations(id)

expected_sha256       TEXT
actual_sha256         TEXT

expected_bytes        INTEGER
actual_bytes          INTEGER

result                TEXT NOT NULL

started_at            TIMESTAMP NOT NULL
completed_at          TIMESTAMP

error_code            TEXT
error_message_safe    TEXT

created_at            TIMESTAMP NOT NULL
```

Require exactly one target (`media_copy_id` or `media_artifact_id`) if both models are used.

Indexes:

```text
INDEX(destination_id, created_at DESC)
INDEX(media_copy_id, created_at DESC)
```

---

## 26. activity_log

User-visible current activity history.

```text
id                    TEXT PRIMARY KEY

event_type            TEXT NOT NULL
severity              TEXT NOT NULL DEFAULT 'INFO'

account_id            TEXT REFERENCES accounts(id)
channel_id            TEXT REFERENCES channels(id)
media_item_id         TEXT REFERENCES media_items(id)
playlist_id           TEXT REFERENCES playlists(id)
destination_id        TEXT REFERENCES destinations(id)
backup_run_id         TEXT REFERENCES backup_runs(id)
job_id                TEXT REFERENCES jobs(id)

summary               TEXT NOT NULL
details_json          TEXT NOT NULL DEFAULT '{}'

created_at            TIMESTAMP NOT NULL
```

Examples:

- MEDIA_DISCOVERED
- TITLE_CHANGED
- THUMBNAIL_CHANGED
- MEDIA_REMOVED_FROM_SOURCE
- PLAYLIST_REMOVED_FROM_SOURCE
- PLAYLIST_MEMBERSHIP_CHANGED
- BACKUP_STARTED
- BACKUP_COMPLETED
- JOB_FAILED
- DESTINATION_DISCONNECTED
- DESTINATION_RECONNECTED
- INTEGRITY_CORRUPT
- REPAIR_COMPLETED
- AUTH_REQUIRED

`details_json` must be sanitized.

Indexes:

```text
INDEX(created_at DESC)
INDEX(channel_id, created_at DESC)
INDEX(media_item_id, created_at DESC)
INDEX(severity, created_at DESC)
```

---

## 27. app_settings

Use either normalized settings table or typed settings service.

If key/value:

```text
key                   TEXT PRIMARY KEY
value_json            TEXT NOT NULL
updated_at            TIMESTAMP NOT NULL
```

Every key must have a code-defined schema.

Do not allow arbitrary unvalidated JSON settings.

Potential keys:

- notifications;
- start_with_windows;
- start_minimized;
- yt_dlp_channel;
- last_update_check;
- diagnostics_preferences.

Secrets do not belong here.

---

## 28. FTS search

Use SQLite FTS5 if available in bundled SQLite.

Suggested virtual index:

```text
media_search
  media_item_id UNINDEXED
  title
  channel_title
  playlist_titles
```

Keep index synchronized intentionally.

Approaches:

- explicit application-level updates;
- database triggers.

Prefer the approach that is easiest to test and rebuild.

The FTS index is derived data.

Provide a command/service to rebuild it.

Search results then join back to canonical tables.

Do not treat FTS as source of truth.

---

## 29. Migration strategy

All schema changes use versioned migrations committed to the repository.

Rules:

- migrations are deterministic;
- migrations are tested against previous release fixtures;
- never edit an already released migration;
- worker backs up database before risky migration if practical;
- migration failure stops worker from performing backups;
- UI receives actionable migration error.

Maintain a schema version.

Do not auto-delete a database because migration fails.

---

## 30. Transaction boundaries

Use transactions around logical atomic updates.

Examples:

### Discovery page ingestion

One bounded transaction may:

- upsert discovered media;
- update last-seen timestamps;
- upsert playlist membership for the page;
- record metadata changes.

Do not keep one transaction open across network calls.

### Mark copy verified

Atomically:

- update copy hash/size/status;
- update verification timestamps;
- complete verification job;
- write activity when needed.

### Claim job

Atomically:

- select eligible READY job;
- set RUNNING;
- assign lock owner;
- set lease;
- increment appropriate attempt state.

Prevent two execution loops from claiming same job.

---

## 31. Idempotency invariants

The DB must support safe retries.

Examples:

Media discovery:

```text
UNIQUE(source_provider, provider_media_id)
```

Playlist:

```text
UNIQUE(source_provider, provider_playlist_id)
```

Playlist membership:

```text
PRIMARY KEY(playlist_id, media_item_id)
```

Media copy:

```text
UNIQUE(media_item_id, destination_id)
```

Jobs:

```text
UNIQUE(idempotency_key)
```

Job planner should construct deterministic keys such as conceptually:

```text
download:<media-id>:<quality-generation>
copy:<media-id>:<destination-id>:<content-hash>
verify:<copy-id>:<expected-hash>
manifest:<channel-id>:<generation>
```

Exact format is implementation-owned but must be deterministic.

---

## 32. Source deletion semantics

During a completed authoritative source inventory:

Known media not seen must not immediately be hard-deleted.

Use a robust removal determination strategy.

Once considered removed/unavailable:

```text
media_items.source_status = REMOVED/UNAVAILABLE
removed_at = ...
```

Never cascade delete `media_copies`.

Archived copies stay in catalog.

Same rule for playlists.

---

## 33. Title changes

When source title changes:

Transactionally:

1. insert `media_metadata_history` if value differs;
2. update `media_items.title`;
3. update relevant metadata-generation marker;
4. create metadata sidecar update jobs;
5. create Activity event.

Do not change logical media ID.

Do not automatically rename folder path.

---

## 34. Copy verification state

A copy becomes `VERIFIED` only after:

- transfer is complete;
- expected final file exists;
- expected byte count is valid where known;
- SHA-256 verification passes.

Never mark copy verified because provider returned HTTP success alone.

For Drive, local hash comparison may need remote verification metadata plus controlled upload result. If Drive cannot provide SHA-256 itself for all cases, persist the expected SHA-256 from the verified source and verify what the API can guarantee.

Document any provider-specific verification strength.

---

## 35. Recovery import

Recovery importer should use an isolated staging model before merging into canonical DB.

Suggested flow:

1. scan destination;
2. parse version/manifest;
3. validate schemas;
4. build import candidates;
5. detect conflicts;
6. merge transactionally in batches;
7. rebuild FTS;
8. optionally enqueue integrity checks.

Recovery must be able to merge another destination into existing catalog without duplicating logical media.

---

## 36. Database pruning

Do not implement aggressive pruning initially.

Safe candidates later:

- old completed job detail;
- old progress telemetry;
- obsolete staging records;
- excessive attempt history.

Never prune:

- canonical media;
- current copies;
- current playlist structure;
- hashes needed for verification;
- backup run summary without explicit retention design;
- activity required for user-visible audit unless policy is added.

---

## 37. Required schema tests

At minimum:

- duplicate media discovery upserts one row;
- same video in five playlists remains one `media_items` row;
- title update creates change record;
- source removal does not delete copies;
- same external drive with changed letter resolves to one destination;
- job idempotency prevents duplicate transfer job;
- foreign keys reject orphan copies;
- job claim is atomic;
- expired job lease can recover;
- FTS rebuild produces expected results;
- database migration from previous fixture works;
- recovery merge from two destinations produces one logical media item.

---

## 38. Schema implementation note for Codex

Before generating Drizzle schema:

1. create the enum constants in a shared package;
2. create migrations;
3. create repository/service layer;
4. do not expose raw ORM objects directly to renderer IPC;
5. map persistence records to typed domain DTOs;
6. add integration tests using temporary SQLite databases.

See `JOB-ENGINE.md` for job transition rules and `ARCHITECTURE.md` for process ownership.
