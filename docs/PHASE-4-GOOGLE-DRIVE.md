# YouTube Backup Manager — Phase 4: Google Drive Backup

Status: **Implementation specification for Phase 4**  
Target branch: `feat/google-drive-backup`  
Platform: **Windows 10/11**  
Source: **YouTube**  
Backup destinations after Phase 4: **Local filesystem and/or Google Drive**

> This document is normative for Phase 4. It extends the approved `MVP.md`, `ARCHITECTURE.md`, `DATABASE.md`, and `JOB-ENGINE.md`. Existing specifications remain authoritative unless this document explicitly narrows Phase 4 implementation scope.

---

## 1. Phase 4 objective

Phase 4 adds Google Drive as a first-class backup destination without changing the existing YouTube acquisition pipeline.

The user must be able to choose any non-empty destination combination.

### Mode A — Local only

```text
YouTube
  ->
yt-dlp / FFmpeg
  ->
verified staging
  ->
Local destination(s)
  ->
VERIFY
  ->
VERIFIED
```

### Mode B — Google Drive only

```text
YouTube
  ->
yt-dlp / FFmpeg
  ->
temporary verified staging
  ->
Google Drive
  ->
VERIFY
  ->
VERIFIED
  ->
cleanup staging
```

The application still requires temporary local staging because `yt-dlp`, FFmpeg, hashing, and resumable upload need a working file. Staging is **not** considered a local backup copy.

### Mode C — Local + Google Drive

```text
                         +-> Local destination -> VERIFY -> VERIFIED
YouTube -> staging ------+
                         +-> Google Drive ------> VERIFY -> VERIFIED
```

Acquisition occurs once.

### Mode D — Existing verified copy -> newly added destination

If a media item already has any usable verified copy, adding another destination must not cause an unnecessary YouTube re-download.

Examples:

```text
Verified Local
    ->
Google Drive
```

```text
Verified Google Drive
    ->
temporary local transfer staging
    ->
new Local destination
```

The second case may require downloading the verified Drive object into temporary staging before copying locally.

---

## 2. Non-negotiable destination semantics

Destination selection is independent.

A channel can have:

- one or more local destinations and no Drive;
- one or more Google Drive destinations and no permanent local destination;
- both local and Drive destinations.

The application MUST NOT require a local destination merely because Google Drive is enabled.

The application MUST NOT require Google Drive merely because local backup is enabled.

At least one effective destination must be selected before a backup can start.

`staging` is implementation infrastructure, not a user backup destination.

A Drive-only media item is successfully backed up when:

1. source acquisition/staging is verified;
2. Drive upload is complete;
3. Drive verification succeeds;
4. the Drive `media_copy` becomes `VERIFIED`;
5. required sidecars/manifest state are persisted;
6. staging can then be cleaned.

---

## 3. Phase 4 scope

Implement:

- Google Drive OAuth capability;
- Google Drive API v3 adapter;
- `drive.file` scope;
- Drive destination creation/configuration;
- multiple connected Google accounts capable of Drive storage;
- local-only, Drive-only, and Local+Drive backup modes;
- Drive application backup root folder;
- provider file/folder IDs;
- resumable uploads;
- persisted resumable-upload state;
- upload crash/restart recovery;
- provider rate-limit/retry handling;
- Drive quota/storage-space preflight where reliably available;
- Drive-side media copies;
- Drive sidecar/manifest copies;
- idempotent folder/file creation;
- duplicate prevention;
- safe replacement for changed metadata/thumbnail;
- Drive verification model;
- Drive copy status in Library/Video Details/Dashboard/Storage/Queue;
- existing Local -> Drive reuse without YouTube re-download;
- Drive-only first backup;
- Drive-only incremental backup;
- retry/resume after network loss;
- reauthorization and revoked-auth UX;
- Google Drive diagnostics;
- automated tests and failure injection.

Do not implement in Phase 4:

- Dropbox;
- OneDrive;
- S3/B2/WebDAV;
- scheduled backups / Windows Task Scheduler;
- full database restore/import from manifests;
- periodic integrity scheduler;
- complete repair-center UX;
- Google Drive file sharing;
- Shared Drives;
- arbitrary user-selected existing Drive folders unless explicitly required;
- Google Picker unless a blocker forces it;
- YouTube browser-cookie/private-media setup;
- subtitles/comments/analytics;
- YouTube write operations.

---

## 4. Google Drive policy release gate

Engineering work may proceed.

Public production release of Drive backup remains a separate compliance gate.

Current Google Drive API Terms state that using the Drive API to back up user/app content from a developer app or project to Drive requires Google's express prior written consent.

Do not remove, hide, or silently ignore this release gate.

References:

- https://developers.google.com/workspace/drive/api/terms
- https://developers.google.com/workspace/workspace-api-user-data-developer-policy

This gate must be documented in Phase 4 implementation notes and release checklist.

---

## 5. OAuth scope model

Existing Phase 2 Google authorization uses:

```text
openid
email
profile
https://www.googleapis.com/auth/youtube.readonly
```

Google Drive requires:

```text
https://www.googleapis.com/auth/drive.file
```

`drive.file` is the required Phase 4 Drive scope.

Do not use:

```text
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/drive.metadata
https://www.googleapis.com/auth/drive.metadata.readonly
```

unless an implementation blocker is demonstrated and explicitly approved.

---

## 6. Desktop OAuth and Drive authorization

Continue to use the approved Desktop/Installed App OAuth flow:

- system browser;
- authorization code;
- PKCE;
- cryptographic state;
- `127.0.0.1` loopback callback;
- ephemeral local port;
- no embedded Google login;
- no OOB flow;
- no client secret treated as confidential.

### Important: no silent incremental Installed-App authorization

Google documentation states that incremental authorization is not supported for installed/desktop applications.

Therefore Phase 4 MUST NOT assume it can silently append Drive permission to an existing Phase 2 credential.

When a user explicitly chooses to enable Google Drive backup for an account that currently has only YouTube scopes:

1. explain that additional Google Drive access is required;
2. start an explicit new Desktop OAuth authorization;
3. request the required combined scopes for that capability:
   - identity scopes;
   - `youtube.readonly`;
   - `drive.file`;
4. verify the returned Google identity matches the intended account;
5. replace/update the encrypted credential set only after the new grant succeeds;
6. update account capabilities/scopes;
7. retain the working previous YouTube credential if the Drive authorization is cancelled or fails.

Do not break local-only backup because Drive consent was rejected.

---

## 7. Account capabilities

A connected Google account must expose safe capability state, e.g.:

```text
YouTube access: Connected
Google Drive access: Connected
```

or:

```text
YouTube access: Connected
Google Drive access: Authorization required
```

The renderer never receives tokens.

Account capability examples:

```ts
{
  youtubeReadonly: true,
  driveFile: true
}
```

This is safe metadata, not credentials.

A Google Drive destination references the Google account whose Drive will hold the backup.

The source YouTube account and Drive destination account MAY be different connected Google accounts.

Do not assume:

```text
sourceAccountId === driveAccountId
```

---

## 8. Drive storage abstraction

Implement `storage-google-drive` behind the existing `storage-core` interface.

The job engine must not import Google SDK-specific implementation types.

Responsibilities:

- authenticate through privileged credential service;
- probe account/Drive availability;
- resolve/create application root;
- create channel/media folder hierarchy;
- upload files resumably;
- resume uploads;
- stat provider objects;
- detect missing provider objects;
- verify provider metadata;
- download a Drive copy to trusted staging when required;
- update metadata;
- classify Google errors;
- return typed provider IDs/results.

No Google Drive API calls from renderer.

---

## 9. Drive root folder

Phase 4 SHOULD create and manage an application-owned root in the selected user's My Drive.

Suggested name:

```text
YouTube Backup Manager
```

Inside:

```text
YouTube Backup Manager/
  BIT387 [UCxxxx]/
    Videos/
    Shorts/
    Live/
    Playlists/
    .ytbackup/
```

The logical hierarchy should mirror the human-readable local backup structure as closely as practical.

The app must store Drive folder IDs.

Names are display/organizational data.

IDs are canonical provider identity.

Do not rely on searching by name for every upload.

---

## 10. No arbitrary Drive folder picker in Phase 4

With `drive.file`, the app should use an application-created root.

To keep scope narrow and avoid Google Picker complexity, v1.0 Phase 4 should not add arbitrary browsing across an existing Drive.

Do not add broad Drive scope merely to let users browse all folders.

If an arbitrary existing folder is later desired, implement it through an appropriate Google-supported picker/share workflow in a separate scoped change.

---

## 11. Drive destination model

A Google Drive destination must persist at least:

```text
destination id
destination type = GOOGLE_DRIVE
Google account id
provider root folder id
enabled state
availability status
last probe
last error
```

`provider_root_id` is the canonical destination root.

Multiple Google Drive destinations SHOULD be architecturally supported.

Example:

```text
Google Account A Drive
Google Account B Drive
```

A channel could theoretically back up to both because they are separate destination records.

UI polish for many Drive destinations may remain simple.

---

## 12. Effective channel destination selection

Use existing global defaults + per-channel overrides.

Examples:

### Local only

```text
Channel A:
  [x] External HDD
  [ ] Google Drive
```

### Drive only

```text
Channel B:
  [ ] External HDD
  [x] Google Drive
```

### Both

```text
Channel C:
  [x] External HDD
  [x] Google Drive
```

### Multiple local + Drive

```text
Channel D:
  [x] D:\Backup
  [x] E:\Archive
  [x] Google Drive
```

The backup planner resolves the effective destination set once at run creation and snapshots it in the backup run configuration.

Changing settings while a run is active does not silently mutate that run's intended destination set.

---

## 13. Drive-only backup and staging

Drive-only backup MUST work.

Example:

```text
No permanent local destination configured.

YouTube
 -> staging on %LOCALAPPDATA%
 -> Drive upload
 -> Drive verify
 -> manifest/sidecars
 -> staging cleanup
```

Capacity preflight must consider local staging space even when no local backup destination exists.

If staging cannot hold the required media:

- Drive-only backup cannot proceed for that item;
- show actionable `STAGING_FULL` or equivalent;
- do not falsely suggest that Drive capacity alone is sufficient.

A Drive-only user must understand that temporary disk space is still needed during active backup.

---

## 14. Drive upload strategy

Use Google Drive API v3 resumable uploads for media.

Do not upload multi-GB video as one non-resumable request.

Upload flow:

```text
verified source
  ->
create/resume upload session
  ->
send chunks
  ->
Drive file created
  ->
persist provider file id
  ->
verify
  ->
media_copy VERIFIED
```

Google Drive resumable sessions return a session URI that can be queried to determine acknowledged bytes. Session URIs are temporary and may expire; the implementation must safely restart a session when required without producing duplicate files.

Chunked uploads must use Drive-compatible chunk sizes and streamed I/O.

---

## 15. Resumable upload state

Persist durable upload state sufficient to recover after:

- app close;
- worker crash;
- Windows restart;
- network disconnect;
- OAuth access-token refresh;
- temporary 429/5xx.

State MAY live in:

- `jobs.payload_json` / `result_json`;
- a dedicated transfer table if cleaner.

Persist at least what is needed to reconcile:

```text
job id
destination id
provider parent folder id
intended provider file id if known
resumable session URI/session state
bytes acknowledged by provider
expected total bytes
expected SHA-256
verified source reference
started/updated timestamps
```

Treat resumable session URIs as sensitive operational data.

Do not expose them to renderer/logs/manifests.

If a session is expired/invalid:

- reconcile whether a Drive file already exists;
- safely initiate a new session only when needed;
- do not create silent duplicates.

---

## 16. Streaming and progress

Use bounded streaming I/O.

Do not buffer complete media files in RAM.

Persist progress at throttled intervals.

UI can receive more frequent in-memory progress events.

Drive upload concurrency must be separate from:

- YouTube downloads;
- FFmpeg;
- hashing;
- local copies.

Default concurrency should be conservative.

---

## 17. Upload idempotency and duplicate prevention

A retry after an indeterminate timeout must not casually produce duplicate Drive files.

Use provider identity and idempotency strategies supported by Drive.

Required behavior:

Before creating a new remote media file, reconcile:

1. existing `media_copies.provider_file_id`;
2. persisted upload/session state;
3. known parent folder ID;
4. expected media identity/hash metadata where stored.

Never treat matching filename alone as proof of identity.

If a known provider file ID still exists and matches expected state, reconcile it.

If it no longer exists:

```text
Drive copy -> MISSING
```

and plan repair/re-upload.

---

## 18. Drive app metadata

Where useful and supported, application-created Drive objects SHOULD store app-specific metadata such as stable source identity using Drive app properties.

Examples conceptually:

```text
ytbmSchemaVersion
sourceProvider = youtube
providerMediaId = abc123
channelId = UCxxxx
artifactType = video
sha256 = ...
```

Do not put secrets in Drive metadata.

This metadata may help recovery/reconciliation but must not replace SQLite + manifest.

Do not depend solely on filename.

---

## 19. Drive verification model

The application's canonical content integrity value remains SHA-256 computed from the verified source/staging bytes.

Do not claim Google supplied SHA-256 if it did not.

After upload, verify at minimum:

- provider file ID exists;
- expected file size matches;
- expected provider metadata/parent relationship is known where appropriate;
- upload completed successfully.

Persist/document verification strength.

For strongest verification, a later/manual integrity path may download Drive bytes to temporary staging and calculate SHA-256 locally.

If Phase 4 does not re-download every newly uploaded file, do not imply that a full remote SHA-256 round-trip was performed.

---

## 20. Drive download as verified-copy source

Phase 4 must implement provider download capability because it is required for:

- Drive-only -> later Local destination;
- repair;
- future full integrity verification;
- future recovery.

Drive download flow:

```text
Drive provider_file_id
  ->
temporary staging file
  ->
stream SHA-256
  ->
compare expected SHA-256
  ->
staging VERIFIED
```

Only after local SHA-256 passes can downloaded Drive content be treated as a trusted source.

Do not stream a Drive object directly into a final local backup and mark it verified without local verification.

---

## 21. Reuse rules

### Local VERIFIED -> Drive missing

```text
Local VERIFIED
   ->
Drive upload
```

No YouTube download.

### Staging VERIFIED during new backup -> Local + Drive

Both branches use the same verified staging source.

### Drive VERIFIED, no local copy -> add Local

```text
Drive
 -> temporary staging download
 -> SHA-256
 -> staging VERIFIED
 -> local copy
 -> local verify
```

No YouTube download if Drive copy is trusted and available.

### Drive-only second backup

If Drive copy is already verified/current:

- no yt-dlp;
- no new upload;
- metadata/manifest update only if needed.

---

## 22. Folder/file identity on Drive

Provider IDs are canonical.

Persist appropriate IDs for:

- channel folder;
- category folders;
- media folder;
- video file;
- thumbnail file;
- metadata file;
- playlist file;
- manifest file.

If the user manually renames or moves an app-created Drive file/folder:

- provider ID remains identity;
- do not create a duplicate merely because path/name differs;
- reconcile current parent/name metadata where needed.

If the user deletes it:

- mark MISSING on probe/verification;
- do not delete other copies;
- allow repair/re-upload.

---

## 23. Drive sidecars

Google Drive backup must contain the same recoverable sidecar concept as local backup:

```text
video.*
thumbnail.jpg
metadata.json
playlist.json
.ytbackup/manifest.json
.ytbackup/version.json
```

A Drive-only backup must not rely on a local destination's manifest.

No credentials/session URIs in Drive sidecars.

Manifest update failure must not cause media re-download/re-upload.

---

## 24. Atomic/retry-safe sidecar replacement

Drive does not have local filesystem atomic-rename semantics.

For metadata/thumbnail/manifest updates:

- use known provider IDs;
- update safely;
- retain last known valid object until replacement/update is confirmed where practical;
- do not create endless duplicate sidecars;
- catalog points to intended provider file ID.

Sidecar updates are independent retryable work.

---

## 25. Drive capacity/quota

Implement best-effort Drive quota display/preflight if available without broader scope.

Do not request broad scopes merely to show capacity.

If quota cannot be obtained reliably with `drive.file`:

- report capacity as unknown;
- allow upload;
- classify quota-exceeded provider errors correctly.

Do not pretend capacity is known.

---

## 26. Rate limits and retries

Centralize Google Drive error classification.

Handle at least:

```text
401 access token expired
refresh failure / revoked auth
403 quota/storage/provider limits
429 rate limit
5xx transient provider failures
network timeout
connection reset
DNS/offline
resumable session invalid/expired
provider file missing
permission/access error
```

Use existing retry engine.

Respect `Retry-After`.

Use jitter.

Do not burn all attempts while system is offline.

A Drive branch failure must not fail a completed Local branch.

Example:

```text
Local: VERIFIED
Drive: FAILED / Needs attention
Backup run: COMPLETED_WITH_ERRORS
```

---

## 27. OAuth refresh/revocation

Access-token expiry should normally refresh transparently.

If Drive authorization is revoked:

- local backup remains usable;
- YouTube source access remains usable if still authorized;
- Drive destinations become `AUTH_REQUIRED`;
- Drive jobs become BLOCKED/Needs attention;
- do not delete local backups;
- do not burn retry attempts;
- user can explicitly reauthorize.

Renderer receives safe account state only.

---

## 28. Backup-run completion semantics

A run snapshots intended destinations.

### Local + Drive

```text
Local = VERIFIED
Drive = VERIFIED
=> COMPLETED
```

```text
Local = VERIFIED
Drive = terminal failure
=> COMPLETED_WITH_ERRORS
```

### Drive only

```text
Drive = VERIFIED
=> COMPLETED
```

A Drive-only run is not complete merely because staging is verified. Staging is not the requested permanent backup.

---

## 29. Job DAG additions

Existing acquisition DAG remains.

Drive adds a distribution branch.

```text
FORMAT_PROBE
    |
DOWNLOAD_MEDIA
    |
POST_PROCESS_MEDIA
    |
HASH_STAGING_MEDIA
    |
VERIFY_STAGING_MEDIA
    |
    +--------------------------+
    |                          |
    v                          v
COPY_TO_FILESYSTEM       UPLOAD_TO_GOOGLE_DRIVE
    |                          |
VERIFY_FILESYSTEM_COPY   VERIFY_GOOGLE_DRIVE_COPY
    |                          |
    +------------+-------------+
                 |
          UPDATE_METADATA
                 |
          UPDATE_MANIFEST
                 |
          CLEANUP_STAGING
```

Do not force a Local branch for Drive-only mode.

Cleanup waits until every selected branch no longer needs staging.

---

## 30. New/updated job types

Add durable job types as appropriate, for example:

```text
ENSURE_GOOGLE_DRIVE_ROOT
ENSURE_GOOGLE_DRIVE_FOLDER
UPLOAD_TO_GOOGLE_DRIVE
VERIFY_GOOGLE_DRIVE_COPY
DOWNLOAD_FROM_GOOGLE_DRIVE
RECONCILE_GOOGLE_DRIVE_OBJECT
UPDATE_GOOGLE_DRIVE_METADATA
UPDATE_GOOGLE_DRIVE_MANIFEST
```

Use existing state transition validator, leases, priority, pause/cancel, and retry logic.

Do not create a second queue.

---

## 31. Job idempotency

Example deterministic concepts:

```text
drive-root:<destination-id>
drive-folder:<destination-id>:<channel-id>:<logical-folder>
drive-upload:<media-id>:<destination-id>:<sha256>
drive-verify:<media-id>:<destination-id>:<provider-file-id>:<sha256>
drive-metadata:<media-id>:<destination-id>:<metadata-generation>
drive-manifest:<channel-id>:<destination-id>:<manifest-generation>
```

A worker restart must not create another video merely because an upload completion response was lost.

---

## 32. Database changes

Extend existing schema minimally.

Likely needs:

- Drive account capability state;
- Drive root/provider folder identity;
- resumable upload session state;
- provider verification details/strength;
- provider-specific artifact IDs.

Prefer migrations over ad-hoc JSON if data is operationally important.

Do not duplicate canonical media state.

`media_copies` remains one logical copy per:

```text
media item + destination
```

Drive copy uses:

```text
destination_type = GOOGLE_DRIVE
provider_file_id = ...
```

---

## 33. Storage UI

Update `Storage`.

Show Local and Drive destinations.

Example:

```text
External HDD (E:)
Available
1.2 TB free
```

```text
Google Drive
user@gmail.com
Connected
Backup root: YouTube Backup Manager
```

Actions:

- Add Google Drive;
- authorize Drive access;
- reconnect;
- disable/remove destination configuration;
- open Drive folder safely.

Removing a Drive destination configuration MUST NOT automatically delete Drive files.

---

## 34. Channel destination UI

Make the selected mode obvious.

Example:

```text
Backup destinations

[x] External HDD (E:)
[x] Google Drive — user@gmail.com
```

Drive-only:

```text
[ ] External HDD
[x] Google Drive — user@gmail.com
```

Local-only:

```text
[x] External HDD
[ ] Google Drive
```

If none:

```text
At least one backup destination is required.
```

Do not introduce a "primary destination".

All selected destinations are independent intended copies.

---

## 35. Backup Now / Custom Backup

Quick Backup uses saved effective destination configuration.

Custom Backup may temporarily choose Local, Drive, or both.

The run snapshots this selection.

Temporary custom selection does not overwrite persistent defaults unless explicitly saved.

---

## 36. Queue UI

Drive jobs display:

```text
Uploading to Google Drive
Video title
8.4 GB / 12.1 GB
69%
18.2 MB/s
ETA ...
```

States may include:

- Uploading
- Waiting for network
- Retry
- Auth required
- Verifying
- Completed
- Failed

Pause/cancel behavior must preserve resumable state where possible.

---

## 37. Video Details

Show each copy separately.

Example:

```text
Backup locations

External HDD
Verified
3840x2160
12.1 GB

Google Drive
Verified
12.1 GB
user@gmail.com
```

Drive-only media:

```text
Local backup: Not configured
Google Drive: Verified
```

Actions may include:

- Open local folder;
- Open on YouTube;
- Open in Google Drive;
- Verify;
- Retry failed Drive upload.

Do not expose provider IDs to normal UI.

---

## 38. Dashboard / health

Dashboard must correctly handle destination combinations.

Do not define success as "local file exists".

Examples:

Drive-only channel can be healthy if intended Drive copies are verified.

Local+Drive media may be:

```text
Local: Verified
Drive: Pending
```

No protection-policy feature.

---

## 39. Manifest behavior with multiple destinations

Each destination must contain enough independent recovery information.

Do not create a local manifest that is the only source describing Drive copies.

A future recovery importer must be able to discover:

- local backup independently;
- Drive backup independently;
- then merge them by stable media IDs.

This is critical for Drive-only users.

---

## 40. Security requirements

Never log/expose:

- access token;
- refresh token;
- authorization code;
- PKCE verifier;
- Authorization header;
- resumable upload session URI.

Drive adapter stays worker-side.

Renderer receives safe DTOs only.

Validate RPC input.

Open-in-Drive URLs must be constructed from trusted provider IDs or validated Google URLs.

Do not accept arbitrary browser URL from renderer.

Remote object names must not alter local staging paths unsafely.

---

## 41. Tests — OAuth/capability

Mandatory:

- YouTube-only account remains functional without Drive;
- enabling Drive requires explicit user action;
- failed/cancelled Drive authorization does not destroy working YouTube credential;
- successful authorization records `drive.file` capability;
- returned Google identity mismatch is rejected;
- tokens never enter SQLite/renderer/logs;
- revoked Drive auth blocks Drive jobs, not local jobs.

---

## 42. Tests — destination modes

### Local only

```text
Local selected
Drive not selected
=> no Drive jobs
=> local backup completes
```

### Drive only

```text
Drive selected
No local destination
=> staging acquisition
=> Drive upload
=> Drive verify
=> run completes
=> staging cleanup
=> no permanent local media_copy
```

### Local + Drive

```text
Both selected
=> acquisition happens once
=> two independent distribution branches
=> both verify
```

### No destination

```text
=> planner rejects backup start
```

---

## 43. Tests — reuse / incremental

Mandatory:

- Local VERIFIED -> add Drive -> no yt-dlp;
- Drive VERIFIED -> second Drive-only backup -> no yt-dlp/no upload;
- staging VERIFIED -> Local+Drive branches share source;
- Local VERIFIED + Drive failed -> retry Drive only;
- title-only change -> no video re-upload;
- thumbnail change -> update thumbnail only;
- source removed -> Drive copy preserved;
- same media in five playlists -> one Drive video object.

---

## 44. Tests — resumable upload

Failure injection:

- disconnect at 10%;
- disconnect at 50%;
- disconnect at 90%;
- worker kill at 50%;
- OAuth access token expires mid-upload;
- provider 429;
- provider 5xx;
- lost completion response;
- resumable session expires;
- app restarts with persisted session;
- provider file already exists on retry.

Expected:

- no duplicate verified Drive media;
- acknowledged progress reconciled;
- resume where valid;
- safe new session where invalid;
- no YouTube redownload if verified source still exists.

---

## 45. Tests — Drive object mutations

Simulate:

- user renames Drive video;
- user moves Drive video/folder;
- user deletes Drive video;
- user renames/moves root folder;
- stale stored provider ID;
- duplicate display names;
- wrong file exists under expected name.

Expected:

- provider ID survives rename/move;
- deletion -> MISSING;
- no duplicate based only on name;
- safe root reconciliation;
- no remote delete of unrelated file.

---

## 46. Tests — Drive download / repair source

Mandatory:

- Drive object downloads to temp staging;
- streamed SHA-256 matches expected -> trusted;
- mismatch -> CORRUPT/untrusted;
- corrupted Drive download never becomes Local VERIFIED;
- Drive VERIFIED -> new Local destination can be populated without YouTube;
- interruption during Drive download is safe/retryable.

---

## 47. Manual smoke test

Use a real Google account and real Drive.

### Test 1 — Local only regression

1. Select Local only.
2. Back up one media item.
3. Confirm no Drive jobs.
4. Run again and confirm no re-download.

### Test 2 — Drive only

1. Authorize Drive.
2. Configure Drive destination.
3. Deselect Local.
4. Select Drive only.
5. Back up one small media item.
6. Confirm Drive hierarchy.
7. Confirm media/thumbnail/metadata/manifest.
8. Confirm local staging cleanup.
9. Run again; no duplicate/re-upload.

### Test 3 — Local + Drive

1. Select both.
2. Back up new media.
3. Confirm one source acquisition.
4. Confirm Local VERIFIED.
5. Confirm Drive VERIFIED.

### Test 4 — Existing Local -> Drive

1. Use already Local VERIFIED media.
2. Enable Drive.
3. Run backup.
4. Confirm no yt-dlp.
5. Confirm upload uses existing verified local source.

### Test 5 — Network interruption

1. Start large Drive upload.
2. Disable network.
3. Restore network.
4. Confirm resume/retry without duplicate.

### Test 6 — Worker termination

1. Start large Drive upload.
2. terminate worker.
3. restart app.
4. confirm durable reconciliation/resume.

---

## 48. Packaging

Packaged application must support Drive without requiring:

- Google CLI;
- Google Drive Desktop;
- Node.js installation;
- extra backend/server.

Drive is API-based.

Official build uses project Google OAuth client configuration.

No client secret committed.

---

## 49. Diagnostics

Show only safe Drive diagnostics:

```text
Google Drive API: available
Account: user@gmail.com
Drive capability: granted
Root folder: configured
Active uploads: N
Last provider error: safe error code
```

No session URI/token/header/raw sensitive API response.

---

## 50. Phase 4 acceptance criteria

### Destination independence

- [ ] Local-only works.
- [ ] Drive-only works.
- [ ] Local+Drive works.
- [ ] Zero destinations is rejected.
- [ ] Staging is never shown as a permanent local backup.

### OAuth

- [ ] Existing YouTube account remains usable.
- [ ] Drive permission requested only after explicit user action.
- [ ] `drive.file` used.
- [ ] No broad Drive scope.
- [ ] Failed Drive consent does not break Local/YouTube.
- [ ] Credentials encrypted and renderer-safe.

### Drive

- [ ] App-created root works.
- [ ] Provider IDs persisted.
- [ ] Resumable large upload works.
- [ ] Worker crash/restart reconciles upload.
- [ ] Network interruption can resume/retry.
- [ ] Duplicate upload avoided.
- [ ] Rename/move does not create duplicate.
- [ ] Delete is detected as missing.

### Incremental/reuse

- [ ] Local VERIFIED can populate Drive without YouTube.
- [ ] Second Drive-only run does not redownload/reupload unchanged media.
- [ ] Local+Drive uses one acquisition.
- [ ] Failed Drive retry does not redo completed Local branch.

### Integrity

- [ ] Canonical SHA-256 retained.
- [ ] Drive verification semantics documented.
- [ ] Drive download can be SHA-256 verified before reuse as trusted source.

### Recovery readiness

- [ ] Drive-only backup contains metadata/playlist/manifest sidecars.
- [ ] No recovery-critical state exists only in a Local permanent backup.
- [ ] No secrets/session URIs in Drive backup.

### UI

- [ ] Storage shows Drive account/status.
- [ ] Channel settings support Local/Drive/both.
- [ ] Queue shows Drive upload progress.
- [ ] Video Details shows Drive copy status.
- [ ] Drive-only media is represented correctly.

### Validation

- [ ] repository-wide format check passes;
- [ ] lint passes;
- [ ] strict TypeScript passes;
- [ ] unit/integration tests pass;
- [ ] build passes;
- [ ] package:dir passes;
- [ ] packaged app smoke passes where environment allows;
- [ ] `git diff --check` passes;
- [ ] no Drive/YT write scopes introduced;
- [ ] no secrets in repository/log fixtures.

---

## 51. Recommended next phase

After Phase 4:

**Phase 5 — Full disaster recovery / manifest import**

Target:

```text
delete app.db
  ->
Restore existing backup
  ->
Local and/or Google Drive discovery
  ->
rebuild channels/media/playlists/copies
  ->
merge by stable provider IDs
```

This closes disaster recovery for Drive-only as well as Local users.

---

## 52. Phase 4 implementation record

Implemented on the `feat/google-drive-backup` branch without changing the approved root specifications.

### OAuth and account capability

Drive enablement is an explicit account action. The desktop installed-app flow requests this exact combined scope set:

```text
openid
email
profile
https://www.googleapis.com/auth/youtube.readonly
https://www.googleapis.com/auth/drive.file
```

The returned Google subject must match the selected existing account. The combined grant is stored in a separate encrypted Drive credential reference, so a cancelled, failed, mismatched, or later-revoked Drive grant does not replace the working YouTube credential. The renderer receives capability state and safe errors only; it never receives credentials.

### Drive archive layout

Each authorized Google account has one app-created My Drive root:

```text
YouTube Backup Manager/
  Channel Title [provider_channel_id]/
    Videos/
    Shorts/
    Live/
    Playlists/
    .ytbackup/
```

Media folders use `Title [provider_media_id]`. Media, thumbnails, metadata, playlist sidecars, manifests, and version sidecars are independently stored in Drive. Provider object IDs and stable `ytbmObjectKey` app properties are canonical; names and current parents are descriptive and reconciled after user rename/move.

### Destination modes and reuse

- Local-only writes and verifies only filesystem copies.
- Drive-only downloads to application staging, verifies the canonical SHA-256, uploads and verifies Drive, writes Drive recovery sidecars, and then cleans staging. Staging is not a destination.
- Local + Drive performs one source acquisition and fans the verified staging result into independent filesystem and Drive branches.
- A verified local copy can populate a missing Drive destination without yt-dlp.
- A verified Drive copy can populate a missing local or second Drive destination through a resumable temporary Drive download whose SHA-256 must match before it becomes a trusted source.
- A failed destination branch retries independently and does not invalidate an already verified sibling destination.

### Resumable upload and recovery

Large media uses Google Drive resumable upload sessions and 8 MiB chunks. SQLite stores the sensitive session URI, acknowledged byte offset, expected size/SHA-256, source reference, destination, media-copy identity, and last update time. This state remains worker-only and is never included in job result DTOs, renderer IPC, logs, sidecars, or Drive metadata.

On retry or worker restart, the provider first reconciles the persisted session offset. An expired session is replaced only after lookup by stable object key. A lost final response is reconciled by provider object ID/object key plus expected size and canonical SHA-256 app metadata, avoiding duplicate uploads.

### Verification semantics

`LOCAL_SHA256` means the final filesystem bytes were locally hashed. `PROVIDER_METADATA_SIZE` means Drive confirmed the provider file ID, expected byte length, expected media identity, and the app metadata containing the canonical SHA-256; it does not claim that Google computed SHA-256. `DOWNLOADED_SHA256` means a Drive object was downloaded to temporary staging and its bytes passed a local SHA-256 comparison before reuse.

### Automated failure injection

The fake Drive endpoint covers interruption/restart at 10%, 50%, and 90%, an expired resumable session, a lost final upload response, duplicate prevention, access-token refresh after 401, ranged download resume, and local SHA-256 verification. Planner/OAuth tests cover zero destinations, Drive-only, Local + Drive one-acquisition fan-out, Local -> Drive reuse, Drive -> Local reuse, Drive -> second Drive reuse, same-identity enforcement, and preservation of the existing YouTube credential after failed or cancelled Drive consent.

### Manual live smoke status

Automated fake-provider coverage is complete. A real Google Drive smoke test requires a developer-owned Desktop OAuth client with Drive API enabled and an explicitly authorized test account; it is not performed in credential-free CI. Before release, run the manual matrix in section 47 and record the Google Cloud project/client, test account, app version, Drive root provider ID, interruption/restart outcomes, and cleanup result without recording credentials or session URLs.

---

## 53. Google Drive public-release compliance gate

Drive backup must remain disabled in public production distribution until all of the following are complete and recorded by the release owner:

- Google has provided the express prior written consent required for Drive API backup use described in section 4;
- the production Google Cloud project, OAuth consent screen, verified domains, privacy policy, support contact, and requested scopes are release-ready;
- any Google OAuth verification or restricted/sensitive-scope review required for the production audience is complete;
- the production Desktop OAuth client configuration is injected outside source control and no client secret or user credential is present in the repository/package;
- the real-account manual smoke matrix in section 47 passes against the production-candidate build;
- the security searches and packaged validation checklist in section 50 pass;
- release notes accurately describe `drive.file`, the app-created-file boundary, verification strength, and the absence of automatic remote deletion.

Engineering completion does not clear this gate. Until the release owner records the approvals above, Google Drive support is development/test-only and is not approved for public release.
