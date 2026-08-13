# YouTube Backup Manager Screen Specifications

Status: authoritative Phase 7A target UX specification; platform: Windows 10/11 desktop; primary window baseline: 1120 by 760 pixels; minimum supported window: 880 by 620 pixels.

## 1. Purpose and authority

This document defines the target behavior, hierarchy, layout, actions, states, desktop adaptation, and accessibility requirements for every major YouTube Backup Manager surface.

It works with:

- `MVP.md`, `ARCHITECTURE.md`, `DATABASE.md`, and `JOB-ENGINE.md` for product and reliability rules;
- `docs/UX-IA.md` for navigation and ownership;
- `DESIGN.md` for visual tokens and component styling;
- `docs/UI-AUDIT.md` for evidence behind the redesign.

If a visual proposal conflicts with a worker, security, persistence, verification, or recovery invariant, the invariant wins. This specification may require new narrow typed DTOs, but it never authorizes renderer access to SQLite, arbitrary files, generic shell commands, provider SDKs, credentials, or raw worker internals.

## 2. Contract notation

Each screen distinguishes between the target experience and what current typed contracts can support.

- **Available now** means the current preload and worker contracts expose the required state or action.
- **Composable now** means the renderer can combine a small number of existing typed responses without inventing state.
- **Contract extension** means the target requires a new worker-owned aggregate or action DTO before implementation.
- **Not in v1.0** means the UI must not imply the capability exists.

The renderer may format, sort, group, and translate typed values. It must not infer that:

- a copy is verified from transfer success, file presence, player behavior, or a green provider response;
- a destination is missing when it is disconnected;
- a source is available from an embedded player;
- an operation completed because a request timed out or the page stopped polling;
- a repair source is healthy without worker verification;
- an imported recovery candidate is canonical before confirmed import.

## 3. Shared screen grammar

### 3.1 App frame

Every primary screen sits inside the same three-region frame:

```text
Integrated titlebar, 40px
Sidebar, 208px expanded or 64px compact | Page content
```

The page content uses the available canvas. It must not be constrained to a narrow centered website column. Long-form help and confirmation copy may use a readable text measure, while grids, split panes, tables, and operational timelines expand with the window.

### 3.2 Page header

The default page header contains:

1. one 28px page title using the authoritative Page title token from `DESIGN.md`;
2. an optional one-sentence task description;
3. one primary page action when the page owns one;
4. contextual controls only when they apply to the whole page.

It does not repeat the product name, account count, or media count. Routine totals belong in the page body only when they help the task.

### 3.3 State hierarchy

Within a page, order information as follows:

1. action-required or blocking state;
2. active operation and progress;
3. primary content;
4. healthy summary;
5. metadata;
6. technical details.

Healthy zero values do not receive equal visual weight with failures or blocked work.

### 3.4 Shared feedback

- Field and row errors stay adjacent to the affected control or object.
- A page-level error summary is used when several objects fail or the page cannot load.
- Toasts acknowledge transient success only. They never carry the sole explanation of a persistent failure.
- Mutations expose `Saving`, `Starting`, `Pausing`, `Cancelling`, or equivalent progress and prevent duplicate submission.
- A refreshed worker snapshot replaces optimistic operational state after reconnect.
- Skeletons match the final content shape. A spinner may accompany a bounded action but is not the only full-page loading treatment.

### 3.5 Shared status language

Normal UI uses plain-language labels with an icon and, where useful, a short resolution:

| Typed state                         | Normal label                                                         | Required distinction                                       |
| ----------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| `VERIFIED`                          | Verified                                                             | Use only after the worker records successful verification. |
| `COMPLETED_WITH_ERRORS`             | Completed with issues                                                | Do not present as complete success.                        |
| `AUTH_REQUIRED` / `REAUTH_REQUIRED` | Sign in again                                                        | Link to Settings > Accounts.                               |
| `DISCONNECTED`                      | Contextual: `Filesystem unavailable` or `Drive account disconnected` | Never translate to missing or infer a device class.        |
| `READ_ONLY`                         | Read-only destination                                                | Explain that new copies cannot be written.                 |
| `FULL`                              | Not enough space                                                     | Preserve existing copies and show the destination.         |
| `RETRY_WAIT`                        | Trying again at {time}                                               | Show attempt details only deeper.                          |
| `BLOCKED`                           | Waiting for {condition}                                              | Do not imply active transfer.                              |
| `PROVIDER_METADATA_SIZE`            | Standard verification                                                | Explain exact strength in Details.                         |
| `DOWNLOADED_SHA256`                 | Full file verification                                               | State bandwidth and temporary-space cost before starting.  |

Color is secondary. Every state has text and an icon or structural cue.

### 3.6 Specification inheritance and applicability

Every numbered screen and subflow inherits Sections 3.1 through 3.5 and the global state matrix in Section 14. A compact category or workflow step that does not repeat a dedicated `Components` or `Desktop and accessibility` heading still has those fields defined as follows:

- **Actions:** the actions listed in its layout/body plus Back, close, retry, or owning-route navigation only where the shared grammar and typed contract permit them.
- **States:** every state named in its body plus every applicable global state; an inapplicable provider state is omitted rather than faked.
- **Components:** the parent shell components plus the controls and content components named in that subsection. Settings categories inherit `SettingsRow`, form controls, inline status, and Save behavior from Settings shell. Recovery steps inherit `RecoveryShell`, step progress, feedback, and the specific component named for that phase.
- **Desktop behavior:** the parent shell's baseline/minimum/maximized rules. At compact width, two-column regions stack in DOM reading order, toolbars wrap intentionally, labels/actions stay visible, and the owning content region scrolls without horizontal page scrolling.

This inheritance is a definition, not permission to omit a screen-specific exception. Every subsection below states its exceptional layout, state, action, component, or contract behavior where it differs.

## 4. Application shell

### 4.1 Integrated titlebar

#### Goal

Make the application feel like one intentional Windows product while retaining dependable system window behavior.

#### Hierarchy and layout

- Height: 40px at 100 percent display scaling, with high-DPI scaling handled by the platform.
- Left: 16px application icon and `YouTube Backup Manager` in compact 12px medium text.
- Center: draggable empty region. No fake page navigation or browser controls.
- Right: exception-only app status, optional application overflow, then the native Window Controls Overlay safe area.
- Background: the titlebar surface token from `DESIGN.md`, visually continuous with the shell but distinct enough to identify the drag region.

#### Actions

- Drag window from non-interactive titlebar space.
- Expect double-click on drag space to maximize or restore, then verify that behavior in the packaged Windows matrix rather than recreating it in renderer IPC.
- Minimize, maximize/restore, and close through reliable Windows controls.
- Preserve `Alt+Space` system-window-menu access and verify it in the packaged Windows matrix.
- An unobtrusive application overflow may hold Help, About, and Diagnostics. `Quit` appears only after a narrow orderly-shutdown command preserves existing worker/tray semantics; it is not currently renderer-callable and never uses generic BrowserWindow control.

#### States

- **Focused:** normal high-contrast icon, label, and controls.
- **Unfocused:** subdued label and chrome without reducing control discoverability.
- **Maximized:** no stray outer gap; drag and safe areas recompute correctly.
- **Active or paused work:** one compact status links to Activity.
- **Scoped attention or network-blocked work:** one compact exception affordance links to the owning resolution route when current typed jobs, accounts, or destinations prove it. Do not infer a global offline state from `navigator.onLine`.
- **Worker reconnecting or unavailable:** one compact exception affordance appears. Healthy worker state remains silent.
- **Update available:** may appear only after a typed update contract exists.

#### Components

`AppTitleBar`, application icon, optional `AppStatusButton`, native Window Controls Overlay.

#### Desktop and accessibility

- Prefer Electron's currently supported Window Controls Overlay or hidden-titlebar mechanism after implementation-time verification.
- Use explicit drag and no-drag regions. Buttons, menus, status affordances, and links are always no-drag.
- Window controls must work with mouse, keyboard, touchpad, Windows snapping, high contrast, and 125-200 percent scaling.
- Do not replace native controls with approximate glyph buttons unless Electron cannot meet the design and equivalent Windows behavior is proven.
- Removing the visible application menu must not remove necessary keyboard shortcuts or system-menu access.

#### Contract and safety limits

Window configuration belongs to Electron main. The renderer receives no generic `BrowserWindow` bridge. App status must come from narrow typed state, not renderer process inspection.

### 4.2 Sidebar

#### Goal

Provide a stable map of seven user concepts with minimal chrome and immediate exception routing.

#### Hierarchy and layout

Expanded order:

```text
Home
Library
Channels

Activity
Storage
Integrity

Settings
```

- Expanded width: 208px from 1040px through 1919px; it may grow to a 224px maximum at 1920px and above.
- Compact width: 64px below 1040px.
- Each item is 36px high with an 18px icon, visible label, and optional exceptional badge.
- Settings anchors at the bottom after a flexible spacer.
- The sidebar does not repeat a full brand lockup, `Worker ready`, account totals, or the permanent read-only statement.

#### Actions

- Activate a destination.
- Expand the compact rail temporarily or persistently.
- Open the owning destination from an exception count.

#### States

- **Active:** tonal row, leading red marker, icon, and label.
- **Hover/focus:** visible independent treatment; focus is not conveyed by the active marker.
- **Exception:** count only for actionable unresolved items on Activity or Integrity.
- **Compact:** icons remain labeled through accessible tooltips and screen-reader names.
- **Overflow:** independent sidebar scrolling at limited height; Settings remains reachable.

#### Components

`Sidebar`, `NavItem`, `ExceptionCount`, `Tooltip`, `SidebarExpandButton`.

#### Desktop and accessibility

- Navigation uses a semantic `nav` and links or buttons with `aria-current="page"`.
- Arrow-key roving behavior is optional; Tab order must remain logical without it.
- Tooltips open on hover and keyboard focus and do not replace accessible names.
- At 880 by 620, compact navigation must not cover page controls or make Settings unreachable.

#### Contract limits

Exception counts must be worker-derived. If a reliable aggregate count is unavailable, omit the badge instead of computing it from stale screen-local data.

### 4.3 Global overlays and dialogs

- Dialogs use focus trapping, Escape where cancellation is safe, initial-focus rules, and focus restoration.
- High-consequence choices use application dialogs, never `window.confirm`.
- Dialogs identify the affected channel, run, destination, copy, or recovery session.
- Closing a dialog never implies cancellation of durable work unless the user explicitly chose cancel.
- Drawers may expose contextual details, but Media Details and Settings are route-like surfaces rather than narrow drawers.

## 5. Onboarding

### 5.1 Entry choice

#### Goal

Let a first-run user either create a new archive or reconstruct an existing one without confusing those workflows.

#### Hierarchy and layout

A calm full-content surface, not a marketing hero:

1. concise welcome and read-only YouTube promise;
2. primary `Set up a new backup` action;
3. secondary `Restore an existing backup` action;
4. short explanation that restore rebuilds the local catalog and does not change backup files.

#### Actions

- Start new archive setup.
- Enter Recovery.
- Resume an incomplete setup or recovery session when one is available.

#### States

- **Loading:** setup-state skeleton while accounts, channels, destinations, schedules, and recovery session are read.
- **Truly empty:** both paths visible.
- **Partial setup:** resume at the first incomplete decision. Do not offer a global `Start over` action without a narrow reset contract and explicit preservation/deletion semantics.
- **Existing catalog:** opening onboarding from Settings becomes `Setup assistant`; it does not replace Home automatically.
- **Startup failure:** the renderer can preserve Diagnostics and Recovery only after a worker-backed shell is available. Failure before worker connection currently exits through a main-owned error box; exposing Recovery there requires a separately designed main-owned safe bootstrap path and is not implied by this renderer spec.

#### Components

`OnboardingShell`, `ChoicePanel`, `Button`, `InlineNotice`.

#### Desktop and accessibility

- Content stays within a readable measure but actions remain at least 40px high.
- The choice is keyboard-operable and is not represented by two click-only decorative cards.
- Read-only permission language is available before OAuth begins.

#### Contract limits

Current setup state is composable from typed account, channel, destination, dashboard, schedule, and recovery queries. A dedicated setup-summary DTO is preferred so the renderer does not mistake a recovered or partially configured catalog for a new installation.

### 5.2 New archive setup flow

The setup assistant uses a step list with completed, current, and upcoming states. Back is allowed before starting durable backup work. The flow persists confirmed choices through existing worker contracts rather than storing authoritative setup state in React alone.

The overall assistant is resumable but not one atomic transaction. On resume, it reconstructs progress from persisted account, channel, destination, settings, and schedule state, then asks again for any decision that was not confirmed.

#### Step 1: Connect Google

- Explain `View your YouTube account` in normal language and state that the app cannot upload, edit, or delete YouTube content.
- Primary action: `Connect Google`.
- OAuth opens the system browser. The app shows `Finish in your browser` and permits leaving setup without claiming the provider flow was cancelled. The current flow expires on its own. A true Cancel/Replace flow requires a narrow `oauthCancel(flowId)` contract and deduplication rules before `Try again` can appear while another flow is pending.
- Handle pending, completed, failed, expired, configuration unavailable, network unavailable, and reauthorization states.
- Do not display authorization codes, callback URLs, tokens, secrets, or raw provider responses.

#### Step 2: Select channels

- Group accessible channels by Google identity only where it helps explain access. A channel accessible through two accounts remains one logical channel.
- Each row shows avatar, channel title, handle, and selection control.
- Primary action: `Continue with {n} channels`.
- Empty state: no accessible channels found, with `Refresh channels`, `Use another Google account`, and safe help copy.
- Channel selection calls the existing typed enable/disable contract. It never modifies YouTube.

#### Step 3: Add destinations

- Offer `Local folder` and `Google Drive` as destination types.
- Local invokes the native trusted folder picker. A distinct probe outcome and capacity preview appear only after a typed discriminated probe/add result exists; current failures collapse to a generic safe worker error.
- Drive requests incremental `drive.file` authorization when needed, then creates or resolves the app-owned root.
- Multiple destinations are allowed.
- The user cannot continue without at least one enabled destination selected for the setup channels. One unavailable destination does not invalidate other healthy destination branches; worker planning may let the unavailable branch wait while healthy branches continue.
- Disconnected, read-only, full, auth-required, error, and unknown outcomes remain target distinctions once the add/probe contract can return them safely.

#### Step 4: Choose quality

- Choices: Best available, Up to 4K, Up to 1080p, Up to 720p.
- Show the current default and a short storage/bandwidth implication, without claiming an upload original.
- This step writes the global default. Per-channel overrides remain a later Channel Details choice.

#### Step 5: Configure schedule

- Choices: Manual only, Daily, Weekly, or Every N hours.
- Advanced options: missed-run catch-up and backup on app startup.
- Show local time and next expected run only after a schedule DTO confirms it.
- Task Scheduler errors do not erase the chosen configuration; they show an actionable automation problem.
- Schedule is optional. `Manual only` is an explicit, valid choice.

#### Step 6: Review

Show one concise summary:

- selected channels;
- destinations and current availability;
- effective quality;
- schedule or Manual only;
- read-only YouTube permission;
- a statement that backup data remains human-readable and existing verified copies are not deleted automatically.

Primary action: `Start first backup`. Secondary: `Finish without starting` only if configuration is valid.

#### Step 7: Starting

- Keep the action disabled while each durable start request is unresolved.
- Show a channel-by-channel accepted, skipped, or failed result.
- On accepted start, route to Activity > Active.
- If the client loses its response, refresh persisted runs and Activity before presenting Retry. A request timeout is not proof that planning failed.

#### Components

`StepList`, `OAuthProgress`, `ChannelSelectionList`, `DestinationPicker`, `QualityChoice`, `ScheduleForm`, `ReviewSummary`, `StartResultList`.

#### Contract limits

- Current `backup.start` starts one channel using saved settings. A true atomic `Back up selected channels` action needs a typed aggregate-start contract.
- Until then, the assistant may issue bounded per-channel starts and report each result, but must not claim the set is atomic.
- Temporary custom-run settings are not supported by the current start contract and must not be simulated by silently changing persistent channel settings.

## 6. Home

### Goal

Answer within one viewport:

1. Is my archive healthy?
2. Is anything happening now?
3. Does anything need my attention?

### Hierarchy and layout

At 1120 by 760:

1. **Health statement:** one dominant conclusion with last completed backup and a contextual primary action.
2. **Active operation:** visible only when work is running, pausing, retrying, paused, or blocked.
3. **Needs attention:** visible before routine summaries when any issue exists.
4. **Archive summary:** compact channel and destination coverage, not equal KPI cards.
5. **Recent outcomes:** a short list of confirmed run outcomes when available.

Example healthy heading: `All intended copies are verified`. Use only when typed state proves it. Example partial heading: `12 items need attention`.

### Actions

- `Back up all channels` only when aggregate scope is explicit and safely supported.
- Otherwise `Back up now` opens a compact eligible-channel chooser.
- Open active operation.
- Open the owning resolution for an attention item.
- Open Channels, Storage, Integrity, or Activity summaries.

### States

- **Loading:** health statement, active region, and summary skeletons.
- **Empty:** onboarding entry choice for new setup or restore.
- **Healthy:** calm conclusion; no wall of green badges or zero-failure cards.
- **Active:** phase, progress, current item, destination, and Pause when supported.
- **Partial:** verified and intended counts with the exception category.
- **Failure/blocked:** prominent safe message and one resolution.
- **Destination disconnected/full/read-only:** separate attention item linking to Storage.
- **Auth required:** link to Settings > Accounts.
- **Offline:** show confirmed network work as waiting while local work may continue. Do not treat the whole app as unavailable.
- **Worker unavailable:** replace operational controls with reconnecting/error state and Diagnostics access.

### Components

`HealthSummary`, `PrimaryAction`, `ActiveOperationSummary`, `AttentionList`, `ArchiveSummary`, `RecentOutcomeList`, `EmptyState`, `ErrorState`.

### Desktop and accessibility

- Health heading is the first main-content heading and is not encoded by color alone.
- Active progress has a text equivalent and announces meaningful phase changes without announcing every percentage tick.
- Attention rows are real links/buttons with descriptive names.
- At minimum width, summary columns stack below health and attention; the primary action remains visible without horizontal scrolling.

### Contract limits

- Current dashboard data provides copy counts, bytes, channel/media counts, and last backup time.
- Active work, destination exceptions, account attention, and recent outcomes require composition from queue, destinations, accounts, integrity, and run history.
- A single worker-owned Home summary DTO is preferred for snapshot consistency.
- Current dashboard data cannot prove every desired plain-language conclusion by itself. Do not infer `healthy` from `failedCopyCount === 0` alone.

## 7. Library

Library has persistent local tabs: `Media` and `Playlists`. Search remains local to Library.

### 7.1 Media

#### Goal

Find indexed media across channels even when backup storage is disconnected, understand exceptional source/copy state, and open details.

#### Hierarchy and layout

1. Page title and result count.
2. Search and filter toolbar.
3. Media canvas in Grid or List mode.
4. Pagination or virtualized continuation.

Toolbar controls:

- search;
- channel;
- media type;
- source status;
- backup/copy status when supported;
- destination when supported;
- quality when supported;
- Grid/List segmented control.

#### Media grid

- Thumbnail ratio: 16:9.
- Title: two-line clamp.
- Channel: one restrained line.
- Duration: thumbnail corner overlay with solid contrast.
- Type: show when Short or Live, or when needed to disambiguate. Do not stamp `VIDEO` on every standard item.
- Backup state: show exceptions and meaningful verified coverage, not `AVAILABLE` on every healthy item.
- Hover: subtle surface or image emphasis.
- Focus: strong visible focus ring around the interactive item.
- Selected: reserved for a future real bulk-selection mode. Do not show selection checkboxes without bulk actions.

#### Media list

Administration-oriented columns at wide widths:

```text
Thumbnail and title | Channel | Type | Source | Backup copies | Quality | Published
```

Collapse lower-priority columns into row metadata at compact widths. Rows remain sortable only after the worker-owned query supports deterministic sorting.

#### Actions

- Open Media Details.
- Search and filter.
- Change view.
- Clear filters.
- Page or incrementally load results.

#### States

- **Initial loading:** thumbnail-shaped skeleton grid or row skeletons.
- **Filter loading:** keep layout stable, mark results busy, and avoid presenting stale result count as current.
- **Empty catalog:** link to Channels and onboarding.
- **No results:** preserve query controls and offer Clear filters.
- **Missing thumbnail:** stable branded placeholder using the media type and accessible alt treatment.
- **Removed/private/unavailable source:** visible source exception; archived copies remain accessible.
- **Disconnected destination:** catalog and search continue; affected copy state is unavailable, not missing.
- **Error:** retry query without clearing search or filters.
- **Offline:** local catalog search continues; remote source actions may be unavailable.

#### Components

`LibraryTabs`, `SearchInput`, `FilterBar`, `Select`, `SegmentedControl`, `MediaGrid`, `MediaCard`, `MediaTable`, `MediaRow`, `Pagination`, `Skeleton`, `EmptyState`.

#### Desktop and accessibility

- Results use semantic links or buttons, never click-only articles.
- The toolbar wraps into two intentional rows at compact width; it never crushes labels or merges Grid/List text.
- Long titles expose the full value through the details route and optional tooltip, not tooltip alone.
- Virtualization must retain keyboard focus and accessible position context on large catalogs.
- Thumbnail alt text is empty when adjacent title text already names the link; otherwise it names the media item.

#### Contract limits

- Current catalog query supports search, channel, media type, source status, and pagination.
- Backup status, destination, quality, worker-owned sorting, and per-card copy health require a catalog query/row DTO extension.
- Do not issue one media-details request per card to fake those filters.
- Search remains worker-owned SQLite FTS and must not scan attached drives.

### 7.2 Playlists

#### Goal

Find an archived/current playlist and inspect its ordered membership as a Library lens.

#### Hierarchy and layout

Desktop master-detail composition:

- left pane, approximately 36 percent: search, channel filter, playlist rows, paging;
- right pane, approximately 64 percent: selected playlist header and ordered media membership;
- both panes have deliberate independent scrolling below their sticky local headers.

Playlist rows show title, channel, item count, and exceptional source state. Detail rows show position, thumbnail, title, type, duration, and source exception when relevant.

#### Actions

- Search and filter playlists.
- Select a playlist.
- Open a member in Media Details.
- Load the next membership page.

No create, edit, reorder, or YouTube playlist modification action exists.

#### States

- Loading list and loading membership are independent.
- Empty playlist collection links to source refresh only when appropriate.
- No selection gives a quiet instructional detail pane.
- Empty selected playlist says `This playlist has no indexed items`.
- Removed playlist remains visible with archived membership and a source-removed explanation.
- Missing member thumbnail uses the Media fallback.
- Query/member error retries only the failed pane.
- Offline keeps indexed playlist search and membership browsing available; source refresh or remote source actions wait.

#### Components

`PlaylistSplitView`, `PlaylistList`, `PlaylistRow`, `PlaylistHeader`, `PlaylistMemberList`, `MediaRow`, `Pager`.

#### Desktop and accessibility

- The selected playlist is exposed with `aria-current` or selection semantics.
- Pane headers and scroll regions have accessible labels.
- At widths below 1040px, selection opens a route-like Playlist Details surface with a Back to playlists action instead of compressing two panes.
- Position is never conveyed solely by visual row order when assistive technology needs it.

#### Contract limits

Current playlist and paginated membership contracts support this view. Implementation must stop truncating membership at the first 50 items. Opening a member in Media Details is a presentation link over the existing media ID.

### 7.3 Media Details

#### Goal

Explain one media item's source state, archived copies, quality, and repair/verification options without exposing technical implementation by default.

#### Hierarchy and layout

A route-identified surface with a Back action and two wide desktop regions. At 1440px and above it may render as a 560px-wide details sheet when retaining Library context materially helps; at the baseline and compact widths it is a full content route, never a narrow technical modal.

1. **Media region:** 16:9 player/thumbnail, title, channel, source state, published date, duration.
2. **Archive region:** copy rows grouped by destination, overall copy conclusion, and actions.
3. **Supporting sections:** playlists, media properties, and collapsed Technical details.

Each copy row shows:

- destination identity;
- copy state;
- availability as a separate condition;
- quality and size when known;
- last verified time;
- the strongest relevant normal-user action.

Hash, provider ID, container, codecs, dimensions, frame rate, relative path, and verification implementation live in Technical details.

#### Actions

- Open verified local folder.
- Open in Google Drive when the provider object resolves.
- Open on YouTube after a dedicated allowlisted external-navigation action exists.
- Verify this copy or all copies.
- Repair an unhealthy copy.
- Add/copy to another destination when a typed per-media action exists.
- Select YouTube or Local player source when a safe player implementation exists.

#### States

- Loading details skeleton.
- No destination copies, with a contextual backup action.
- Verified, pending, transferring, verifying, missing, corrupt, failed, and unavailable copy states.
- Destination disconnected and copy missing remain visually and semantically different.
- Source available, private, unlisted, removed, unavailable, and unknown.
- Open-folder/provider object missing refreshes the copy state and keeps the user on Details.
- Repair active links to Activity.
- Detail query error preserves the originating Library context.

#### Components

`MediaDetailsHeader`, `MediaPlayerRegion`, `SourceStatus`, `CopyList`, `CopyRow`, `CopyStatus`, `ActionMenu`, `Disclosure`, `TechnicalDetails`, `PlaylistLinks`.

#### Desktop and accessibility

- At wide widths the player and archive region share the first viewport. At compact widths they stack with copy health before technical metadata.
- Player controls are keyboard accessible and do not receive privileged preload APIs.
- Every icon action has a visible tooltip and accessible name.
- The route restores focus and Library scroll position on Back.

#### Contract limits

- Current media backup details accepts a media ID but lacks channel, thumbnail, source URL, published date, duration, and playlist membership. There is no catalog item-by-ID query. It can be composed with a known catalog item for in-session navigation, but deterministic deep links require an enriched media-details DTO.
- Local playback requires a narrowly scoped, unprivileged media-delivery design. The renderer must never receive an arbitrary filesystem read API.
- YouTube embeds are not authoritative source-status checks and must be isolated from privileged APIs.
- Google Drive streaming is optional and does not block v1.0.
- Open YouTube and per-media copy-to-destination are not currently exposed as dedicated actions and must stay hidden until narrow validated contracts exist.

## 8. Channels

### 8.1 Channel list

#### Goal

Understand each managed channel's archive state and quickly refresh or back it up.

#### Hierarchy and layout

Use compact rows or low-elevation panels, not giant metric cards. Each row contains:

1. avatar, channel title, and handle;
2. plain-language backup health;
3. destination summary;
4. last backup and next scheduled backup;
5. restrained media composition;
6. `Back up now` and overflow actions.

The page header may offer `Add or manage channels`, which links to Settings > Accounts or a channel-selection surface.

#### Actions

- Open Channel Details.
- Back up now.
- Refresh channel.
- Manage whether the channel participates in backup.
- Resolve account authorization.

#### States

- Loading rows.
- No managed channels, with Connect Google and Select channels paths.
- Source refresh queued/running/retrying/completed/failed.
- Backup healthy/partial/pending/missing/corrupt/unavailable/auth-required.
- Destination disconnected/full/read-only.
- Backup disabled, with a clear Enable action.
- Offline source refresh waiting while archived data remains available.

#### Components

`ChannelList`, `ChannelRow`, `ChannelIdentity`, `HealthSummary`, `DestinationSummary`, `ScheduleSummary`, `Button`, `DropdownMenu`.

#### Desktop and accessibility

- The row title is the primary details link. Nested action buttons are separate targets.
- Compact width moves metadata to a second row; buttons never wrap labels.
- Status summaries use text and icons, not small all-caps pills.

#### Contract limits

Current channel DTO provides identity, enabled state, source state, media counts, accessible account IDs, last sync, and sync status. Backup health, last backup, next schedule, and destination coverage require composition or a channel-summary DTO. Prefer a worker-owned aggregate for consistent row snapshots.

### 8.2 Channel Details

#### Goal

Own all channel-specific source and backup decisions in one place.

#### Hierarchy and layout

Header:

- identity and source state;
- dominant health statement;
- `Back up now`;
- overflow for Refresh channel and enable/disable management.

Local tabs or anchored sections:

1. **Overview:** health, last backup, next schedule, media composition, source refresh.
2. **Backup settings:** quality override and intended destinations.
3. **Schedule:** global inheritance or per-channel override summary.
4. **Source details:** last sync, connected identities, and safe technical identifiers behind disclosure.

#### Actions

- Open Start Backup dialog; its default primary action starts a quick backup with saved settings.
- Change quality override.
- When increasing quality, choose `Upgrade existing eligible copies` or `Apply only to new media` after a worker-owned eligibility check.
- Select intended destinations.
- Create, edit, disable, or remove the channel schedule.
- Refresh source catalog.
- Enable or disable channel backup participation.

#### States

- Settings loading and save-in-progress.
- Inherits global quality/schedule versus explicit override.
- Higher-quality choice with no eligible prior copies, existing eligible lower-quality copies, and upgrade-policy loading/error states.
- No destination selected disables backup with an adjacent explanation and Storage link.
- A selected unavailable destination remains configured and receives a branch-specific warning before start. It does not globally block healthy destination branches when worker preflight accepts the run.
- Source refresh progress and retry time.
- Authorization required links to the exact Google identity in Settings > Accounts when resolvable.
- Partial save failure restores confirmed worker values.

#### Components

`ChannelDetailsHeader`, `Tabs`, `HealthSummary`, `MediaComposition`, `BackupSettingsForm`, `DestinationCheckboxList`, `QualitySelect`, `ScheduleSummary`, `SourceSyncStatus`, `Disclosure`.

#### Desktop and accessibility

- Settings controls use labels above or adjacent in a consistent SettingsRow pattern.
- Autosave state is announced politely and failures remain by the affected group.
- A selected but disconnected destination is not silently removed from intended configuration and does not globally block healthy destination branches; it may wait independently when worker planning accepts the run.

#### Contract limits

Quality override and destination selection are available now and persist immediately through the typed channel-settings patch; there is no separate Save step. However, the required choice between upgrading existing eligible copies and applying the higher quality only to new media is not supported: the current planner skips existing verified copies. A worker-owned eligibility preview and upgrade intent/action are required before the target quality-upgrade flow is complete. Schedule CRUD is available now. Health and rich recent-run summaries require composition or an enriched channel-details DTO. Disabling an account must never delete channel catalog or backups.

### 8.3 Start Backup dialog

#### Goal

Start a quick saved-settings run immediately or make explicitly temporary choices without mutating defaults.

#### Hierarchy and layout

- Header names the channel.
- Default state summarizes effective quality and destinations.
- Primary: `Start backup`.
- Secondary disclosure: `Customize this run`.
- Custom choices, when supported: new content only, metadata refresh, verify existing files, temporary destinations, and temporary quality.
- A separate `Save these as channel defaults` checkbox is off by default.

#### States

- Preflight/planning in progress with the bounded status copy `Checking destinations and planning the backup`. The UI prevents duplicate submission, retains access to Activity, and never treats a client timeout as proof that planning stopped.
- Accepted with planned work and already-verified skips, translated to normal language.
- No work needed: `Everything selected is already backed up`.
- Destination full/disconnected/read-only/auth-required with one resolution. In a multi-destination run, describe the affected branch and allow other eligible branches to continue when the worker accepts that plan.
- Network offline: local-only eligible branches may proceed only if worker planning accepts them.
- Uncertain client result: inspect persisted runs before Retry.

#### Components

`Dialog`, `EffectiveConfigurationSummary`, `Disclosure`, `Checkbox`, `Select`, `DestinationPicker`, `InlineError`, `ProgressStatus`.

#### Desktop and accessibility

- Initial focus is the dialog heading or first decision, not the destructive/cancel control.
- Enter does not submit while focus is inside a select or checkbox group unexpectedly.
- Closing the dialog after acceptance does not cancel the run.

#### Contract limits

Quick backup is available now. The current `backup.start` accepts only a channel ID and uses persisted settings. Custom temporary configuration requires a new validated request and effective-configuration snapshot. Until that exists, hide the Customize disclosure rather than altering defaults behind the user's back.

## 9. Activity

Activity has three primary tabs: `Active`, `History`, and `Needs attention`. It translates worker jobs into user-level operations.

### 9.1 Active

#### Goal

See what is happening now, what is next, and safely control durable work.

#### Hierarchy and layout

1. One dominant current operation when present.
2. Remaining running, paused, retrying, waiting, or blocked operations as rows.
3. Queued next work.

An operation row shows:

- media title or channel/run name;
- user-level phase, such as Downloading, Processing media, Copying to External HDD, Uploading to Google Drive, or Verifying;
- destination when applicable;
- progress, bytes, speed, and ETA when known;
- waiting/retry reason;
- Pause/Resume and an overflow.

#### Actions

- Open Operation Details.
- Pause or resume run/job where supported.
- Cancel through a choice dialog.
- Move waiting work to top or adjust priority from deeper controls.

Cancel dialog choices:

- `Cancel and keep partial data`;
- `Cancel and remove partial data` when job semantics allow;
- `Keep backup running`.

Verified copies are never presented as deletion targets.

Run-level cancel currently supports keeping partial data only. `Cancel and remove partial data` appears only for an individual job whose typed control supports it.

#### States

- Loading snapshot.
- No active work: calm state with `Choose a channel to back up` linking to Channels, plus a recent-result link. Activity does not own another backup-start workflow.
- Running, pause requested, paused, retry wait, cancel requested, blocked, interrupted/recovering.
- Destination disconnected, auth required, offline, staging full, and destination full use distinct resolutions.
- Reconnecting to worker holds the last snapshot as stale only if clearly marked, then replaces it with a fresh snapshot.
- Partial operation: other destination branches may continue while one waits or fails.

#### Components

`ActivityTabs`, `OperationList`, `OperationRow`, `Progress`, `StatusMessage`, `Button`, `DropdownMenu`, `CancelOperationDialog`.

#### Desktop and accessibility

- Progress exposes phase plus numeric text and does not announce every event tick.
- Pause and Cancel have unambiguous names including the operation when needed.
- Lists virtualize or paginate for large queues while preserving focus.
- At compact width, speed and ETA move below progress rather than truncating the title or actions.

#### Contract limits

Current queue exposes jobs, progress, safe errors, retry time, and controls. Reliably grouping several jobs into one user-level operation may require an operation DTO keyed by run/media/destination. The renderer must not merge jobs heuristically if doing so could hide independent failures.

Queue snapshot excludes channel sync, and an active sync is queryable only by a known `syncId`; Recovery uses its own latest/session APIs. Until a rediscoverable active-operation query exists, source refresh stays on Channel and Recovery stays in its dedicated workflow rather than appearing in Activity > Active.

### 9.2 History

#### Goal

Understand confirmed operation outcomes and archive changes over time without treating notifications or current catalog state as history.

#### Hierarchy and layout

- Local modes or filters distinguish `Operations` and `Archive changes` when typed history supports them.
- Operation rows show date/time, channel or scope, trigger, outcome, useful counts, transferred bytes, and duration when known.
- Change rows show events such as new media, title or thumbnail update, playlist membership/source removal, destination connection change, and authorization attention, with affected channel/media/destination context.
- `Completed with issues` exposes the issue count and opens details.
- Technical trigger and enum names remain in Details.

#### Actions

- Open Run/Operation Details.
- Open the run's Channel Details backup action after resolving or re-evaluating the recorded condition. Activity does not start a parallel backup flow.

#### States

- No history.
- Loading. Pagination appears only after the history contract is extended.
- Completed, completed with issues, failed, cancelled, interrupted, and still-running records.
- New-media, metadata-change, playlist-change, source-removal, destination-state, and auth-attention events after a typed Activity-log query exists.
- Historical destination labels remain understandable even if settings later change.

#### Components

`HistoryFilterBar`, `RunHistoryList`, `RunHistoryRow`, `ActivityChangeList`, `ActivityChangeRow`, `OutcomeStatus`, and `Pager` only after paged queries exist.

#### Desktop and accessibility

Use a dense list/table pattern with semantic headers at wide width and row summaries at compact width. Dates are localized but retain full values for assistive technology.

#### Contract limits

Backup run history is available now but is capped at the 50 most recent runs with no paging or filter input. Integrity history is embedded in an overview capped at 100 items, also without paging or filtering. The database already persists the MVP archive-change events in `activity_log`, but preload exposes no query. Worker-owned paged/filterable run, integrity, and Activity-log queries are required before the target History controls or complete archive can be claimed. There is no current generic history query for source sync, recovery, and schedule events. The first implementation may compose only bounded typed histories and label the limitation. It must not reconstruct history from transient notifications or current catalog state.

### 9.3 Needs attention

#### Goal

Show blocked and failed operations with a reason and one owning resolution.

#### Hierarchy and layout

Group by resolution, not raw error code:

- Sign in again;
- Connect destination;
- Free destination space;
- Review failed media;
- Repair missing/corrupt copy;
- Fix schedule automation;
- Resolve a network/provider failure.

Rows show the affected operation/media, safe reason, time, and destination/account/channel context.

#### Actions

Open the owning Settings, Storage, Integrity, or Operation Details surface. Do not show a manual job Retry action under the current control contract. A new attempt may be offered only through an existing safe action, such as starting a new channel backup after current persisted state is refreshed.

#### States

- No issues: no celebratory card wall, just a concise healthy empty state.
- One issue versus grouped repeated issue.
- Auth, disconnected, full, read-only, offline, exhausted retry, terminal source issue, and internal/database error.
- Repeated provider errors should be summarized without hiding affected items.

#### Components

`AttentionGroups`, `AttentionRow`, `ResolutionAction`, `ErrorState`.

#### Desktop and accessibility

At the baseline width, resolution groups use full-width divided rows rather than cards. At compact width, context moves beneath the item title and the one resolution action remains visible. Group headings expose affected counts, repeated issues remain individually reachable, and focus moves to the destination heading after a resolution link.

#### Contract limits

Current failed and blocked queue items can populate this tab. Schedule and integrity exceptions require composition from their typed surfaces. Deduplication and user-level grouping should move worker-side if renderer grouping could suppress distinct operations.

### 9.4 Operation and Run Details

#### Goal

Explain one operation from intent through durable outcome, with technical steps available on demand.

#### Hierarchy and layout

Default Overview:

- operation name and status;
- channel/media/scope;
- effective quality and destinations for backup runs;
- current phase and progress;
- summary counts and outcome;
- safe issue explanations;
- run-level controls.

Collapsed `Technical details`:

- durable steps in dependency order;
- job type, job status, destination, attempts, next retry, safe error code, priority, and timestamps;
- no raw child-process output or secret-bearing provider response.

#### Actions

- Pause/resume/cancel at the supported run or job scope.
- Move to top or adjust priority for eligible pending/ready work.
- Open affected Media Details, Channel Details, or Destination Details.

#### States

Planning, running, paused, completed, completed with issues, failed, cancelled, interrupted/recovered, blocked, and no-longer-found.

#### Components

`OperationHeader`, `OperationTimeline`, `SummaryCounts`, `TechnicalStepList`, `Disclosure`, `ContextLinks`, `RunControls`.

#### Desktop and accessibility

At wide widths, Overview and a restrained context column may sit side by side; Technical details remains below or in a labeled secondary pane. At compact width, controls follow the status summary and never float beside a compressed timeline. Timeline semantics expose ordered steps, current state, and timestamps without relying on connector color. Expanding Technical details retains focus and does not trigger another operation query loop.

#### Contract limits

Current run and queue DTOs provide much of this separately. A stable operation-details query is preferred for entity deep links and coherent snapshots. Raw job types are permitted only in Technical details. Run-level controls currently support Pause, Resume, and Cancel while keeping partial data; remove-partial remains an individual-job control.

## 10. Storage

### 10.1 Destination list

#### Goal

Understand where backups live, whether each destination can be used, and what needs attention.

#### Hierarchy and layout

1. Page header with `Add destination`.
2. Action-required destination rows first.
3. Available destination rows.
4. A short explanation that disabling a destination does not delete backup data.

Each row shows:

- filesystem or Google Drive identity, with more specific device/network classification only when typed data provides it;
- availability and safe issue;
- free/total capacity when known;
- copy count/bytes, last successful backup, and integrity summary when contracts provide them;
- primary contextual action and overflow.

Tool versions and runtime readiness do not appear here.

#### Actions

- Add destination.
- Open local location only through a trusted catalog-authorized destination action when implemented.
- Open Google Drive root.
- For Drive auth-required state, `Sign in again` opens Settings > Accounts for the associated identity and uses the existing narrow Drive-capability OAuth flow.
- Disable destination through confirmation.
- Open Destination Details.

#### States

- Loading.
- No destinations.
- Available, disconnected, read-only, full, auth required, error, unknown, disabled.
- Capacity unknown is not an error.
- Offline leaves local destinations functional and network destinations waiting.
- Reconnected destination refreshes identity and unblocks work through the worker.

#### Components

`DestinationList`, `DestinationRow`, `CapacityMeter`, `AvailabilityStatus`, `Button`, `DropdownMenu`, `EmptyState`.

#### Desktop and accessibility

- Paths and account identities wrap or middle-truncate without hiding the stable distinguishing portion; full values are accessible.
- Capacity never relies solely on a graphical meter.
- Destructive-looking styling is reserved for actions that actually remove or disable state, not Add.

#### Contract limits

Current destination DTO provides type, identity, enabled/availability state, capacity, probe time, and safe message. Copy coverage, bytes held, last backup, and integrity summary require a destination-summary extension. There is no explicit destination-ID contract for manual probe, reconnect, or re-enable. Re-adding the same trusted filesystem path/volume through the native picker or the same Drive account currently re-enables the matching stable destination; present that recovery path explicitly or add a dedicated narrow re-enable action. Drive account reauthorization already belongs to Settings > Accounts through the existing capability-specific OAuth flow. Do not derive copy counts by loading the full Library.

### 10.2 Add destination

#### Goal

Add a trusted Local or Google Drive destination with clear authorization and probe feedback.

#### Hierarchy and layout

First dialog step chooses:

- `Local folder`;
- `Google Drive`.

Local launches the native folder picker, then displays the confirmed path. Capacity and a distinct probe result appear only when a discriminated typed result supports them. A volume-type label appears only when typed data supports it.

Drive shows eligible Google identities. If Drive capability is missing, `Connect Drive` explains `drive.file`, opens system-browser OAuth, and returns to destination creation.

#### Actions

- Choose type.
- Pick local folder.
- Connect or sign in to Drive through the existing capability-specific account OAuth flow.
- Add Drive root.
- Cancel safely.

#### States

- Picker cancelled with no error.
- Folder unavailable, read-only, full, permission denied, invalid, or duplicate.
- Drive OAuth pending/completed/failed/expired.
- Drive root creation/resolution pending.
- Account has an existing enabled destination.
- Offline blocks Drive setup but not Local selection/probing where the path is available.

#### Components

`Dialog`, `DestinationTypeChoice`, native folder picker handoff, `AccountChoiceList`, `OAuthProgress`, `ProbeResult`.

#### Desktop and accessibility

The native picker is initiated by a clearly named button. Returning focus goes to the initiating control or result summary. OAuth status is announced without repeatedly stealing focus.

#### Contract and policy limits

Local picker and Drive add are available now through narrow IPC, but the current local add returns only a destination or cancel and collapses rejected probe outcomes to a generic safe worker error. A typed discriminated probe/add result is required before the target unavailable, read-only, full, permission-denied, invalid, and duplicate feedback can be claimed. The public Google Drive feature remains subject to the documented compliance release gate. The UI specification does not remove or bypass that gate. No arbitrary path text field or provider-root-ID field is exposed.

### 10.3 Destination Details

#### Goal

Inspect one destination's identity, capacity, availability, copy coverage, recent activity, and technical information.

#### Hierarchy and layout

- Header: destination label, availability, primary resolution/open action.
- Summary: capacity, last probe, last successful backup, copy coverage, integrity conclusion when available.
- Recent operations for this destination.
- Advanced details disclosure: volume identity, last mount, filesystem, Drive account, provider root presence, and safe diagnostics.

#### Actions

- Open in Drive.
- Sign in again through Settings > Accounts when Drive authorization is required. Re-probe appears only after a narrow action contract exists.
- Verify destination.
- Disable destination.
- Open filtered Library or Activity when supported.

Disable confirmation states that verified files or Drive objects are not deleted and existing catalog records remain.

#### States

Available, disconnected, remounted under a new letter, read-only, full, auth-required, error, unknown, disabled, verifying, and no copies.

#### Components

`DestinationDetailsHeader`, `CapacitySummary`, `CopyCoverage`, `RecentOperationList`, `TechnicalDetails`, `ConfirmationDialog`.

#### Desktop and accessibility

At wide widths, identity/capacity and copy/recent-operation regions may form two useful columns. At compact width they stack with availability and its resolution first. Long paths and account labels wrap or middle-truncate with full accessible values; capacity has numeric text; the disable confirmation restores focus to the destination action menu.

#### Contract limits

Current contracts can populate identity, capacity, availability, Drive-open action, and capability-specific Drive reauthorization through Settings > Accounts. Copy coverage, filtered recent activity, local root open, and explicit re-probe need narrow worker/main contracts. There is no direct destination-ID re-enable action, although re-adding the same trusted filesystem path/volume or Drive account currently re-enables the matching destination. The renderer never receives generic open-path authority.

## 11. Integrity

Integrity has local tabs: `Overview`, `Issues`, and `Verification history`.

### 11.1 Overview

#### Goal

State actual copy health and make the next verification or repair action obvious.

#### Hierarchy and layout

1. Dominant descriptive health conclusion.
2. Issues summary with missing/corrupt before unavailable/auth/pending.
3. `Verify backups` action and last-check context.
4. Channel/destination health rows.
5. Recent verification outcomes.

Do not show six equal counter cards or invent a protection score.

#### Actions

- Start Verify flow.
- Open Issues.
- Open a channel/media/destination scope.
- Open verification history.

#### States

- Loading overview.
- Complete, partial, pending, missing, corrupt, unavailable, auth required.
- No copies yet.
- Verification active, paused, cancelled, completed, completed with issues.
- Disconnected destination remains unavailable and is not counted as corrupt/missing solely from disconnection.
- Offline permits Local checks and delays Drive full verification.

#### Components

`IntegrityTabs`, `IntegrityHealthSummary`, `IssueSummary`, `ScopeHealthList`, `VerificationHistoryPreview`, `Button`.

#### Desktop and accessibility

- The conclusion uses a heading and explanatory sentence, not only a colored icon.
- Issue counts link to filtered lists with descriptive names.
- Channel rows use aligned textual counts without concatenating numbers and labels.
- At 1120 by 760, the conclusion and primary action occupy one full-width header row and counts never form a narrow side column. At 880 by 620 or increased text scale, summary regions stack in reading order, actions remain one line, and the issue list uses the full content width.

#### Contract limits

The current integrity overview provides global counts, channel health, media health, issues, and check history. Destination-level health summary may require grouping or an aggregate DTO. The renderer must retain the distinction between copy status, destination availability, and verification strength.

### 11.2 Issues

#### Goal

Review each unhealthy copy, understand why it is unhealthy, and enter a safe repair flow.

#### Hierarchy and layout

Filters: Corrupt, Missing, Sign in again, Destination unavailable, Pending, and All.

Each issue row shows:

- media and channel;
- target destination;
- problem and last checked time;
- whether a verified archived repair source exists;
- `Repair`, `Verify again`, and `Open details` as appropriate.

#### Actions

- Repair.
- Verify again.
- Open Media Details.
- Resolve authorization or destination connection.

#### States

- No issues.
- Corrupt and missing.
- Destination unavailable/auth-required, which are not automatically repairable file defects.
- Healthy source available.
- YouTube fallback only.
- No eligible repair source.
- Repair already active.
- Issue became healthy before action, resulting in a safe no-op.

#### Components

`IssueFilterBar`, `IntegrityIssueList`, `IntegrityIssueRow`, `RepairabilitySummary`, `ResolutionAction`.

#### Desktop and accessibility

- Filter state is announced and remains in the URL/internal route state if routing supports it.
- The target and source are clearly labeled so they cannot be reversed visually or by a screen reader.

#### Contract limits

Current issue DTO exposes repair source candidates by copy, destination type, verification strength, and preferred flag, but Integrity Overview returns only a bounded sample of up to 100 issues with no total or paging input. The target filters and complete issue list require a worker-owned paged/filterable issues query; client-filtering the sample would misstate totals. Human destination labels can be composed from the destination list. If an exact candidate identity cannot be resolved, use a generic verified-source statement rather than inventing a path/account.

### 11.3 Verification history

#### Goal

Review completed and active verification checks without confusing a bounded recent sample with the full archive.

#### Hierarchy and layout

1. Filter bar for result, verification strength, destination, and date only after the paged query supports them.
2. Dense history rows showing media, destination, Standard or Full file verification, result, checked time, and safe issue summary.
3. Pagination with a truthful total after the worker contract exposes it.

#### Actions

- Open the related Media Details, copy issue, or operation.
- Start a new scoped verification through the Verify flow.
- Resolve authorization or destination availability through its owning route.

#### States

- Loading and bounded recent-history loading.
- No verification history.
- Current check-row results: Pending, Verified, Missing, Corrupt, Unavailable, and Error. Authorization, cancellation, and aggregate completed-with-issues outcomes appear only when a future paged history/operation DTO exposes them explicitly.
- Offline preserves existing history and disables only remote-dependent new verification choices.
- Query error preserves filters and offers a safe retry.

#### Components

`IntegrityTabs`, `VerificationHistoryFilterBar`, `VerificationHistoryList`, `VerificationHistoryRow`, `OutcomeStatus`, and `Pager` after paged support exists.

#### Desktop and accessibility

At wide widths use semantic column headers; at compact widths each check becomes a labeled row summary without horizontal page scrolling. Method, result, and destination remain textually distinct. Dates expose full localized values to assistive technology.

#### Contract limits

`IntegrityOverview.history` currently returns only the latest 100 checks with no total, filter, or page input. The first implementation may label and show `Recent verification checks`; it cannot claim complete history or apply filters to the bounded sample. Add a worker-owned paged/filterable history query for the full target.

### 11.4 Verify flow

#### Goal

Choose an explicit scope and verification strength, understand cost, and queue durable checks.

#### Hierarchy and layout

Dialog or focused route:

1. Scope: one copy, media item, channel, destination, or all backups.
2. Drive verification choice when Drive copies are included:
   - Standard verification: provider object and file size/metadata.
   - Full file verification: download and SHA-256, with bandwidth and temporary-space warning.
3. Summary of selected scope.
4. Primary `Start verification`.

Local verification always uses the strong local SHA-256 behavior defined by the worker.

#### States

- No eligible copies gives a no-work result.
- Planning with planned check count.
- Active routes to Activity.
- Destination disconnected/auth-required explains that affected checks will wait or block.
- Offline permits eligible Local checks; Drive work waits.
- Disabled Full Drive option when temporary space or typed capability is unavailable only when the worker can prove that condition.

#### Components

`VerifyDialog`, `ScopePicker`, `VerificationMethodChoice`, `CostNotice`, `ReviewSummary`.

#### Desktop and accessibility

Method choices use radio semantics with full descriptions. The stronger option is not marketed as universally better without disclosing cost.

#### Contract limits

Current `integrity.start` supports all defined scopes and both Drive modes. The planned count is authoritative. The UI must not claim completed verification until jobs settle and the overview/history refreshes.

### 11.5 Repair flow

#### Goal

Repair one missing or corrupt copy from a verified source without risking the last healthy copy.

#### Hierarchy and layout

1. Target copy and problem.
2. Recommended source class and verification strength.
3. Plain-language replacement safety sequence.
4. YouTube fallback warning only when no healthy archived copy exists.
5. Primary `Start repair`.

#### Actions

- Start repair.
- Verify target again.
- Cancel before planning.
- Open Activity after acceptance.

#### States

- Verified Local source available.
- Verified Drive source available and will be downloaded/hash-checked first.
- YouTube fallback available, requiring explicit confirmation.
- YouTube unavailable or authentication missing.
- No repair source, disabled with explanation.
- Already healthy no-op.
- Planning/active/paused/completed/failed.
- Offline allows Local-to-Local and blocks network-dependent sources through worker state.

#### Components

`RepairDialog`, `TargetCopySummary`, `RepairSourceSummary`, `SafetyNotice`, `ConfirmationCheckbox` for YouTube fallback, `InlineError`.

#### Desktop and accessibility

The dialog names target and source repeatedly in concise form. Confirmation is required only for the YouTube fallback, not for routine repair from a healthy archive. No control suggests the corrupt target will be deleted first.

#### Contract limits

Current repair action accepts the target copy and whether YouTube fallback is allowed. Source choice remains worker-owned. The UI may show the preferred candidate but must not promise that exact source before the worker returns its selected source. No arbitrary source/target paths or provider IDs enter the request.

## 12. Settings

### 12.1 Settings shell

#### Goal

Make configuration discoverable without turning every category into a giant card stack.

#### Hierarchy and layout

At 1040px and above:

- 200px persistent category list;
- one independently scrolling detail pane;
- sticky category title and contextual Save only for multi-field forms that need explicit commit.

Categories:

```text
General
Accounts
Backup
Scheduling
Integrity
Notifications
Advanced
Recovery
About
```

At compact width, the category list becomes a route-like index or accessible flyout. Do not add a third permanent rail beside the compact app sidebar.

#### Shared states and components

- `SettingsNav`, `SettingsSection`, `SettingsGroup`, `SettingsRow`, `Switch`, `Select`, `Input`, `InlineStatus`, `SaveBar`.
- Simple toggles autosave with row-local Saving/Saved/Error feedback.
- Scheduling and other dependent multi-field forms use explicit Save and dirty-state warning.
- Unsupported settings remain absent, not disabled placeholders, unless the disabled state explains a near-term prerequisite that matters to the user.

#### Accessibility

- Every input has a persistent label and optional description.
- Category navigation exposes the selected category.
- Errors associate with controls and a summary when Save fails.
- Toggling a setting does not unexpectedly move focus or announce a global toast as the only feedback.

### 12.2 General

#### Goal and layout

Configure Windows behavior in compact divided rows:

- Start with Windows.
- Start minimized.
- Keep running in the tray when the window closes.
- Application updates: check preference, `Check for updates`, and current version status when a renderer-safe updater contract exists.

When an update is available, use a focused product prompt:

```text
v1.x available
[Update] [Later]
```

The prompt includes release identity and safe progress/failure feedback. It does not imply installation succeeded until the packaged updater confirms it.

Explain the controls independently: Start minimized currently hides the window on any launch, including a manual launch; Start with Windows controls automatic startup. Do not disable or subordinate one based on the other unless application semantics are deliberately changed.

#### States

Loading, saving, saved, validation error, Windows integration unavailable, active-work close behavior, checking for updates, up to date, update available, downloading/installing, and safe update failure.

#### Contract limits

The first three controls are available through the renderer settings patch. `checkForUpdates` exists in stored settings but is not currently exposed by the renderer patch, and no renderer-safe GitHub Releases check/download/install contract exists. Add narrow signed-or-integrity-verified update check, download, and orderly install/restart capabilities before rendering the preference, `Update`, or `Later` flow. The packaging phase must define the exact installation and rollback behavior; the renderer never receives an arbitrary download URL or executable path.

### 12.3 Accounts

#### Goal and hierarchy

Manage Google identities and their separate YouTube and Drive capabilities.

Each compact account row shows:

- avatar, name, and email;
- YouTube: Connected, Sign in again, Disconnected, or Error;
- Drive: Connected, Connect Drive, or Sign in again;
- accessible channel count/list;
- one primary resolution plus overflow actions.

`Connect Google` sits in the category header. Disconnect is in overflow and requires confirmation stating that credentials are removed while catalog records and backup data remain.

#### States

- OAuth pending/completed/failed/expired/configuration unavailable.
- Account connected/reauth-required/disconnected/error.
- Drive authorization required/connected/reauth-required.
- Channel discovery pending/empty/failed.
- Offline OAuth unavailable while local archive remains usable.

#### Components

`AccountList`, `AccountRow`, `CapabilityStatus`, `OAuthProgress`, `DropdownMenu`, `ConfirmationDialog`.

#### Contract limits

Available now. Optional authenticated YouTube browser-session management is specified by the product architecture but is not exposed in current DTOs and remains hidden until a secure credential-safe contract exists.

### 12.4 Backup

#### Goal and layout

Configure global backup defaults:

- default quality;
- explicit quality-upgrade policy when a higher default affects existing eligible copies;
- default destinations when supported;
- safe concurrency and bandwidth controls only after renderer-safe contracts exist.

Use `SettingsRow` components and short explanations. Tool versions do not appear here.

#### States

Loading, autosaving, saved, save error, no destinations, and inherited-by-channels explanation.

#### Contract limits

Default quality is editable now. Raising it does not currently expose the required existing-copy eligibility or upgrade policy, and current planning skips existing verified copies. Add a worker-owned preview and explicit `Upgrade existing eligible copies` / `Apply only to new media` decision before presenting the target policy as functional. Global default destinations are not exposed by the current renderer contract. Concurrency values exist in application settings but the renderer patch intentionally excludes them. Bandwidth limits are not currently exposed. Hide those controls until narrow validated patches exist.

### 12.5 Scheduling

#### Goal and hierarchy

Configure one global schedule and optional per-channel overrides while showing whether Windows automation is ready.

Layout:

1. scope selector: Global default or channel;
2. enabled state;
3. frequency and conditional weekday/interval;
4. local time;
5. missed-run catch-up and backup-on-startup;
6. next expected run and Windows automation status;
7. Save and Remove schedule.

#### States

- Loading schedules.
- No schedule for selected scope initializes clean defaults rather than retaining another scope's values.
- Dirty, saving, saved, validation error.
- Task pending, synced, error, unavailable.
- Disabled schedule.
- Missed/catch-up outcome shown only from typed history/status.
- Offline does not prevent editing; it may affect a triggered network backup, not schedule persistence itself.

#### Components

`ScheduleScopeSelect`, `ScheduleForm`, `FrequencyChoice`, `TimeInput`, `WeekdaySelect`, `IntervalInput`, `AutomationStatus`, `SaveBar`.

#### Desktop and accessibility

Conditional controls preserve logical focus order. Time and weekday labels remain visible. Task Scheduler details stay behind Technical details.

#### Contract limits

Current schedule list/upsert/remove contracts support global and per-channel schedules, Daily, Weekly, Every N hours, catch-up, startup backup, task status, next expected time, and safe error. Do not expose cron or arbitrary scheduled commands.

### 12.6 Integrity settings

#### Goal and layout

Configure opt-in periodic verification:

- enabled;
- Weekly, Monthly, or Custom interval;
- local time;
- scope;
- Drive mode: Standard or Full file verification.

Full file verification includes an inline bandwidth and temporary-disk warning.

#### States

Disabled, enabled, saving, validation error, scope unavailable, and full Drive mode selected.

#### Contract limits

Available now through periodic-integrity settings. The UI must preserve the exact configured scope and must not state that a fresh full hash exists until a check completes.

### 12.7 Notifications

#### Goal and layout

Let users enable categories without per-file noise:

- successful backups;
- backups with issues or failures;
- destination disconnected/reconnected;
- authentication required;
- integrity problems;
- repair outcomes;
- schedule errors.

Use compact switch rows. Explain that repeated notifications for one unresolved problem may be suppressed.

#### States

Loading, saving, saved, OS notifications unavailable when a typed capability exists, and category disabled.

#### Contract limits

Notification preferences are available now. Do not add a notification-history UI without a query contract. Click routing must validate route and entity IDs before opening specific details; otherwise open the owning parent safely.

### 12.8 Advanced and Diagnostics

#### Goal and hierarchy

Keep operationally useful technical information available without leaking it into daily surfaces.

Groups:

- Managed tools: yt-dlp availability/version, Stable/Nightly channel, and `Update yt-dlp`; FFmpeg availability/version with an explanation that it remains pinned to the application release.
- Google Drive runtime summary.
- Application, environment, database, and worker information.
- Locations and actions: Open logs; application data/database/staging paths only when exposed safely.
- Diagnostics actions: Export diagnostics and Copy system info only after redacted typed implementations exist.

#### States

Tool ready/unavailable, yt-dlp Stable/Nightly selected, update available/updating/updated/failed/rollback-safe, worker reconnecting/unavailable, last safe Drive error, export pending/completed/failed. A specific database-migration error state appears only after a dedicated safe startup/health error contract exists; current worker failures are generic.

#### Components

`DiagnosticsGroup`, `DefinitionList`, `CopyButton`, `Button`, `TechnicalStatus`, `Disclosure`.

#### Desktop and accessibility

Technical values are selectable and wrap safely. Copy actions announce success. Error codes supplement, not replace, safe user messages.

#### Contract and security limits

Foundation and tool diagnostics are available now; Open logs is available through narrow main-process mediation. Current contracts do not set the yt-dlp Stable/Nightly channel or safely update its managed binary. Add a narrow managed-tool update contract with allowlisted release sources, integrity verification, atomic replacement, rollback, and safe progress before those controls appear. FFmpeg remains pinned to the application release. Current database health can report only ready state, and specific startup/migration failure diagnosis requires a dedicated safe health-error DTO. Export diagnostics, copy system info, and application-data/staging/database open actions are not currently exposed to the renderer. They require dedicated redacted contracts. Never expose tokens, cookies, auth codes, authorization headers, credential references, arbitrary paths, or raw child-process commands/output.

### 12.9 Recovery settings entry

#### Goal and layout

Explain when Recovery is used, show the latest incomplete/completed session, and enter the dedicated Recovery workflow.

Actions:

- `Restore an existing backup`;
- `Resume recovery` when a resumable session exists;
- `Start another recovery` after completion.

States:

- Loading latest session.
- No session: explain Recovery and offer `Restore an existing backup`.
- Draft or ready-for-review session: `Resume recovery` with its current phase.
- Active scan/import: show progress and resume monitoring; leaving Settings does not cancel it.
- Completed or completed-with-warnings: show last result and allow a new session.
- Safe query error: retain the explanation and offer retry.
- Offline: local-source recovery remains available; Drive authorization/discovery explains the network prerequisite.
- Drive authorization required: identify the recovery-only Drive capability and continue to the dedicated workflow.

State clearly that recovery rebuilds/merges the local catalog, does not change backup files or YouTube, and does not restore credentials or schedules.

#### Contract limits

Current recovery session contracts support this entry. Starting another recovery must not silently discard an active session.

### 12.10 About

#### Goal and layout

Show:

- application name and version;
- Free and Open Source statement;
- GitHub, Report an issue, and Support the developer actions when configured;
- read-only YouTube promise;
- Google Drive compliance/release information only where product/legal copy requires it.

#### Contract limits

Application name/version/environment/platform/architecture are available in foundation data. External links require exact allowlisted destinations and system-browser opening. No in-app payment form, paid feature state, or telemetry control is introduced.

## 13. Recovery workflow

Recovery is a dedicated progressive workflow reached from first run or Settings. It may merge into an existing catalog, but it never mutates canonical catalog state during scan/preview.

### 13.1 Recovery shell

#### Goal

Keep source selection, scanning, preview, confirmation, import, and result mutually understandable at every durable session state.

#### Hierarchy and layout

Use a five-stage step list:

```text
Sources
Scan
Preview and warnings
Restore catalog
Result
```

Only the current stage exposes its primary action. Within Preview and warnings, the summary precedes grouped warnings. Completed stages remain reviewable where safe. Provider IDs and parser codes remain in Technical details.

#### Components

`RecoveryShell`, `RecoveryStepList`, `SourceList`, `RecoveryProgress`, `RecoveryPreview`, `WarningGroups`, `ImportConfirmation`, `RecoveryResult`.

#### Desktop and accessibility

- The step list is a progress indicator, not five clickable cards.
- Progress announces phase changes and bounded count milestones, not every file.
- Long warning lists virtualize/group while retaining count and source context.
- Focus moves to the new stage heading after a confirmed transition.

### 13.2 Sources

#### Goal and layout

Add one or more independent sources:

- Local backup folder;
- Google Drive backup through an authorized Drive identity.

Each source row shows type, label, scan state, and safe error. Source removal is not shown until a narrow removal contract exists.

Drive source setup authorizes an identity and adds a source. With the current contract, the first scan discovers app-created roots, initially selects newly found roots, and returns their names for review. Renamed or moved roots remain valid when discovered through provider metadata.

#### Actions

- Add Local source through native picker.
- Add Drive account/source.
- Continue to the initial Scan.
- Leave the draft and resume it later. Do not offer Cancel/Abandon without a narrow contract that changes inactive-session state deliberately.

#### States

- No sources.
- Local source added.
- Drive authorization required/pending/failed/completed.
- No app-created Drive roots found after scan.
- Multiple Drive roots found after scan, ready for review.
- Source pending/scanning/scanned/failed/cancelled.
- Offline permits Local source setup and blocks Drive discovery.

#### Contract and safety limits

Current contracts support multiple Local/Drive sources and durable per-root selection, but root discovery occurs inside `recovery.scan`, not when a Drive source is added. Do not show pre-scan root choices unless a narrow discovery action is added. The renderer never accepts or sends arbitrary provider IDs except values returned by the typed Drive-root list. Local selection is main-mediated. No credential is imported from a source.

### 13.3 Scan

#### Goal and layout

Show a fast, non-destructive catalog scan with phase and progressive counts.

Normal phases translate as:

- Preparing sources;
- Scanning local backup;
- Finding Google Drive items;
- Reading backup details;
- Preparing preview.

Primary action before start: `Scan sources`. During scan: `Cancel scan`.

#### States

- Ready to scan.
- Scanning with known or unknown total.
- Individual source failure while healthy sources continue where supported.
- Session failed with safe retry.
- Cancelled, with canonical catalog unchanged.
- Worker restart marks an interrupted scan Failed with `Scan the sources again`; the user explicitly starts a new scan. It does not claim automatic resume or rerun.

#### Contract and safety limits

Scan reads manifests, sidecars, filesystem metadata, and app-owned Drive metadata. It does not call YouTube, yt-dlp, or FFmpeg; upload/delete content; download full videos; freshly hash every large file; import credentials; or write canonical catalog records. Archived hashes remain expected values, not fresh verification results.

### 13.4 Preview and warnings

#### Goal and layout

Explain what can be reconstructed before the user authorizes import.

Preview summary:

- channels;
- media;
- playlists;
- Local copies;
- Google Drive copies;
- warnings.

Warnings are grouped by action/impact, such as:

- unsupported or invalid backup metadata;
- missing files or Drive objects;
- size/hash conflicts;
- partial backups;
- unsafe paths;
- ambiguous destinations;
- orphaned or unknown references.

Each group shows a plain-language consequence and affected count. Technical warning code and entity key are disclosed deeper.

#### Actions

- Review warnings.
- Change selected Drive roots returned by the initial scan.
- Scan again.
- Continue to Restore catalog.
- Leave and resume later. `cancelRecovery` is reserved for active scan/import work under the current contract.

#### States

- Ready with no warnings.
- Ready with warnings.
- Partial source results.
- Unsupported schema that blocks one source.
- Source selection changed: preview becomes invalid and Restore is disabled until rescan.

#### Contract limits

Current session DTO caps returned warning details while exposing total counts. The UI must say when only a bounded warning sample is shown. Drive-root controls use only roots returned by the prior scan; changing them invalidates the preview and returns the workflow to Scan. The UI must not invent recovered objects from counts or hide a blocking unsupported schema inside a generic warning total.

### 13.5 Restore catalog confirmation and import

#### Goal and layout

Require explicit confirmation of the canonical merge after a valid preview.

Confirmation states:

- exact candidate counts;
- existing catalog will be merged by stable YouTube IDs;
- backup files and Drive objects will not be changed;
- YouTube will not be contacted;
- credentials, schedules, notification preferences, and UI preferences will not be restored;
- full integrity verification is a separate post-recovery action.

Primary: `Restore catalog`. Secondary: Back to Preview. During import: `Cancel after current batch` when supported by the current session state.

#### States

- Importing with Import and Rebuilding search phases.
- Cancel requested at safe batch boundary.
- Failed with resumable/re-runnable explanation.
- Completed.
- Completed with warnings.
- Worker crash/restart during import returns the session to Ready for review. Already committed batches remain valid, and the user explicitly reconfirms `Restore catalog` to continue.

#### Contract and safety limits

- Import is idempotent, bounded, stable-ID based, and worker-owned.
- Already committed batches remain valid after cancellation/crash.
- The UI must not promise an all-or-nothing transaction for a very large import.
- Changing sources or Drive-root selection after preview requires rescan.
- The renderer never writes canonical catalog data or FTS.

### 13.6 Result

#### Goal and layout

Confirm the restored catalog and direct the user to the next useful task.

Show:

- restored/merged channel, media, playlist, and copy counts;
- warning count and items needing attention;
- `Open Library` primary action;
- `Review integrity issues` when relevant;
- `Connect YouTube` as an optional later action when source refresh is desired;
- `Run full verification` as a separate explicit action.

#### States

- Completed.
- Completed with warnings.
- No recoverable content.
- Search-index rebuild failed/retry required.

#### Contract limits

Completion means the worker completed import and FTS work for the session. It does not mean every large media file received a fresh SHA-256 check. Recovered copies preserve the verification strength supported by source evidence. Existing recovered copies must remain reusable by future backup planning.

## 14. Global state coverage matrix

Every implementation review must exercise these state classes on every surface where they can occur:

| State         | Required presentation                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| Loading       | Shape-matched skeleton or bounded action progress; no stale value presented as current.                               |
| Empty         | Explain why the surface is empty and give the owning next action.                                                     |
| Error         | Safe message, affected object/scope, Retry or resolution, and preserved user input.                                   |
| Disconnected  | Name the destination, preserve catalog/copy identity, and never relabel it missing.                                   |
| Auth required | `Sign in again`, the affected Google identity/capability, and Settings > Accounts link.                               |
| Active        | User-level operation, phase, progress when known, and safe controls.                                                  |
| Success       | Confirm worker-recorded outcome without permanent green badge clutter.                                                |
| Partial       | State what succeeded, what did not, and where the user resolves it.                                                   |
| Disabled      | Explain the prerequisite adjacent to the control; do not rely on disabled styling alone.                              |
| Offline       | Keep Local catalog, Local verification, and eligible Local repair usable; network work waits without burning retries. |

## 15. Cross-screen acceptance criteria

- Home, Library, Channels, Activity, Storage, Integrity, and Settings are the only primary destinations.
- The integrated titlebar replaces the native titlebar plus visible `File Edit View Window` strip without adding fake browser controls.
- Accounts, Playlists, Backup configuration, Queue, Backup History, Diagnostics, Recovery, and tool versions appear under the owners defined in `docs/UX-IA.md`.
- Every primary screen is usable at 1120 by 760 and 880 by 620, and expands intelligently at 1440p and 4K.
- No primary button label wraps at the baseline or minimum supported size.
- Content and operational lists can handle thousands of items through paging or virtualization.
- Every modal or dialog traps/restores focus and uses application confirmation UI instead of native `window.confirm`.
- Status is never color-only, and visible focus works across titlebar, sidebar, toolbars, rows, cards, panes, dialogs, and disclosures.
- Normal surfaces do not expose raw job types, recovery-step counts, provider verification enum names, worker readiness, hashes, provider IDs, yt-dlp state, FFmpeg build strings, or raw error output.
- Technical detail remains available through explicit disclosures and Diagnostics when it is safe and useful.
- Search remains worker-owned and usable with backup drives disconnected.
- Quick backup never rewrites settings. Custom backup does not exist visually until a typed temporary-configuration contract exists.
- A lost backup-start response never produces a blind Retry before persisted runs are refreshed.
- Verification, repair, and recovery never overstate their strength or completion.
- Recovery scan/preview remains isolated from canonical catalog writes until explicit import confirmation.
- The renderer retains narrow typed IPC and never gains SQLite ownership, generic shell execution, generic filesystem access, provider credentials, or a generic external-navigation bridge.
