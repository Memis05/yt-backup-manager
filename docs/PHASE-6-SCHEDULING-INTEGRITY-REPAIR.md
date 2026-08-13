# YouTube Backup Manager — Phase 6: Scheduling, Integrity & Repair

Status: **Implementation specification for Phase 6**  
Target branch: `feat/scheduling-integrity-repair`

## 1. Goal

Phase 6 turns the app into a reliable background backup system.

Implement:

- automatic backups through Windows Task Scheduler;
- daily, weekly and bounded custom interval schedules;
- backup on app startup;
- start with Windows;
- start minimized / tray operation;
- missed-run recovery;
- Windows notifications;
- manual integrity checks;
- scheduled periodic integrity checks;
- descriptive backup-health summaries;
- Repair Center;
- Local -> Local repair;
- Local -> Drive repair;
- Drive -> Local repair;
- Drive -> Drive repair where two Drive destinations exist;
- YouTube fallback repair only when no healthy archived copy exists.

Existing supported backup modes must remain:

- Local only;
- Google Drive only;
- Local + Google Drive.

No new source/storage providers are added.

## 2. Scheduling architecture

Production scheduling MUST NOT depend on renderer timers or `setInterval`.

Use Windows Task Scheduler as the external trigger.

Conceptual flow:

```text
Windows Task Scheduler
-> YouTubeBackupManager.exe --worker --scheduled <schedule-id>
-> existing worker singleton / new worker
-> existing durable backup planner
```

The existing worker remains the sole execution engine.

SQLite remains schedule configuration truth. Windows Task Scheduler is execution infrastructure.

Create a typed Windows scheduling adapter, preferably:

```text
packages/scheduler-windows/
```

Responsibilities:

- create;
- update;
- enable/disable;
- remove;
- query;
- reconcile app-owned tasks.

Do not expose generic Task Scheduler commands to renderer.

## 3. Schedule types

Support:

- Daily at selected local time;
- Weekly at selected weekday/time;
- Every N hours, minimum 1 hour;
- Backup on application startup.

Support:

- global schedule defaults;
- per-channel override;
- enable/disable/update/delete.

Do not expose raw cron syntax in v1.0.

## 4. Schedule time semantics

User schedules represent local wall-clock intent.

Do not permanently convert:

```text
Daily at 02:00
```

into a fixed UTC schedule.

Document deterministic timezone/DST behavior.

Persist enough schedule configuration to recreate the Windows task after timezone, application-path or installation changes.

## 5. Task safety

Task actions use only:

- controlled packaged executable path;
- fixed arguments;
- stable schedule IDs.

No titles, paths or arbitrary renderer strings become commands.

No shell interpolation.

Normal scheduling must not require administrator privileges.

App tasks must use a unique stable namespace/prefix.

Do not modify unrelated Windows tasks.

## 6. Task reconciliation

On startup/settings change reconcile DB configuration with Windows.

Examples:

```text
DB schedule exists + task missing
-> recreate

schedule disabled
-> disable/remove app-owned task

application path changed
-> update action

stale app task
-> reconcile safely
```

Do not create duplicate tasks per application version.

## 7. Missed runs

The PC may be sleeping/off during a trigger.

Use Task Scheduler's missed-start behavior where practical.

Application semantics:

- one or more missed equivalent triggers collapse into one current run;
- do not launch multiple identical full backups after resume;
- record missed/catch-up behavior in Activity/history.

## 8. Trigger idempotency

Use stable logical-trigger idempotency, conceptually:

```text
schedule:<schedule-id>:<logical-trigger-time>
```

Handle:

- duplicate Windows trigger;
- startup trigger at same time;
- manual backup already active;
- UI opening while scheduled run active.

No duplicate acquisition/download.

## 9. Worker lifecycle

Scheduled worker must:

- acquire/reuse singleton;
- recover durable jobs first;
- execute scheduled run;
- remain alive while backup/integrity/repair work is active;
- exit only when truly idle.

Opening UI during headless work attaches to existing worker.

Closing renderer must not terminate durable work unexpectedly.

## 10. Start with Windows / tray

Support:

```text
Start YouTube Backup Manager with Windows
Start minimized to tray
Keep running in tray when window closes
```

Tray menu may expose:

- Open;
- Backup now;
- Pause/Resume active work;
- Quit.

When active work exists and user closes the window, preserve configured behavior and never corrupt/kill active jobs accidentally.

## 11. Windows notifications

Notification categories:

```text
BACKUP_COMPLETED
BACKUP_COMPLETED_WITH_ERRORS
BACKUP_FAILED
DESTINATION_DISCONNECTED
DESTINATION_RECONNECTED
DRIVE_AUTH_REQUIRED
INTEGRITY_CORRUPT
INTEGRITY_MISSING
REPAIR_COMPLETED
REPAIR_FAILED
SCHEDULE_ERROR
```

Do not send per-file success spam.

Support user preferences by category.

Suppress repeated notifications for the same unresolved problem.

No tokens, raw provider errors or sensitive session data in notifications.

Notification click opens a validated internal route/entity ID.

## 12. Integrity scopes

Manual verification supports:

- one copy;
- one media item;
- one channel;
- one destination;
- all backups.

Scheduled periodic integrity supports:

- per destination;
- per channel;
- global.

Integrity uses the existing durable jobs system.

## 13. Local integrity

Strong Local verification:

```text
destination available
-> trusted physical path
-> file exists
-> stream SHA-256
-> compare expected SHA-256
```

States:

```text
VERIFIED
MISSING
CORRUPT
UNAVAILABLE
ERROR
```

Disconnected external disk is `UNAVAILABLE`, never automatically `MISSING`.

## 14. Google Drive integrity

Support two strengths.

### Provider metadata check

Default cheap Drive verification:

```text
provider file exists
provider ID matches
size matches
expected metadata/appProperties
```

Strength:

```text
PROVIDER_METADATA_SIZE
```

### Full content verification

Optional/manual/advanced:

```text
Drive download
-> temporary staging
-> streamed SHA-256
-> compare expected
```

Strength:

```text
DOWNLOADED_SHA256
```

Do not claim full content SHA verification when only provider metadata was checked.

## 15. Periodic integrity

Support:

- Weekly;
- Monthly;
- reasonable Custom interval.

Periodic integrity is opt-in.

Recommended Drive default:

```text
metadata/size
```

Full Drive content verification requires explicit opt-in because it consumes bandwidth/temp disk.

Periodic integrity default priority must be below active backup work.

User can pause/cancel.

## 16. Integrity history

Persist:

- copy;
- verification strength;
- expected hash/size;
- actual hash/size when calculated;
- result;
- start/end;
- safe error.

UI shows:

```text
Last verified
Method
Result
```

## 17. Backup health

Do NOT introduce the previously rejected protection-policy/minimum-copy model.

Health is descriptive.

Per media/channel/global summarize:

- fully backed up across intended destinations;
- partial;
- pending;
- missing;
- corrupt;
- unavailable;
- auth required.

Dashboard derives from actual copy states.

## 18. Repair Center

Add functional Integrity/Repair UI.

Example categories:

```text
Corrupt
Missing
Auth required
Unavailable
```

Each issue shows:

- media;
- unhealthy destination;
- problem status;
- healthy source candidates;
- recommended action.

Actions:

```text
Repair
Verify again
Open details
```

"Dismissing" a warning must never turn a physically corrupt copy into healthy state.

## 19. Repair source ordering

For target `media_copy`, prefer:

1. verified Local copy;
2. another verified Local copy;
3. Drive copy downloaded to temp and SHA-verified;
4. YouTube source only if no healthy archived copy exists.

Do not use MISSING, CORRUPT or untrusted bytes.

## 20. Local -> Local repair

```text
Local A VERIFIED
-> temp copy to Local B
-> SHA-256
-> atomic promotion
-> Local B VERIFIED
```

No yt-dlp.

## 21. Local -> Drive repair

```text
Local VERIFIED
-> existing resumable Drive upload pipeline
-> Drive verification
-> Drive VERIFIED
```

No yt-dlp.

## 22. Drive -> Local repair

```text
Drive object
-> temp staging
-> SHA-256 expected match
-> staging VERIFIED
-> safe Local temp copy
-> Local SHA-256
-> atomic promotion
-> Local VERIFIED
```

Do not overwrite corrupt Local target before replacement is independently verified.

## 23. Drive -> Drive repair

When two Drive destinations exist:

```text
Drive A
-> temp staging
-> SHA-256
-> Drive B upload
-> verify
```

No provider-to-provider shortcut is required.

## 24. YouTube fallback repair

Only when:

- no healthy archived source exists;
- source remains available;
- required source authentication exists;
- repair is explicitly initiated/approved.

Use normal yt-dlp/FFmpeg acquisition, but do not create a new logical media item.

YouTube is last-choice repair source.

## 25. Repair safety

Never destroy the last healthy copy.

Replacement process:

1. confirm healthy source;
2. create replacement temp;
3. verify replacement;
4. promote/swap safely;
5. update target VERIFIED only after success.

If replacement fails, target remains unhealthy.

Repair must be idempotent.

Existing verified target on retry becomes no-op/reconciled completion.

## 26. Repair pause/cancel

Use existing job controls.

Pause preserves resumable state.

Cancel:

- does not delete healthy source;
- does not delete verified target;
- safely cleans temporary artifacts where appropriate.

## 27. Destination reconnect

Local destination:

```text
DISCONNECTED -> AVAILABLE
```

When stable volume returns:

- blocked backup jobs become eligible;
- blocked integrity jobs become eligible;
- repair candidates re-evaluate.

Do not burn retries while drive is absent.

## 28. Drive auth recovery

Revoked/invalid Drive authorization:

```text
destination = AUTH_REQUIRED
Drive jobs = BLOCKED
```

Local work remains functional.

Notify once.

Successful reauthorization unblocks relevant work.

## 29. Network offline

When offline:

- Local integrity/repair can continue;
- YouTube/Drive network jobs wait;
- retry counters are not burned repeatedly.

Resume network jobs gradually after connectivity returns.

## 30. Scheduling UI

Settings -> Backup Schedule.

Support:

```text
Automatic backup [On/Off]

Frequency:
Daily / Weekly / Every N hours

Time/weekday

Run missed backup when PC becomes available

Backup on app startup
Start with Windows
Start minimized
```

Global defaults + per-channel override.

## 31. Integrity UI

Settings -> Integrity:

```text
Automatic integrity checks [On/Off]

Weekly / Monthly / Custom

Local verification
Google Drive verification

[ ] Full Drive content verification
```

Warn about bandwidth/temp-space cost for full Drive verification.

## 32. Queue

Queue must support/display:

- scheduled backup;
- integrity verification;
- repair;
- Drive verification;
- Drive download for repair.

Show phase, destination, progress, priority and blocked/error reason.

All operational state remains worker-derived.

## 33. Activity/history

Add summary events such as:

```text
SCHEDULE_CREATED
SCHEDULE_UPDATED
SCHEDULE_DISABLED
SCHEDULE_TRIGGERED
SCHEDULE_MISSED
INTEGRITY_STARTED
INTEGRITY_COMPLETED
INTEGRITY_MISSING
INTEGRITY_CORRUPT
REPAIR_STARTED
REPAIR_COMPLETED
REPAIR_FAILED
DESTINATION_RECONNECTED
AUTH_REQUIRED
```

Avoid noisy per-file Activity where a summary is sufficient.

## 34. Persistence

Extend existing schema minimally.

Likely additions:

- schedule status/configuration fields;
- notification preferences/dedup state;
- periodic integrity settings;
- repair-run linkage if useful;
- verification history/strength fields if existing tables are insufficient.

Do not introduce another queue.

Backup, integrity and repair use the existing durable job engine.

## 35. Security — scheduler

Test/protect against:

- arbitrary executable scheduling;
- argument injection;
- malformed schedule IDs;
- renderer modifying unrelated tasks;
- task namespace escape;
- unsafe packaged executable path.

Renderer sends schedule DTOs, not command strings.

## 36. Security — repair

Repair RPC uses catalog-authorized IDs:

```text
repairCopy(copyId)
```

Never renderer-provided arbitrary:

```text
sourcePath
targetPath
providerFileId
```

Worker resolves trusted source/target records.

Preserve all existing filesystem/Drive hardening.

## 37. Scheduler tests

Use fake Task Scheduler adapter for deterministic automated tests.

Mandatory:

- daily create;
- weekly create;
- N-hour create;
- update;
- disable;
- delete;
- missing task recreation;
- executable path reconciliation;
- unrelated task untouched;
- duplicate trigger dedupe;
- missed run catch-up;
- manual run already active;
- worker already active;
- headless worker idle exit;
- UI attach to scheduled worker;
- local time/DST configuration preservation.

Where practical add Windows integration smoke in isolated app task namespace.

## 38. Notification tests

Mandatory:

- success;
- completed with errors;
- auth required;
- corruption/missing;
- preferences disabled;
- duplicate suppression;
- safe message content;
- click opens validated internal target.

## 39. Integrity tests

### Local

- SHA match;
- SHA mismatch;
- missing file;
- disconnected drive;
- changed mount path;
- read failure;
- cancellation;
- worker crash/restart.

### Drive

- metadata healthy;
- provider object missing;
- size mismatch;
- rename/move survives by ID;
- full downloaded SHA match;
- full downloaded SHA mismatch;
- network outage;
- auth required.

No false VERIFIED state.

## 40. Repair tests

Mandatory:

### Local -> Local

- MISSING target;
- CORRUPT target;
- failed replacement leaves unhealthy;
- source corrupt before use aborts.

### Local -> Drive

- no yt-dlp;
- resumable upload;
- no duplicate.

### Drive -> Local

- Drive bytes SHA verified first;
- mismatch aborts;
- correct repair VERIFIED.

### Drive -> Drive

- temp staging;
- no duplicate object.

### YouTube fallback

- only when no healthy archive;
- unavailable source -> cannot repair;
- existing healthy copy -> yt-dlp not called.

## 41. Failure injection

Test:

- kill worker during scheduled backup;
- kill during integrity;
- kill during repair;
- duplicate Windows trigger;
- local disk disconnect;
- Drive auth revoke;
- network offline;
- lease expiry;
- app opens during background work.

All work must reconcile safely.

## 42. Manual scheduling smoke

On real Windows:

1. configure near-future schedule;
2. close UI;
3. confirm Task Scheduler launches worker;
4. confirm backup run starts;
5. open UI mid-run;
6. UI attaches to existing worker;
7. complete;
8. no duplicate run.

Test missed trigger by sleeping/shutting down across trigger and verify one catch-up run.

## 43. Manual integrity/repair smoke

### Local corruption

1. safety-copy a verified file;
2. modify bytes;
3. verify;
4. expect CORRUPT;
5. repair from healthy Local/Drive;
6. reverify -> VERIFIED.

### Missing Local

1. move one backed-up file away;
2. verify -> MISSING;
3. repair;
4. verify -> VERIFIED.

### Missing Drive

1. manually delete one app-created Drive video;
2. verify -> MISSING;
3. repair from healthy Local if available;
4. Drive -> VERIFIED.

Confirm no yt-dlp while a healthy archive copy exists.

## 44. Packaging

Windows scheduled tasks in production must point to packaged application, not dev Electron/Node.

Package smoke must validate scheduled invocation path where environment allows.

If current installer/uninstaller does not clean app-owned scheduled tasks, document this for Phase 7 release hardening.

## 45. Documentation

Create:

```text
docs/PHASE-6-SCHEDULING-INTEGRITY-REPAIR.md
```

Document:

- Task Scheduler architecture;
- app task namespace;
- missed-run semantics;
- timezone/DST;
- worker lifecycle;
- tray;
- notification policy;
- integrity strengths;
- periodic integrity;
- Repair Center;
- source ordering;
- repair safety;
- tests;
- manual validation;
- known limitations.

Do not modify root specifications.

## 46. Validation

Run:

- repository-wide format;
- lint;
- strict TypeScript;
- full unit/integration suite;
- scheduler tests;
- integrity tests;
- repair tests;
- build;
- package:dir;
- packaged worker smoke;
- packaged Electron E2E where environment permits;
- `git diff --check`.

Audit:

- no arbitrary scheduled commands;
- no renderer Task Scheduler authority;
- no arbitrary repair paths;
- no automatic destructive cleanup;
- no YouTube write scopes;
- no broad Drive scopes;
- no credential/session leaks.

## 47. Acceptance criteria

### Scheduling

- [ ] Daily works.
- [ ] Weekly works.
- [ ] Every-N-hours works.
- [ ] UI can be closed.
- [ ] Worker singleton preserved.
- [ ] Duplicate triggers deduped.
- [ ] Missed run behavior deterministic.
- [ ] Global/per-channel schedules work.
- [ ] No admin requirement.

### Tray/startup

- [ ] Start with Windows.
- [ ] Start minimized.
- [ ] Closing window can keep work running.
- [ ] Quit is safe.

### Notifications

- [ ] Backup/error/auth/integrity notifications.
- [ ] Preferences.
- [ ] Duplicate suppression.
- [ ] No sensitive data.

### Integrity

- [ ] Local SHA verification.
- [ ] Missing/corrupt detection.
- [ ] Drive provider verification.
- [ ] Optional Drive downloaded SHA.
- [ ] Periodic integrity.
- [ ] History persists.
- [ ] Disconnected != missing.

### Repair

- [ ] Local -> Local.
- [ ] Local -> Drive.
- [ ] Drive -> Local.
- [ ] Healthy source required.
- [ ] YouTube fallback last.
- [ ] Last healthy copy never destroyed.
- [ ] Retry idempotent.
- [ ] Repair Center accurate.

### Regression

- [ ] Local-only works.
- [ ] Drive-only works.
- [ ] Local+Drive works.
- [ ] Disaster-recovered catalog works with schedules/integrity/repair.
- [ ] No unnecessary re-download/re-upload.

## 48. Recommended next phase

Phase 7 — **Release Hardening & v1.0 Packaging**

Targets:

- final onboarding/UI polish;
- app icon/branding;
- installer/uninstaller;
- scheduled-task uninstall cleanup;
- GitHub Release packaging;
- update checker/updater;
- yt-dlp managed update lifecycle;
- final diagnostics;
- security/privacy docs;
- production OAuth checklist;
- Google Drive compliance gate;
- final performance/load tests;
- final security review;
- v1.0 release checklist.
