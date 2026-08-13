# YouTube Backup Manager Design System

Status: authoritative Phase 7A design specification; platform: Windows 10 and 11 desktop application; theme: dark only for v1.0; visual density: 6/10; design variance: 5/10; motion intensity: 3/10.

This document defines the target visual language for YouTube Backup Manager. It replaces the current renderer's visual grammar. Existing layouts and CSS are not precedent unless this document or the screen specifications explicitly retain them.

The product is an operational archive manager, not a dashboard template, streaming service, website, or developer console. Its interface should make protection state, active work, required attention, and recovery choices understandable without exposing the worker's internal structure.

## 1. Design principles

### Protection before statistics

Lead with an answer to the user's question: are the selected channels protected, is work active, and does anything need attention? Counts support that answer. They are not the answer by themselves.

### Tasks before containers

Choose a layout from the task: a list for operations, a master-detail view for playlists, an image grid for media, and divided rows for settings. Do not place every concept in an interchangeable bordered card.

### Progressive disclosure for technical depth

Plain language owns the default view. Job steps, copy IDs, provider IDs, hashes, file paths, tool versions, logs, and diagnostic messages appear only where they help someone investigate or recover.

### Honest state

The UI never claims that a copy is verified until verification succeeds. `Unavailable` is not `Missing`. Standard provider-metadata verification is not presented as downloaded SHA-256 verification. A partial outcome stays visible and actionable.

### One action owner

Each primary action has one predictable owner. Backup starts from channel context, current work is controlled from Activity, accounts live in Settings, and recovery is a guided Settings flow. Duplicate shortcuts may deep-link to that owner but do not create competing workflows.

### Native desktop confidence

Use the window well: compact chrome, persistent navigation, dense lists, keyboard access, independent scrolling, and native Windows controls. Do not imitate a narrow responsive website.

### Quiet when healthy

Healthy infrastructure should not demand attention. There is no permanent `Worker ready` badge. Connectivity, authorization, destination, or worker status surfaces when it changes the user's next action.

## 2. Visual direction

The target is a neutral charcoal product shell with restrained luminance layers, confident typography, and content-led screens. Red identifies the product's most important affirmative action and selected navigation. Semantic green, amber, and danger colors describe outcomes and do not replace labels or icons.

Netflix contributes content emphasis, limited color, and disciplined typography. FACEIT contributes compact integrated chrome, grouped navigation, and settings density. The implementation must not copy entertainment carousels, giant marketing type, gaming metrics, neon color, browser controls, or either reference's exact tokens.

The visual system deliberately rejects:

- blue-navy developer-dashboard surfaces;
- a matrix of equally prominent KPI cards;
- uppercase eyebrows above every heading;
- borders around every group and row;
- pills for ordinary metadata;
- red on routine, neutral, or verification actions;
- raw enum values as default copy;
- default shadcn, Radix Themes, or Electron styling.

## 3. Color system

All colors are semantic tokens. Components consume tokens, not literal colors. Token names below are the normative source of truth; code may expose them as CSS custom properties.

### 3.1 Neutral surfaces

| Token                   | Value                 | Use                                            |
| ----------------------- | --------------------- | ---------------------------------------------- |
| `color.canvas`          | `#0B0B0D`             | Main application background                    |
| `color.chrome`          | `#101012`             | Titlebar and sidebar                           |
| `color.surface.1`       | `#141416`             | Main panels and list regions                   |
| `color.surface.2`       | `#1A1A1E`             | Inputs, selected rows, nested regions          |
| `color.surface.raised`  | `#202025`             | Menus, popovers, dialogs, temporary elevation  |
| `color.surface.hover`   | `#242429`             | Neutral hover state                            |
| `color.surface.pressed` | `#2A2A30`             | Neutral pressed state                          |
| `color.border.subtle`   | `#2A2A2F`             | Dividers and necessary boundaries              |
| `color.border.strong`   | `#3A3A41`             | Focus-adjacent structure and selected outlines |
| `color.overlay.scrim`   | `rgba(0, 0, 0, 0.68)` | Modal scrim                                    |

Use a surface change before a border. A panel may use a border when it needs a boundary against the same-level canvas, but nested borders are the exception.

### 3.2 Text and icons

| Token                  | Value     | Use                                         |
| ---------------------- | --------- | ------------------------------------------- |
| `color.text.primary`   | `#F4F4F5` | Headings, primary values, active labels     |
| `color.text.secondary` | `#B3B3BA` | Body copy and secondary metadata            |
| `color.text.muted`     | `#92929B` | Timestamps and nonessential supporting text |
| `color.text.disabled`  | `#68686F` | Disabled text only                          |
| `color.icon.primary`   | `#D7D7DB` | Default icons                               |
| `color.icon.muted`     | `#8B8B93` | Supporting icons                            |

`color.text.muted` is approximately 5.96:1 on `color.surface.1`. Do not lower opacity on already-muted text. Essential instructions use secondary or primary text.

### 3.3 Brand and interaction

| Token                        | Value     | Use                                              |
| ---------------------------- | --------- | ------------------------------------------------ |
| `color.brand.action`         | `#D93842` | Filled primary action                            |
| `color.brand.action.hover`   | `#C92F37` | Primary-action hover                             |
| `color.brand.action.pressed` | `#B6222C` | Primary-action pressed                           |
| `color.brand.accent`         | `#FF5B63` | Selected indicators and accent icon/text on dark |
| `color.focus`                | `#FF6B72` | Keyboard focus ring                              |

White on `color.brand.action` is approximately 4.57:1. Brand red does not mean error. Destructive actions use the danger treatment and explicit destructive copy, never the primary-action fill by default.

### 3.4 Semantic status

| Meaning                        | Foreground | Subtle background | Border    | Required secondary cue               |
| ------------------------------ | ---------- | ----------------- | --------- | ------------------------------------ |
| Healthy / verified / connected | `#76D6AD`  | `#10261F`         | `#285443` | Check icon plus label                |
| Warning / partial / paused     | `#F2C46D`  | `#2A2112`         | `#5F4B25` | Warning or pause icon plus label     |
| Error / corrupt / failed       | `#FF7A83`  | `#2B1518`         | `#653039` | Error icon plus label                |
| Informational / active         | `#8DB7FF`  | `#131F31`         | `#2B4A71` | Activity icon or progress plus label |
| Neutral / pending / unknown    | `#B3B3BA`  | `#1A1A1E`         | `#39393F` | State-specific icon plus label       |

Status color is never the only carrier of meaning. Large fills are reserved for blocking banners and callouts. Healthy rows usually use plain text plus an icon, not green pills.

### 3.5 Interaction-state rules

- Hover changes surface or underline, not layout.
- Pressed state combines a darker surface with at most `translateY(1px)`.
- Selected state uses surface emphasis plus a 2px brand indicator or checked control.
- Disabled controls use disabled text, reduced surface contrast, and `not-allowed` only when a pointer cursor would otherwise imply action.
- Destructive hover never uses brand red. It uses the danger background and danger foreground.
- Focus always remains visible over hover and selected states.

## 4. Typography

### 4.1 Families

Use a locally bundled Geist Sans variable font covering weights 400 through 700. Network font loading is prohibited. The fallback stack is:

```css
font-family: 'Geist Sans', 'Segoe UI Variable Text', 'Segoe UI', sans-serif;
```

Use Geist Mono only inside copied technical identifiers, hashes, paths, or diagnostic code blocks. Do not mix a monospaced face into ordinary metadata.

### 4.2 Type scale

| Role          | Size / line   | Weight   | Tracking  | Use                                   |
| ------------- | ------------- | -------- | --------- | ------------------------------------- |
| Page title    | `28px / 34px` | 650      | `-0.02em` | One per primary view                  |
| Dialog title  | `20px / 26px` | 600      | `-0.01em` | Dialog and sheet headings             |
| Section title | `18px / 24px` | 600      | `-0.01em` | Major regions                         |
| Row title     | `14px / 20px` | 600      | `0`       | Object and setting titles             |
| Body          | `14px / 20px` | 400      | `0`       | Default reading text                  |
| Body strong   | `14px / 20px` | 600      | `0`       | Important values and action labels    |
| Secondary     | `13px / 18px` | 400      | `0`       | Metadata and supporting copy          |
| Caption       | `12px / 16px` | 500      | `0.01em`  | Compact labels, timestamps            |
| Micro         | `11px / 14px` | 500      | `0.02em`  | Nonessential overlays only            |
| Technical     | `12px / 18px` | 400 mono | `0`       | IDs, paths, hashes, diagnostic output |

Minimum default readable text is 12px. Micro text cannot contain an action, failure reason, or required instruction. Uppercase is limited to familiar abbreviations such as `GB` and `SHA-256`, not labels or headings.

Numeric tables and progress metrics use tabular numerals. Long names wrap to two lines where space allows. Truncation must expose the full value through a tooltip and accessible name.

## 5. Spacing and sizing

The base unit is 4px.

| Token       | Value  | Typical use                 |
| ----------- | ------ | --------------------------- |
| `space.0`   | `0`    | Reset                       |
| `space.0.5` | `2px`  | Optical adjustment          |
| `space.1`   | `4px`  | Icon/label micro-gap        |
| `space.2`   | `8px`  | Tight control gap           |
| `space.3`   | `12px` | Row internals               |
| `space.4`   | `16px` | Default content gap         |
| `space.5`   | `20px` | Compact section inset       |
| `space.6`   | `24px` | Panel inset and section gap |
| `space.8`   | `32px` | Page padding                |
| `space.10`  | `40px` | Major vertical separation   |
| `space.12`  | `48px` | Empty-state spacing         |
| `space.16`  | `64px` | Rare large separation       |

Control heights are 32px compact, 36px default, and 40px prominent. Pointer targets are at least 36 by 36px in dense desktop layouts and 40 by 40px for isolated icon controls. Adjacent 32px row controls require at least 4px separation and a 36px effective hit area.

Page content uses 28px horizontal padding at the primary window size and 32px when maximized. Dense list regions may extend to the page grid edge; their rows retain 16 to 20px horizontal inset.

## 6. Shape, border, and depth

### 6.1 Radius scale

| Token         | Value   | Use                            |
| ------------- | ------- | ------------------------------ |
| `radius.xs`   | `4px`   | Compact tags, progress tracks  |
| `radius.sm`   | `7px`   | Inputs, buttons, menu items    |
| `radius.md`   | `10px`  | Panels, rows with surface fill |
| `radius.lg`   | `12px`  | Dialogs and sheets             |
| `radius.pill` | `999px` | Status chips only              |

Nested objects use the same or smaller radius than their parent. Generic 16 to 20px cards are not part of this system.

### 6.2 Borders

- Default divider: `1px solid color.border.subtle`.
- Selected outline: `1px solid color.border.strong` plus a brand indicator.
- Input error: danger border plus error text and icon.
- Focus: 2px outer ring using `color.focus` with a 2px canvas offset.
- Do not use borders as decoration behind every metric, label, or healthy state.

### 6.3 Shadows

Depth comes from luminance first. Only temporary layers cast shadows:

| Token            | Value                                  | Use                       |
| ---------------- | -------------------------------------- | ------------------------- |
| `shadow.popover` | `0 8px 24px rgba(0,0,0,0.36)`          | Menus, tooltips, popovers |
| `shadow.dialog`  | `0 20px 56px rgba(0,0,0,0.52)`         | Dialogs and sheets        |
| `shadow.focus`   | `0 0 0 2px #0B0B0D, 0 0 0 4px #FF6B72` | Keyboard focus fallback   |

Persistent content panels and cards do not cast shadows.

## 7. Iconography and imagery

Use one locally bundled Phosphor icon package. Regular weight is the default; selected navigation may use a filled variant only when the silhouette remains identical. Default sizes are 16px in compact metadata, 18px in controls and navigation, 20px in prominent actions, and 24px in empty states.

Rules:

- No hand-drawn SVG icons in component code.
- Every icon-only action has an accessible name and a tooltip.
- Icons support labels; unfamiliar product actions are never icon-only.
- Status icons have a text label.
- Provider logos retain their recognized color only in identity contexts, not as general decoration.
- Thumbnails use a 16:9 ratio, `object-fit: cover`, and a neutral fallback with a media-type icon.
- Broken or absent thumbnails do not show a browser image-error icon.

## 8. Application shell

### 8.1 Window titlebar

The target titlebar is 40px high and visually integrated with `color.chrome`. Use Electron `titleBarStyle: 'hidden'` with Windows `titleBarOverlay` so native minimize, maximize/restore, and close controls remain owned by Windows. Keep the normal frame and resize behavior. Do not set `frame: false`.

Layout from left to right:

1. 16px app icon and `YouTube Backup Manager` in 12px medium text.
2. Flexible drag region.
3. Exception-only operational status. Active or paused operations link to Activity; account, destination, integrity, schedule, network-blocked work, or worker exceptions link to their owning resolution route when current typed state identifies one. A global offline indicator requires an additive capability contract and is not inferred from browser state.
4. Optional overflow menu for Help, About, and diagnostics. `Quit` appears only after a narrow orderly-shutdown command exists; it never uses a generic BrowserWindow bridge.
5. The native Window Controls Overlay safe area.

The renderer must reserve Electron's `titlebar-area-x`, `titlebar-area-y`, `titlebar-area-width`, and `titlebar-area-height` environment values rather than hardcoding caption-button width. All buttons, links, menus, and status triggers are `app-region: no-drag`; empty titlebar canvas is `app-region: drag`. Drag regions disable text selection and have no custom context menu.

Remove the default `File / Edit / View / Window` application menu with `Menu.setApplicationMenu(null)`. Preserve fixed keyboard commands through explicit accelerators or renderer shortcuts where required. Do not add browser Back, Forward, or Refresh controls.

Native caption buttons provide their own hover, pressed, inactive, maximized, high-DPI, and accessibility behavior. The application must test, not assume, drag-region double-click, Snap Layout, maximize/restore, Alt+Space, high contrast, and scaling behavior in a packaged Windows build. Closing continues to obey the existing close-to-tray lifecycle.

Implementation references: Electron's [Custom Title Bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar), [Custom Window Interactions](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions), [BaseWindow options](https://www.electronjs.org/docs/latest/api/structures/base-window-options), and [Application Menu](https://www.electronjs.org/docs/latest/tutorial/application-menu) documentation.

### 8.2 Sidebar

The full sidebar is 208px wide below the titlebar. It uses `color.chrome`, a 1px right divider, and two semantic groups plus an anchored Settings item:

- Archive: Home, Library, Channels.
- Operations: Activity, Storage, Integrity.
- Settings: anchored at the bottom after a flexible spacer.

Each item is 36px high with an 18px icon, label, and optional exceptional badge. The active item uses `color.surface.2`, primary text, and a 2px brand indicator at the leading edge. Hover uses `color.surface.hover`. There is no red-filled navigation block.

The sidebar footer contains version/help access only. It does not permanently repeat worker readiness or read-only YouTube messaging. Account identity is available inside Settings and contextual authorization states.

At widths below 1040px, the sidebar becomes a 64px icon rail. Tooltips and accessible names expose every label, and focus order remains identical. It never becomes an off-canvas mobile drawer. At 880px minimum width, the content region remains usable with the rail.

### 8.3 Page frame

The titlebar does not scroll. The sidebar does not scroll unless its content truly overflows at high text scaling. Each primary page owns one scroll container below the titlebar. Sticky toolbars and split panes use the page's local scroll context.

A standard page has:

- a 28px-high context line only when needed for breadcrumb or entity ownership;
- one page title and optional concise description;
- one primary action at the trailing edge;
- a toolbar or tabs where the workflow needs them;
- the content region.

Do not repeat product-name eyebrows, universal account/media counters, or the page name inside its first section.

## 9. Navigation and orientation components

### `AppTitleBar`

Owns drag/no-drag regions, title, exception status, overflow, and overlay-safe layout. It never polls by itself; it consumes typed shell state.

### `Sidebar`

Renders semantic navigation groups and compact-rail behavior. Counts appear only when an item needs attention, never as decorative totals.

### `NavItem`

Supports default, hover, focus, active, disabled, and attention states. Uses link/button semantics appropriate to the renderer route adapter.

### `PageHeader`

Contains title, one-sentence description when necessary, and at most one primary action plus one overflow. It is not a card.

### `Toolbar`

Holds search, filters, view controls, sort, and contextual bulk actions. At compact widths it wraps into two intentional rows, never into clipped controls. Filters with active values show an adjacent `Clear filters` action.

### `Tabs`

Use for sibling views of one destination, such as Media/Playlists or Active/History/Needs attention. Tabs have a text label, optional count, 36px minimum height, a clear active indicator, arrow-key navigation, and programmatic panel relationships.

### `SegmentedControl`

Use only for low-risk display modes such as Grid/List. It is not a substitute for workflow tabs or a select.

### Breadcrumbs and back behavior

Use a short breadcrumb or labeled back action for entity details, not a browser-style back button in the global titlebar. Detail routes preserve the originating filter and scroll state.

## 10. Controls and forms

### 10.1 Button hierarchy

| Variant   | Visual treatment                           | Use                                    |
| --------- | ------------------------------------------ | -------------------------------------- |
| Primary   | Brand fill, white label                    | One affirmative page/dialog action     |
| Secondary | Surface 2, subtle border, primary label    | Important alternative action           |
| Ghost     | Transparent, hover surface                 | Toolbar and row actions                |
| Danger    | Transparent or danger-subtle, danger label | Destructive action after clear context |
| Link      | Text with underline on hover/focus         | Low-emphasis navigation                |

Buttons use sentence case, a single line, and an action verb. If the control cannot act, nearby text explains why. Loading preserves width, replaces the leading icon with a spinner, and prevents duplicate activation. A disabled primary action does not remain the loudest object on the page.

### 10.2 `IconButton`

Use only for familiar compact actions such as overflow, close, or view mode. Minimum visible size is 32px and effective hit area 36px. Tooltip delay is 500ms; keyboard focus reveals it immediately.

### 10.3 `Input` and `Search`

Default height is 36px, radius 7px, surface 2, and a subtle boundary. Labels are persistent above inputs unless a compact search has a stable accessible name. Placeholder text is an example, not the label. Search includes a leading icon, clear control, debounce feedback, and `Escape` behavior that clears only when focus remains in the field.

### 10.4 `Select`

Use a themed accessible select primitive for finite choices. The trigger is fully bounded, displays the chosen value, and keeps the chevron inside the hit area. Menus support arrow keys, typeahead, Home/End, Escape, selected-state text, and viewport collision handling.

### 10.5 `Checkbox`

Use for independent multi-selection such as destinations. Label the consequence, for example `Back up to Archive D:` rather than `Manage`. Mixed state is allowed only when real child state exists. The label and control share one hit target.

### 10.6 `Switch`

Use only for settings that take effect immediately and have a clear on/off meaning. Place the label and explanation before the switch. Do not use a switch for destructive, scheduled, or multi-step actions.

### 10.7 Validation and help

Validation is local to the field or group, announced in an error summary when submission can produce multiple failures. Error text states how to recover. Help text remains visible when it prevents a consequential mistake; supplementary detail belongs in a tooltip or disclosure.

### 10.8 Save behavior

Settings rows declare whether they save immediately or require `Save changes`. Do not mix silent autosave and explicit submit in one undifferentiated panel. Autosave communicates `Saving` and `Saved` without a global busy lock.

## 11. Status and feedback language

### 11.1 Status treatment

Use one of three levels:

1. Inline status: icon plus text for ordinary connected, verified, pending, or unavailable state.
2. Status chip: compact pill only when state must be scanned beside many peer rows.
3. Callout/banner: blocking, cross-row, or page-level issue with explanation and action.

Raw enums are mapped to sentence case. Example mappings:

| Internal value           | Default visible copy   |
| ------------------------ | ---------------------- |
| `COMPLETED`              | Completed              |
| `COMPLETED_WITH_ERRORS`  | Completed with issues  |
| `AUTH_REQUIRED`          | Sign in again          |
| `RETRY_WAIT`             | Retrying soon          |
| `PROVIDER_METADATA_SIZE` | Standard verification  |
| `DOWNLOADED_SHA256`      | Full file verification |

Technical details may expose the exact value in a labeled disclosure.

### 11.2 `Progress`

Determinate progress shows percentage, completed/total when known, current action in plain language, and accessible `aria-valuenow`. Indeterminate progress states what is being prepared. Progress is never inferred from elapsed time.

### 11.3 `Toast`

Toasts confirm nonblocking actions such as setting saved, folder opened, or backup planned. They remain visible for at least five seconds, pause on hover/focus, support dismiss, and do not contain the only record of a failure. At most three stack in the bottom-right above page content.

### 11.4 `ErrorState`

Local query failures stay in the affected region with `Try again` when safe. Page-level failures preserve orientation. A durable operation timeout never says to blindly repeat the action; it directs the user to Activity while persisted state is checked.

### 11.5 `EmptyState`

An empty state explains why the region is empty and offers one relevant next action. It does not occupy an oversized card or suggest switching filters when a clear/reset action can do it directly.

### 11.6 `Skeleton`

Skeletons reproduce the final region's broad geometry with neutral surface layers. They contain no fake text, pulse only when reduced motion is not requested, and are announced as one labeled loading region rather than many screen-reader items. Existing content remains visible during background refresh whenever showing it is not misleading.

## 12. Content components

### `MediaCard`

Used only in the Library grid. The 16:9 thumbnail leads, the whole card is one semantic link/button, the title receives up to two lines, and metadata follows. Healthy availability is quiet; exceptional source/copy state is visible. Hover uses subtle thumbnail luminance and surface change, not scale-heavy animation.

### `MediaRow`

Used for dense Library, playlist, and completed-operation lists. Columns align across rows; the title remains the primary accessible link. Compact state and destination metadata appear at the trailing edge.

### `ChannelRow`

Uses an avatar, identity, protection summary, last source refresh, next backup when available, and one contextual action. Media-type counts are supporting text, not three nested cards.

### `DestinationRow`

Shows destination name/type, path or account label, availability, free space or quota when known, and last verified activity. Routine actions live in an overflow menu. Disabling is destructive and explains consequences without implying data deletion.

### `ActivityItem`

Represents a user-level operation backed by a rediscoverable typed contract. Initially this covers queue-backed backup, verification, and repair work. Source sync remains on Channel and Recovery remains in its workflow until an active-operation query can rediscover them. The item shows target, state, plain-language current step, progress, timing, and allowed controls. Worker DAG jobs remain in a technical disclosure.

### `CopyStatus`

Summarizes intended and actual copies per destination, verification strength, last verification, and actionable exceptions. It never equates existence with verified integrity.

### `SettingsRow`

Uses a divided row with label/help on the left and a bounded control or status/action on the right. Related rows share a section heading and surface instead of individual cards.

### Metric treatment

Metrics are typographic pairs within semantic groups. Use a large value only when it changes a decision. A Home protection summary may show one primary outcome with three supporting facts; it must not become an eight-card grid.

## 13. Overlays and temporary layers

### `Tooltip`

Short explanatory text only. It is not a container for required instructions or interactive controls. It opens on hover and focus and closes on Escape.

### `DropdownMenu` and `ContextMenu`

Use a shared accessible primitive and visual treatment. Destructive items appear last after a separator. Context menus are optional accelerators; every action remains reachable without a secondary click. No custom context menu appears inside the titlebar drag region.

### `Dialog`

Use for focused, consequential decisions such as starting a multi-destination backup or confirming recovery import. It traps focus, closes with Escape unless a noninterruptible commit phase forbids it, restores trigger focus, labels title/description, and keeps actions visible. Default width is 480 to 640px; never fill the desktop without need.

### `Drawer` / `Sheet`

Use a right-side sheet for rich media or operation details when retaining list context is valuable. Default width is 440px and may expand to 560px. At compact width it becomes a full content pane below the titlebar, not a squeezed overlay. The sheet has a route/deep-link identity where the contract supports it.

### Confirmation

Do not use native `confirm()`. A confirmation names the object, consequence, preservation/deletion behavior, and reversible option. Canceling a job with partial files requires explicit choices in product language.

## 14. Loading and state model

Every major surface implements the following shared states. Screen-specific content is defined in `docs/SCREEN-SPECS.md`.

| State         | Required treatment                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| Loading       | Skeletons matching final geometry for initial read; inline progress for known active work; no full-window spinner |
| Empty         | Reason, relevant context, and one next action                                                                     |
| Error         | Safe message, affected scope, retained context, and retry only when idempotent/safe                               |
| Disconnected  | Provider/destination identity, effect on protection, and reconnect path                                           |
| Auth required | `Sign in again`, affected capability, preserved local/catalog data reassurance where true                         |
| Active        | Operation label, progress/current step, allowed controls, and persisted destination in Activity                   |
| Success       | Outcome and timestamp; use a toast for transient acknowledgement and durable history for operations               |
| Partial       | Completed portion, unresolved portion, and safe next action; amber rather than generic success                    |
| Disabled      | Clear prerequisite next to the control; no unexplained dead button                                                |
| Offline       | Preserve browseable local catalog state, identify blocked remote actions, and avoid false global failure          |

Stale data must be labeled when freshness affects a decision. Changing filters may retain current results behind a local loading treatment, but must not silently present them as matching the new query.

## 15. Motion

| Token                    | Duration                     | Use                                             |
| ------------------------ | ---------------------------- | ----------------------------------------------- |
| `motion.fast`            | `80ms`                       | Hover, press, focus-color feedback              |
| `motion.base`            | `140ms`                      | Menu, tooltip, selected-row transition          |
| `motion.slow`            | `200ms`                      | Dialog/sheet entry and route content transition |
| `motion.easing.standard` | `cubic-bezier(0.2, 0, 0, 1)` | Standard movement                               |
| `motion.easing.exit`     | `cubic-bezier(0.4, 0, 1, 1)` | Exit only                                       |

Animate opacity and transform only. Route changes use a subtle 4px vertical settle and fade; they do not slide the entire application. Progress changes may animate their track but never delay a truthful value. New activity rows may fade in; changing order does not create decorative spring movement.

With `prefers-reduced-motion: reduce`, remove transforms and nonessential transitions, reduce feedback to immediate opacity/color changes, and keep progress understandable without animation.

## 16. Desktop sizing and reflow

The primary design viewport is the existing 1120 by 760 content window. The minimum supported window remains 880 by 620 unless implementation testing proves a safe higher minimum. The design must function at Windows scaling of 100%, 125%, 150%, and 200%.

### Width behavior

| Window width  | Shell                  | Content behavior                                                                    |
| ------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| `880-1039px`  | 64px icon rail         | One primary column; toolbars use two planned rows; sheets become full content panes |
| `1040-1439px` | 208px full sidebar     | Standard layouts; up to three media columns; 440px details sheet                    |
| `1440-1919px` | 208px full sidebar     | Wider split panes, four media columns where readable, secondary Home column         |
| `1920px+`     | 224px full sidebar max | Add useful columns/pane width; cap readable text lines, not the whole application   |

Do not center all content in a narrow website column. Lists and grids use available width. Reading-heavy help text may use a 72-character line length within its region.

### Height behavior

At 620px height, the titlebar and page header remain compact, actions remain reachable, and content scrolls locally. Dialogs use a maximum height of `calc(100vh - 64px)` with a scrollable body and fixed action footer. Split-pane headers remain visible while their list bodies scroll independently.

### Zoom and text scaling

Controls cannot depend on one-line helper text. At increased text size, rows grow, buttons retain labels, and toolbars move to an intentional second line. Horizontal scrolling is allowed only inside genuinely tabular technical data, never for the primary workflow.

## 17. Accessibility requirements

The target is WCAG 2.2 AA as applied to a Windows desktop web renderer.

- All functionality is keyboard reachable in a predictable order.
- Every screen begins with a unique level-one heading.
- Focus is visible at 2px minimum and is never clipped by scroll containers.
- Dialogs and sheets trap and restore focus; menus follow expected roving-focus behavior.
- Grid cards and rows use buttons or links, not clickable noninteractive elements.
- Status updates use appropriately scoped live regions and do not repeatedly announce polling refreshes.
- Progress has a programmatic name, value, and state.
- Color is paired with icon, text, pattern, or position.
- Text meets 4.5:1 for ordinary type and 3:1 for large text and meaningful graphical controls.
- Keyboard targets have at least a 24 by 24px WCAG target, while this system aims for 36px effective desktop targets.
- Truncated content has a focusable or associated full-value disclosure where it affects identification.
- Destructive and durable actions have clear names, consequences, and safe cancellation behavior.
- Reduced motion, Windows high contrast/forced colors, 200% scaling, and screen-reader labels are included in acceptance testing.
- Native Window Controls Overlay behavior is verified on Windows 10 and 11; the design does not recreate caption buttons in the renderer.

## 18. Layer and z-index model

Components use named layers rather than arbitrary large numbers.

| Layer        | z-index | Contents                                          |
| ------------ | ------: | ------------------------------------------------- |
| Base         |     `0` | Page content and normal surfaces                  |
| Sticky       |    `10` | Page-local sticky toolbar/header                  |
| Sidebar      |    `20` | Sidebar and shell dividers                        |
| Titlebar     |    `30` | Integrated titlebar below native overlay controls |
| Dropdown     |    `40` | Selects, menus, autocomplete                      |
| Toast        |    `50` | Toast stack                                       |
| Scrim        |    `60` | Modal scrim                                       |
| Dialog/sheet |    `70` | Modal content and blocking sheets                 |
| Tooltip      |    `80` | Tooltips above all renderer content               |

Native Window Controls Overlay remains outside the renderer's z-index model. Nested components do not create new stacking contexts without a documented reason.

## 19. Component foundation and dependency policy

The current renderer has no shared UI package, accessibility primitive library, icon library, router, or animation library. Phase 7A implementation should begin with renderer-local tokens and product components.

- Use accessible low-level Radix primitives selectively for Dialog, DropdownMenu, Tooltip, Select, Tabs, Switch, and Checkbox when native elements do not provide the required behavior.
- Do not add Radix Themes or ship default shadcn styling.
- Use semantic native elements for buttons, inputs, lists, tables, and progress where they are sufficient.
- Add one Phosphor icon family and bundle it locally.
- Bundle Geist Sans locally and document its license.
- Do not mix component systems.
- Extract `packages/ui` only after a second real consumer or substantial proven reuse exists.
- Keep all renderer dependencies compatible with the existing content-security policy. No remote scripts, styles, fonts, or icon assets.

Each primitive requires unit/component coverage for keyboard and state behavior before widespread adoption. Product components add domain copy and semantics rather than leaking raw worker DTOs into styling primitives.

## 20. Content and copy rules

- Use sentence case.
- Start buttons with verbs: `Back up now`, `Refresh channel`, `Verify copies`, `Sign in again`.
- Prefer user objects and outcomes: `media`, `copy`, `destination`, `backup`, `completed operation`.
- Reserve `job`, `worker`, `provider ID`, `DAG`, `appProperties`, and raw status names for Technical details.
- Explain verification strength without weakening it: `Standard verification` and `Full file verification`.
- Use `catalog` only when distinguishing indexed metadata from downloaded media matters.
- Never imply YouTube write access. Connection and refresh copy reinforces read-only behavior where authorization context makes it relevant, not in persistent chrome.
- Avoid release-phase language such as `Phase 2`.
- Avoid architecture explanations such as `durable summaries remain separate` in normal views.
- Use punctuation naturally and keep labels short. Do not use all-caps emphasis.

## 21. Visual quality gates

Before a migrated screen replaces its predecessor, verify:

- the task and primary action are identifiable within five seconds;
- populated, loading, empty, error, partial, disconnected, offline, and disabled states are represented as applicable;
- no raw enum or internal job step dominates the default view;
- one container level can be removed without losing meaning before adding a border;
- controls do not wrap or clip at 880 by 620 and 1120 by 760;
- useful extra columns or pane width appear at 1440p and 4K;
- focus order, focus visibility, screen-reader names, reduced motion, and high contrast pass;
- semantic status is accurate and not conveyed by color alone;
- titlebar drag/no-drag regions and native controls work in a packaged Windows build;
- the renderer continues to use only narrow typed APIs, with no Node.js, database, generic shell, or arbitrary filesystem access.

The target screen structures, journeys, and state-specific content are defined in `docs/UX-IA.md` and `docs/SCREEN-SPECS.md`. Implementation sequencing and behavioral guardrails are defined in `docs/UI-MIGRATION-PLAN.md`.
