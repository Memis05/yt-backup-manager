# YouTube Backup Manager — Codex Handoff

Read these specifications before writing application code, in this order:

1. `MVP.md`
2. `ARCHITECTURE.md`
3. `DATABASE.md`
4. `JOB-ENGINE.md`

The four files are the current approved development blueprint.

Important v1.0 decision:
- YouTube source
- Local filesystem destination
- Google Drive destination
- official application uses the project's Google OAuth client
- no Dropbox/OneDrive in v1.0
- YouTube is permanently read-only

Codex should begin with the first vertical durability milestone described in `MVP.md` / `ARCHITECTURE.md`, not with UI polish.
