# YouTube Backup Manager UX and Information Architecture

Status: authoritative Phase 7A target IA; platform: Windows 10/11 desktop; primary window baseline: 1120 by 760 pixels.

## 1. Product mental model

The interface should present one durable archive, not a set of backend modules.

The user's mental model is:

```text
My channels
  -> their indexed media
  -> intended and verified copies stored in destinations
  -> operations that keep those copies healthy
```

The application model remains:

```text
Renderer
  -> typed preload IPC
  -> worker-owned catalog and durable jobs
  -> local filesystem and Google Drive
```

The first model governs navigation and copy. The second model remains the security and reliability boundary.

## 2. IA principles

### 2.1 Navigate by user object or task

Primary destinations must represent a stable user concept:

- Home: overall state and next action.
- Library: archived and indexed content.
- Channels: sources and their backup setup.
- Activity: operations over time.
- Storage: destination management.
- Integrity: verification and repair.
- Settings: configuration and support.

### 2.2 Keep configuration out of daily navigation

Accounts, schedules, notification preferences, recovery, tool versions, paths, and logs are configuration or support concerns. They belong in Settings.

### 2.3 Keep actions with their object

- Start a channel backup from Home, Channels, or Channel Details.
- Configure a channel's quality and destinations in Channel Details.
- Add or maintain a destination in Storage.
- Verify or repair a copy from Media Details or Integrity.
- Control an operation from Activity.

There is no top-level Backup destination because backup is an action, not a content domain.

### 2.4 Translate jobs into operations

Activity presents work as a user-level operation when a worker-owned operation contract or rigorously specified deterministic composition supports it. Durable jobs remain visible only inside `Technical details`.

### 2.5 Surface exceptions before totals

Healthy zero states do not need equal visual weight. Home and Integrity elevate incomplete, failed, blocked, disconnected, corrupt, missing, and authorization-needed states before routine counts.

### 2.6 Do not invent state

The renderer may compose typed worker responses for presentation. It must not infer verified status, repair eligibility, source availability, or operation completion from UI behavior.

## 3. Primary navigation

```text
Home
Library
Channels

Activity
Storage
Integrity

Settings
```

The first three destinations describe the archive. The next three describe the systems that maintain it. Settings is visually separated at the bottom of the sidebar.

### Navigation behavior

- Full sidebar at widths of 1040px and above.
- Compact icon rail below 1040px, with accessible tooltips and a user-controlled expand action.
- Active destination uses a restrained tonal row, a red leading marker, an icon, and a text label. The label remains the primary identifier.
- Counts appear only for actionable exceptions, such as `2` beside Activity or Integrity. Counts never show routine totals such as channel count.
- `Worker ready` is not a navigation item or permanent footer.
- The read-only YouTube promise appears in onboarding, account permission details, About, and relevant confirmation copy, not in the permanent sidebar.
- Sidebar scrolling is independent from page content when vertical space is limited.

## 4. Target sitemap

```text
Home
  Health overview
  Active operation
  Needs attention
  Channels and destinations summary
  Recent outcomes

Library
  Media
    Grid
    List
    Media Details
  Playlists
    Playlist list
    Playlist Details / membership

Channels
  Channel list
  Channel Details
    Overview
    Backup settings
    Schedule summary
    Source sync

Activity
  Active
    Operation Details
      Overview
      Technical details
  History
    Run Details
  Needs attention
    Blocked and failed operations

Storage
  Destination list
  Add destination
  Destination Details

Integrity
  Overview
  Issues
  Verification history
  Verify flow
  Repair flow

Settings
  General
  Accounts
  Backup
  Scheduling
  Integrity
  Notifications
  Advanced
    Diagnostics
  Recovery
  About
```

### 4.1 Stable target view identifiers

The renderer route adapter needs deterministic target views even though the current internal notification schema still uses legacy section names. Proposed semantic view IDs are:

| Destination | Target view IDs                                                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home        | `home`                                                                                                                                                                                        |
| Library     | `library.media`, `library.playlists`, `library.media-details`, `library.playlist-details`                                                                                                     |
| Channels    | `channels`, `channels.details`, `channels.backup`, `channels.schedule`                                                                                                                        |
| Activity    | `activity.active`, `activity.history`, `activity.attention`, `activity.details`                                                                                                               |
| Storage     | `storage`, `storage.add`, `storage.details`                                                                                                                                                   |
| Integrity   | `integrity.overview`, `integrity.issues`, `integrity.history`, `integrity.verify`, `integrity.repair`                                                                                         |
| Settings    | `settings.general`, `settings.accounts`, `settings.backup`, `settings.scheduling`, `settings.integrity`, `settings.notifications`, `settings.advanced`, `settings.recovery`, `settings.about` |

These are target renderer identifiers, not permission to rename the existing validated `InternalRoute` contract. Until an additive route/subview contract exists, the adapter maps a stable legacy section to the safest parent target and resolves `entityId` only through deterministic typed data.

## 5. Destination definitions

### 5.1 Home

Home answers:

1. Is my archive healthy?
2. Is anything happening?
3. Does anything need my attention?

Home is not an analytics dashboard. It contains one dominant health statement, one contextual primary action, and a small number of supporting summaries.

### 5.2 Library

Library is the content center. Its local sub-navigation contains:

- `Media`
- `Playlists`

Media supports Grid and List views. Playlists retains a master-detail pattern on desktop. Media Details is a substantial route-like surface, not a narrow technical modal.

### 5.3 Channels

Channels owns:

- which channels are managed;
- channel identity and catalog sync;
- backup destination selection;
- quality override;
- explicit quality-upgrade policy when selected quality increases: upgrade existing eligible copies or apply only to new media;
- schedule summary and override;
- channel-level health and backup action.

Google identity management does not live here. When a channel needs authorization, the resolution links to Settings > Accounts.

### 5.4 Activity

Activity unifies the current Queue and Backup History presentation.

#### Active

Shows operations that are running, waiting, retrying, or paused. A row represents a user-level operation or media item where possible, not an internal job.

#### History

Shows two related kinds of operational history:

- operation outcomes, such as backup, verification, and repair;
- archive changes, such as new media, title/thumbnail/playlist changes, source removals, destination connection changes, and authorization attention.

Backup runs expose only the latest 50 and Integrity embeds only the latest 100 checks; neither supports paging or filtering. The worker database records archive changes in `activity_log`, but no typed renderer query exposes them. Source sync has no history-list contract, and recovery exposes only the latest or a known session. Complete, paged, or filtered History requires worker-owned queries; the first implementation must label its bounded view and must not synthesize changes from notifications or current catalog state.

#### Needs attention

Shows blocked and failed operations with an explanation and a resolution. Integrity issues may be summarized here but open the specialized Integrity workflow.

#### Technical details

Operation Details may reveal durable steps, job status, attempts, retry time, destination, error code, and priority controls. This is a disclosure, not a default tab in the main navigation.

### 5.5 Storage

Storage owns destination identity and availability:

- filesystem paths, without inventing an internal/external/network classification;
- Google Drive app-owned roots;
- capacity when known;
- copy coverage and last backup when contracts provide it;
- integrity summary;
- add, open, and disable actions. Drive auth-required state links to the existing capability-specific account OAuth flow. There is no explicit destination-ID reconnect/re-enable action; re-adding the same trusted path/volume or Drive account currently re-enables the stable match.

Filesystem capacity describes the containing volume's total and available space. It is not archive-owned bytes.

Backup quality is not a storage property and moves to Settings > Backup or a channel override.

### 5.6 Integrity

Integrity owns copy verification and repair:

- current health conclusion;
- missing and corrupt copies;
- disconnected and authorization-needed conditions;
- manual verification;
- verification strength details;
- the worker-selected verified repair source and the user's explicit YouTube-fallback decision;
- verification history.

It does not create a protection score. It reports actual copy state.

### 5.7 Settings

Settings uses a persistent local category list and a dense detail pane.

#### General

- Start with Windows.
- Start minimized.
- Keep running in tray.
- Application update preference, `Check for updates`, and the `v1.x available` / `Update` / `Later` flow after narrow safe GitHub Releases and packaged-update contracts exist.

#### Accounts

- Google identity.
- YouTube read-only capability.
- Drive capability.
- Connected channels.
- Reconnect and disconnect actions.
- Optional authenticated YouTube download-session state when implemented.

#### Backup

- Global default quality.
- Quality-upgrade policy when a higher default would affect existing lower-quality verified copies.
- Default destinations when supported by the current contract.
- Safe backup defaults.
- Concurrency and bandwidth controls only after typed settings support exists.

#### Scheduling

- Global schedule.
- Channel overrides.
- Catch-up and startup behavior.
- Windows automation state in plain language.

#### Integrity

- Periodic verification frequency, time, scope, and Drive verification mode.

#### Notifications

- Individual notification categories.

#### Advanced

- Tool versions and readiness.
- yt-dlp Stable/Nightly channel and update action after a narrow verified managed-binary update contract exists; FFmpeg remains pinned to the app release.
- Application data, database, staging, and log locations.
- Open logs.
- Export diagnostics and copy system info when available.
- Safe technical details.

#### Recovery

- Restore existing backup.
- Resume an incomplete recovery session.
- Recovery explanation and safety boundaries.

#### About

- Application version.
- Free and open-source statement.
- GitHub, report issue, and support links when configured.

## 6. Old-to-new navigation mapping

| Current destination or surface        | Target destination                                                     | Change                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Dashboard                             | Home                                                                   | Rename and rebuild around health, active work, and attention.                      |
| Accounts                              | Settings > Accounts                                                    | Move configuration out of daily navigation. Channel enablement moves to Channels.  |
| Channels                              | Channels                                                               | Retain, but make it the owner of per-channel backup settings and schedule summary. |
| Library                               | Library > Media                                                        | Retain as the core content experience.                                             |
| Playlists                             | Library > Playlists                                                    | Merge into Library as a content lens.                                              |
| Backup                                | Channels, Channel Details, Start Backup dialog, and Activity > History | Remove as a primary destination. Keep its actions and configuration contextually.  |
| Queue                                 | Activity > Active and Needs attention                                  | Translate jobs into user-level operations.                                         |
| Backup History                        | Activity > History                                                     | Merge run history with operation outcomes.                                         |
| Backup Details modal                  | Library > Media Details                                                | Replace the narrow modal with a full details surface or wide contextual pane.      |
| Storage                               | Storage                                                                | Retain, focused on destinations. Move quality and tools elsewhere.                 |
| Integrity                             | Integrity                                                              | Retain, rewritten in human language with issues-first hierarchy.                   |
| Settings                              | Settings categories                                                    | Replace the long card stack with local navigation and settings rows.               |
| Scheduling in Settings                | Settings > Scheduling                                                  | Give it a dedicated category.                                                      |
| Periodic Integrity in Settings        | Settings > Integrity                                                   | Give it a dedicated category.                                                      |
| Disaster Recovery                     | Settings > Recovery                                                    | Keep a dedicated nested workflow and first-run entry point.                        |
| yt-dlp / FFmpeg / Drive runtime cards | Settings > Advanced > Diagnostics                                      | Remove from primary Storage.                                                       |
| Worker ready                          | Exception-only titlebar status and Diagnostics                         | Remove the permanent healthy-state label.                                          |
| Read-only sidebar copy                | Onboarding, Accounts permission details, Recovery, and About           | Keep the trust promise where it affects a decision.                                |

## 7. Core user journeys

### 7.1 First run: new archive

```text
Home empty state
  -> Set up backup
  -> Connect Google
  -> Select channels
  -> Add one or more destinations
  -> Choose quality
  -> Configure schedule
  -> Review
  -> Start first backup
  -> Activity > Active
```

The guided flow is progressive. It does not expose tool installation, worker status, raw scopes, or internal job steps.

Each step persists through existing narrow account, channel, destination, and settings calls; onboarding is not one atomic wizard transaction. It reconstructs progress from persisted state so a partial setup can resume. Because `startBackup` currently accepts one channel, the final step either names and starts one channel or uses an explicit chooser/sequential flow. It does not imply an aggregate start contract.

### 7.2 First run: restore existing archive

```text
Home empty state
  -> Restore existing backup
  -> Add local sources and/or authorize Drive-only recovery access
  -> Run initial scan, including discovered app-created Drive roots
  -> Review and adjust Drive roots when multiple are found
  -> Scan again if root selection changed
  -> Review recovered catalog and warnings
  -> Explicitly confirm import
  -> Library
```

Scan and import remain separate. Under the current contract, Drive roots are discovered during the first scan and newly found roots are initially selected; they are not selectable before that scan. Changing root selection in review invalidates the preview and requires another scan. A separate pre-scan root-discovery step would require a new narrow action. The flow can resume the latest incomplete session, and the screen states what will and will not change before confirmation. Recovery authorization remains independent from normal YouTube authorization after database loss.

### 7.3 Daily health check

```text
Open app
  -> Home health statement
  -> no issue: optionally Back up now
  -> issue: open Needs attention
  -> resolve in Activity, Storage, Accounts, or Integrity
```

### 7.4 Find an archived item

```text
Library
  -> search or filter
  -> Media Details
  -> inspect source and copies
  -> open local folder / open on YouTube / open Drive / verify / repair
```

Search remains catalog-based and works while external storage is disconnected.

### 7.5 Monitor and control backup

```text
Home or Channels
  -> Back up now
  -> Activity > Active
  -> Operation Details
  -> pause / resume / cancel
```

Cancel uses an application dialog with explicit choices:

- `Cancel and keep partial data`
- `Keep backup running`

`Cancel and remove partial data` remains available only for an individual job under the current contract. It must not appear as a run-level choice or be fanned out across jobs by the renderer. Verified copies are never presented as deletion targets.

### 7.6 Resolve an integrity issue

```text
Home / Activity attention
  -> Integrity issue
  -> inspect target and the worker's suggested recovery path
  -> Repair
  -> confirmation only when YouTube is the fallback
  -> Activity > Active
  -> Integrity outcome
```

## 8. Global actions and cross-links

### Back up now

`Back up now` appears:

- as the Home primary action when at least one channel is eligible;
- on each Channel row;
- in Channel Details.

The Home action starts all eligible selected channels only when that scope is explicit in the label, such as `Back up all channels`. Until a typed aggregate-start flow is verified, Home may open a compact channel chooser that calls the existing per-channel start contract safely.

### Search

Search is local to Library. The redesign does not add a global command palette or fake global search.

### Attention links

Attention summaries target the owning resolution when deterministic target/subview routing exists; otherwise they open its safe parent destination:

- authorization -> Settings > Accounts;
- disconnected/full/read-only destination -> Storage;
- missing/corrupt copy -> Integrity;
- blocked/failed operation -> Activity > Needs attention;
- schedule failure -> Settings > Scheduling.

### Notifications

Notification routes remain stable internal concepts. The renderer maps them into the new IA:

| Stable internal section | Target presentation                                      |
| ----------------------- | -------------------------------------------------------- |
| `dashboard`             | Home                                                     |
| `backup`                | Activity > History or a specific Run Details view        |
| `queue`                 | Activity > Active or a specific Operation Details view   |
| `storage`               | Storage or Destination Details                           |
| `integrity`             | Integrity or a specific issue                            |
| `settings`              | Settings parent until a validated category target exists |

The full pending-notification DTO includes category, title, body, and a route. The renderer's internal-route event delivered on notification click carries only the legacy route's `section` and optional `entityId`, with no target/subview discriminator, and the current renderer ignores `entityId`. Specific details and Settings-category links require an additive target/subview contract or deterministic entity resolution. Until then, open the correct parent view and preserve a safe explanation.

## 9. Terminology model

| Internal or current term | Normal user term                                                     | Deeper technical term           |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------- |
| Dashboard                | Home                                                                 | Dashboard summary DTO           |
| Catalog media            | Items or media                                                       | Catalog media                   |
| Queue                    | Activity                                                             | Durable jobs                    |
| Recovery steps           | Processing steps                                                     | Job DAG                         |
| Worker ready             | No healthy-state message                                             | Worker connected                |
| PROVIDER_METADATA_SIZE   | Standard verification                                                | Provider metadata and file size |
| DOWNLOADED_SHA256        | Full file verification                                               | Downloaded SHA-256              |
| AUTH_REQUIRED            | Sign in again                                                        | Auth required                   |
| DISCONNECTED             | Contextual: `Filesystem unavailable` or `Drive account disconnected` | Destination disconnected        |
| COMPLETED_WITH_ERRORS    | Completed with issues                                                | Completed with errors           |
| Source reconciliation    | Source update                                                        | Source reconciliation           |
| Sync channel             | Refresh channel                                                      | Source sync                     |
| Backup copy              | Copy                                                                 | Media copy                      |
| Disaster recovery        | Recovery                                                             | Recovery session/import         |

`Verified` is never softened into `Safe` unless verification actually passed. `Unavailable` is not `Missing`. `Standard verification` must not imply downloaded SHA-256 strength.

## 10. Contract-aware limits

The target IA may group existing information without changing ownership. Some richer views require deliberate typed contract work:

| Target need                                                                     | Current limit                                                                                                                                                               | Design requirement                                                                                                                                                           |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home active work, attention, recent outcomes, destination and channel summaries | Dashboard DTO mainly exposes counts and last backup time                                                                                                                    | Compose existing typed queries initially or add one worker-owned aggregate DTO. Do not infer from stale UI state.                                                            |
| Library backup/copy filters                                                     | `CatalogQuery` supports search, channel, media type, source status, and paging only                                                                                         | Add worker-owned backup status, destination, and quality filters. Renderer-side filtering of paged results would be incorrect.                                               |
| User-level active operations                                                    | Queue snapshot exposes jobs plus a separate completed-media list, not a durable operation aggregate                                                                         | Add a worker-owned operation DTO/query or document deterministic composition and progress rules with tests. Never infer completion from visible child jobs.                  |
| Active source sync and Recovery in Activity                                     | Queue excludes channel sync; sync requires a known `syncId`; Recovery is exposed through latest/get-by-known-session contracts                                              | Keep source refresh on Channel and Recovery in its workflow initially, or add a worker-owned rediscoverable active-operation query before showing them in Activity.          |
| Unified Activity history                                                        | Backup runs are capped at 50 and Integrity history at 100; neither is paged/filterable; source sync has no history list and Recovery exposes latest/known sessions only     | Label the bounded interim histories. Add typed paged/filterable history contracts before promising a complete cross-operation timeline.                                      |
| Required archive-change history                                                 | Worker-owned `activity_log` records catalog, playlist, destination, auth, backup, verification, and repair events, but no renderer query exposes it                         | Add a worker-owned paged/filterable Activity-log DTO/query and present those events in Activity > History. Do not reconstruct them from notifications or current rows.       |
| Aggregate operation cancellation                                                | Run control supports pause, resume, and cancel-keep-partial; remove-partial exists only on an individual job                                                                | Do not offer run-level remove-partial or fan out destructive job commands from the renderer. Add a narrow aggregate contract first.                                          |
| Rich Media Details                                                              | Current backup-details DTO lacks channel, thumbnail, date, duration, playlist membership, and source URL, and there is no catalog detail query by media ID                  | Add an explicit enriched detail DTO/query before deterministic details deep links. Do not invent values.                                                                     |
| Media source/copy actions                                                       | No narrow Open-on-YouTube or direct per-media add/copy-to-destination action exists                                                                                         | Add fixed validated main/worker actions. Never expose a generic URL or filesystem bridge.                                                                                    |
| Media repair                                                                    | Repair eligibility comes from Integrity, and `startRepair(copyId, allowYoutubeFallback)` leaves source selection to the worker                                              | Display eligible context and let the user decide only whether YouTube fallback is allowed. Do not add a manual repair-source menu.                                           |
| Destination details                                                             | Destination DTO lacks copy count/bytes, last-backup summary, and destination-level integrity summary; capacity is volume capacity                                           | Label current values precisely and add worker-owned summaries before showing richer destination health.                                                                      |
| Integrity issue/history paging                                                  | Global/channel health is complete, but media, issues, and history arrays are each capped at 100 with no totals or paging/filter input                                       | Add worker-owned paged/filterable issue and history queries. Do not filter a bounded renderer sample or present it as complete.                                              |
| Destination actions/classification                                              | No explicit destination-ID reconnect, re-enable, or manual-probe action and no reliable internal/external/network classification field; re-add can re-enable a stable match | Explain the trusted re-add recovery path or add narrow direct actions. Drive auth uses Settings > Accounts. Hide unsupported classifications.                                |
| Recovery discovery/history                                                      | Recovery supports Drive-only authorization, root discovery/selection, latest session, and get-by-known-session, not a general history list                                  | Preserve explicit root choice, preview invalidation, rescan, and latest-session resume without inventing history.                                                            |
| Multi-channel backup                                                            | `startBackup` accepts one channel                                                                                                                                           | Use an explicit chooser or sequential orchestration with defined failure/deduplication behavior, or add an aggregate worker contract.                                        |
| Quality upgrades                                                                | Current settings can increase quality, but backup planning skips existing verified copies and exposes no eligibility preview or upgrade-existing policy                     | Add worker-owned eligibility/decision contracts. When quality rises, require `Upgrade existing eligible copies` or `Apply only to new media`; never duplicate logical media. |
| Advanced settings                                                               | Renderer patch does not expose every stored option                                                                                                                          | Hide unsupported controls until a narrow validated contract exists.                                                                                                          |
| Application updates                                                             | `checkForUpdates` is stored but renderer editing and GitHub Releases check/download/install actions are not exposed                                                         | Add narrow integrity-verified updater contracts and packaged install/rollback semantics before the `v1.x available` / `Update` / `Later` flow is functional.                 |
| yt-dlp channel and update                                                       | Diagnostics expose version/readiness only; no renderer-safe Stable/Nightly selection or managed-binary update action exists                                                 | Add an allowlisted, integrity-verified, atomic managed-tool update contract with rollback. Keep FFmpeg pinned to the application release.                                    |
| Live titlebar state                                                             | Foundation state is mostly a startup snapshot                                                                                                                               | Show exception-only status sourced from active typed data. Do not imply continuous health monitoring without it.                                                             |
| Entity deep links and subviews                                                  | Existing route carries only legacy `section` and optional `entityId`; renderer ignores `entityId` and receives no target/category                                           | Add a validated target/subview field or deterministic entity resolution, plus regression tests, before claiming specific details or Settings-category links.                 |

## 11. IA acceptance criteria

- No more than seven primary navigation destinations.
- Accounts, Recovery, Diagnostics, and tool versions are not primary navigation.
- Playlists is visibly part of Library.
- There is no top-level Backup destination.
- Queue and Backup History appear as one Activity mental model.
- Home answers health, active work, and attention within one viewport at 1120 by 760.
- Every primary action has one clear owner.
- Technical job steps, hashes, provider IDs, and tool versions require deliberate disclosure.
- Notification routing maps safely into the new IA.
- Compact navigation works at 880 by 620 without hiding destination labels from keyboard and screen-reader users.
- The renderer does not gain database, generic filesystem, generic shell, or generic BrowserWindow access.
