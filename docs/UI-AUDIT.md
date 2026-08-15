# YouTube Backup Manager UI Audit

Status: Phase 7A current-state audit; scope: UX, visual hierarchy, interaction, copy, desktop behavior, and accessibility risk; evidence date: 2026-08-13.

## 1. Audit purpose

This audit documents the current renderer before the Phase 7A redesign. It treats the existing interface as evidence of product capabilities, not as a layout template.

The redesign must preserve the mature backup behavior, worker authority, typed IPC contracts, recovery boundaries, and read-only YouTube model. It does not need to preserve the current navigation, page composition, card system, labels, or visual chrome.

The target user needs to answer four questions without understanding the job engine:

1. Are my backups healthy?
2. What is happening now?
3. What needs my attention?
4. Where can I find or restore a specific archived item?

## 2. Evidence reviewed

### Product and implementation

- `MVP.md`
- `ARCHITECTURE.md`
- `DATABASE.md`
- `JOB-ENGINE.md`
- `CODEX-HANDOFF.md`
- `docs/Phase 7A - UX-UI Design Overhaul.md`
- Complete current renderer in `apps/desktop/src/renderer/src/App.tsx`
- Complete current renderer styles in `apps/desktop/src/renderer/src/styles.css`
- Current Electron window creation, main-process mediation, preload bridge, DTOs, and tests

### Current-screen screenshots

- `docs/ui-reference/current/dashboard.png`
- `docs/ui-reference/current/accounts.png`
- `docs/ui-reference/current/channels.png`
- `docs/ui-reference/current/library.png`
- `docs/ui-reference/current/playlist.png`
- `docs/ui-reference/current/backup.png`
- `docs/ui-reference/current/quueue.png`
- `docs/ui-reference/current/storage.png`
- `docs/ui-reference/current/integrity.png`
- `docs/ui-reference/current/settings.png`

The supplied screenshots are approximately 1100 by 755 pixels and closely reflect the current 1120 by 760 default window. They are therefore representative desktop evidence, not narrow mobile captures.

### Visual references

- `docs/ui-reference/inspiration/faceit-titlebar.png`
- `docs/ui-reference/inspiration/faceit-sidebar.png`
- `docs/ui-reference/inspiration/faceit-settings.png`
- `docs/ui-reference/inspiration/faceit-statistics.png`
- `docs/ui-reference/inspiration/faceit-statistics-2.png`
- `docs/ui-reference/netflix-DESIGN.md`
- `docs/ui-reference/taste-SKILL.md`

## 3. Current application structure

The current renderer is one 3,185-line React component that owns 11 section states, polling, mutations, overlays, and all screen markup. The ten visible primary destinations are:

```text
Dashboard
Accounts
Channels
Library
Playlists
Backup
Queue
Storage
Integrity
Settings
```

`recovery` is an eleventh hidden section reached from Dashboard or Settings. Media details is a modal state. Playlist details is a selected pane state. There is no router, entity deep link, or view history.

The current shell has:

- the native Windows/Electron title bar;
- a visible `File Edit View Window` menu strip;
- a 232px fixed sidebar;
- a repeated brand lockup and repeated page eyebrow;
- account and media-count chips on every page;
- persistent `Worker ready` and read-only YouTube copy;
- a dark blue developer-dashboard palette;
- pervasive bordered, rounded cards and pills.

This creates three layers of app identity before the user reaches content: the Windows title, the sidebar brand, and the page eyebrow. It also gives internal health and implementation language permanent prominence.

Live-state behavior is also concentrated in the same component:

- OAuth and source-sync status poll every second.
- Queue state polls every second.
- Integrity state polls every two seconds.
- Recovery polls every 750ms while scanning or importing.
- Library and playlist queries use a 200ms debounce.
- One global `busy` key can disable controls unrelated to the operation in progress.

These timings, cancellation cleanups, and single-action ownership are behavioral migration constraints. Running old and new views together would duplicate RPC traffic and can duplicate commands.

## 4. Cross-product findings

### 4.1 The interface is organized around implementation areas

The current navigation mirrors development phases and backend concepts more than user mental models. Accounts, Backup, Queue, Playlists, and Settings are all peers even though they represent different kinds of destinations:

- Accounts is configuration.
- Backup is an action plus per-channel configuration.
- Queue is one state of ongoing activity.
- Playlists is a Library lens.
- Settings contains several independent configuration domains.

The result is a high navigation cost and repeated concepts. Channel identity and controls appear in Accounts, Channels, Backup, Library filters, Integrity scopes, and Scheduling.

### 4.2 Card use has erased hierarchy

Cards are used for metrics, accounts, channels, destination pickers, history, queue filters, dependencies, destinations, health, settings, recovery, empty states, and modal copy details. Because nearly every group is elevated, elevation no longer indicates importance or containment.

The redesign should reserve cards or raised panels for one of three reasons:

1. The item is a visually independent media object.
2. The item needs temporary elevation over its surroundings.
3. The group must remain together during scrolling or interaction.

Rows, dividers, split panes, section spacing, and tonal surface changes should handle most other grouping.

### 4.3 Status has too many dialects

Current labels include `CONNECTED`, `COMPLETED`, `AVAILABLE`, `Ready`, `Worker ready`, `AUTHORIZATION REQUIRED`, and `0 active uploads`. Green is used for account authorization, source state, destination state, tool installation, copy state, worker state, and job completion.

These are not interchangeable concepts. The redesign needs one translation layer that distinguishes:

- backup health;
- source availability;
- destination availability;
- authorization state;
- activity state;
- verification strength;
- technical runtime readiness.

Raw enum text must remain available for diagnostics where helpful, but it should not be normal user copy.

### 4.4 Important product state is scattered

Backup state appears in:

- Dashboard counters;
- Backup history;
- Queue jobs;
- Media Details copy rows;
- Integrity health and issues;
- periodic-integrity settings.

There is no single place to understand an operation from start to outcome. The user moves between Backup and Queue for one run, then Integrity for a related failure. This should become a unified Activity surface for operations, with Integrity retaining the specialized verification and repair workflow.

### 4.5 Technical information is too prominent

The current interface exposes or explains:

- Phase 2 behavior;
- logical-channel normalization;
- catalog media terminology;
- recovery steps and job types;
- provider verification names;
- SHA-256 as a primary action label;
- yt-dlp and FFmpeg versions;
- raw Drive provider IDs;
- worker readiness;
- catalog-authorized copy IDs;
- Windows Task Scheduler details.

This information can be operationally valuable. It should move under `Details`, `Technical details`, `Advanced`, or `Diagnostics`, unless the user must act on it immediately.

### 4.6 The global header is repetitive and unreliable

Every page repeats an uppercase product eyebrow, the page title, an account count, and an indexed-media count. These counts are usually unrelated to the page task. The media count is populated from Library query state, which can show `0 media indexed` until Library is opened even when Dashboard reports 1,219 items.

The redesigned page header should contain only:

- the current page title;
- a short task-specific description when needed;
- the primary page action;
- contextual controls that belong to that page.

### 4.7 Desktop space is used inconsistently

- Dashboard is extremely sparse after eight equal metrics.
- Settings is too vertically expensive because each group is a large card.
- Playlist content is overly compressed inside a sensible split pane.
- Integrity visibly collapses at the supplied desktop width.
- Wide tables and toolbars have incomplete compact-width behavior.

The redesign must remain useful at the existing 880 by 620 minimum and use the full canvas at 1440p and 4K without becoming a narrow centered website.

## 5. Screen-by-screen audit

### 5.1 Dashboard

Evidence: `dashboard.png` and the `dashboard` renderer section.

#### Actual user goal

Understand overall backup health, see active work, identify attention items, and start the next useful action.

#### Current primary action

- Empty state: `Set up new backup`.
- Populated state: none.

#### Current secondary actions

- Empty state: `Restore existing backup`.
- Populated state: none.

#### Information that deserves prominence

- A plain-language health conclusion based on intended and verified copies.
- Active backup or verification work.
- Failures, blocked work, disconnected destinations, or authorization problems.
- Last completed backup.
- A clear `Back up now` action.

#### Information currently too prominent

- Selected-channel count.
- Local and Drive counts as equal headline metrics.
- Zero-value pending and failed cards when there is no issue.
- Top-right account and media chips.

#### What should move deeper

- Copy-type breakdown belongs in a health details disclosure.
- Raw totals belong in a compact summary, not eight equal cards.

#### Redundancy and hierarchy problems

- Eight identical cards give failures and routine counts equal weight.
- The page does not say `All backups are healthy` or explain what is incomplete.
- There is no active-operation or recent-activity region.
- Half the page is unused.
- The screenshot contradicts itself with `0 media indexed` and `Catalog media 1219`.
- `131 / 131` lacks a clear relationship to 1,219 catalog items.
- Dashboard data is not refreshed after ordinary backup completion, so the populated summary can become stale.
- The welcome path appears only when both catalog media and destinations are absent. A partly configured installation can enter the metric view without a clear way to resume setup.

#### Preserve

- Intended versus verified copy semantics.
- Local and Drive coverage.
- Pending and failed counts.
- Verified bytes and last backup time.
- The first-run choice between new setup and restoring an existing backup.
- Loading, healthy, partial, failed, and empty states.

### 5.2 Accounts

Evidence: `accounts.png` and the `accounts` renderer section.

#### Actual user goal

Connect and maintain Google identities, understand separate YouTube and Drive permissions, discover accessible channels, and choose which channels are managed.

#### Current primary action

- `Connect Google`.

#### Current secondary actions

- Refresh channels.
- Reconnect YouTube.
- Enable or reconnect Drive.
- Disconnect credentials.
- Enable or disable accessible channels.
- Open logs.

#### Information that deserves prominence

- Google identity.
- YouTube read-only connection state.
- Drive connection state.
- Reauthorization needed.
- Connected channels.

#### Information currently too prominent

- `Open logs` beside the primary connection action.
- Credential-storage implementation text.
- Three or four equal buttons in every account row.
- Raw provider identifiers when a handle is missing.

#### What should move deeper

- Logs to Settings > Advanced > Diagnostics.
- Disconnect to an overflow menu with a confirmation explaining that backups and catalog remain.
- Channel enablement to Channels or a channel-selection onboarding step.

#### Redundancy and hierarchy problems

- Account management and channel selection are two tasks on one long page.
- YouTube and Drive status pills are correct concepts but use dense uppercase enum language.
- `Refresh channels` wraps at the supplied width.
- The channel checkboxes have no visible column label and their effect is unclear.
- `Manage` and `backupEnabled` are not expressed as one stable concept.

#### Preserve

- Multiple Google identities.
- Separate YouTube read-only and Drive capabilities on one identity.
- Explicit Drive permission confirmation.
- Pending, completed, failed, expired, and reauthorization OAuth states.
- OAuth configuration unavailable, no-account, no-channel, account error, disconnected, and Drive authorization-required states.
- One logical channel accessible through multiple accounts.
- Disconnecting credentials without deleting backups or catalog records.

### 5.3 Channels

Evidence: `channels.png` and the `channels` renderer section.

#### Actual user goal

Understand each managed channel's backup state, refresh its source catalog, review its schedule and destinations, and start a backup.

#### Current primary action

- `Backup now`, which currently only navigates to Backup.

#### Current secondary action

- `Sync channel`.

#### Information that deserves prominence

- Channel identity.
- Backup health.
- Last backup.
- Next scheduled backup.
- Destination coverage.
- Whether source sync needs attention.

#### Information currently too prominent

- Three equal video, Short, and Live statistic boxes.
- A generic `COMPLETED` pill.
- Repeated zero Live counts.

#### What should move deeper

- Detailed catalog composition to channel details.
- Provider channel ID to technical details.
- Per-channel quality and destination overrides to a channel settings panel.

#### Redundancy and hierarchy problems

- Nested statistic panels repeat cardification.
- `COMPLETED` does not identify what completed.
- `No media is downloaded in Phase 2` is stale internal release language.
- Backup action and backup configuration are split across two top-level screens.
- Current cards omit actual backup health, last backup, next schedule, and destination state.

#### Preserve

- Source catalog sync as a separate read-only operation.
- Sync progress and safe failures.
- Video, Short, and Live counts.
- Last sync time.
- Queued, running, retry, complete, and failed sync states.

### 5.4 Library

Evidence: `library.png` and the `library` renderer section.

#### Actual user goal

Find archived or indexed media across all channels, understand its source and backup state, and open details.

#### Current primary action

- Open media details.

#### Current secondary actions

- Search.
- Filter by channel, type, and source state.
- Switch Grid/List.
- Paginate.

#### Information that deserves prominence

- Thumbnail.
- Title.
- Channel.
- Backup health or copy availability when it is not healthy.
- Duration and media type as restrained metadata.

#### Information currently too prominent

- `VIDEO` on every thumbnail.
- `AVAILABLE` on every healthy card.
- Card borders around every media item.

#### What should move deeper

- Full source-state text for normal healthy items.
- Published date and technical metadata to List or Details.

#### Redundancy and hierarchy problems

- The content-forward direction is correct, but repeated pills compete with imagery.
- Titles are restricted to one truncated line.
- Metadata is extremely small.
- Grid/List looks visually fused.
- The grid items are clickable `article` elements and are not keyboard-operable.
- Library cannot filter by required backup status, destination, or quality with the current query. Playlist filtering is an optional enhancement where it proves useful.
- Query changes retain stale results without a dedicated loading state.

#### Preserve

- Search while backup drives are disconnected.
- Grid and administration-oriented List modes.
- Debounced search and pagination.
- Channel, media type, and source-state filtering.
- Missing-thumbnail and unknown-duration behavior.
- Long-title handling.
- Empty, loading, error, and disconnected-storage states.

### 5.5 Playlists

Evidence: `playlist.png` and the `playlists` renderer section.

#### Actual user goal

Find a playlist and inspect its ordered current catalog membership.

#### Current primary action

- Select a playlist.

#### Current secondary actions

- Search playlists.
- Filter by channel.
- Paginate playlists.

#### Information that deserves prominence

- Playlist title and channel.
- Item count.
- Selected state.
- Ordered media membership with readable thumbnails and titles.

#### Information currently too prominent

- The generic `AVAILABLE` pill in the detail header.
- Borders around the entire split pane and every member row.

#### What should move deeper

- Source status should appear only when exceptional or inside details.
- Playlist provider ID belongs in technical details.

#### Redundancy and hierarchy problems

- The master-detail structure is strong, but it is visually disconnected from Library.
- Member type and duration are too small.
- Titles truncate aggressively.
- Selected playlist state is not cleared when filters change.
- Only the first 50 members are shown despite a pageable contract.
- Playlist members cannot open media details.

#### Preserve

- Master-detail navigation.
- Ordered membership.
- Search, channel filtering, and playlist pagination.
- Source removal status.
- No-selection, empty-playlist, loading, and error states.

### 5.6 Backup

Evidence: `backup.png` and the `backup` renderer section.

#### Actual user goal

Use saved settings to start a backup, update the channel's persisted destinations or quality, and review prior runs.

#### Current primary action

- `Backup now` for one channel.

#### Current secondary actions

- Choose a quality override.
- Select destinations.
- Go to Storage when no destination exists.
- Pause or resume a running backup from history.

#### Information that deserves prominence

- Channel.
- Effective destinations and availability.
- Effective quality.
- Whether backup can start.
- Last run outcome.

#### Information currently too prominent

- Repeated channel identity already visible in Channels.
- Availability pills beside every destination.
- `Effective: Best available` beneath every quality control.
- History as large cards.

#### What should move deeper

- Persistent quality and destination configuration to channel backup settings.
- Historical run details to Activity > History.
- Technical planning counts to operation details.

#### Redundancy and hierarchy problems

- Destination names truncate where identity matters.
- Disabled primary buttons do not explain why they are disabled.
- The primary button wraps.
- Controls have weak boundaries.
- Copy such as `plan one durable backup run` and `recoverable processing steps` describes architecture rather than outcome.
- Backup history and Queue divide one workflow across two primary destinations.
- Global default quality is on Storage while per-channel quality is here.
- History labels `localCopyCount` as `verified copies` while omitting Drive upload count, failure count, trigger, destinations, and effective quality.

#### Preserve

- Quick backup using saved settings.
- Per-channel quality override and global default.
- One or multiple destinations.
- Per-destination availability without whole-run gating. A disconnected destination branch may wait while other selected destinations continue.
- Durable planning, already-verified skips, and method-specific long start timeout.
- Run history and run-level pause/resume.
- Pending, running, paused, completed, completed-with-issues, failed, cancelled, and interrupted run outcomes.
- Manual, custom-manual, scheduled, and startup trigger identity in the current bounded Backup History. Verification and repair context exists in queue/integrity surfaces; a unified cross-operation history requires additive contracts. Recovery is not exposed as a backup-run trigger in current history.
- No blind retry after a client timeout because the worker may have persisted a run.

### 5.7 Queue

Evidence: `quueue.png` and the `queue` renderer section.

#### Actual user goal

Understand active work, see what is waiting or blocked, intervene safely, and review completed operations.

#### Current primary action

- Monitor or pause active work.

#### Current secondary actions

- Resume.
- Cancel and choose whether to preserve partial data.
- Move waiting work to the top.
- Adjust priority.
- Filter by state.
- Open completed media details.

#### Information that deserves prominence

- The user-level operation or media title.
- Current phase in plain language.
- Progress, bytes, speed, and ETA when known.
- What happens next.
- Blocking condition and one actionable resolution.

#### Information currently too prominent

- Seven equal counter cards.
- `All recovery steps` and a count of 3,149.
- Raw job and operation enum names.
- Priority controls in the normal view.

#### What should move deeper

- Durable job DAG to `Technical details`.
- Individual job priority to an advanced operation view.
- Completed media list and backup history into a unified History tab.

#### Redundancy and hierarchy problems

- Filters mix jobs, completed media, and engine steps as if they were one unit.
- The selected zero-state card is red and resembles an error.
- `Nothing in this view` is not a useful empty-state title.
- The interface says an advanced view exists without clearly presenting one.
- Cancel uses a native confirm where choosing `Cancel` in the prompt still cancels the job but preserves partial data.
- One media item can appear as several internal jobs instead of one understandable operation.

#### Preserve

- Active, waiting, retrying, paused, blocked/failed, and completed distinctions.
- Durable job control semantics.
- Pause, resume, and cancel. Keep/remove-partial is currently an individual-job choice, not an aggregate run capability.
- Reprioritization.
- Progress, speed, ETA, retry time, and safe error messages.
- Live polling or event-driven updates and fresh snapshot after reconnect.
- Completed verification and destination information.

### 5.8 Backup Details / Media Details

Evidence: renderer `mediaDetails` modal. No supplied screenshot captures this state.

#### Actual user goal

Understand one media item's source state, archived copies, copy health, quality, and available actions.

#### Current primary action

- Verify all copies.

#### Current secondary actions

- Verify one copy.
- Open a verified local folder.
- Open a Drive object.
- Close.

#### Information that deserves prominence

- Thumbnail or player region.
- Title and channel.
- YouTube source availability.
- Each intended destination and copy health.
- Quality and size.
- Repair action when relevant.

#### Information currently too prominent

- Destination path.
- Raw verification method.
- A truncated SHA-256 value.

#### What should move deeper

- Hash, provider identity, codec, container, and verification implementation to Technical details.

#### Redundancy and hierarchy problems

- The narrow modal is not a full media details experience.
- It lacks thumbnail, channel, playlists, source action, published date, and duration.
- It does not render the media type or source status already present in its current DTO.
- MVP actions such as opening the source on YouTube, repairing an eligible copy, and adding or copying to a destination have no complete current details workflow.
- Copy status and destination availability are combined into terse text.
- The dialog has no explicit focus trap, Escape handling, or focus restoration.

#### Preserve

- Multiple independent copies.
- Difference between a copy's verification state and a destination's availability.
- Availability-gated local and Drive open actions.
- Per-copy and per-media verification.
- Refresh after a missing/unavailable open result.
- No-copy state and technical metadata access.

### 5.9 Storage

Evidence: `storage.png` and the `storage` renderer section.

#### Actual user goal

Add and maintain independent backup destinations and understand whether each one is available and healthy.

#### Current primary actions

- Add local folder.
- Add Drive for a connected Google account.

#### Current secondary actions

- Open Drive root.
- Disable destination.
- Change global quality.

#### Information that deserves prominence

- Destination identity.
- Availability and actionable failure.
- Used/free capacity when known.
- Copy count and bytes.
- Last successful backup.
- Integrity state.

#### Information currently too prominent

- A full-width red add button.
- yt-dlp and FFmpeg versions.
- Raw FFmpeg build string and URL.
- `0 active uploads` and duplicated Drive availability.
- Volume serial and provider-root readiness.

#### What should move deeper

- Managed-tool status, versions, volume identity, provider IDs, and last safe codes to Advanced > Diagnostics.
- Global backup quality to Settings > Backup.
- Disable to an overflow menu with its non-deletion consequence stated.

#### Redundancy and hierarchy problems

- Actions, defaults, tools, provider summary, and every destination are separately carded.
- Tool diagnostics appear before configured destinations.
- `Ready`, `AVAILABLE`, and active-upload badges use different language for nearby system states.
- Current destination rows omit last backup, copy coverage, and verification health.

#### Preserve

- Native local-folder picker and safe probing.
- Independent filesystem and Drive destinations.
- Drive identity association and app-owned root.
- Capacity when known.
- Available, disconnected, read-only, full, auth-required, error, and unknown states.
- Stable external-volume identity.
- Open Drive and disable without deleting verified backup data. There is no explicit destination-ID re-enable action, but re-adding the same trusted path/volume or Drive account can re-enable its stable match; the UI must explain this recovery path instead of implying either easy reversal or irreversibility.

### 5.10 Integrity / Repair

Evidence: `integrity.png` and the `integrity` renderer section.

#### Actual user goal

Understand verified-copy health, run an appropriate check, and safely repair missing or corrupt copies.

#### Current primary actions

- Verify selected scope.
- Repair an issue.

#### Current secondary actions

- Download and SHA-256 check Drive content.
- Verify one issue again.
- Choose all, channel, or destination scope.

#### Information that deserves prominence

- A health conclusion.
- Missing and corrupt copies.
- Authorization versus disconnection problems.
- Last verification time.
- Repairability and recommended repair source.

#### Information currently too prominent

- Six equal counters.
- `Full Drive SHA-256` as a red primary action.
- Raw verification-strength and health enums.
- `catalog-authorized copy IDs` copy.

#### What should move deeper

- Provider metadata, hashes, exact verification strength, and individual check history to Details.
- Periodic verification policy to Settings > Integrity.

#### Redundancy and hierarchy problems

- The supplied screenshot is visibly broken: copy and counts collapse into a narrow column, buttons wrap into several lines, and the scope control floats in unused space.
- Unavailable and authorization-required states are merged even though their resolutions differ.
- Verification is visually framed like a destructive action.
- The issue flow does not clearly explain which healthy source will repair the target.
- `It is not a protection policy` is a specification disclaimer, not primary user copy.

#### Preserve

- Descriptive health, not a fabricated score.
- Complete, partial, pending, missing, corrupt, unavailable, and authorization-needed distinctions.
- Standard Drive metadata/size checks versus downloaded SHA-256 checks.
- All, channel, destination, media, and copy scopes.
- Healthy archive sources before YouTube fallback.
- Explicit consent before a YouTube repair download.
- No repair from an unverified or corrupt source.
- Durable verification/repair jobs and history.

### 5.11 Settings

Evidence: `settings.png` and the `settings` renderer section.

#### Actual user goal

Configure application behavior, accounts, backup defaults, scheduling, integrity cadence, notifications, advanced tools, and recovery.

#### Current primary actions

The screen has no single primary action. Some changes auto-save, while Scheduling requires `Save schedule`.

#### Current secondary actions

- Change Windows/tray behavior.
- Configure schedules.
- Configure periodic integrity.
- Configure notification categories.
- Open Integrity.
- Open Recovery.
- Open logs.

#### Information that deserves prominence

- Clear category navigation.
- Current settings values.
- Save state and validation.
- Category-specific attention states.

#### Information currently too prominent

- A large rounded card for every group.
- Repeated uppercase red eyebrows.
- Task Scheduler and DST implementation detail.
- Repeated read-only/recovery assurances.

#### What should move deeper

- Accounts into a Settings category.
- Logs, tool versions, paths, and export under Advanced > Diagnostics.
- Recovery into a dedicated Settings category.
- About, updates, GitHub, report issue, and support links into About.

#### Redundancy and hierarchy problems

- `Settings` is repeated as page title and section heading.
- Only one and a half groups fit in the supplied viewport.
- There is no settings-local navigation or search.
- Form controls have weak boundaries.
- Autosave and explicit-save patterns are mixed without explanation.
- Small checkboxes and low-contrast helper text are high-risk.

#### Preserve

- Start with Windows, start minimized, and keep running in tray.
- Individual notification categories.
- Global and per-channel scheduling.
- Periodic integrity configuration and bandwidth warning.
- Recovery and diagnostic entry points.
- Typed validation and safe persistence.

### 5.12 Scheduling

Evidence: Scheduling is embedded in `settings.png` and the Settings renderer section.

#### Actual user goal

Choose when backups run globally or for one channel and understand whether Windows automation is ready.

#### Current primary action

- Save schedule.

#### Current secondary action

- Remove schedule.

#### Information that deserves prominence

- Scope.
- Frequency and local time.
- Enabled state.
- Next expected backup.
- A plain-language problem when Windows scheduling is not ready.

#### Information currently too prominent

- Task Scheduler reconciliation language.
- Raw `SYNCED` or error enum states.
- Timezone implementation detail before the core choice.

#### What should move deeper

- Task ID and scheduling diagnostics to Technical details.

#### Current interaction risks

- Loaded schedules do not initialize the form automatically.
- Choosing a scope with no existing schedule can retain values from the prior scope.
- There is no dedicated loading or no-schedule state.
- Conditional weekday and interval controls alter the grid without a clear transition.

#### Preserve

- Global default plus channel overrides.
- Daily, weekly, and every-N-hours options.
- Local wall-clock intent, timezone, and DST-safe behavior.
- Catch-up and backup-on-startup.
- Windows Task Scheduler reconciliation and deduplication.
- Next expected run, safe errors, enabled state, and removal.

### 5.13 Disaster Recovery

Evidence: the hidden `recovery` renderer section. No supplied screenshot captures this state.

#### Actual user goal

Rebuild a lost local catalog from one or more existing local or Drive backups without changing backup files or YouTube.

#### Current primary flow

1. Resume or create a recovery session.
2. Add local and/or Drive sources.
3. Run the initial scan, which discovers and initially includes app-created Drive roots.
4. Review discovered Drive roots, counts, and warnings.
5. If root selection changes, scan again.
6. Explicitly confirm import.

#### Current secondary actions

- Authorize another Drive account.
- Rescan.
- Cancel safely.
- Open Library after completion.
- Start another recovery.

#### Information that deserves prominence

- The separation between scan and import.
- Selected sources.
- Progress.
- Recovered channels, media, playlists, and copies.
- Warnings that affect confidence.
- A clear statement that backup files are not changed.

#### Information currently too prominent

- Raw session, source, and phase enum values.
- Drive provider root IDs.
- Step numbers presented as permanent panel labels.

#### What should move deeper

- Provider IDs and parser details to Technical details.
- Detailed warning codes behind human-readable warning summaries.

#### Redundancy and hierarchy problems

- Authorization, source selection, scanning, preview, and import actions can coexist visually.
- Two large panels do not provide enough progressive disclosure for a stateful workflow.
- The current text is accurate but often written from an implementation viewpoint.

#### Preserve without compromise

- Scan and preview must not mutate the canonical catalog.
- Import requires explicit confirmation.
- Changing selected Drive roots invalidates the preview and requires a rescan.
- Scan reads manifests, sidecars, filesystem metadata, and app-owned Drive metadata only.
- Scan does not download media or rehash full content.
- Credentials are not imported.
- Backup files and YouTube state are not modified.
- Safe cancellation, warnings, stable-ID merge, FTS rebuild, idempotent import, and completion-with-warnings.

## 6. Accessibility and interaction risks

These are observed risks, not claims of full WCAG non-compliance. Keyboard, screen-reader, Windows High Contrast, zoom, and assistive-technology verification still require implementation testing.

- Much secondary text appears at 9-12px in muted blue-gray.
- Tiny uppercase pills often depend on green, red, or amber.
- Checkboxes and icon controls are below comfortable target sizes.
- Grid/List, clock, and chevron controls have weak visible affordance.
- There is no general `:focus-visible` system.
- Library cards are mouse-clickable non-buttons.
- Media Details lacks clear focus trapping, Escape handling, and focus restoration.
- Truncated titles, emails, and destination paths do not consistently expose the full value.
- The Integrity layout already fails at the normal captured width, making 125%, 200%, and Windows text scaling especially risky.
- Status changes rely on color and terse labels.
- Global success/error banners remove errors from the control or object that caused them.
- Native `window.confirm` prompts are used for nuanced, high-consequence choices.
- Animated spinners have no reduced-motion accommodation.
- Visual progress bars lack native or ARIA progress semantics.
- Several borders reference an undefined `--line` token and may silently disappear.
- The current visible menu and future custom titlebar both require deliberate keyboard and system-menu testing.

## 7. Reference interpretation

### Netflix principles worth retaining

- Content should dominate chrome, especially in Library and Playlists.
- Use a constrained neutral palette with one deliberate brand accent.
- Build hierarchy through type, spacing, and luminance before borders.
- Let real thumbnails carry visual weight.
- Keep motion functional and restrained.
- Use a small radius system and a consistent 4px spacing rhythm.

### Netflix elements not to copy

- Marketing-scale headings.
- Entertainment discovery carousels for operational data.
- Cinematic transitions.
- The exact measured token values or questionable contrast notes in `netflix-DESIGN.md`.
- Netflix branding, content IA, or logo treatment.

### FACEIT principles worth retaining

- An integrated compact title area.
- Native-feeling desktop density.
- Icon-anchored, grouped navigation with restrained active treatment.
- Settings-local navigation and divided rows.
- A few semantic panels instead of many equal cards.
- Thin borders and tonal surfaces used selectively.

### FACEIT elements not to copy

- Browser back, forward, or refresh controls.
- Gaming colors, gamified language, scores, and upgrade promotion.
- Icon-only navigation without labels or tooltips.
- Tiny gray copy.
- A literal double-sidebar settings modal.
- Its metric-card layouts or benchmark bars.

### Taste rubric applied selectively

`taste-SKILL.md` explicitly excludes dashboards, dense product UI, data tables, and multi-step workflows from its main purpose. The redesign uses only its relevant guardrails:

- audit before redesign;
- avoid card overuse;
- one coherent color, type, and radius system;
- explicit loading, empty, error, and disabled states;
- accessible focus and controls;
- motivated motion;
- copy self-audit;
- no default AI-purple, oversized marketing type, ornamental pills, or decorative effects.

Landing-page hero, scroll-storytelling, marketing image, and section-variety rules do not govern this desktop application.

## 8. Audit conclusion

The current product already exposes most of the right capabilities. Its primary failure is translation: durable backend concepts are presented almost one-to-one as pages, labels, cards, and counters.

Phase 7A should replace the current interface grammar with:

- a compact integrated Windows shell;
- seven task-oriented primary destinations;
- one contract-backed user-level Activity model over durable jobs;
- content-forward Library and playlist views;
- channel-centered backup actions and settings;
- destination-centered Storage;
- plain-language Integrity and repair;
- category-driven Settings;
- technical detail available on demand rather than permanently visible.

Nothing in this conclusion requires changing SQLite ownership, worker behavior, provider boundaries, read-only YouTube access, copy verification semantics, or recovery safety.
