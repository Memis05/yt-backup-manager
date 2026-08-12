# YouTube Backup Manager — Durable Job Engine Specification

Status: **v1.0 execution model**  
Persistence: **SQLite**  
Executor: **single backup-worker process with configurable internal concurrency**

> Reliability is more important than peak throughput. Every long-running operation must be resumable, retryable, or safely restartable.

---

## 1. Purpose

The job engine coordinates:

- YouTube discovery;
- metadata synchronization;
- yt-dlp downloads;
- FFmpeg processing;
- SHA-256 hashing;
- local copies;
- Google Drive uploads;
- verification;
- manifest updates;
- cleanup;
- repair;
- integrity scans.

A backup is NOT implemented as one giant `backupChannel()` call.

Long operations are explicit durable jobs.

---

## 2. Fundamental invariants

1. Job state is persisted before external side effects are considered complete.
2. A crash must not create a false `COMPLETED` state.
3. Retrying a completed side effect must be idempotent or first detect existing result.
4. One failed media item must not stop unrelated media.
5. One unavailable destination must not stop other destination branches.
6. Verified data is never deleted merely to make a retry easier.
7. Temporary/staging data is never considered a backup copy.
8. A media copy is `VERIFIED` only after content verification.
9. The worker is the only job-state authority.
10. Job planning itself must be idempotent.

---

## 3. Worker execution model

There is one worker process per Windows user.

The worker can execute multiple jobs concurrently within configured pools.

Example default pools:

```text
discovery:            1-2
downloads:            2
ffmpeg:               1
hashing:              1-2
local copies:         2
google drive uploads: 2
verification:         1-2
```

Exact defaults may be tuned.

Advanced settings may change concurrency.

Do not map one OS process to every job unnecessarily.

Use child processes only where appropriate:

- yt-dlp;
- FFmpeg.

---

## 4. Job states

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

Meaning:

### PENDING

Created but dependencies/configuration are not yet satisfied.

### READY

Eligible for claim.

### RUNNING

Actively owned by a worker execution slot.

### PAUSE_REQUESTED

User requested pause; executor is reaching safe stop point.

### PAUSED

No active work. Resumable state retained.

### RETRY_WAIT

Transient failure occurred; waits until `next_retry_at`.

### CANCEL_REQUESTED

Cancellation requested; executor is stopping safely.

### CANCELLED

No further work for this job unless user explicitly creates/restarts a new operation.

### COMPLETED

Job side effect and required persistence completed.

### FAILED

Terminal failure requiring attention or new planning.

### INTERRUPTED

Previously RUNNING lease expired or worker crashed.

### BLOCKED

Cannot proceed because dependency/destination/auth/config condition is unresolved.

---

## 5. Allowed transition model

Primary:

```text
PENDING -> READY
READY -> RUNNING
RUNNING -> COMPLETED
RUNNING -> RETRY_WAIT
RUNNING -> FAILED
RETRY_WAIT -> READY
```

Pause:

```text
READY -> PAUSED
RUNNING -> PAUSE_REQUESTED -> PAUSED
PAUSED -> READY
```

Cancel:

```text
PENDING -> CANCELLED
READY -> CANCELLED
PAUSED -> CANCELLED
RUNNING -> CANCEL_REQUESTED -> CANCELLED
```

Crash:

```text
RUNNING -> INTERRUPTED -> READY
```

Dependency/configuration:

```text
PENDING -> BLOCKED
BLOCKED -> READY
BLOCKED -> CANCELLED
```

Not every transition is legal.

Implement a centralized transition validator.

Do not let random services update `jobs.status` directly.

---

## 6. Job lease

When claiming a job, worker atomically sets:

```text
status = RUNNING
lock_owner = <worker-instance-id>
lease_until = now + lease-duration
last_heartbeat_at = now
```

Worker renews leases while job is active.

If a worker dies:

```text
status = RUNNING
lease_until < now
```

Recovery sweep changes:

```text
RUNNING -> INTERRUPTED
```

Then reconciliation decides:

- READY for safe retry/resume;
- BLOCKED if an external precondition is missing;
- FAILED if side effect cannot be safely reconciled.

Never have two executors own one job lease.

---

## 7. Job claiming

Claiming must be atomic.

Conceptual algorithm:

1. select highest-priority eligible READY job for a pool;
2. ensure dependencies completed;
3. ensure `next_retry_at <= now` if relevant;
4. write RUNNING/lease/owner atomically;
5. only then begin side effect.

Ordering:

- higher priority first;
- older created job as tie breaker.

User `Move to top` modifies priority, not row order hacks.

---

## 8. Job types

Initial job types:

### Discovery

```text
CHANNEL_SYNC
MEDIA_DISCOVERY
PLAYLIST_DISCOVERY
METADATA_REFRESH
SOURCE_RECONCILIATION
```

Implementation may combine some source API calls internally, but persistent state should still be understandable.

### Acquisition

```text
FORMAT_PROBE
DOWNLOAD_MEDIA
DOWNLOAD_THUMBNAIL
POST_PROCESS_MEDIA
HASH_STAGING_MEDIA
VERIFY_STAGING_MEDIA
WRITE_STAGING_METADATA
```

### Distribution

```text
COPY_TO_FILESYSTEM
UPLOAD_TO_GOOGLE_DRIVE
VERIFY_FILESYSTEM_COPY
VERIFY_GOOGLE_DRIVE_COPY
WRITE_DESTINATION_METADATA
UPDATE_MANIFEST
```

### Maintenance

```text
CLEANUP_STAGING
VERIFY_EXISTING_COPY
REPAIR_COPY
MIGRATE_COPY
RECOVER_DESTINATION
REBUILD_SEARCH_INDEX
```

Do not create dozens of micro-jobs for trivial in-memory operations. A durable job is warranted for operations with meaningful duration, external side effects, retry needs, or crash-recovery value.

---

## 9. Backup run planning

A `backup_run` is the user-visible operation.

Planner:

1. snapshot effective channel settings;
2. create backup run;
3. create discovery jobs;
4. discovery upserts source catalog;
5. planner evaluates each media item;
6. create only missing/needed job branches;
7. dependencies drive execution;
8. run completes after required branches settle.

A scheduled run and manual run use the same core planner.

Do not maintain separate backup logic for scheduler vs UI.

---

## 10. Per-media DAG

Typical new media:

```text
FORMAT_PROBE
    |
    v
DOWNLOAD_MEDIA
    |
    v
POST_PROCESS_MEDIA
    |
    v
HASH_STAGING_MEDIA
    |
    v
VERIFY_STAGING_MEDIA
    |
    +------------------------------+
    |                              |
    v                              v
COPY_TO_FILESYSTEM          UPLOAD_TO_GOOGLE_DRIVE
    |                              |
    v                              v
VERIFY_FILESYSTEM_COPY      VERIFY_GOOGLE_DRIVE_COPY
    |                              |
    +---------------+--------------+
                    |
                    v
              UPDATE_MANIFEST
                    |
                    v
              CLEANUP_STAGING
```

Sidecars may join branch as needed.

If only Local is selected, no Drive branch exists.

If only Drive is selected, a temporary staging download still exists until verified upload finishes.

---

## 11. Existing verified source optimization

Scenario:

```text
Media A:
  Local HDD -> VERIFIED
  Drive -> not configured

User adds Drive.
```

Planner must not create YouTube download job if an eligible verified local copy exists.

Instead:

```text
LOCAL VERIFIED COPY
       |
       v
UPLOAD_TO_GOOGLE_DRIVE
       |
       v
VERIFY_GOOGLE_DRIVE_COPY
```

Repair/source selection should rank healthy existing copies before source re-download where practical.

---

## 12. Discovery jobs

Discovery is paginated.

A channel with 50,000 items must not become one memory-heavy transaction.

Discovery requirements:

- bounded API pages;
- bounded DB transactions;
- progress where source API supports totals;
- restartable cursor/checkpoint where practical;
- rate-limit aware;
- idempotent upserts.

An interrupted discovery must be able to rerun safely.

Do not mark unseen source items removed until an authoritative inventory cycle completes sufficiently to make that decision.

---

## 13. yt-dlp adapter

`yt-dlp` is an external executable managed by a dedicated adapter.

The job engine must not parse arbitrary console text in UI code.

Adapter responsibilities:

- construct safe arguments;
- enforce destination under staging path;
- select format according to quality profile;
- request resumable download behavior;
- parse progress;
- classify known errors;
- expose child process cancellation/pause strategy;
- redact command lines before logging;
- manage authenticated cookies/session only through credential-safe APIs.

Never interpolate untrusted title text into a shell command.

Spawn executable with argument array, not shell command strings.

Do not enable `shell: true` unless there is an exceptional documented reason.

### Partial downloads

Keep `.part` or equivalent resumable files.

On normal retry/restart, resume.

Do not delete partials by default.

---

## 14. FFmpeg adapter

FFmpeg executes after source acquisition when needed.

Responsibilities:

- merge separate streams;
- remux without unnecessary quality loss;
- validate process exit;
- write output to temporary name;
- atomically promote completed output.

Do not overwrite a verified destination copy directly.

FFmpeg failure:

- preserve valid input partials;
- remove only clearly invalid temp output;
- retry according to classified error.

---

## 15. Staging lifecycle

Staging path is per media/job generation.

Example:

```text
...\staging\youtube\abc123\<generation>\
```

Possible states:

```text
PARTIAL
DOWNLOADED
POST_PROCESSED
HASHED
VERIFIED
DISTRIBUTING
CLEANUP_PENDING
```

A staging artifact is eligible as transfer source only in verified state.

Cleanup is its own idempotent operation.

Startup reconciliation scans staging records and filesystem.

If a file exists with no valid DB state:

- do not immediately delete;
- classify as orphan candidate;
- only clean when safe.

---

## 16. Hashing

Use SHA-256.

Hash streaming; never load large media fully into RAM.

The staging hash becomes canonical expected content hash for distribution.

For local copy verification:

- hash destination content and compare.

For Drive:

- persist canonical SHA-256;
- use API-returned size/provider checksum data where useful;
- document limitations of remote verification;
- never claim stronger verification than actually performed.

If a Drive copy is later downloaded for repair, verify SHA-256 locally before using as healthy repair source.

---

## 17. Local copy job

Safe local-copy algorithm:

1. verify destination availability;
2. check capacity;
3. create destination media folder;
4. copy to temporary filename;
5. flush/close;
6. hash temporary copy;
7. compare expected SHA-256;
8. atomically rename/promote to final filename;
9. update `media_copies` to VERIFIED;
10. enqueue/update manifest.

If crash occurs before step 9, DB must not claim verified.

Existing final file:

- if catalog says VERIFIED and expected identity matches, job is idempotently complete;
- otherwise verify before deciding whether to replace;
- never overwrite unrelated file based solely on same filename.

---

## 18. Google Drive upload job

Use resumable upload for large media.

Persist enough resumable session state if feasible/supported to continue after a process restart.

Upload algorithm:

1. verify Google account auth;
2. resolve application root/channel/media folders by provider IDs;
3. check existing `provider_file_id`;
4. if existing provider object represents expected content, reconcile instead of duplicate;
5. initiate/resume upload;
6. stream from verified source;
7. persist provider file ID;
8. validate returned metadata/size;
9. mark transfer complete;
10. run Drive verification step;
11. only then set copy VERIFIED.

Rate limits:

- respect `Retry-After` where provided;
- classify quota/rate-limit separately;
- use exponential/backoff policy;
- do not create upload storms after reconnect.

---

## 19. Provider ID rule

For Google Drive, display path/name is not canonical identity.

Persist `provider_file_id`.

If user moves an application-created file/folder in Drive:

- attempt to continue tracking by ID;
- update discovered parent/path metadata if needed;
- do not automatically re-upload just because textual path changed.

If provider ID no longer exists:

- status MISSING;
- plan repair/upload if desired.

---

## 20. Retry policy

Default transient schedule:

```text
attempt 1 -> wait 30 seconds
attempt 2 -> wait 2 minutes
attempt 3 -> wait 10 minutes
attempt 4 -> wait 1 hour
attempt 5 -> wait 6 hours
then -> FAILED / Needs attention
```

Use jitter around retries to avoid synchronized storms.

Provider-specific `Retry-After` overrides local delay when longer/required.

### Retryable examples

- network timeout;
- connection reset;
- temporary DNS failure;
- HTTP 429;
- HTTP 5xx;
- transient Drive error;
- temporary file lock;
- interrupted yt-dlp network operation.

### Blocked/wait examples

- external disk disconnected;
- auth required;
- browser session required;
- staging path unavailable.

### Terminal/non-blind retry examples

- disk full;
- invalid OAuth grant/revoked consent;
- source permanently removed;
- permission denied;
- malformed manifest;
- unsupported media condition requiring user action.

Centralize error classification.

Do not decide retry behavior by matching UI strings in multiple modules.

---

## 21. Error codes

Define typed error codes.

Initial categories:

```text
NETWORK_TIMEOUT
NETWORK_UNAVAILABLE
RATE_LIMITED
PROVIDER_5XX

AUTH_EXPIRED
AUTH_REFRESH_FAILED
AUTH_REVOKED
YOUTUBE_SESSION_REQUIRED
YOUTUBE_SESSION_INVALID

SOURCE_REMOVED
SOURCE_UNAVAILABLE
FORMAT_UNAVAILABLE

DESTINATION_DISCONNECTED
DESTINATION_READ_ONLY
DESTINATION_FULL
DESTINATION_PERMISSION_DENIED

DOWNLOAD_FAILED
FFMPEG_FAILED
HASH_FAILED

COPY_FAILED
UPLOAD_FAILED
VERIFY_FAILED
COPY_MISSING
COPY_CORRUPT

MANIFEST_INVALID
MANIFEST_WRITE_FAILED

DATABASE_ERROR
INTERNAL_ERROR
```

Each error type defines:

- retryable?
- default delay?
- blocks branch?
- requires user notification?
- safe user message.

Never surface raw secret-bearing provider errors directly.

---

## 22. Pause

User may pause:

- backup run;
- channel;
- individual job where meaningful.

Pause semantics:

### Pending/ready

Immediately -> PAUSED.

### Running download/upload/copy

Set PAUSE_REQUESTED.

Executor reaches a safe stop point and preserves resumable state.

Then -> PAUSED.

### FFmpeg/hash

If safe resumption inside operation is not supported, implementation may:

- stop operation safely;
- preserve required source inputs;
- restart that operation from beginning on resume.

Do not pretend an operation is byte-resumable when it is not.

---

## 23. Cancel

Cancel never deletes verified backups.

For active temporary work, user can choose where appropriate:

- keep partial for later;
- delete partial.

Job transitions to CANCELLED after process/stream stops.

Dependent jobs:

- become CANCELLED or BLOCKED according to run-cancel semantics.

Cancelling one Drive upload should not delete a verified local copy.

---

## 24. Reprioritization

Priority is an integer.

UI actions:

- Move to top.
- Increase priority.
- Decrease priority.

Reprioritization affects READY/PENDING ordering.

Do not terminate a RUNNING job simply because another job becomes higher priority unless explicit preemption is later designed.

---

## 25. Backup run completion

A run is not simply success/fail boolean.

Suggested resolution:

### COMPLETED

All intended in-scope jobs completed or were idempotently unnecessary.

### COMPLETED_WITH_ERRORS

Core run finished but one or more independent media/destination branches failed.

### FAILED

Run-level condition prevented meaningful execution, e.g.:

- database failure;
- source authorization unavailable before any useful work;
- invalid planner state.

### CANCELLED

User cancelled run.

A single failed video normally leads to `COMPLETED_WITH_ERRORS`, not `FAILED`.

---

## 26. Source removed behavior

If source sync determines media is removed:

- update source status;
- log Activity;
- do not create delete jobs for destinations;
- do not remove playlist historical archive files automatically;
- do not retry download indefinitely.

Existing copies remain searchable and repairable between destinations.

---

## 27. Metadata-only change

If title changes:

No `DOWNLOAD_MEDIA`.

Jobs may include:

```text
WRITE_STAGING_METADATA / destination metadata sidecar update
UPDATE_MANIFEST
```

Thumbnail changes may enqueue thumbnail acquisition/update.

Existing video bytes are untouched.

Existing media folder is not automatically renamed.

---

## 28. Quality upgrade

A quality profile has a generation/signature.

When user requests upgrade:

1. format probe current source;
2. determine if better eligible representation exists;
3. if not, no-op;
4. download new candidate to new staging generation;
5. verify;
6. distribute using safe replacement;
7. do not destroy old verified copy until replacement is verified.

If destination replacement fails, old verified copy remains.

---

## 29. Repair job

Inputs:

- target damaged/missing copy;
- candidate healthy copies;
- source availability.

Candidate source priority should generally be:

1. verified local copy;
2. other verified destination copy;
3. verified Drive copy downloaded and hash-checked;
4. YouTube re-download.

Exact cost-aware ordering may vary.

Before repair source is used, it must be trusted as verified.

Repair output undergoes normal verification.

---

## 30. Integrity scan planning

Manual/periodic integrity scan should not create one giant blocking job.

Planner enumerates copies and schedules bounded verification jobs.

Throttle to avoid saturating disk for normal user workloads.

User can:

- pause scan;
- cancel scan;
- prioritize backups over integrity scans.

Backup jobs should generally have higher default priority than periodic verification.

---

## 31. Destination disconnection

When filesystem operation detects drive missing:

Job -> BLOCKED with condition `DESTINATION_DISCONNECTED`.

Destination probe/watch can detect return.

When same volume identity returns:

```text
BLOCKED -> READY
```

Do not consume retry attempts every few seconds while disk is absent.

---

## 32. Authentication failure

### Access token expiry

Credential layer attempts refresh.

If refresh succeeds, job continues/retries transparently.

### Revoked OAuth grant

Mark account capability attention state.

Relevant jobs -> BLOCKED or FAILED-with-attention.

Notify user once, not per file.

After reauthorization, unblock jobs.

### YouTube authenticated session required

Public jobs should not be blocked by missing browser session.

Only media requiring it becomes BLOCKED/Needs authentication.

---

## 33. Network offline

Use shared connectivity/backoff signals to avoid every Drive job failing independently.

When system appears offline:

- allow local-only work that does not need network;
- network jobs wait;
- do not burn all retry attempts instantly.

On reconnect, release jobs gradually.

---

## 34. Capacity preflight

Before local transfer branch:

- probe destination;
- determine expected bytes if known;
- compare available space with safety margin.

If insufficient:

```text
DESTINATION_FULL
```

Block/fail branch with actionable UI.

Do not begin a 100 GB copy when only 20 GB are available if expected size is already known.

Staging itself also requires capacity checks.

---

## 35. Progress model

Job engine emits structured progress events.

Example:

```ts
{
  jobId,
  phase: "DOWNLOAD",
  bytesProcessed,
  bytesTotal,
  progressRatio,
  speedBytesPerSecond,
  etaSeconds,
  updatedAt
}
```

Throttle DB writes and UI events.

Do not write SQLite for every yt-dlp output line.

Use in-memory coalescing, e.g. persist at bounded intervals and important boundaries.

On crash, a small loss of progress telemetry is acceptable; loss of durable job state is not.

---

## 36. Worker event stream

UI subscribes to worker events through IPC.

Events:

- job.updated;
- job.completed;
- job.failed;
- backupRun.updated;
- destination.updated;
- account.updated;
- activity.created;
- integrity.updated.

UI should update optimistically only for trivial view state.

Operational state comes from worker.

On reconnect, UI must fetch a fresh snapshot instead of relying solely on missed events.

---

## 37. Scheduler interaction

Windows Task Scheduler triggers worker.

Worker converts schedule firing into the same backup-run planner used by UI.

No alternate "scheduler backup code".

If a channel already has an equivalent active backup:

- merge/suppress duplicate run as appropriate;
- do not download everything twice.

Use idempotency keys and active-run checks.

---

## 38. Startup recovery sweep

Every worker start performs reconciliation before claiming new jobs.

Steps:

1. acquire singleton.
2. open/migrate DB.
3. find expired RUNNING leases.
4. transition to INTERRUPTED.
5. reconcile staging artifacts.
6. reconcile provider transfer records where needed.
7. validate destination availability.
8. make resumable interrupted jobs READY/BLOCKED.
9. start scheduler/queue execution.

Do not delete partial files before reconciliation.

---

## 39. Idempotency examples

### Download

Before new download:

- inspect verified staging/final source state;
- if exact desired generation already verified, mark job complete.

### Local copy

If final path exists:

- verify identity/hash;
- if correct -> reconcile copy record and complete;
- if wrong -> do not blindly overwrite.

### Drive upload

If stored provider file ID exists:

- stat it;
- if expected object/content -> reconcile;
- if missing -> new upload;
- if conflicting -> safe replacement strategy.

### Manifest update

Write deterministic current manifest atomically.

Running twice produces same logical document.

---

## 40. Manifest update ordering

Do not update manifest to claim a destination copy exists before the copy is verified.

Correct:

```text
transfer
-> verify
-> database copy VERIFIED
-> manifest update
```

If manifest update fails after copy verified:

- copy stays verified in DB;
- manifest job retries;
- no media re-download.

---

## 41. Thumbnail and metadata jobs

Sidecars are independent from large video media.

A failed thumbnail update should not invalidate a verified video file.

Metadata sidecar should be written atomically.

Current source title belongs in metadata even if directory title is older.

Metadata should include:

- stable source media ID;
- current title;
- source URL;
- type;
- published time;
- archived media technical properties;
- selected quality profile;
- hash;
- backup/update timestamps;
- source status;
- playlist IDs/current membership references where appropriate.

Do not include secrets.

---

## 42. Playlist jobs

Playlist files are logical references.

`playlist.json` should include ordered stable media IDs.

A media appearing in multiple playlists does not create copy/download jobs per playlist.

Playlist removed from YouTube:

- mark source status removed;
- keep archived playlist JSON;
- update Activity;
- do not delete media.

---

## 43. Concurrency controls

Separate semaphores/pools per resource type.

Do not use a single global concurrency number.

Reasons:

- FFmpeg is CPU-heavy.
- hashing is disk-heavy.
- local copy is disk-heavy.
- downloads use network.
- Drive uploads use network/provider quota.

Default conservative.

Advanced settings configurable within sane bounds.

The planner may apply per-destination limits.

---

## 44. Bandwidth limiting

If supported reliably:

- download bandwidth limit passed through download engine;
- upload throttle applied to Drive stream.

Unlimited is allowed.

Bandwidth configuration changes should affect new/continuing operations safely.

Do not implement brittle user-space timing if provider/library already offers a reliable mechanism.

---

## 45. Logging

Structured logs with:

- timestamp;
- level;
- component;
- worker instance;
- job ID;
- run ID;
- media ID;
- safe error code.

Do not log:

- raw OAuth tokens;
- cookies;
- Authorization headers;
- full sensitive URLs;
- Google auth codes;
- secrets.

Child-process command logging must be redacted.

---

## 46. Testing strategy

Use fake clock to test retry delays.

Use fake providers to simulate:

- 429;
- 500;
- disconnect;
- slow stream;
- auth revoke;
- partial upload;
- provider object moved;
- provider object deleted.

Use temp files to simulate:

- partial yt-dlp output;
- hash mismatch;
- disk full where feasible/mocked;
- changed drive mount.

Crash tests should terminate worker at deterministic hooks.

---

## 47. Mandatory failure-injection tests

Before v1.0:

### Download

- kill at 10%;
- kill at 70%;
- network cut;
- yt-dlp process exits nonzero.

Expected: resume/retry, no duplicate verified copy.

### FFmpeg

- kill during merge.

Expected: inputs retained, temp output not promoted, retry safe.

### Hash

- kill midway.

Expected: hash job restarts, no false verified state.

### Local copy

- kill at 50%.

Expected: temp copy retained/reconciled, final not marked verified.

### Drive upload

- cut network;
- expire access token;
- return 429;
- kill worker mid-upload.

Expected: resumable/retry behavior without full channel restart.

### Manifest

- kill between temp write and replace.

Expected: old valid manifest remains or new valid manifest exists, never truncated canonical JSON.

### Worker

- launch two scheduled worker processes simultaneously.

Expected: only one owns queue.

---

## 48. Acceptance scenario

This is the minimum durable engine demonstration:

```text
1. Discover channel.
2. Plan one 4K/1080p media backup.
3. Start yt-dlp.
4. Kill worker at ~50%.
5. Restart worker.
6. Recover interrupted job.
7. Resume download.
8. FFmpeg completes.
9. SHA-256 staging verification passes.
10. Copy to external HDD.
11. Upload to Google Drive.
12. Verify each copy.
13. Write manifest.
14. Cleanup staging.
15. Modify one local byte.
16. Run integrity check.
17. Mark local copy CORRUPT.
18. Repair from healthy source.
19. Delete SQLite database.
20. Rebuild catalog from backup metadata/manifests.
```

The engine is not ready until this flow works consistently.
