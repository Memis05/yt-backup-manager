# YouTube Backup Manager — Architecture Specification

Status: **Approved development blueprint for v1.0**  
Platform: **Windows 10/11 only**  
Architecture style: **local-first desktop application**  
Primary stack: **Electron + React + TypeScript + Node.js + SQLite**  
Primary source: **YouTube**  
v1.0 destinations: **Local filesystem + Google Drive**

> This document is normative. `MUST`, `MUST NOT`, `SHOULD`, and `MAY` describe implementation requirements. Codex should not replace major architectural decisions without an explicit project-owner decision.

---

## 1. Product intent

YouTube Backup Manager is a Windows desktop application for owners/managers of YouTube channels who want to maintain durable copies of their own channel content.

The application is not a generic YouTube downloader.

The application MUST:

- authenticate users through the application's Google OAuth client;
- discover only channels to which the authenticated Google account has access;
- treat YouTube as a read-only source;
- back up Videos, Shorts, completed livestream recordings, thumbnails, titles, and playlist structure;
- download the best available YouTube representation or a user-selected maximum quality;
- preserve multiple independent backup copies;
- maintain a local searchable catalog even when backup drives are disconnected;
- support incremental backup;
- survive app crashes, Windows shutdowns, internet failures, disconnected drives, and partial transfers;
- verify copies using SHA-256;
- reconstruct the local catalog from backup manifests after the local database is lost;
- never automatically delete an archived copy merely because the source disappeared from YouTube.

The application MUST NOT:

- edit a YouTube video;
- delete a YouTube video;
- upload a YouTube video;
- create, edit, or delete YouTube playlists;
- modify channel metadata;
- request YouTube write scopes;
- expose OAuth tokens, refresh tokens, browser cookies, or other credentials in logs, manifests, diagnostics, or UI;
- use a backend controlled by the project for ordinary application operation.

---

## 2. v1.0 architectural boundaries

### Included providers

Source:

- YouTube Data API for authenticated source discovery and metadata.
- `yt-dlp` for media acquisition.
- FFmpeg for stream merge/remux/post-processing where required.

Destinations:

- Local filesystem.
- Internal drives.
- External USB drives.
- Network paths exposed to Windows as normal filesystem paths, where available.
- Google Drive through a dedicated Google Drive storage adapter.

Not included in v1.0:

- Dropbox API.
- OneDrive API.
- S3.
- Backblaze B2.
- WebDAV.
- SFTP.
- NAS-specific APIs.
- macOS.
- Linux.

The provider interfaces MUST nevertheless be generic enough to add these later without rewriting the job engine.

---

## 3. Important Google Drive release gate

Engineering support for Google Drive belongs to v1.0.

Public release of the Google Drive backup feature MUST be treated as a compliance release gate.

Current Google Drive API Terms state that backup of user/app content from a developer application/project to Drive is not allowed without Google's express prior written consent.

Implementation work MAY proceed before this approval is obtained, but a public production release MUST NOT silently assume that this requirement does not exist.

Reference:

- https://developers.google.com/workspace/drive/api/terms
- https://developers.google.com/workspace/workspace-api-user-data-developer-policy

The adapter MUST use the narrowest practical scope. The intended scope is:

`https://www.googleapis.com/auth/drive.file`

Do not use the broad `drive` scope unless the project owner explicitly approves a justified change.

---

## 4. Google OAuth model

### 4.1 Official application credentials

The official application uses a Google OAuth client owned/configured by this project.

There MUST NOT be a normal end-user UI that asks users to paste their own Google Client ID or Client Secret.

The production Google OAuth Client ID SHOULD be injected at build/release time rather than committed as an editable end-user setting.

The public source repository MAY contain:

- placeholder configuration;
- development configuration hooks;
- documentation for maintainers.

A source checkout without a configured development OAuth client MAY have Google integration disabled.

The official release build MUST have the project OAuth client configured.

### 4.2 Native application authorization

Use Google's Desktop/Installed App authorization-code flow.

Requirements:

- system browser for authorization;
- PKCE;
- loopback redirect using `127.0.0.1` and an ephemeral local port;
- no embedded login page;
- no deprecated OOB/manual copy-paste flow.

Reference:

- https://developers.google.com/identity/protocols/oauth2/native-app

### 4.3 OAuth scopes

YouTube source scope:

`https://www.googleapis.com/auth/youtube.readonly`

Basic identity MAY use:

- `openid`
- `email`
- `profile`

Google Drive permission MUST be requested only when Drive functionality is configured, if incremental authorization can be implemented cleanly.

Drive scope:

`https://www.googleapis.com/auth/drive.file`

The application MUST NOT request:

- `youtube`
- `youtube.force-ssl`
- `youtube.upload`
- broad Drive scope unless a later documented requirement explicitly needs it.

### 4.4 Multiple Google identities

The architecture MUST support multiple connected Google identities.

A Google account can have capabilities such as:

- YouTube source access;
- Google Drive destination access;
- both.

A YouTube channel belongs to a connected Google account.

A Google Drive destination MUST reference the Google account whose Drive will hold the backup.

The schema and service layer MUST NOT assume that the Drive account must always be the same account that owns a YouTube channel.

---

## 5. Private/restricted YouTube content

Google OAuth access tokens are not to be treated as interchangeable with an authenticated YouTube web session for `yt-dlp`.

The application MUST model two separate authentication concepts:

1. Google API authorization.
2. Optional authenticated YouTube download session.

The UI SHOULD display these separately.

Example:

- Google API: Connected
- Authenticated YouTube download session: Not configured / Connected / Expired

For content requiring an authenticated browser session:

- the user explicitly enables browser-session access;
- browser/profile selection is explicit;
- cookies/session data MUST be treated as credentials;
- persistent session material MUST be encrypted at rest;
- session material MUST NOT be exported through diagnostics;
- the user SHOULD be warned that authenticated automated downloading can trigger YouTube anti-abuse protections.

If a public/unlisted video can be downloaded without session cookies, the download engine SHOULD avoid authenticated cookies for that item.

---

## 6. Process architecture

The application is distributed as one application but can run in two modes.

```text
YouTubeBackupManager.exe
    -> Electron desktop UI

YouTubeBackupManager.exe --worker
    -> headless backup worker

YouTubeBackupManager.exe --worker --scheduled
    -> headless mode initiated by Windows Task Scheduler
```

Conceptual topology:

```text
+--------------------------------------------------+
| Electron Renderer                                |
| React UI                                         |
|                                                  |
| Dashboard / Library / Channels / Queue / Storage |
| Activity / Integrity / Settings                  |
+--------------------------+-----------------------+
                           |
                     preload IPC only
                           |
+--------------------------v-----------------------+
| Electron Main Process                            |
|                                                  |
| windows / tray / notifications                   |
| safeStorage access                               |
| system integration                               |
| worker discovery and lifecycle                   |
+--------------------------+-----------------------+
                           |
                    local authenticated IPC
                           |
+--------------------------v-----------------------+
| Backup Worker                                     |
|                                                   |
| sole SQLite owner                                 |
| scheduler                                         |
| durable job engine                                |
| YouTube provider                                  |
| yt-dlp adapter                                    |
| FFmpeg adapter                                    |
| storage adapters                                  |
| manifest/recovery                                 |
| integrity engine                                  |
+-------------+----------------+-------------------+
              |                |
              v                v
        local filesystem    Google Drive
```

### 6.1 Worker owns persistence

The worker MUST be the sole process that opens and mutates the application SQLite database.

The renderer MUST NOT open SQLite.

The normal Electron main process MUST NOT directly mutate SQLite.

All catalog and job operations are worker APIs.

Examples:

- `channels.list`
- `library.search`
- `backup.start`
- `backup.pause`
- `jobs.reprioritize`
- `destinations.add`
- `integrity.start`
- `recovery.scan`

This creates one persistence authority and simplifies SQLite write locking, concurrency, and recovery.

---

## 7. Worker singleton and IPC

Only one worker per Windows user profile may own the application state at a time.

Implementation SHOULD use:

- an OS-level named mutex scoped to the current Windows user;
- a Windows named pipe for worker RPC/events;
- worker instance ID;
- heartbeat;
- graceful reconnect.

Example named pipe shape:

`\\.\pipe\ytbm-{userSid}`

The exact name MAY differ, but it MUST be user-scoped.

Startup behavior:

```text
Desktop opens
    |
    +-- worker already exists -> connect
    |
    +-- no worker -> spawn --worker -> connect
```

Scheduled start:

```text
Task Scheduler launches --worker --scheduled
    |
    +-- no worker -> acquire singleton -> run
    |
    +-- worker exists -> signal existing worker -> exit duplicate process
```

The application MUST NOT run two backup engines against the same database.

IPC messages MUST be validated with runtime schemas (Zod or equivalent).

Do not expose generic arbitrary execution primitives over IPC.

Bad:

- `runShell(command)`
- `executeSql(sql)`
- `readAnyFile(path)`

Good:

- `backup.start({channelId, mode})`
- `jobs.pause({jobId})`
- `library.search(filters)`

---

## 8. Electron security model

Renderer security is mandatory.

Required:

- `contextIsolation: true`
- renderer sandbox enabled
- Node integration disabled in renderers
- narrowly scoped preload bridge
- strict IPC allowlist
- CSP appropriate for packaged app
- navigation interception
- external links opened in system browser after URL validation
- no arbitrary remote code execution
- no remote pages receiving privileged preload APIs

The YouTube player/remote content MUST NOT receive privileged application APIs.

Use a separate unprivileged frame/webview strategy only if necessary and consistent with current Electron security guidance.

Reference:

- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/tutorial/context-isolation

---

## 9. Credential storage

Never store raw credentials in SQLite.

Credential types include:

- OAuth access token;
- OAuth refresh token;
- OAuth grant metadata where sensitive;
- persisted authenticated YouTube cookies/session;
- future storage-provider credentials.

Use Electron `safeStorage` / Windows DPAPI-backed encryption.

SQLite stores only references, for example:

```text
credential_ref = "google-oauth:01"
```

Encrypted credential blobs MAY be stored in an application credential file/store, but decryption MUST occur only in a privileged worker/main process.

Credentials MUST be redacted from:

- structured logs;
- error messages;
- diagnostics zip;
- activity records;
- manifest;
- `metadata.json`;
- crash reports;
- console output.

---

## 10. Repository structure

Target monorepo:

```text
youtube-backup-manager/
|
+-- apps/
|   +-- desktop/
|       +-- src/
|           +-- main/
|           +-- preload/
|           +-- renderer/
|           +-- worker-bootstrap/
|
+-- packages/
|   +-- core/
|   +-- database/
|   +-- job-engine/
|   +-- ipc/
|   +-- security/
|   +-- source-youtube/
|   +-- download-ytdlp/
|   +-- media-ffmpeg/
|   +-- storage-core/
|   +-- storage-filesystem/
|   +-- storage-google-drive/
|   +-- manifest/
|   +-- integrity/
|   +-- scheduler/
|   +-- diagnostics/
|   +-- shared/
|   +-- ui/
|
+-- resources/
|   +-- ffmpeg/
|   +-- yt-dlp/
|
+-- docs/
|   +-- ARCHITECTURE.md
|   +-- MVP.md
|   +-- DATABASE.md
|   +-- JOB-ENGINE.md
|
+-- scripts/
+-- .github/
|   +-- workflows/
|
+-- README.md
+-- CONTRIBUTING.md
+-- SECURITY.md
+-- package.json
+-- pnpm-workspace.yaml
```

Do not introduce Turborepo unless build performance later justifies it.

---

## 11. Technology decisions

Language:

- TypeScript with strict mode.

Desktop:

- Electron.

Renderer:

- React.
- Vite.
- Tailwind CSS.

Workspace:

- pnpm workspaces.

Validation:

- Zod or equivalent runtime schema validation.

Persistence:

- SQLite.
- Drizzle ORM.
- `better-sqlite3` unless an implementation-time evaluation identifies a concrete blocker.

Media download:

- bundled/managed `yt-dlp`.

Media processing:

- bundled FFmpeg.

Testing:

- Vitest for unit/integration.
- Playwright/Electron E2E where suitable.

CI/release:

- GitHub Actions.
- GitHub Releases.

Dependency versions SHOULD use compatible stable releases available at implementation time and MUST be locked by lockfile.

Do not add server infrastructure such as:

- Redis;
- RabbitMQ;
- PostgreSQL;
- Docker requirement;
- hosted job queue;
- hosted API backend.

---

## 12. Source provider abstraction

Core must not hardcode YouTube behavior throughout the application.

Conceptual contract:

```ts
interface SourceProvider {
  id: string;

  listAccounts(): Promise<SourceAccount[]>;
  listChannels(accountId: string): Promise<SourceChannel[]>;
  syncChannel(channelId: string): Promise<ChannelSyncResult>;
  getMedia(mediaId: string): Promise<MediaItem>;
  getPlaylists(channelId: string): Promise<Playlist[]>;
}
```

The first implementation is `YouTubeSourceProvider`.

It is composed from:

```text
YouTubeSourceProvider
|
+-- Google/YouTube Data API
|   +-- account identity
|   +-- owned/managed channels
|   +-- media inventory
|   +-- playlists
|   +-- metadata
|
+-- YouTubeDownloadEngine
    +-- yt-dlp
    +-- optional authenticated browser session
    +-- format selection
    +-- FFmpeg merge/remux
```

API discovery and media acquisition MUST remain separate modules.

---

## 13. Storage provider abstraction

Conceptual contract:

```ts
interface StorageProvider {
  readonly type: StorageProviderType;

  probe(destinationId: string): Promise<DestinationProbe>;
  getCapacity(destinationId: string): Promise<CapacityInfo | null>;

  putFile(input: PutFileInput): Promise<TransferResult>;
  getFile(input: GetFileInput): Promise<TransferResult>;

  stat(input: StorageObjectRef): Promise<StorageObjectStat | null>;
  verify(input: VerifyStorageObjectInput): Promise<VerificationResult>;

  move?(input: MoveObjectInput): Promise<void>;
  deleteTemporary?(input: StorageObjectRef): Promise<void>;
}
```

Implementations:

- `FilesystemStorageProvider`
- `GoogleDriveStorageProvider`

Future implementations:

- `DropboxStorageProvider`
- `OneDriveStorageProvider`
- `S3StorageProvider`
- `WebDavStorageProvider`

The job engine MUST depend on `storage-core`, not on provider-specific SDKs.

---

## 14. Google Drive storage behavior

Use the Drive API v3.

Prefer resumable uploads for media.

Reference:

- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create

The Drive adapter MUST:

- create/manage an application backup root folder;
- persist provider file IDs/folder IDs in SQLite;
- use provider IDs rather than paths as the primary Drive identity;
- survive a user moving an application-created file/folder inside Drive where provider identity remains valid;
- upload large files resumably;
- recover resumable upload jobs where supported;
- classify quota/auth/rate-limit/network errors;
- never silently overwrite an unrelated file based only on display name;
- verify remote size and available provider checksum metadata when possible;
- still use the application's SHA-256 catalog value as the canonical content checksum.

`drive.file` should be the target OAuth scope.

---

## 15. Filesystem destination behavior

A local destination is not identified only by drive letter.

Persist enough volume identity to re-detect an external drive if Windows changes:

`E:\` -> `F:\`

Expected metadata includes where available:

- volume GUID;
- volume serial;
- filesystem;
- last known mount path.

A destination becomes:

- AVAILABLE
- DISCONNECTED
- READ_ONLY
- FULL
- ERROR

The worker MUST not fail an entire backup because one local destination is disconnected.

Its branch waits while other destinations may continue.

---

## 16. Backup folder format

Backups must remain useful without this application.

No proprietary binary archive format.

Target:

```text
YouTube Backup/
|
+-- BIT387 [UCxxxxxxxx]/
    |
    +-- Videos/
    |   +-- Building a SaaS from Scratch [abc123]/
    |       +-- video.webm
    |       +-- thumbnail.jpg
    |       +-- metadata.json
    |
    +-- Shorts/
    |   +-- Office Setup [def456]/
    |       +-- video.mp4
    |       +-- thumbnail.jpg
    |       +-- metadata.json
    |
    +-- Live/
    |
    +-- Playlists/
    |   +-- Programming Tutorials [PLxxxxx]/
    |       +-- playlist.json
    |
    +-- .ytbackup/
        +-- manifest.json
        +-- version.json
```

Naming requirements:

- human readable;
- include stable YouTube ID in brackets;
- sanitize invalid Windows filename characters;
- avoid reserved DOS device names;
- trim trailing periods/spaces;
- cap title component length;
- never truncate stable provider ID;
- resolve collisions deterministically.

If a YouTube title changes:

- update metadata;
- write activity record;
- do not automatically rename the existing folder.

The media file inside a media folder should use a stable generic name:

- `video.mp4`
- `video.webm`
- `video.mkv`

depending on selected output.

---

## 17. Quality model

UI presets:

- Best available
- Up to 4K
- Up to 1080p
- Up to 720p

Do not call the first preset "Original".

YouTube/yt-dlp cannot guarantee retrieval of the exact creator-uploaded original master.

Prefer the best available representation satisfying the chosen cap.

Avoid lossy transcoding merely to force MP4.

FFmpeg should primarily:

- merge separate video/audio streams;
- remux when useful and lossless;
- perform required post-processing.

A later quality change MAY create upgrade jobs for existing archived media.

---

## 18. Staging architecture

Downloads must not write directly into final destination copies.

Use a worker staging area, for example:

```text
%LOCALAPPDATA%\YouTubeBackupManager\staging\<media-id>\
```

Possible contents:

```text
video.part
audio.part
merged.webm
thumbnail.jpg
metadata.json
```

Pipeline:

```text
download
  ->
post-process
  ->
hash
  ->
verify staging
  ->
distribute to destination branches
```

Only a verified staging artifact may become a source for destination transfers.

When all required branches no longer need staging, cleanup may run.

If an existing verified backup copy already exists and the user adds another destination, the engine SHOULD transfer from the verified existing copy rather than re-download from YouTube.

---

## 19. Manifest architecture

SQLite is the fast operational catalog.

It MUST NOT be the only recovery source.

Every channel backup has:

- high-level `manifest.json`;
- per-media `metadata.json`;
- playlist JSON files;
- schema/version markers.

Manifest requirements:

- versioned schema;
- source provider;
- channel stable ID;
- file relative paths;
- content hashes;
- sizes;
- media stable IDs;
- last update timestamp.

Do not create an architecture where a single giant manifest must contain all historical metadata for tens of thousands of videos.

The manifest should be an index; detailed media metadata remains distributed per media folder.

Manifest writes MUST be atomic:

1. write temporary file;
2. flush;
3. replace final file.

A crash must not leave a partially written canonical manifest.

---

## 20. Recovery

Recovery is a core product feature, not optional polish.

Given an existing backup folder and an empty/missing local database, the application must be able to:

- detect channel backups;
- read manifest versions;
- scan media folders;
- read metadata;
- reconstruct channels;
- reconstruct media items;
- reconstruct playlists;
- reconstruct copies;
- recalculate/verify hashes when required;
- merge multiple destinations by stable provider media ID.

Identity is:

`provider + provider_media_id`

Never title or filename.

Recovery must not require an active YouTube connection to reconstruct a previously archived catalog.

---

## 21. Search/catalog

The catalog remains searchable when drives are disconnected.

Use SQLite FTS for text search.

Searchable concepts include:

- media title;
- channel title;
- playlist title.

Filters include:

- channel;
- media type;
- source status;
- backup/copy status;
- destination;
- quality.

Filesystem scanning MUST NOT be performed on each library search.

---

## 22. Scheduling and Windows integration

Support:

- Backup now;
- daily;
- weekly;
- custom supported schedule;
- run at application startup;
- start app with Windows;
- start minimized to tray;
- Windows notifications.

Scheduled headless runs should use Windows Task Scheduler.

UI is not required to be open.

If the user closes the window while work is active, offer:

- continue in tray;
- stop/exit;
- cancel close.

The worker remains the source of truth for active jobs.

---

## 23. Updates

Application update channel:

- GitHub Releases.

v1.0 is unsigned unless project policy changes.

The UI should explain Windows SmartScreen warnings in documentation, not hide them.

`yt-dlp` may update independently:

- Stable: default.
- Nightly: advanced option.

Do not expose master/development channel to normal users.

FFmpeg is bundled and updated only with an application release unless the architecture is explicitly changed.

---

## 24. Diagnostics

Provide:

- open log folder;
- copy system information;
- export diagnostics;
- application version;
- Electron version;
- yt-dlp version;
- FFmpeg version;
- database path;
- staging path.

Diagnostics MUST run through a redaction layer.

It is better to omit a potentially sensitive value than to leak it.

---

## 25. Donation

Settings/About MAY show:

`Support the developer`

The button opens an external Stripe Payment Link in the system browser.

The desktop application:

- does not collect card details;
- does not embed Stripe Checkout;
- does not require a payment backend;
- does not unlock paid features in v1.0.

---

## 26. Performance principles

Assume channels can contain thousands or tens of thousands of media items.

Requirements:

- discovery is paginated;
- DB writes are batched in bounded transactions;
- UI lists are virtualized;
- search uses indexes/FTS;
- queue is lazy/paginated;
- never load all thumbnails into memory;
- large file copies/uploads are streamed;
- hashing is streamed;
- FFmpeg/yt-dlp output is parsed incrementally;
- concurrency is configurable but conservative by default.

Do not optimize by sacrificing durability.

---

## 27. Testability

Every provider must be behind an interface to allow deterministic fakes.

Job-engine tests must not require YouTube or Google Drive for core state-machine verification.

Create test doubles for:

- source provider;
- downloader;
- filesystem destination;
- Google Drive destination;
- clock;
- worker crash/restart.

Critical integration tests:

1. crash during download;
2. crash during hash;
3. crash during local copy;
4. crash during Drive upload;
5. disconnected HDD;
6. disk full;
7. expired auth;
8. revoked auth;
9. duplicate scheduled worker start;
10. SQLite deletion + manifest restore;
11. corrupted archived file;
12. changed YouTube title;
13. source video removed;
14. same video in multiple playlists.

---

## 28. Development ordering

Do not build visual polish first.

First vertical milestone:

```text
launch
  ->
authenticate Google
  ->
discover owned channel
  ->
select channel
  ->
select local destination
  ->
choose 1080p
  ->
start backup
  ->
kill app during download
  ->
restart
  ->
resume
  ->
finish
  ->
verify SHA-256
  ->
delete app.db
  ->
restore from existing backup
```

Only after this path is durable should the project invest heavily in dashboard polish.

See:

- `MVP.md`
- `DATABASE.md`
- `JOB-ENGINE.md`
