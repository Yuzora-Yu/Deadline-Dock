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

Remote task deletion records whose task is absent locally are ignored without warnings. Locally deleted tasks also do not warn when their remote row is absent. Neither case recreates a task or edits the remote deletion record. Missing rows for active tasks and manual deletion-marker edits on active tasks still produce warnings. Regression tests cover repeat sync, a retained baseline, and concurrent import of an ordinary new row.
