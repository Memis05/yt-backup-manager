# Phase 3: Durable Local Backup Acquisition

Phase 3 adds the first complete backup destination to the existing read-only
YouTube catalog. The backup worker remains the only SQLite owner. Electron main
and the renderer use narrow, schema-validated RPC operations; neither opens the
database or receives generic filesystem/process capabilities.

## Implemented architecture

The worker composes small packages with explicit responsibilities:

- `@ytbm/download-ytdlp`: managed executable discovery, read-only URL
  validation, format probing, resumable acquisition, progress parsing, and safe
  failure classification.
- `@ytbm/media-ffmpeg`: lossless stream merge/remux through temporary outputs.
- `@ytbm/integrity`: streaming SHA-256 hashing and verification.
- `@ytbm/storage-core`: destination, volume identity, probe, and copy contracts
  reusable by later storage providers.
- `@ytbm/storage-filesystem`: Windows volume detection, confined archive paths,
  destination preflight, temporary copy, verification, and atomic promotion.
- `@ytbm/manifest`: strict version-1 recovery schemas plus deterministic atomic
  JSON writes.
- `@ytbm/job-engine`: leased durable execution, dependency promotion,
  cancellation, pause/resume, retry/backoff, and bounded execution pools.
- `@ytbm/database`: job claiming and all local-backup/catalog persistence.

The runtime uses separate pools for probes, downloads, FFmpeg, hashing, local
copies, sidecars, manifests, and cleanup. A pending/running/retryable job keeps
the worker alive. SQLite state is authoritative; renderer polling is only a
view of durable state.

## Managed tools

Development tools live at:

```text
resources/yt-dlp/yt-dlp.exe
resources/ffmpeg/ffmpeg.exe
```

The binaries are intentionally ignored by Git, while
`resources/managed-binaries.json` pins their accepted versions and SHA-256
hashes. `package:dir` fails before building if either local managed binary is
missing, has the wrong hash, or reports a different version. The packaged files
are copied to deterministic locations outside ASAR:

```text
resources/yt-dlp/yt-dlp.exe
resources/ffmpeg/ffmpeg.exe
```

`YTBM_YTDLP_PATH` and `YTBM_FFMPEG_PATH` are privileged, absolute-path
development overrides. End users do not need Python, global yt-dlp, or global
FFmpeg. Automatic managed-tool updates are deferred.

Both adapters call `spawn` with argument arrays, `shell: false`, hidden Windows
processes, bounded captured output, and an `AbortSignal`. YouTube acquisition
accepts only HTTPS URLs on the explicit YouTube host allowlist and rejects
credentials in URLs. No renderer input can provide a process executable or raw
arguments.

## Quality mapping

The global default is `MAX_1080P`; a channel may inherit it or snapshot an
override in each backup run.

| UI label       | Stored value     | Video height rule |
| -------------- | ---------------- | ----------------- |
| Best available | `BEST_AVAILABLE` | no height cap     |
| Up to 4K       | `MAX_4K`         | at most 2160      |
| Up to 1080p    | `MAX_1080P`      | at most 1080      |
| Up to 720p     | `MAX_720P`       | at most 720       |

Within the cap, selection prefers height and then bitrate. If the chosen video
already has audio, it is downloaded as one representation. Otherwise the best
audio-only representation is acquired separately. FFmpeg uses stream copy: a
compatible WebM pair remains WebM, a compatible MP4/M4A pair becomes MP4, and
mixed codecs use MKV. Phase 3 does not perform lossy transcoding. Quality and a
`q1` generation are persisted on staging artifacts, media copies, jobs, and run
configuration so later quality-upgrade planning can distinguish generations.

## Durable job graph

For media without an existing verified source, the planner creates:

```text
FORMAT_PROBE
  -> DOWNLOAD_MEDIA
  -> POST_PROCESS_MEDIA
  -> HASH_STAGING_MEDIA
  -> VERIFY_STAGING_MEDIA
  -> COPY_TO_FILESYSTEM (one branch per destination)
  -> VERIFY_FILESYSTEM_COPY
  -> WRITE_DESTINATION_METADATA
  -> UPDATE_MANIFEST
  -> CLEANUP_STAGING
```

Thumbnail jobs are independent side branches and cannot invalidate a verified
media copy. Playlist sidecars are rebuilt by the manifest job. Dependencies and
generation-scoped idempotency keys prevent duplicate acquisition work.

Claims are atomic SQLite transactions that set `RUNNING`, assign a worker ID,
set a lease, increment the attempt count, and create an attempt-history row.
Heartbeats renew active leases. On startup, an expired `RUNNING` lease becomes
`INTERRUPTED`, then `READY`. Graceful shutdown also marks aborted active work
`INTERRUPTED`. The next worker safely claims it again.

Transient failures use jittered delays of 30 seconds, 2 minutes, 10 minutes,
1 hour, and 6 hours. Destination disconnects and authentication/session needs
block without burning retries. A periodic destination probe re-enables a local
branch when its stable volume identity returns. Permanent failures remain
visible and block only dependent branches; run reconciliation can report
`COMPLETED_WITH_ERRORS` for partial media failures.

Pause on queued work is immediate. Pause or cancel on active work first records
the requested state and then aborts the child/stream. Cancel supports keeping a
resumable partial or deleting the application-owned media staging directory.

## Staging and verification

Application-owned staging is confined below:

```text
<local application data>/staging/youtube/<provider-media-id>/<quality-generation>/
```

yt-dlp uses `.part`, `--continue`, `--part`, and `--no-overwrites`. Separate
source representations remain available if FFmpeg is interrupted. FFmpeg writes
a unique `.ytbm-tmp` result and promotes it only after a successful process.
When the format probe reports an expected size, the download job checks staging
capacity with a safety reserve before starting acquisition.

The final staging media is streamed through SHA-256, then read and verified a
second time. A destination copy is streamed to a deterministic temporary file,
flushed, verified by size and SHA-256, atomically renamed, and read/verified
again before `media_copies.status` becomes `VERIFIED`. A correct existing final
file is reconciled; a different file at the planned path is never overwritten.
Staging cleanup depends on completed destination manifests. Source removal never
deletes verified backup data.

## Local filesystem and volume identity

Adding a destination performs a write probe, capacity query, and Windows volume
identity lookup. The catalog stores volume GUID, serial, filesystem type, and
last known mount. If a removable disk changes drive letter, the provider searches
current Windows volumes and reconstructs the configured subdirectory below the
new mount.

Archive components replace Windows-invalid characters, remove control
characters and trailing dots/spaces, avoid reserved device names, and enforce a
bounded component length. Stable provider IDs remain in folder names, for
example:

```text
<root>/Channel Title [UC...]/Videos/Video Title [youtube-id]/video.webm
```

All derived paths are resolved and checked below their known destination or
staging root. Absolute input, traversal, and root-equality cases are rejected.

## Recovery manifests

Every verified media directory gets `metadata.json`. Playlist directories get
`playlist.json`. Each channel gets:

```text
.ytbackup/version.json
.ytbackup/manifest.json
```

Schemas are strict and explicitly versioned with `schemaVersion: 1`. The channel
manifest records stable provider IDs, relative media/metadata paths, bytes, and
SHA-256; playlist records refer to those same media IDs, so one media archive can
serve multiple playlists. JSON keys are sorted deterministically. Writes go to
a same-directory random temporary file, flush it, and atomically rename it, so a
crash cannot expose a truncated canonical JSON file. Full import/rebuild from
these manifests is a later phase; Phase 3 establishes the durable format.

## Desktop workflow

- **Storage** adds/disables local folders, shows volume identity, availability,
  and capacity, and controls the global quality default.
- **Channels** provides a direct Backup action.
- **Backup** configures per-channel quality and destination selection, starts a
  run, and displays history and aggregate counts.
- **Queue** shows durable status, progress, bytes, speed, ETA, attempts, safe
  errors, pause/resume, keep-or-remove cancellation, and priority controls.
- **Library** opens media backup details with copy status, destination path,
  format/resolution/quality, hash, and a narrowly scoped Open folder action for
  a worker-confirmed verified copy.

## Automated interruption coverage

The automated suites use fake process/storage adapters and small filesystem
fixtures. They cover atomic claim/priority, dependency completion and blocking,
lease recovery, transient retry, cancellation cleanup policy, worker restart,
partial download retention at 10/50/90 percent, FFmpeg failure/retry without
promotion, mid-hash abort, local-copy interruption, disconnect-after-preflight,
hash corruption, filesystem safety, manifest replacement failure, full/permission
errors, incremental reruns, second-destination reuse, and source-removal
preservation. The end-to-end worker integration executes the full fake-media
pipeline and proves the final copy, metadata, manifest, restart resume, and
second-run no-redownload behavior without network access or credentials. It also
proves that a known oversized acquisition fails before invoking the downloader.

## Manual real-media smoke test

This procedure is intentionally manual because CI must not require Google
credentials or real YouTube media.

1. Place the pinned managed executables under `resources/` and run
   `corepack pnpm package:dir` followed by `corepack pnpm test:package-smoke`.
2. Start the application and connect a Google account using the Phase 2 flow.
3. Sync a channel containing a small video.
4. In Storage, add an empty local folder and confirm it reports Available.
5. Open the channel Backup screen, choose **Up to 1080p**, select the destination,
   and start the backup.
6. Observe FORMAT, DOWNLOAD, processing, hash, copy, verification, metadata,
   manifest, and cleanup jobs in Queue. Pause and resume one queued or active job.
7. Open the Library item details. Confirm the copy is VERIFIED and use Open folder.
8. Play the final `video.*`; inspect `metadata.json`, `.ytbackup/version.json`, and
   `.ytbackup/manifest.json`.
9. Compute `Get-FileHash -Algorithm SHA256 <video-path>` and compare it to both
   the UI hash and manifest.
10. Run the same channel backup again and confirm no media download is queued.
11. Repeat with a larger video that has separate video/audio representations and
    confirm the final container plays with both streams.
12. During another real download, terminate the worker/application at roughly
    10%, restart, and confirm the partial resumes, no duplicate archive is made,
    and the final copy verifies.
13. During a destination copy, disconnect a removable destination. Confirm no
    VERIFIED status appears; reconnect the same volume (even on another drive
    letter) and confirm the branch resumes.

## Known limitations and deferred work

- Google Drive transfer and verification are Phase 4 work; the storage contract
  and DAG are shaped for an additional provider.
- The managed yt-dlp/FFmpeg auto-updater is deferred. Maintainers deliberately
  replace and re-pin ignored binaries; packaged users receive the bundled copies.
- Authentication for yt-dlp cases that require a browser session/cookies has no
  renderer flow yet. The job is safely blocked with a session-required error.
- Manifest-based database import/rebuild and periodic integrity audits are not
  exposed as user workflows yet.
- Windows is the supported v1 target. Filesystem fixtures run cross-platform,
  but volume GUID re-detection uses Windows PowerShell without shell execution.
