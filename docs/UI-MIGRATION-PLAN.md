# YouTube Backup Manager UI Migration Plan

Status: Phase 7A implementation plan; scope: staged renderer and desktop-window migration only; target platform: Windows 10/11; primary window baseline: 1120 by 760 pixels; minimum supported window: 880 by 620 pixels.

## 1. Purpose

This plan replaces the current product interface without replacing the backup product underneath it. The migration is intentionally incremental: each stage produces a shippable application, retains a tested fallback until its replacement reaches parity, and changes only one architectural seam at a time.

The target interface is defined by `DESIGN.md`, `docs/UX-IA.md`, and `docs/SCREEN-SPECS.md`. This document defines how to reach that target safely. It does not authorize a backend rewrite, a database migration, or a single large renderer replacement.

The implementation strategy is a renderer-side strangler migration:

```text
native window and worker lifecycle
  -> existing typed preload API
  -> route adapter and feature controllers
  -> one active screen implementation per route
  -> new shell and migrated screen
```

Old layouts are disposable. Existing behaviors, safety boundaries, and durable state semantics are not.

## 2. Non-negotiable boundaries

Every stage must preserve the following constraints.

### 2.1 Process and data ownership

- The backup worker remains the only process that owns and opens SQLite.
- Renderer and normal Electron main code must not import `@ytbm/database`, `better-sqlite3`, repositories, migrations, or worker-only services.
- The renderer obtains product state only through the frozen `window.ytbm` preload API.
- Main continues to validate the calling frame and validate both IPC input and output.
- New UI needs are satisfied first by composing existing typed responses. Any genuinely missing data requires a narrow, additive schema and RPC change through core, IPC, worker, main, and preload in that order.
- The renderer must not scan backup folders, enumerate Drive data directly, infer database state, or maintain a second catalog.

### 2.2 Security

- Keep `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, and `allowRunningInsecureContent: false`.
- Do not expose generic BrowserWindow control, shell execution, SQL, arbitrary filesystem authority, arbitrary provider identifiers, or arbitrary URLs to the renderer. Bounded safe typed DTO fields such as known paths or provider-root IDs may be displayed or round-tripped only through their exact validated capability.
- Continue passing catalog-owned IDs to open, verify, repair, and destination operations. Main and worker resolve the authorized resource.
- OAuth secrets, authorization codes, access tokens, refresh tokens, cookies, and authorization headers remain outside renderer state and logs.
- YouTube remains permanently read-only. UI copy and controls must not imply upload, delete, edit, or playlist-write capabilities.
- Keep the renderer Content Security Policy restrictive. Fonts, icons, and design assets are bundled locally; remote scripts and styles are not added for the redesign.
- Renderer errors use safe messages. Technical disclosures may show approved codes and metadata, never credentials or unsanitized provider responses.

### 2.3 Durable-operation semantics

- Backup, source sync, integrity, repair, recovery, and schedule state comes from worker DTOs, not optimistic UI completion.
- A copy is shown as verified only after its verification state says so. UI progress reaching 100 percent is not verification.
- `UNAVAILABLE` is not `MISSING`; authorization required, disconnected, read-only, full, corrupt, and unknown remain distinct when their resolution differs.
- Standard Drive verification and downloaded SHA-256 verification remain different strengths even when translated into plain language.
- Pause, resume, cancel, priority, and partial-data choices map exactly to the existing run/job action enums. Retry timing is worker-owned state; the UI does not invent a manual job Retry action.
- A `backup.start` client timeout may coexist with an already-persisted run. The UI refreshes persisted runs/activity before offering another start; it does not blindly retry.
- Closing the window may leave the worker and tray application running. Native close controls must continue through the existing close-to-tray and shutdown policy.
- Recovery scanning and preview do not mutate the canonical catalog. Import remains a separate, explicit confirmation. Credentials and backup files are never imported or changed by scanning.
- Verified backup data is never automatically deleted because YouTube source content disappeared.

## 3. Current implementation seams

The current renderer is concentrated in `apps/desktop/src/renderer/src/App.tsx`. It owns navigation, data loading, pollers, mutation handlers, dialogs, and all screen markup. Migration should separate these responsibilities before replacing many screens.

| Current seam                                                                    | Migration treatment                                                                                                           |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Local `Section` union and `setSection` navigation                               | Replace behind an in-memory typed `AppRoute`; no browser router is required.                                                  |
| `onInternalRoute` sets a section directly                                       | Send every internal route through one compatibility adapter that understands stable persisted route IDs.                      |
| Screen-specific effects inside `App`                                            | Extract one controller/hook per feature while preserving the current polling cadence and cleanup.                             |
| Startup-wide account, channel, destination, diagnostics, and dashboard requests | Reduce only after each target screen has an explicit data owner; do not change all loading behavior at once.                  |
| Media Details modal state                                                       | Migrate to a substantial Library detail route or wide pane keyed by `mediaItemId`.                                            |
| Playlist selection state                                                        | Move under the Library route model and retain ordered membership and pagination.                                              |
| One global `busy` state                                                         | Inventory the controls it currently serializes, then replace it with operation-scoped pending state as each feature migrates. |
| Native `window.confirm` for cancel                                              | Replace with an accessible application dialog whose buttons map unambiguously to keep/remove-partial actions.                 |
| One global stylesheet                                                           | Introduce tokens and layers first; delete legacy selectors only after the last consumer is removed.                           |
| Architecture test names only `App.tsx`                                          | Change it to recursively guard all desktop main, preload, and renderer source files before splitting the renderer.            |
| Packaged E2E asserts old navigation labels                                      | Preserve its functional journeys, then migrate assertions route by route. Do not delete coverage with the old shell.          |

### 3.1 Single-owner rule for live data

Only the active implementation of a route may own its request loop. A legacy and replacement screen must never be mounted together merely to hide one with CSS.

The extracted controllers must retain cancellation/cleanup for:

- OAuth and source-sync status polling, currently every one second;
- Library and Playlist queries, currently debounced by 200 milliseconds;
- Backup run and channel-settings loading;
- Queue/Activity polling, currently every one second;
- Integrity overview polling, currently every two seconds;
- Recovery session polling, currently every 750 milliseconds while scanning or importing;
- schedule/settings loading.

After a mutation, refresh the owning worker-backed query rather than editing a second, optimistic copy of durable state. Optimistic treatment is limited to temporary interaction state such as an open menu, selected tab, or pending button.

## 4. Target route model and compatibility seams

The new route model is renderer-local. It describes product navigation without changing the worker or database:

```ts
type AppRoute =
  | { area: 'home' }
  | { area: 'library'; view: 'media' | 'playlists'; entityId?: string }
  | { area: 'channels'; entityId?: string; panel?: 'overview' | 'backup' | 'schedule' }
  | {
      area: 'activity';
      view: 'active' | 'history' | 'attention';
      entityId?: string;
      detail?: 'overview' | 'technical';
    }
  | { area: 'storage'; entityId?: string; flow?: 'add' }
  | {
      area: 'integrity';
      view: 'overview' | 'issues' | 'history';
      entityId?: string;
      flow?: 'verify' | 'repair';
    }
  | {
      area: 'settings';
      category:
        | 'general'
        | 'accounts'
        | 'backup'
        | 'scheduling'
        | 'integrity'
        | 'notifications'
        | 'advanced'
        | 'recovery'
        | 'about';
    };
```

Exact names may change during implementation, but the semantic distinctions and compatibility rules below must remain.

### 4.1 Existing local-section to target-route mapping

| Existing renderer state or surface | Target route                                       | Compatibility behavior during migration                                                                |
| ---------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `dashboard`                        | `{ area: 'home' }`                                 | The Home route can render the legacy Dashboard until Stage 4 completes.                                |
| `accounts`                         | `{ area: 'settings', category: 'accounts' }`       | The new Settings frame may host the legacy account content until Stage 6.                              |
| `channels`                         | `{ area: 'channels' }`                             | Channel list remains directly reachable.                                                               |
| `library`                          | `{ area: 'library', view: 'media' }`               | Search/filter/page state belongs to this route controller.                                             |
| `playlists`                        | `{ area: 'library', view: 'playlists' }`           | It becomes a Library sub-view, not a primary destination.                                              |
| selected playlist                  | `{ area: 'library', view: 'playlists', entityId }` | Preserve ordered membership and safe fallback when the playlist is no longer returned.                 |
| `backup` configuration             | `{ area: 'channels', entityId, panel: 'backup' }`  | Saved quality/destination configuration moves to Channel Details. No generic Backup route replaces it. |
| `backup` run history               | `{ area: 'activity', view: 'history' }`            | Existing `listBackupRuns` data moves intact.                                                           |
| `queue` active/retrying/paused     | `{ area: 'activity', view: 'active' }`             | Existing queue filters become secondary filters or operation details.                                  |
| `queue` attention                  | `{ area: 'activity', view: 'attention' }`          | Failed and blocked jobs retain their safe messages and resolutions.                                    |
| `queue` completed media            | `{ area: 'activity', view: 'history' }`            | Compose with run history without pretending it is a universal event log.                               |
| Media Details modal                | `{ area: 'library', view: 'media', entityId }`     | The route opens the full Media Details surface and returns focus to its invoker on close/back.         |
| `storage`                          | `{ area: 'storage' }`                              | Destination management stays primary; quality and diagnostics leave this route.                        |
| `integrity`                        | `{ area: 'integrity', view: 'overview' }`          | Issues and history become local views; verification/repair remain durable operations.                  |
| `settings`                         | `{ area: 'settings', category: 'general' }`        | Existing groups move category by category.                                                             |
| `recovery`                         | `{ area: 'settings', category: 'recovery' }`       | Preserve first-run direct entry as well as Settings entry.                                             |

### 4.2 Stable notification route mapping

`InternalRouteSchema` currently allows only `dashboard`, `backup`, `queue`, `storage`, `integrity`, and `settings`, plus a nullable UUID `entityId`. It carries no sub-view or Settings-category discriminator, and the current renderer ignores `entityId`. These identifiers may be persisted in notifications and must remain valid during the UI migration.

| Stable internal section | Default target     | Entity behavior                                                                                                                                            |
| ----------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dashboard`             | Home               | Ignore an unexpected entity safely.                                                                                                                        |
| `backup`                | Activity > History | Open Run Details only if the ID is resolved through an authorized existing response; otherwise keep History open and explain that the item is unavailable. |
| `queue`                 | Activity > Active  | Open Operation Details only if the ID is present in a fresh queue response; blocked/failed entities may select Needs attention.                            |
| `storage`               | Storage            | Open Destination Details only after the ID resolves through `listDestinations`.                                                                            |
| `integrity`             | Integrity          | Open a specific issue only after it resolves through `getIntegrityOverview`; otherwise show the overview/issues parent.                                    |
| `settings`              | Settings > General | A category-specific route requires an additive typed discriminator; never infer one from an arbitrary UUID.                                                |

The adapter must be a pure, unit-tested function. Unknown, stale, or unresolved entities fall back to the safe parent route. Do not change `InternalRouteSchema` merely to rename navigation. If a future notification needs a new target, expand the schema additively and retain compatibility for existing notifications.

### 4.3 Suggested renderer boundaries

The implementation should converge on small ownership boundaries such as:

```text
renderer/src/
  app/                 app composition, AppRoute, internal-route adapter
  shell/               AppTitleBar, Sidebar, PageFrame
  ui/                  tokens, primitives, common states
  features/home/
  features/library/
  features/channels/
  features/activity/
  features/storage/
  features/integrity/
  features/settings/
  platform/             typed window.ytbm facade helpers only
```

This is an ownership guide, not a requirement to create every folder up front. `App.tsx` should end as composition and route selection, not become another monolith. Keep components inside `apps/desktop` until there is a demonstrated second consumer; do not create `packages/ui` as speculative infrastructure.

## 5. Contract-gap protocol

A more ambitious screen is not permission to invent data. Classify every apparent gap before implementing it:

1. **Presentation-only:** rename, group, filter, or disclose fields already present. No IPC change.
2. **Renderer composition:** combine multiple existing typed queries under one controller with explicit loading/error/freshness behavior. No database or worker change.
3. **Additive contract:** the worker owns required information that no DTO exposes. Add a narrow query or field with schemas and end-to-end validation.
4. **Unsupported behavior:** no safe product operation exists. Hide the control from production UI and document the contract gap here; do not simulate it.

Any additive contract follows this order:

```text
core DTO/schema
  -> worker service/query
  -> worker RPC contract and tests
  -> desktop IPC input/output contract
  -> main forwarding and sender authorization
  -> frozen preload method
  -> renderer controller
  -> interaction and integration tests
```

Contract additions must be backward-compatible while legacy routes remain available. They must not grant arbitrary path, SQL, shell, URL, or provider-object authority or carry credentials/provider tokens. Exact bounded path or provider-ID fields are allowed only when the fixed capability requires them and validates their provenance.

### 5.1 Known gaps

| Target need                                                                     | Current capability                                                                                                                                                                                    | Implementation rule                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home active work, attention, recent outcomes, and channel/destination summaries | Dashboard gives counts and `lastBackupAt`; queue, integrity, channels, destinations, and runs are separate queries                                                                                    | Compose existing responses initially. Consider one worker-owned aggregate only if freshness or request cost becomes unacceptable.                                                                                                    |
| `Back up all channels`                                                          | `startBackup(channelId)` starts one channel                                                                                                                                                           | Initially open a channel chooser and invoke the existing contract with explicit per-channel feedback. Add an aggregate start contract before claiming one atomic all-channel operation.                                              |
| Unified Activity history                                                        | Backup runs expose only the latest 50 and Integrity embeds the latest 100 checks; neither is paged/filterable; source sync has no history list, and Recovery exposes latest/get-by-known-session only | Label the bounded interim histories. Add worker-owned paged/filterable history queries before target filters, paging, or a comprehensive timeline.                                                                                   |
| MVP archive-change history                                                      | `activity_log` persists media, metadata, playlist, destination, auth, backup, verification, and repair events, but no preload query exposes it                                                        | Add a worker-owned paged/filterable Activity-log DTO/RPC and present it in Activity > History. Never synthesize durable events from notifications or current catalog state.                                                          |
| User-level operation grouping                                                   | Queue exposes durable jobs with `backupRunId`, `mediaItemId`, and operation metadata, but not a durable user-level operation/history DTO                                                              | Add a worker-owned operation query for the complete target Activity model. A limited interim view may compose only relationships that existing stable IDs define deterministically; keep the exact job list under Technical details. |
| Rediscoverable active sync/recovery                                             | Queue excludes channel sync; sync polling requires a known `syncId`; Recovery is exposed through latest/get-by-known-session contracts                                                                | Keep sync progress on Channel and Recovery progress in its workflow initially, or add a worker-owned active-operation query before claiming them in Activity.                                                                        |
| Operation-level remove-partial cancel                                           | Jobs support keep/remove partial; run control currently supports keep partial only                                                                                                                    | Do not show a run-level remove-partial choice until a safe typed run action exists. The renderer must not fan out a destructive operation across child jobs.                                                                         |
| Library backup/copy, destination, and quality filters                           | `CatalogQuery` supports search, channel, media type, source state, and paging only                                                                                                                    | Extend the worker-owned paged query before offering these filters. Filtering one visible renderer page would return incorrect totals and pages. Playlist filtering remains optional unless specified by the target screen.           |
| Rich Media Details                                                              | Backup details expose title, media type, source status, and copies; catalog results contain other presentation fields; playlist membership is separate; there is no catalog get-by-media-ID query     | Compose only when the requested item is present in stable typed data, or add an enriched worker get-by-ID DTO. Never invent player/source URL, publication, channel, playlist, or thumbnail data.                                    |
| Media source and copy actions                                                   | There is no narrow Open on YouTube action and no per-media add/copy-to-destination action                                                                                                             | Do not use generic navigation or filesystem IPC. Add fixed, validated capabilities before displaying these actions.                                                                                                                  |
| Media repair context                                                            | Repair candidates come from Integrity, while `startRepair(copyId, allowYoutubeFallback)` leaves source selection to the worker                                                                        | Explain the preferred verified candidate, but do not offer a manual source selector without a new contract.                                                                                                                          |
| Destination copy coverage, last successful backup, and integrity summary        | Destination DTOs mainly describe identity, availability, and volume capacity                                                                                                                          | Omit unsupported summaries or add an explicit worker-owned destination summary. Do not calculate coverage from the visible Library page or call volume usage archive-owned bytes.                                                    |
| Complete Integrity issues/history                                               | Global/channel health is complete, but media, issues, and history arrays are capped at 100 without totals, filters, or paging                                                                         | Label bounded recent samples and add worker-owned paged/filterable issue/history queries before target filters or complete-list claims.                                                                                              |
| Destination reconnect, re-enable, and manual probe                              | No explicit destination-ID actions exist; re-adding the same trusted path/volume or Drive account re-enables a stable match, and Drive account auth uses existing OAuth                               | Explain the trusted re-add recovery path and route Drive auth to Settings > Accounts, or add one narrow direct action per behavior. Do not invent manual probe.                                                                      |
| Destination kind                                                                | Filesystem DTOs do not classify internal, external, or network storage                                                                                                                                | Use only known labels. Do not infer a device class from path syntax.                                                                                                                                                                 |
| Add-destination diagnostics                                                     | Local add returns a destination or cancel; rejected probe states collapse to a generic safe worker error                                                                                              | Add a typed discriminated probe/add result before promising distinct unavailable, read-only, full, permission, invalid, or duplicate feedback.                                                                                       |
| Channel health, last backup, next schedule                                      | Channel, run, schedule, destination, and backup-settings data are separate                                                                                                                            | Compose by stable channel ID with defined loading/partial states. Add an aggregate only if needed.                                                                                                                                   |
| Quality upgrade policy                                                          | Quality settings can increase, but the planner skips existing verified copies and exposes no eligibility preview or upgrade-existing intent                                                           | Add worker-owned eligibility and action/policy contracts. Require an explicit choice between upgrading existing eligible copies and applying the higher quality only to new media; preserve one logical media record.                |
| Concurrency and update settings                                                 | Stored settings include them, but `RendererSettingsPatchSchema` does not authorize them                                                                                                               | Display read-only values only if useful; hide editing until the narrow renderer patch is deliberately expanded and tested.                                                                                                           |
| Application update flow                                                         | `checkForUpdates` is stored but renderer editing and GitHub Releases check/download/install capabilities are absent                                                                                   | Add narrow integrity-verified updater contracts and packaged install/restart/rollback semantics before rendering `v1.x available`, `Update`, or `Later`.                                                                             |
| yt-dlp Stable/Nightly and update                                                | Tool diagnostics are read-only; no renderer-safe channel selection or managed-binary update action exists                                                                                             | Add an allowlisted, integrity-verified, atomic tool-update contract with safe progress and rollback. FFmpeg remains pinned to the application release.                                                                               |
| Live title-bar health                                                           | Foundation status is primarily a startup snapshot                                                                                                                                                     | Show no permanent healthy indicator. Exception status must come from a current typed source and open its owning resolution route.                                                                                                    |
| Global offline status                                                           | No renderer network-capability contract exists; only scoped operation/provider/destination states are typed                                                                                           | Show scoped network-blocked exceptions only. Do not infer global offline from browser state; add a typed capability contract before a global indicator.                                                                              |
| Specific notification deep links                                                | Current renderer ignores `entityId`; list queries rather than get-by-ID APIs cover several entities                                                                                                   | Resolve IDs from fresh authorized responses, otherwise fall back to the parent route. Claim deep-link support only after regression tests.                                                                                           |
| Global search or command palette                                                | No global search contract                                                                                                                                                                             | Do not add one. Keep search local to Library.                                                                                                                                                                                        |

## 6. Stage plan

Every stage includes focused tests, the repository-wide checks applicable to changed code, a defined exit gate, and a rollback seam. A stage is not complete when only its populated happy state looks correct.

### Stage 0 - Freeze behavior and create migration seams

**Scope**

- Record a parity matrix for every `window.ytbm` method, the current screen/actions that call it, and the target owner.
- Add representative fixtures for healthy, empty, loading, partial, error, disconnected, authorization-required, active, paused, retrying, blocked, cancelled, completed-with-issues, and recovery-preview states.
- Extract product controllers/hooks from `App.tsx` without changing visible layout or copy.
- Introduce the typed `AppRoute` and pure legacy/internal route adapters behind the existing navigation.
- Make the database-ownership architecture test scan all main, preload, and renderer source files recursively.
- Establish one renderer interaction-test environment. Use a single accessibility-oriented primitive/test stack; do not introduce competing component systems.
- Split the existing packaged E2E into stable user journeys rather than one long test, while retaining all current functional assertions until their routes migrate.

**Required tests**

- Pure route-adapter tests, including every legacy section, every stable internal section, null entity, stale entity, and unknown-resolution fallback.
- Controller tests proving pollers start once, stop on unmount/route exit, and refresh after mutations.
- Existing desktop IPC authorization and contract tests.
- Recursive architecture-boundary test.
- Existing packaged Electron journey with no intended visual behavior changes.

**Exit gate**

- Current UI remains functionally and visually equivalent.
- Each live query and mutation has one named owner.
- No renderer source can import database code without failing a test.

**Rollback**

- Revert controller wiring and keep the original `App` behavior. There are no schema or persisted-data changes.

### Stage 1 - Window chrome and design tokens

**Scope**

- Add neutral dark design tokens, typography, spacing, radii, focus, semantic status, motion, and layer tokens without restyling all legacy content at once.
- Replace the default title bar with Electron's supported hidden-titlebar plus Window Controls Overlay approach.
- Remove the visible default application menu. Preserve the tray context menu and existing close-to-tray behavior.
- Add `AppTitleBar` with the local app icon/name, safe drag region, optional exception-only status, and no browser back/forward/refresh controls.
- Keep `Quit` in the main-owned tray menu initially. Add it to renderer titlebar overflow only through a narrow `requestQuit` command that preserves orderly worker shutdown; never expose generic BrowserWindow control.
- Match `BrowserWindow.backgroundColor` to the renderer canvas to avoid startup flash.

**Target Electron configuration**

```ts
{
  width: 1120,
  height: 760,
  minWidth: 880,
  minHeight: 620,
  titleBarStyle: 'hidden',
  titleBarOverlay: {
    color: '#101012', // color.chrome
    symbolColor: '#F4F4F5', // color.text.primary
    height: 40,
  },
  // Keep the normal frame and thick frame defaults.
}
```

- Call `Menu.setApplicationMenu(null)` before application readiness when the product has no native application menu. Do not use `autoHideMenuBar` as the removal mechanism because Alt can reveal it.
- Use `app-region: drag` only on noninteractive title-bar space. Give buttons, links, menus, and status affordances `app-region: no-drag`.
- Size renderer content with `env(titlebar-area-x)`, `env(titlebar-area-width)`, and related safe-area values. Do not hardcode caption-button width or assume the controls are always on the right.
- Let Windows own minimize, maximize/restore, close glyphs, hit targets, and system hover/pressed behavior. Do not expose BrowserWindow commands to imitate controls in React.
- Do not set `frame: false` or disable `thickFrame`; preserve Windows resize borders, shadow, animation, and native controls.

The implementation basis is the official Electron documentation for [Custom Title Bars](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar), [Custom Window Interactions](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions), [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window), [BaseWindow options](https://www.electronjs.org/docs/latest/api/structures/base-window-options), [Application Menus](https://www.electronjs.org/docs/latest/tutorial/application-menu), and [Keyboard Shortcuts](https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts/).

Electron documents drag/no-drag regions, overlay safe-area APIs, native controls, and menu removal. It does not explicitly guarantee every Windows double-click, Snap Layout, keyboard, or high-DPI behavior for an arbitrary custom drag surface. Those are validation requirements, not assumptions.

**Required tests**

- Unit-test title-bar style/overlay values and reassert every existing web-preference security option.
- Main-process test that the default application menu is absent while the tray menu remains available.
- Packaged Windows smoke for drag, no-drag interactions, minimize, maximize, restore, native close, close-to-tray, and explicit Quit.
- Verify the menu does not reappear with Alt.
- Manual Windows 10/11 matrix at 100, 125, 150, and 200 percent scale: normal, maximized, restored, snapped, multi-monitor, keyboard/system menu, high contrast, and visible focus for renderer-owned controls.
- Capture 1120 by 760, 880 by 620, maximized 1440p, and representative 4K screenshots.

**Exit gate**

- No native title/menu double stack is visible.
- Native caption controls and window lifecycle work in a packaged build.
- The legacy app remains usable under the new chrome and tokens.

**Rollback**

- Restore the previous window options and default menu behavior while leaving unused token files in place. No renderer or database contract is involved.

### Stage 2 - Accessible primitives

**Scope**

- Implement and document the primitive inventory required by the target screens: Button, IconButton, Input, Search, Select, Checkbox, Switch, Tabs, SegmentedControl, Tooltip, DropdownMenu, ContextMenu, Dialog, optional Drawer/Sheet, Toast, Progress, Skeleton, EmptyState, ErrorState, status treatment, SettingsRow, and metric treatment.
- Choose at most one accessible low-level primitive foundation if native React/HTML behavior is insufficient. Fully theme it; do not import default dashboard styling.
- Adopt one locally bundled icon family. Do not mix icon sets or add hand-rolled SVG controls.
- Implement focus trapping/restoration, Escape handling, screen-reader names, reduced-motion behavior, and status text independent of color.
- Keep media, channel, destination, activity, and copy-status components in their feature stages rather than prematurely generalizing them.

**Required tests**

- Keyboard and pointer interaction for every interactive primitive.
- Dialog focus trap, initial focus, Escape, destructive-choice labeling, and focus restoration.
- Tooltip and menu accessible naming and no titlebar drag-region interference.
- Automated accessibility checks plus manual high-contrast/focus review.
- Token contrast checks for body, secondary, disabled, focus, brand, success, warning, and danger combinations.

**Exit gate**

- Screens can be built without one-off buttons, pills, dialogs, or focus behavior.
- No default third-party visual language leaks into the product.

**Rollback**

- Primitives remain unused until a migrated route adopts them. Remove the primitive layer without touching IPC or old screens.

### Stage 3 - Application shell and navigation

**Scope**

- Introduce `AppShell`, Sidebar, NavItem, PageHeader/PageFrame, route outlet, error boundary, and global toast/dialog layers.
- Show exactly seven primary destinations: Home, Library, Channels, Activity, Storage, Integrity, Settings.
- Use a full labeled sidebar at 1040 pixels and above. Below 1040, use the specified compact rail with tooltips and an explicit user expand action; do not treat the app as a mobile webpage.
- Move Accounts, Playlists, Backup, Queue, and Recovery out of primary navigation via the route mapping in Section 4.
- Remove permanent `Worker ready`, read-only explanatory copy, and unrelated global account/media counters from the shell. Keep exception status only when sourced from current typed state.
- Place the legacy screen outlet inside the new shell until each route migrates. Only the selected route mounts.

**Required tests**

- Keyboard navigation, active destination, tooltip names, compact/full switching, independent sidebar scrolling, and focus placement after route change.
- Stable internal notification mapping to all six existing route IDs.
- Reload/startup default to Home; Recovery first-run entry still works.
- 880 by 620 layout does not hide destinations from keyboard or screen-reader users.
- No duplicate controller/poller mounts while switching legacy and migrated routes.

**Exit gate**

- The product has the final top-level IA even while some route bodies remain legacy.
- Every former primary destination has a deterministic target.
- Notification clicks and first-run entry points remain safe.

**Rollback**

- A development/build-time shell switch may select the old shell, but never mount both shells. It must not be a worker setting, database field, or permanent user preference.

### Stage 4 - Home

**Scope**

- Replace Dashboard with a health-first Home: dominant health conclusion, one contextual action, active work when present, needs-attention items, compact channel/destination summary, and recent outcomes that existing contracts genuinely expose.
- Preserve the first-run split between setting up a new archive and restoring an existing one.
- Treat onboarding as a sequence of existing narrow, independently persisted account, channel, destination, settings, and schedule calls, not as one atomic wizard transaction. Resume partial setup from worker-owned state.
- Use `getDashboardSummary` as the authoritative coverage summary and compose fresh queue, integrity, channel, destination, and run responses only where needed.
- Implement `Back up now` as a channel chooser unless/until a typed aggregate-start operation exists.
- Link attention to its owning route: Accounts, Storage, Activity, Integrity, or Scheduling.

**Required tests**

- Empty archive, healthy archive, incomplete copies, failed copies, active operation, disconnected destination, authorization required, stale/unresolvable attention entity, loading, and request failure.
- First-run new-setup and Recovery routes.
- Partially configured installations resume from persisted accounts, selected channels, destinations, and settings rather than dropping into an unexplained metrics view.
- Backup start refreshes persisted runs/activity before allowing a retry after a timeout.
- Home refreshes its worker-backed summary after observed operation completion; it does not retain the current Dashboard's stale startup snapshot.
- No vanity metric contradicts dashboard truth or Library pagination state.

**Exit gate**

- At 1120 by 760, Home answers health, active work, and attention in one viewport.
- Every conclusion is traceable to a worker DTO and has an honest partial/error state.

**Rollback**

- Route Home back to the legacy Dashboard body; keep the shell and route adapter.

### Stage 5 - Library, Playlists, and Media Details

**Scope**

- Migrate Library Media with content-forward Grid and List views, search, current typed filters, pagination, keyboard-operable media items, loading skeletons, and missing-thumbnail handling.
- Add backup/copy status, destination, or quality filters only after extending the worker-owned paged query. Never filter only the current renderer page.
- Move Playlists into Library local navigation while retaining master-detail behavior, ordered membership, filtering, pagination, empty states, and selection invalidation when query results change.
- Replace the narrow media modal with a full Media Details route or wide pane. Preserve source state, independent copy state, availability-gated open actions, per-copy/per-media verification, and technical metadata disclosure.
- Treat thumbnails as presentation; do not weaken remote-image CSP or introduce remote scripts/player code without a separate security review.

**Required tests**

- Debounce, filter reset, pagination, Grid/List persistence for the session, stale-request ordering, loading, empty, error, and disconnected-storage cases.
- Keyboard open/close/back, selected state, long titles, missing thumbnail, unknown duration, and focus restoration.
- Playlist selection invalidation, empty membership, ordered membership, member pagination, and opening a member's Media Details.
- Copy states including verified, pending, failed, missing, corrupt, unavailable, and authorization required.
- Local/Drive open actions refresh details after `MISSING` or `UNAVAILABLE` responses.
- Technical details preserve exact verification strength without making hashes primary copy.
- A direct entity route either resolves through a typed get-by-ID contract or falls back safely; it does not depend on the item happening to be on the current Library page.
- Open on YouTube, add/copy destination, and repair actions are absent until their narrow action and eligibility contracts exist.

**Exit gate**

- Library and Playlists feel like one content domain.
- Every old Library, Playlist, and Media Details capability is represented or explicitly blocked on an additive contract.

**Rollback**

- Switch Media and Playlists independently back to their legacy bodies. The route adapter retains their new parent navigation.

### Stage 6 - Channels and Accounts

**Scope**

- Migrate Channels to a concise list plus Channel Details with Overview, Backup settings, schedule summary, and source sync.
- Move saved channel quality/destination configuration out of the old Backup page and into Channel Details.
- Preserve its current immediate persistence through `updateChannelBackupSettings`; do not describe a changed quality/destination choice as temporary or saved only when backup starts.
- Add the normative higher-quality decision only after a worker-owned eligibility preview and upgrade action/policy exist: upgrade existing eligible copies or apply only to new media.
- Keep `Back up now` on channel rows/details and route the resulting run to Activity.
- Move Google identity management to Settings > Accounts. Channel enablement belongs in Channels or onboarding, while account capability, reconnect, disconnect, and discovery stay in Accounts.
- Move `Open logs` out of Accounts to Settings > Advanced > Diagnostics.

**Required tests**

- Multiple accounts and the same logical channel accessible through more than one account.
- No-account, no-channel, OAuth-configuration-unavailable, YouTube-only, Drive-enabled, account error/disconnected, pending OAuth, completed OAuth, failed/expired OAuth, reauthorization, and safe disconnect flows.
- Source sync start/status polling and cleanup for queued, running, retrying, completed, and failed states.
- Enable/disable channel, saved destinations, inherited/overridden quality, per-destination availability messaging, schedule summary, and backup start.
- Quality increases exercise no-eligible, upgrade-existing, new-media-only, loading, and eligibility-error states without duplicating logical media.
- An unavailable selected destination does not cause the renderer to block all otherwise eligible branches; the worker remains authoritative for waiting and continuation semantics.
- Disconnect confirmation states that credentials are removed without deleting catalog or backups.

**Exit gate**

- The old Accounts and Backup primary routes have no unique remaining behavior.
- Channels owns source and per-channel backup decisions; Accounts owns identity and permissions.

**Rollback**

- Route Channels or Settings > Accounts to their legacy bodies independently. Keep additive DTO fields, if any, backward-compatible and unused by rollback views.

### Stage 7 - Activity

**Scope**

- Merge Queue and Backup History into Activity > Active, History, and Needs attention.
- Add the required worker-owned paged Activity-log query for new media, metadata/playlist/source changes, destination state, authorization attention, and durable outcomes; present it as History change events.
- Present a user-level operation when current stable IDs allow accurate grouping; show durable jobs only under Technical details.
- Preserve progress, bytes, speed, ETA, retry time, destination, safe error, attempt count, and priority controls at the appropriate depth.
- Replace ambiguous native cancel confirmation with three explicit choices: keep partial data, remove partial data when the selected typed action supports it, or keep running.
- Route completed media to Media Details and integrity-related attention to Integrity.

**Required tests**

- All queue sections and job statuses, including reconnect/fresh-snapshot behavior.
- All backup-run statuses and currently exposed history triggers, including manual, custom-manual, scheduled, and startup. Verification/repair outcomes use queue/integrity contracts until unified history exists; Recovery remains in its dedicated session workflow.
- Pause/resume/cancel mappings for jobs and runs; unsupported run-level remove-partial is never offered.
- Move-top and priority actions appear only for supported job states.
- One poller remains active while Activity is mounted and stops on exit.
- Grouped summaries never hide a failed child job; Technical details reports exact job status/attempt/retry metadata.
- History accurately distinguishes completed, completed with issues, cancelled, and failed outcomes.
- History labels `localCopyCount`, `driveUploadCount`, failures, bytes, destinations, and effective quality accurately; it does not relabel local copy count as all verified copies.

**Exit gate**

- No top-level Queue or Backup History remains.
- Users can monitor and control every currently controllable job/run without seeing raw DAG terminology by default.

**Rollback**

- Activity tabs can delegate separately to the legacy Queue and Backup History bodies. Do not retain a partial new grouping that obscures controls.

### Stage 8 - Storage

**Scope**

- Rebuild Storage around destination identity, availability, capacity, safe actions, and only the copy/integrity summaries actually supported by contracts.
- Preserve native folder selection, Drive account association, app-owned roots, opening Drive, and disabling without data deletion.
- Do not show direct destination reconnect/re-enable, manual probe, or filesystem-kind labels until corresponding typed capabilities exist. Explain that re-adding the same trusted path/volume or Drive account re-enables a stable match; route Drive auth-required state to Settings > Accounts. Treat reported capacity as volume capacity, not archive-owned bytes.
- Move global quality to Settings > Backup.
- Move yt-dlp, FFmpeg, Drive runtime, paths, provider IDs, and volume diagnostics to Settings > Advanced > Diagnostics.

**Required tests**

- Add/cancel local-folder picker, add Drive for the selected account, open Drive, disable confirmation, and refresh.
- Available, disconnected, read-only, full, authorization-required, error, and unknown destination states.
- Capacity known/unknown and long paths/account identities at compact widths.
- No destination action accepts a renderer-provided arbitrary path or provider ID.

**Exit gate**

- Storage contains destination decisions, not tool/runtime configuration.
- Removing old diagnostic cards does not remove diagnostic capability from the product.

**Rollback**

- Restore the legacy Storage body; diagnostics and quality links may continue to open their new Settings categories.

### Stage 9 - Integrity and Repair

**Scope**

- Rebuild Integrity around a plain-language conclusion, issues-first hierarchy, verification history, scoped verify flow, and safe repair flow.
- Translate implementation labels while preserving exact details: `PROVIDER_METADATA_SIZE` becomes `Standard verification`, and `DOWNLOADED_SHA256` becomes `Full file verification` in normal copy.
- Show authorization, disconnection, unavailable, missing, and corrupt states separately.
- Explain worker-ranked repair candidates and the preferred verified source when exposed, but do not make the source user-selectable under the current contract. Require explicit consent before YouTube fallback.
- Route started integrity/repair operations to Activity > Active while Integrity retains their outcome and issue context.

**Required tests**

- Healthy, partial, pending, missing, corrupt, unavailable, authorization-required, loading, empty-history, and error states.
- All/channel/destination/media/copy scope mapping and both Drive verification strengths.
- Integrity polling starts once and stops on route exit.
- Repair is unavailable without a safe source; no corrupt/unverified source is presented as valid.
- The renderer sends only the target copy and fallback permission; it does not override the worker's repair-source choice.
- YouTube fallback confirmation is required and cannot be inferred from a generic confirm dismissal.
- Completed progress does not display `Verified` before the worker DTO does.

**Exit gate**

- No raw provider verification enum is primary copy.
- Every issue has an honest resolution or an explicit explanation that it cannot currently be repaired.

**Rollback**

- Route Integrity back to the legacy body. Existing worker jobs continue unaffected because they are durable and worker-owned.

### Stage 10 - Settings, Scheduling, Diagnostics, and Recovery

**Scope**

- Complete the persistent Settings category list: General, Accounts, Backup, Scheduling, Integrity, Notifications, Advanced, Recovery, and About.
- Move current settings controls to rows with explicit save-state behavior. Do not mix autosave and explicit save without labeling the difference.
- Preserve global/per-channel schedules, local wall-clock intent, timezone/DST behavior, catch-up, backup-on-startup, Windows Task Scheduler state, and removal.
- Preserve periodic integrity scope, schedule, and Drive mode with bandwidth warning for full file verification.
- Put managed-tool readiness, versions, safe paths, logs, and Drive runtime information under Advanced > Diagnostics.
- Implement the application `v1.x available` / `Update` / `Later` flow only after packaging defines a narrow integrity-verified GitHub Releases updater and orderly install/restart/rollback behavior.
- Implement yt-dlp Stable/Nightly and update controls only after an allowlisted, integrity-verified, atomic managed-tool update contract exists. Keep FFmpeg pinned to the application release.
- Rebuild Recovery as a progressive workflow: source selection, scan, preview/warnings, explicit import, completion. Do not display incompatible actions from multiple phases at once.
- Preserve Drive-only recovery authorization after catalog/database loss, multiple discovered app-created Drive roots, explicit root selection, and preview invalidation after a selection change. The current bridge discovers only the latest session automatically; do not promise a browsable recovery history without a new query.
- Populate About only with configured, real version/support links. Do not ship placeholder links.

**Required tests**

- Every authorized `RendererSettingsPatchSchema` field, validation failure, save pending/success/error, and reload persistence.
- Unsupported concurrency/update editing is absent until its contract is extended.
- Application update available/later/download/install/failure/rollback behavior and yt-dlp Stable/Nightly/update/rollback behavior pass focused contract and packaged tests before their controls appear.
- Schedule load initializes the correct scope; switching to a scope without a schedule does not retain another scope's values.
- Schedule create/update/remove for global and channel scope, plus ready/error Windows automation states.
- Notification categories persist independently.
- Diagnostics reveal technical data only on demand and open logs through the narrow existing method.
- Recovery resume/create, local source cancel, Drive authorization/root selection, scan, preview invalidation, warning review, explicit import, cancellation, completion, and completion-with-warnings.
- Recovery restart behavior: interrupted scan becomes Failed and requires `Scan sources` again; interrupted import returns to Ready for review and requires explicit `Restore catalog` reconfirmation while committed batches remain valid.
- Assert scanning does not mutate the canonical catalog; import does. Assert credentials and backup files are unchanged.

**Exit gate**

- Every old Settings, Accounts, diagnostics, scheduling, periodic-integrity, and Recovery capability has one clear category.
- No unsupported setting appears editable.
- Recovery safety boundaries remain visible at the decision point.

**Rollback**

- Roll back one Settings category at a time to its legacy body. A recovery session remains worker-owned and can be resumed after renderer rollback.

### Stage 11 - Consistency, accessibility, and legacy removal

**Scope**

- Review every supplied current screenshot against its migrated target and complete the capability parity matrix.
- Remove the old `Section`, navigation array, legacy screen branches, unused helpers, old modal, dead selectors, temporary adapters, and renderer-only migration switch only after all routes pass.
- Retain the stable internal-route adapter permanently unless the notification contract is deliberately versioned.
- Normalize copy, icon use, density, focus, loading/empty/error/disconnected/auth-required states, motion, truncation/tooltips, and technical disclosures.
- Review the complete diff for accidental worker, IPC, database, credential, CSP, or dependency changes.

**Required tests and validation**

- `corepack pnpm format:check`
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm package:dir`
- `corepack pnpm test:package-smoke`
- `corepack pnpm test:e2e`
- Packaged Windows keyboard, screen reader, high contrast, reduced motion, text scaling, DPI, multi-monitor, snap/maximize/restore, tray, notification-route, offline/disconnected, and crash/restart checks.
- Visual captures at 880 by 620, 1120 by 760, maximized 1440p, and representative 4K for all primary routes and consequential dialogs.

If an environment prevents a packaged or accessibility check, record the exact limitation and do not claim that gate passed.

**Exit gate**

- The compatibility matrix has no unexplained gaps.
- No legacy UI path or CSS remains in production.
- All required checks pass or have an explicit, accepted limitation.
- The renderer still has no database, generic shell, generic filesystem, or generic BrowserWindow capability.

**Rollback**

- Perform legacy deletion only after the prior release/branch remains recoverable. If a production rollback is required, deploy the last complete stage rather than trying to revive partially deleted legacy markup.

## 7. Test strategy across stages

### 7.1 Layers

| Layer                      | Responsibility                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Pure unit tests            | Route adapters, copy/status translators, derived presentation models, formatting, supported action visibility.             |
| Renderer interaction tests | Focus, keyboard, menus/dialogs, controller lifecycle, states, and user action to preload-call mapping with typed fixtures. |
| Contract tests             | Reject malformed input/output, arbitrary paths/URLs/shell/SQL, unsupported settings, and credentials.                      |
| Worker/desktop integration | Verify actual typed forwarding, persisted run/job/settings/recovery state, sender authorization, and worker ownership.     |
| Packaged Electron E2E      | Window chrome, tray, native dialogs, navigation, representative product journeys, and restart/recovery behavior.           |
| Manual Windows validation  | DPI, Snap, high contrast, assistive technology, system menu, multiple monitors, and visual quality.                        |

### 7.2 Stable selector policy

- Prefer accessible roles and names for normal interaction tests.
- Add a stable test ID only when a changing user-facing label or native overlay makes a semantic selector insufficient.
- Do not preserve poor copy solely because an E2E test asserts it.
- Preserve journey intent when labels and IA change: connect account, select channel, add destination, start backup, control work, inspect copy, verify/repair, configure schedule, and recover.

### 7.3 Per-stage command gate

For every implementation stage, run at minimum:

```text
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Run focused tests first while iterating, then the full gate. Run packaged smoke/E2E for window, shell, native dialog, tray, notification, durable-operation, and final stages. Never update snapshots blindly; inspect visual and semantic differences.

## 8. Rollout and rollback rules

- Migrate by route or Settings category, not by copying the whole renderer into a second application.
- A temporary build-time development switch may choose old or new presentation. It must select exactly one tree, must not be remotely controlled, and must not be stored in SQLite.
- Additive DTO/RPC changes land before their UI consumers and remain compatible through rollback.
- No stage changes or deletes persisted user data for visual migration.
- Durable worker operations continue across renderer route changes, window reloads, close-to-tray, and UI rollback.
- After any operation-start timeout, inspect the current worker-backed run/job/session before enabling a retry.
- Each stage's fallback is removed only in Stage 11 after parity and packaged validation.

## 9. Final removal and relocation review

### 9.1 Removed

- Native/default title bar plus visible `File Edit View Window` menu stack.
- The old ten-item primary navigation.
- Top-level Accounts, Playlists, Backup, and Queue destinations.
- Permanent `Worker ready`, permanent read-only sidebar explanation, and unrelated header counters.
- Repeated equal KPI grids, routine-state pills, card-per-setting/card-per-group treatment, and technical release-language copy.
- Raw job types, provider verification enums, hashes, tool versions, provider IDs, and filesystem internals from default views.
- Ambiguous native cancellation confirmation and mouse-only media cards.
- Legacy screen branches, old Media Details modal, and unused CSS after parity.

Removal from primary presentation does not mean removal of operationally useful details; those details move to deliberate disclosures or Diagnostics.

### 9.2 Retained

- All account, OAuth, channel discovery/selection, source sync, catalog, playlist, destination, backup, queue, run-control, job-control, media-copy, scheduling, integrity, repair, diagnostics, notification, tray, and recovery capabilities.
- Multiple accounts and channels, independent destinations, per-channel overrides, incremental/resumable backups, safe retry behavior, SHA-256 semantics, and manifest recovery.
- Worker-only database ownership, typed/narrow IPC, renderer sandboxing, credential isolation, and read-only YouTube access.
- Search while destinations are disconnected, independent copy states, safe local/Drive open actions, technical details on demand, and explicit recovery import.
- Existing default/minimum window dimensions unless later evidence requires a separately approved change.

### 9.3 Merged

- Queue, Backup History, and supported operation outcomes become Activity with Active, History, and Needs attention.
- Library and Playlists become one content domain with local views.
- Media copy details and catalog presentation become one Media Details experience when stable typed identity allows composition.
- Channel backup actions, saved channel quality/destinations, source sync, and schedule summary become Channel Details.

Backend DTOs and state machines are not merged merely because their presentation is unified.

### 9.4 Moved

- Accounts to Settings > Accounts.
- Playlist navigation to Library > Playlists.
- Backup configuration to Channel Details and Settings > Backup.
- Backup history to Activity > History.
- Queue controls and failures to Activity > Active/Needs attention.
- Recovery to Settings > Recovery, while retaining its first-run direct entry.
- Global quality to Settings > Backup.
- Periodic verification policy to Settings > Integrity.
- yt-dlp, FFmpeg, Drive runtime, logs, paths, and provider/volume details to Settings > Advanced > Diagnostics.
- Raw hashes, codecs, provider verification details, attempts, retry timing, priority, and job DAG information to Technical details.
- Read-only YouTube trust copy to onboarding, Accounts permission detail, Recovery, and About.

### 9.5 Navigation change

```text
Before: Dashboard, Accounts, Channels, Library, Playlists,
        Backup, Queue, Storage, Integrity, Settings

After:  Home, Library, Channels, Activity, Storage,
        Integrity, Settings
```

The new navigation is organized around the archive and the systems that maintain it, not the implementation phases that produced the application.

### 9.6 Window-chrome change

- One integrated 40-pixel product title bar replaces separate Windows/Electron chrome and the visible default menu.
- Native Window Controls Overlay retains Windows-owned caption controls.
- Renderer content respects the overlay safe area and defines explicit drag/no-drag regions.
- The tray menu, close-to-tray policy, resize frame, system behavior, and security settings remain.

### 9.7 Information-hierarchy change

- Health conclusion, active work, and actionable exceptions precede totals.
- Media imagery and titles precede routine badges and metadata.
- User-level operations precede durable jobs.
- Destination identity and availability precede tools and provider internals.
- Plain-language verification and resolution precede hashes and provider methods.
- Settings categories and rows replace a long stack of equal cards.

### 9.8 Supplied-screenshot resolution

Every current-screen screenshot has a named target and an explicit disposition:

| Supplied current screenshot | Target resolution                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `current/dashboard.png`     | Replaced by Home. Retain accurate coverage/last-backup facts; remove the equal eight-card grid, unrelated header counters, and empty populated-state action model.                                     |
| `current/accounts.png`      | Move to Settings > Accounts. Retain separate YouTube/Drive capability and multi-account/channel relationships; move channel selection to Channels/onboarding and logs to Diagnostics.                  |
| `current/channels.png`      | Rebuild as compact Channel rows and Channel Details. Retain source sync and media composition; add contract-backed health, saved backup settings, and schedule context without nested statistic cards. |
| `current/library.png`       | Retain as the strongest content-led precedent. Improve hierarchy, keyboard semantics, title treatment, filtering contracts, and healthy-state noise; merge Playlists into local Library navigation.    |
| `current/playlist.png`      | Retain the desktop master-detail model and ordered membership. Increase readable density, add membership paging/detail links, and use a route-like detail view at compact widths.                      |
| `current/backup.png`        | Remove as a destination. Move saved configuration to Channel Details, quick start to channel context, planning outcome to Activity, and history to Activity > History.                                 |
| `current/quueue.png`        | Replace seven equal filter cards with Activity > Active/History/Needs attention. Preserve exact worker controls and technical jobs under deliberate disclosure.                                        |
| `current/storage.png`       | Retain Storage as a destination list. Move quality to Settings > Backup and tool/runtime cards to Diagnostics; prioritize identity, availability, and capacity.                                        |
| `current/integrity.png`     | Fully replace the visibly collapsed layout. Retain exact health taxonomy/scopes/verification strengths; lead with a readable conclusion, issues, Verify, and safe Repair.                              |
| `current/settings.png`      | Replace the long card stack with persistent category navigation and divided Settings rows while preserving current authorized controls and durable scheduling semantics.                               |

The inspiration screenshots are also bounded deliberately:

| Supplied inspiration                  | Used for                                                | Explicitly not copied                                                       |
| ------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `inspiration/faceit-titlebar.png`     | Compact integrated desktop chrome and visual continuity | Browser navigation controls, custom caption-button imitation, gaming chrome |
| `inspiration/faceit-sidebar.png`      | Grouped icon-anchored navigation and economical density | Gaming IA, promotion, unlabeled icon-only navigation                        |
| `inspiration/faceit-settings.png`     | Persistent category navigation and divided setting rows | A literal double-sidebar modal and tiny low-contrast copy                   |
| `inspiration/faceit-statistics.png`   | Selective grouping and typographic value hierarchy      | Gamified scoring, trend/benchmark language, another equal-card dashboard    |
| `inspiration/faceit-statistics-2.png` | A few purposeful semantic regions                       | Neon color, player-stat metaphors, generic KPI proliferation                |

`netflix-DESIGN.md` contributes content emphasis, constrained color, spacing, and type discipline, but not its tokens, entertainment IA, carousel patterns, or marketing scale. `taste-SKILL.md` contributes audit-first rigor, card restraint, explicit states, accessibility, motion discipline, and copy review; its landing-page, hero, and scroll-storytelling rules do not govern this desktop tool.

## 10. Completion definition

The migration is complete only when:

- all seven primary destinations and their nested routes satisfy their target screen specifications;
- the old-to-new capability matrix is complete;
- no old route contains unique functionality;
- title-bar, menu, native controls, tray, and Windows scaling are verified in a packaged application;
- notification routes and stale entity fallbacks are regression-tested;
- every major state, not only populated success, is designed and tested;
- all renderer data remains typed and worker-owned;
- durable, verification, repair, and recovery semantics are unchanged;
- the final source and dependency diff has been reviewed;
- legacy markup/styles and the temporary migration switch are removed;
- all applicable validation passes, with any external limitation stated precisely.
