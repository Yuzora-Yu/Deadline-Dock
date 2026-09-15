# Google OAuth production status

Verified in Google Cloud Console on 2026-09-15.

- Project: `deadline-dock-508705`
- Audience: External / In production
- Branding: verified and published; Google confirms it is displayed to users
- Data access: verification not required (no sensitive or restricted scopes)
- Scopes in the app: `openid email profile https://www.googleapis.com/auth/drive.file`
- Homepage: https://yu-zora.com/tools/Tool05_deadline-dock/
- Privacy: https://yu-zora.com/tools/Tool05_deadline-dock/privacy/
- Terms: https://yu-zora.com/terms/
- Authorized domain: `yu-zora.com`
- Logo source/export: `assets/branding/`

This is a Google-side configuration change. Existing v0.1.11 downloads use the same OAuth client and do not require rebuilding for production access. Old testing-mode authorizations may require reconnecting after expiry. Workspace administrators may independently restrict third-party apps.

The v0.1.11 executable icon is unchanged. The new logo is used for Google branding and the portal. Do not upload user tokens, client configuration JSON, or task databases with branding assets.

The production configuration and published branding were verified in the console. A fresh sign-in by an unrelated Google account was not performed.

## v0.1.12 sync correction

Deleting a task immediately requests automatic synchronization. The task row and its checklist, event, and resource rows are physically removed from Sheets. Existing visible deletion records are cleaned on the next sync. Offline changes wait for reconnection; automatic sync must be enabled.

A hidden `削除の同期記録` tab retains only task IDs, deletion/undo state, operation IDs and timestamps. This prevents another PC from recreating deleted tasks. Both PCs must run v0.1.12 or newer. Deletion metadata and row removal are sent in one batch, with a fresh snapshot check before writing and no blind retry of positional deletes. All app writers also rotate a shared named-range guard in that atomic batch. A competing writer still holding the removed guard ID fails the whole batch and rereads. Manual spreadsheet edits do not participate in this protocol; avoid simultaneous structural row edits while syncing.

SQLite migration 10 cascades soft deletion to child records. Undo restores only children deleted with the parent, preserving earlier individual deletions. A durable operation ID guards acknowledgements against a concurrent local undo. Restored records lose stale synchronization baselines so they can be uploaded again. Local history and undo data remain on the PC; shared categories are retained. Event/resource content synchronization remains unsupported, but their rows are cleaned when the parent is deleted.

Regression tests cover deletion selection, stale PCs, explicit undo, repeated deletion, local cascade, acknowledgement races, and preservation of individually deleted children. Missing rows for active tasks still produce warnings.

## Sheet maintenance

Every sync checks the sheet structure. Missing fixed-ID tabs and blank header cells are restored. Nonempty mismatched headers stop synchronization to protect task rows from column shifts. A recreated tab gets a new developer-metadata generation; migration 11 records it per spreadsheet and tab. Changed generations reset only that entity type's baseline, including recovery after a lost creation reply. Unrelated tabs and input values are preserved.

The explicit layout repair action applies the same presentation as new sheets: forest-green headers, meaningful column widths, frozen titles, dropdowns, checkboxes and header notes. Administrative columns are hidden. Ordinary sync does not reset a user's layout. A renamed conflicting tab with a different ID is never adopted or overwritten automatically.

Verified against Google Sheets API using a separate synthetic file: fresh setup without Sheet1, two repairs with unchanged input values, parent and three child-tab row deletion, repeated deletion, missing checklist tab recreation, and metadata idempotency. The test file was moved to trash after completion. API reference: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request

## Concurrent writer guard

`sheet_guard.rs` observes the shared guard before each writer's final snapshot validation. A batch deletes that exact named range and creates its successor. A missing old range rejects the whole batch, protecting positional edits from another app instance's row deletion. A permanent bootstrap ID similarly protects simultaneous first initialization. Only two named ranges are retained; there is no per-write metadata accumulation. Task writes, related-data writes, lifecycle cleanup, and sheet setup/repair all use this protocol. Google API reference: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request#DeleteNamedRangeRequest
