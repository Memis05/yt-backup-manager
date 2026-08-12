# YouTube Backup Manager — v1.0 MVP Specification

Status: **Approved product scope**  
Target: **Production-ready Windows v1.0**  
Primary source: **YouTube**  
Destinations: **Local filesystem + Google Drive**

> This document defines what v1.0 must do. Features outside this document should not be added opportunistically by Codex unless they are required to support an in-scope behavior.

---

## 1. v1.0 objective

A user with one or more Google/YouTube accounts can install the Windows application, connect Google, choose owned/managed YouTube channels, choose one or more backup destinations, and create a durable incremental archive of the channel.

The user must be able to:

- understand what has been backed up;
- find archived videos even when an external disk is disconnected;
- see where every copy lives;
- detect missing/corrupt copies;
- resume interrupted work;
- recover the catalog after reinstall/database loss;
- preserve archived media if YouTube source content disappears.

---

## 2. Product principles

### 2.1 Read-only YouTube

YouTube is permanently a read-only source.

v1.0 MUST NOT contain UI or API paths for:

- editing titles;
- editing descriptions;
- deleting media;
- uploading media;
- creating playlists;
- editing playlist membership on YouTube;
- modifying channel settings.

Only read scopes are allowed.

### 2.2 Local-first

No project backend is required for normal operation.

State exists on the user's Windows machine and selected destinations.

### 2.3 Human-readable backup

A backup must still make sense in Windows Explorer without the application.

### 2.4 Incremental by default

After initial backup, subsequent runs process only:

- newly discovered media;
- changed metadata;
- changed playlist membership;
- missing destination copies;
- explicitly requested quality upgrades;
- explicitly requested verification/repair.

### 2.5 Never silently destroy backups

If an item disappears from YouTube, archived copies remain.

If a file is corrupt, do not overwrite it blindly until a healthy source has been identified.

---

## 3. Supported platform

v1.0:

- Windows 10.
- Windows 11.
- x64 required unless build tooling later makes arm64 trivial and explicitly approved.

Not in v1.0:

- macOS.
- Linux.

The architecture must not intentionally prevent future ports.

---

## 4. Distribution

v1.0 distribution:

- public GitHub repository;
- GitHub Releases;
- installable Windows build and/or portable build as selected during packaging;
- unsigned binary initially;
- no paid code-signing requirement;
- no subscription;
- no license/payment gate.

The application may contain a `Support the developer` button linked to an external Stripe Payment Link.

No Stripe SDK or payment processing is required in-app.

---

## 5. Google OAuth experience

Official v1.0 uses the project's Google OAuth application.

End users DO NOT enter their own OAuth credentials.

Expected user flow:

```text
Connect Google
  ->
system browser opens
  ->
Google sign-in
  ->
consent
  ->
browser displays success/return-to-app page
  ->
desktop app becomes connected
```

Use Desktop OAuth authorization code + PKCE + loopback redirect.

YouTube permission must be read-only.

Google Drive permission should use the narrowest practical scope, targeted at `drive.file`.

The UI should explain permissions in plain language.

---

## 6. Multi-account and multi-channel

The user can connect multiple Google accounts.

After connecting an account, show accessible YouTube channels.

Example:

```text
Google account A
[x] Channel One
[x] Channel Two
[ ] Test Channel

Google account B
[x] Company Channel
```

The user chooses which channels have backup enabled.

All selected channels coexist in one application catalog.

---

## 7. Supported source content

v1.0 backs up:

- standard YouTube videos;
- Shorts;
- completed livestream recordings;
- thumbnails;
- current title;
- playlist structure.

The application should retain enough metadata for future features even when not all metadata is displayed.

Not required in v1.0:

- comments;
- analytics;
- view/like history;
- community posts;
- subtitles/captions;
- tags UI;
- chapters UI;
- description backup UI unless naturally available and useful to persist;
- channel banner/avatar archival as a user-visible feature.

### 7.1 Source visibility

Goal:

- Public: supported.
- Unlisted: supported where accessible.
- Private: supported where accessible with authenticated session.
- Age/restricted content: supported where `yt-dlp` can access it with required authenticated session.

The app should provide an optional authenticated YouTube download-session setup.

---

## 8. Quality options

User-selectable:

- Best available
- Up to 4K
- Up to 1080p
- Up to 720p

Default should be conservative but quality-oriented; choose during implementation and expose clearly.

Do not label any choice "Original".

A user can define:

- global default quality;
- per-channel override.

If a channel was previously backed up at lower quality and the setting later increases, offer:

- upgrade existing eligible copies;
- apply only to new media.

A quality upgrade must not create duplicate logical media records.

---

## 9. Destination model

A channel may back up to one or multiple destinations.

v1.0 destination types:

- local/internal drive;
- external drive;
- normal filesystem/network path;
- Google Drive.

Global defaults plus per-channel overrides are supported.

Example:

```text
Global:
  Local backup: enabled
  Google Drive: enabled

Channel A:
  use global

Channel B:
  Local backup: enabled
  Google Drive: disabled
```

A user may have multiple local destination copies.

No user-facing custom destination nickname is required in v1.0.

---

## 10. Google Drive

v1.0 engineering includes a Drive adapter.

User flow:

```text
Storage
  ->
Add Google Drive
  ->
select/connect Google account
  ->
choose/create application backup root
  ->
save
```

Prefer application-managed folder structure.

Use provider file/folder IDs as canonical Drive identities.

Large media must use resumable upload.

A moved Drive object should remain trackable by provider ID where possible.

### Release gate

Current Drive API policy requires express prior written consent for backup of developer app/project content to Drive.

Do not remove this release gate from project documentation merely because the feature works technically.

---

## 11. Human-readable folder format

Example:

```text
YouTube Backup/
  BIT387 [UCxxxx]/
    Videos/
      Building a SaaS [abc123]/
        video.webm
        thumbnail.jpg
        metadata.json

    Shorts/
      Office Setup [def456]/
        video.mp4
        thumbnail.jpg
        metadata.json

    Live/

    Playlists/
      Programming [PLxxxx]/
        playlist.json

    .ytbackup/
      manifest.json
      version.json
```

Requirements:

- folder names readable by humans;
- stable YouTube ID included;
- same video is not physically duplicated because it belongs to multiple playlists;
- playlists reference logical media;
- title change does not automatically rename an existing media folder;
- metadata updates to current title;
- title change appears in Activity.

---

## 12. Initial onboarding

Use a guided step flow.

Suggested steps:

1. Welcome.
2. Connect Google.
3. Select YouTube channels.
4. Add backup destination(s).
5. Choose quality.
6. Configure schedule.
7. Review.
8. Start first backup.

The first run must not require the user to install:

- Node.js;
- Python;
- FFmpeg;
- yt-dlp;
- database tools.

Required runtime tools are bundled/managed by the application.

---

## 13. Main navigation

v1.0 sidebar:

```text
Dashboard

Library
Channels
Playlists

Backup
Queue
Activity

Storage
Integrity

Settings
```

Minor naming may be adjusted during UI design, but information architecture should remain equivalent.

---

## 14. Dashboard

Show useful global state, not vanity metrics.

At minimum:

- selected channel count;
- media count;
- total archived bytes where known;
- last backup run;
- running backup summary;
- failures needing attention;
- storage capacity/availability;
- copy health summary.

Channel cards show:

- channel title;
- Videos count;
- Shorts count;
- Live count;
- last sync;
- backup status/health;
- Backup now;
- Open channel.

Do not invent a formal "protection policy" score.

Health is descriptive/derived from actual copy states.

---

## 15. Global Library

Library covers all indexed media across all channels.

The same library component is reusable with a channel filter when viewing one channel.

Views:

- grid;
- list.

Search must work while external backup storage is disconnected.

Filters:

- channel;
- type: Video / Short / Live;
- source status;
- backup/copy status;
- destination;
- quality.

Grid card example:

```text
[ thumbnail ]

Building a SaaS
BIT387
4K • 2.8 GB

Local: Verified
Drive: Verified
```

List view should be administration-oriented.

---

## 16. Video details

Selecting a media item opens details.

Show:

- thumbnail/player;
- current title;
- channel;
- YouTube source status;
- published date;
- duration;
- archived resolution;
- archived size;
- playlists;
- each destination copy and status.

Actions:

- Open local folder when available.
- Open on YouTube.
- Verify.
- Repair backup.
- Add/copy to destination where applicable.

### Player

Player supports source selection where available:

- YouTube embed.
- Local archived copy.

Google Drive streaming MAY be added if it can be done safely and cleanly, but it is not required to block v1.0.

The YouTube embed also provides a useful user-visible signal that the remote source may still be available.

Do not infer authoritative source availability solely from player behavior; source sync remains authoritative.

---

## 17. Backup now

Two paths:

### Quick backup

`Backup now`

Immediately starts using saved settings.

### Custom backup

Allows temporary selections such as:

- new content only;
- refresh metadata;
- verify existing files;
- destinations;
- quality override.

A custom run should not silently rewrite persistent defaults unless the user explicitly saves changes.

---

## 18. Incremental sync semantics

Each channel sync determines:

- media newly found;
- known media still present;
- title changed;
- thumbnail changed;
- playlist created;
- playlist removed;
- membership changed;
- source media removed/unavailable;
- known copies missing or corrupt.

Rules:

- title change -> metadata update + Activity;
- thumbnail change -> replace archived thumbnail through safe atomic flow;
- media source removed -> mark source status, preserve copies;
- playlist removed -> preserve archived playlist representation and mark removed;
- membership changes -> store current membership + Activity;
- no automatic media re-download for metadata-only change.

---

## 19. Preflight

Before a backup run, perform best-effort preflight.

For local destinations:

- destination present;
- writable;
- available free space.

If required bytes are known and clearly exceed available space, do not begin transfers to that destination.

Show an actionable message.

Cloud:

- check account/destination availability;
- check quota if API reliably exposes relevant values.

Unknown total backup size should not block initial discovery; preflight can refine after format/size discovery.

---

## 20. Queue

Queue is user-controllable.

Sections/statuses:

- active;
- pending;
- retrying/waiting;
- failed/needs attention;
- completed/recent.

Show for active transfer where known:

- media title;
- operation;
- destination;
- percent;
- bytes;
- speed;
- ETA.

Actions:

- pause;
- resume;
- cancel;
- move to top;
- increase/decrease priority.

Support controls for:

- whole backup run;
- channel;
- individual job/media operation.

---

## 21. Pause and cancel semantics

Pause:

- stop safely;
- keep resumable partial state;
- preserve `.part`/upload session where valid.

Cancel:

Ask where relevant:

- keep partial data for possible later resume;
- delete temporary partial data.

Cancel must not delete already verified backup copies.

---

## 22. Failure behavior

One bad video MUST NOT stop an entire channel backup.

Example:

```text
1,000 media
998 complete
1 private/auth required
1 failed repeatedly
```

Run completes as `COMPLETED_WITH_ERRORS` or equivalent, not catastrophic failure.

Problem items are visible and retryable.

---

## 23. Retry defaults

Default transient retry schedule:

1. 30 seconds.
2. 2 minutes.
3. 10 minutes.
4. 1 hour.
5. 6 hours.

After terminal retry exhaustion:

- mark Needs attention/Failed;
- later scheduled backup may re-evaluate and retry where appropriate.

Do not retry permanent failures blindly.

---

## 24. Background scheduling

Supported:

- manual;
- daily;
- weekly;
- custom supported schedule;
- on app startup.

Scheduled jobs can run without UI using Windows Task Scheduler.

Settings:

- Start with Windows.
- Start minimized to tray.

When UI opens during a running headless backup, it attaches to the active worker and displays progress.

Do not start another engine.

---

## 25. Notifications

Windows notifications:

- backup complete;
- backup completed with errors;
- destination disconnected;
- authentication needs attention;
- integrity problem;
- major failure.

Users can disable notification categories.

Avoid noisy per-file success notifications.

---

## 26. Storage disconnection

If an external destination disappears:

```text
External HDD: Waiting for destination
Google Drive: continues
```

When the same volume reappears under another drive letter, the application should recognize it by persisted volume identity and resume.

Do not mark a verified copy corrupt merely because the drive is disconnected.

---

## 27. Backup copy repair

If a copy is missing/corrupt and another verified copy exists:

Offer/perform repair from a healthy existing copy.

Preferred source order should avoid unnecessary YouTube download.

Example:

```text
Local: Missing
Drive: Verified
YouTube: Available
```

Repair local from Drive before downloading from YouTube, unless policy/efficiency makes another verified local copy preferable.

Never use a corrupt copy as repair source.

---

## 28. Integrity

v1.0 uses SHA-256.

User actions:

- Verify this copy.
- Verify media item.
- Verify destination.
- Verify channel.
- Verify backups.

Verification can be:

- manual;
- periodic/scheduled.

Store:

- expected hash;
- file size;
- verified timestamp;
- last checked timestamp;
- result.

States:

- Verified.
- Missing.
- Corrupt.
- Unavailable/disconnected.
- Verification pending.
- Error.

A mismatched hash is `CORRUPT`.

---

## 29. Recovery after database loss

This is a release-blocking v1.0 feature.

Scenario:

1. User has valid backup.
2. `app.db` is lost/deleted.
3. User installs/opens the application.
4. User selects `Restore existing backup`.
5. User points to one or more existing destinations.
6. Application scans manifest and metadata.
7. Application reconstructs local catalog.

The reconstructed catalog should include:

- channels;
- media;
- playlists;
- copy locations;
- hashes;
- available media properties.

OAuth connections/schedules may need to be re-established because credentials are intentionally not stored inside backups.

---

## 30. Activity

Activity log records current operational history.

Examples:

- title changed;
- thumbnail updated;
- playlist membership changed;
- playlist removed from source;
- media removed from source;
- new media discovered;
- backup completed;
- verification found corruption;
- repair completed;
- destination connected/disconnected;
- auth requires attention.

No versioned playlist-history feature is required beyond Activity.

---

## 31. Backup History

Each backup run has a summary:

```text
11 Aug 2026 08:40
BIT387 scheduled backup

Discovered: 4
Downloaded: 4
Copied to local: 4
Uploaded to Drive: 4
Metadata updated: 12
Errors: 0
Duration: 18m 42s
```

Historical summaries remain after detailed completed jobs are pruned, if pruning is later implemented.

---

## 32. Settings

### General

- start with Windows;
- start minimized;
- notification preferences;
- update checks.

### Backup

- default quality;
- schedule defaults;
- default destinations;
- staging location if user-configurable later;
- conservative concurrency.

### Advanced

- concurrent downloads;
- local copy concurrency;
- Drive upload concurrency;
- upload/download bandwidth limits where implementable;
- yt-dlp channel Stable/Nightly;
- update yt-dlp;
- show versions;
- open application data folder;
- open logs.

### Accounts

- connected Google identities;
- reconnect;
- disconnect;
- Drive capability;
- YouTube capability;
- authenticated YouTube session state.

Disconnecting an account must not delete backups.

---

## 33. Diagnostics

Help/Diagnostics:

- Open log folder.
- Export diagnostics.
- Copy system info.

Export may contain:

- app version;
- Windows version;
- Electron/Node version;
- yt-dlp version;
- FFmpeg version;
- sanitized settings;
- recent sanitized errors/logs;
- provider state without credentials.

Never include:

- OAuth token;
- refresh token;
- authorization code;
- cookies;
- raw Authorization header;
- Drive download/upload authorization URL containing credentials;
- other secrets.

---

## 34. Application updates

Application checks GitHub Releases.

UI:

```text
v1.x available
[Update]
[Later]
```

Exact installation strategy can be selected during packaging.

No code-signing cost is assumed for v1.0.

### yt-dlp

Managed independently.

Default:

- Stable.

Advanced:

- Nightly.

FFmpeg remains pinned to the application release.

---

## 35. Donate

Settings/About:

```text
YouTube Backup Manager
Free & Open Source

[Support the developer]
[GitHub]
[Report an issue]
```

Support button opens configured external Stripe Payment Link.

Donation is optional.

No feature changes based on donation.

---

## 36. Explicitly out of scope for v1.0

Do not implement unless needed for a core dependency:

- Dropbox.
- OneDrive.
- macOS.
- Linux.
- generic public-channel downloads.
- arbitrary URL downloader.
- YouTube write operations.
- subtitles/captions.
- comments.
- analytics.
- community posts.
- CSV catalog export.
- playlist historical snapshots.
- protection-policy rules.
- database encryption.
- automatic media-folder rename on title change.
- S3/B2/WebDAV.
- mobile app.
- web dashboard.
- hosted backend.
- accounts/login system owned by this project.
- paid plans.
- telemetry/analytics collection unless separately approved.
- in-app Stripe payment handling.

---

## 37. v1.0 release acceptance criteria

v1.0 cannot be called ready until all critical criteria pass.

### Authentication

- [ ] Project Google OAuth client works in packaged build.
- [ ] System browser + PKCE + loopback flow works.
- [ ] Multiple Google accounts work.
- [ ] Only allowed YouTube read scope requested.
- [ ] Credentials encrypted at rest.
- [ ] No credentials in logs.

### Discovery

- [ ] Multiple channels discover correctly.
- [ ] Video/Short/Live classification works.
- [ ] Playlists discover correctly.
- [ ] Large paginated channel tested.

### Download

- [ ] Best available works.
- [ ] 4K cap works.
- [ ] 1080p cap works.
- [ ] 720p cap works.
- [ ] Video+audio merge works.
- [ ] Human-readable folders work.
- [ ] Invalid Windows titles sanitized.
- [ ] Same media in multiple playlists produces one media file.

### Durability

- [ ] Kill process at 50% download -> resumes.
- [ ] Kill during FFmpeg -> safely retries.
- [ ] Kill during local copy -> no false Verified state.
- [ ] Kill during hash -> safely recovers.
- [ ] Restart during queued backup -> queue restored.

### Local storage

- [ ] External disk disconnect handled.
- [ ] Drive-letter change recognized.
- [ ] Disk-full is actionable.
- [ ] Multiple local destinations supported.

### Google Drive

- [ ] Resumable large upload.
- [ ] Retry after network failure.
- [ ] Provider file IDs persisted.
- [ ] Existing uploaded copy not duplicated unnecessarily.
- [ ] Auth refresh works.
- [ ] Revoked auth is actionable.
- [ ] Compliance release gate reviewed before public release.

### Incremental

- [ ] New media only downloaded.
- [ ] Metadata-only title change does not re-download video.
- [ ] Removed source remains archived.
- [ ] Playlist membership update does not duplicate files.

### Integrity

- [ ] SHA-256 generated.
- [ ] Intentional byte corruption detected.
- [ ] Missing file detected.
- [ ] Repair from healthy copy works.

### Recovery

- [ ] Delete `app.db`.
- [ ] Restore from existing local backup.
- [ ] Media, channels, playlists and copies return.
- [ ] No YouTube connection required merely to rebuild archived catalog.

### UI

- [ ] Global Library search works with backup drive disconnected.
- [ ] Grid/list work on thousands of rows.
- [ ] Queue can pause/resume/cancel/reprioritize.
- [ ] Activity and run history work.
- [ ] Video details opens local folder and YouTube source.

### Security

- [ ] Renderer has no Node integration.
- [ ] Context isolation enabled.
- [ ] IPC schemas validated.
- [ ] No generic shell/SQL IPC.
- [ ] External URL allowlist/validation.
- [ ] Diagnostics redaction tests pass.

---

## 38. First development milestone

Before UI polish, demonstrate this end-to-end path:

```text
Open application
-> connect Google
-> discover owned channel
-> choose channel
-> choose E:\YouTube Backup
-> choose Up to 1080p
-> start backup
-> terminate app/process during active download
-> reopen
-> resume instead of restart
-> complete media
-> SHA-256 verify
-> close app
-> delete local SQLite database
-> reopen
-> Restore existing backup
-> select E:\YouTube Backup
-> channel/media catalog reconstructed
```

If this path is not reliable, v1.0 foundation is not complete.
