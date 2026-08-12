# Phase 2 source catalog

Phase 2 implements Google account connection and a local read-only YouTube
catalog. It does not download or back up media bytes.

## OAuth design

- Google Desktop/Installed Application authorization-code flow.
- S256 PKCE with a cryptographically random verifier.
- Cryptographically random, single-flow state validation.
- System browser sign-in; no embedded Google page and no OOB copy/paste flow.
- Loopback callback bound only to `127.0.0.1` on an ephemeral port.
- The Google-generated desktop client secret is build/development configuration
  used only by the privileged worker for token exchange and refresh. It is not
  persisted, logged, or exposed through renderer IPC.
- Scopes are `openid`, `email`, `profile`, and
  `https://www.googleapis.com/auth/youtube.readonly` only.
- The privileged worker exchanges and refreshes tokens. The normal Electron
  main process sees only the authorization URL needed to open the browser. The
  renderer sees a flow ID and safe status only.
- Access and refresh tokens are serialized only into the encrypted credential
  store. SQLite stores the opaque `credential_ref` and safe account metadata.

Set `YTBM_GOOGLE_OAUTH_CLIENT_ID` and `YTBM_GOOGLE_OAUTH_CLIENT_SECRET` in the
maintainer's environment. A source checkout without both keeps the Connect
Google control functional but reports a configuration-required state without
opening a browser.

## YouTube API approach

The source provider uses YouTube Data API v3:

1. `channels.list(mine=true)` discovers the channels represented by the grant.
2. The channel's uploads playlist is read with paginated
   `playlistItems.list` calls.
3. Video metadata is fetched in batches of up to 50 through `videos.list`.
4. Channel playlists and each ordered membership are read through paginated
   `playlists.list` and `playlistItems.list` calls.

Transactions cover one received page, never a network wait. A sync can write
safe discovered/upserted pages incrementally, but unseen media, playlists, and
membership are reconciled only after the provider returns a fully completed
authoritative inventory. A page/API failure therefore cannot mark unseen rows
removed.

## Identity and classification

Media identity is always `YOUTUBE + provider_media_id`. Playlist membership
references that one logical media row; it never duplicates media.

Classification order:

1. A record with `liveStreamingDetails.actualEndTime` is `LIVE`.
2. Otherwise duration at or below 60 seconds for pre-15 October 2024 uploads,
   or at or below 180 seconds for later/unknown dates, is `SHORT`.
3. Otherwise it is `VIDEO`.

YouTube Data API v3 does not expose a canonical Shorts flag or video
orientation. The 180-second rule follows the current maximum Shorts duration
but can classify a short horizontal video as `SHORT`, and unusual Shorts may be
classified as `VIDEO`. Active/upcoming livestreams are omitted until completed.

`channels.list(mine=true)` reflects the channel identity represented by the
OAuth grant. Google/YouTube account and Brand Account selection behavior can
therefore require connecting another grant to expose another managed identity.
The normalized `account_channels` table safely allows two grants to map to the
same logical channel.

A channel playlist can reference videos uploaded by another channel. Phase 2
stores ordered membership for media already belonging to the managed channel
catalog; it does not import another channel's video as if the selected channel
owned it.

## Incremental semantics

- Media, playlists, mappings, and membership use stable unique identities and
  idempotent upserts.
- `original_title` is immutable after first discovery.
- Title, thumbnail, and source-state changes create metadata history where
  applicable and safe Activity events.
- Completed authoritative absence marks source rows removed while preserving
  canonical rows and all future/existing copy relationships.
- Playlist removal preserves its row and last known membership.
- FTS5 is derived local data rebuilt for the synchronized channel. Search does
  not call YouTube and works without backup storage attached.
