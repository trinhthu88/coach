# Google Calendar sync setup

Clariva uses per-coach Google OAuth. Each coach connects their own account from **Coach → My availability**. Clariva requests free/busy data to filter availability and writes a Clariva event to the coach's primary calendar when a session is confirmed. Refresh tokens are encrypted before storage and are never sent to the browser.

## Google Cloud setup

1. Select or create the Google Cloud project that will own the integration.
2. Enable the Google Calendar API.
3. Configure the OAuth consent screen. Google may require verification before coaches outside the consent-screen test-user list can connect.
4. Create an OAuth client for a **Web application**.
5. Add this exact authorized redirect URI:

   `https://ygufjhhpguauwwmfvczy.supabase.co/functions/v1/google-calendar-oauth-callback`

## Supabase Edge Function secrets

In the Supabase project's Edge Function secrets, add:

- `GOOGLE_CALENDAR_CLIENT_ID` — the Google OAuth client ID.
- `GOOGLE_CALENDAR_CLIENT_SECRET` — the matching client secret.
- `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` — a securely generated, base64-encoded 32-byte key. Keep a protected backup; replacing it makes existing encrypted coach refresh tokens unreadable.

Do not put these values in source control, browser variables, or chat. The encryption key must remain stable after coaches connect.

The shared `ALLOWED_ORIGIN` secret must include every app origin that is allowed to start OAuth. The default production origins are `https://clariva.club` and `https://www.clariva.club`; add a narrowly scoped Replit preview pattern only when preview testing is needed.

## Rollout and verification

Apply the migration and deploy the Google Calendar Edge Functions with the web app. Then sign in as a coach and verify:

1. Connect and disconnect a Google account.
2. A Google busy interval hides an overlapping Clariva slot in coaching, peer-coaching, and mentoring booking.
3. A busy-time change after booking prevents coach confirmation.
4. Confirming a free session adds one Clariva event; cancelling or rescheduling removes the old event.
5. **Sync upcoming sessions** adds or refreshes future confirmed events and removes recent cancelled/rescheduled events.
