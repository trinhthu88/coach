# Clariva — Private Coaching Marketplace

A role-based executive coaching platform connecting vetted coaches with invited coachees. Built with React 18, Vite, TypeScript, Tailwind CSS, and Supabase.

## How to run

```
npm run dev
```

The app runs on **port 5000** via the "Start application" workflow. Vite serves the React SPA directly (no separate Express server needed for dev).

## Deployment

**As of 2026-08-10, `clariva.club` is still live on Lovable's hosting** — confirmed by DNS + response headers (see below). GoDaddy only holds domain registration and DNS (nameservers `ns17`/`ns18.domaincontrol.com`); it never hosted the app itself. Migration target: **Replit Deployments** (Static), replacing Lovable as the host, with GoDaddy DNS repointed at it.

`.replit` now has a `[deployment]` block (`deploymentTarget = "static"`, `build = ["npm","run","build"]`, `publicDir = "dist"`) pre-filled for this. The following steps only exist in Replit's / GoDaddy's web UI — they can't be done from inside this workspace:

1. In the Replit workspace, click **Deploy** → choose **Static** → confirm build command `npm run build` and public directory `dist` (pre-filled from `.replit`, but verify in the UI since this hasn't been tested end-to-end yet) → Deploy.
2. In the Deployment's **Settings → Domains**, link `clariva.club` (and `www.clariva.club` if wanted). Replit will show the exact A/CNAME + TXT verification records to add.
3. In GoDaddy DNS (**godaddy.com → My Products → DNS** for `clariva.club`), replace the current A record (`185.158.133.1`, pointing at Lovable) with the records Replit gave you in step 2. Leave the MX/TXT records for Microsoft 365 email untouched — only the web (A/CNAME) records change.
4. Wait for DNS propagation and Replit's automatic TLS cert issuance, then verify `https://clariva.club` serves this repo's build (check for the removed `@Lovable` twitter meta tag being gone, and/or the `x-deployment-id` header changing).

Until step 3 is done, the live site keeps serving from Lovable — pushing to GitHub or deploying on Replit does not affect it.

Once this is confirmed working, decide whether to also disconnect this GitHub repo from Lovable's own sync (a setting in Lovable's project dashboard, not something available here) so Lovable can no longer push commits to `origin`.

## Stack

- **Frontend**: React 18, Vite 5, TypeScript, Tailwind CSS v3, shadcn/ui components
- **Database / Auth**: Supabase (PostgreSQL + Supabase Auth)
- **Routing**: React Router v6
- **State**: TanStack Query v5
- **Fonts**: Fraunces (serif display) + Montserrat (sans-serif body)

## Supabase connection

`src/lib/supabase-target.ts` is the active Supabase client. Vite aliases `@/integrations/supabase/client` → this file (see `vite.config.ts`). The Lovable-generated `src/integrations/supabase/client.ts` has been removed — this project no longer has any Lovable Cloud dependency (the MCP tool-server integration and its Supabase edge function were removed too).

### Env vars

`supabase-target.ts` hardcodes the project's Supabase URL and anon key directly — it does **not** read `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. An earlier version tried reading those from Replit Secrets with a hardcoded fallback, but Vite only exposes `VITE_*` vars that resolve through its `.env`-based env loading, not arbitrary Replit Secrets — with those secrets unset, `import.meta.env.VITE_SUPABASE_URL` resolved to `""` and crashed the client. See the comment at the top of `supabase-target.ts` before changing this; do not reintroduce an `import.meta.env.VITE_SUPABASE_URL` read there.

| Secret | Purpose |
|--------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-side / Edge Functions only) |
| `RESEND_API_KEY` | Resend API key used by `supabase/functions/_shared/send-email.ts` to send auth/transactional emails |
| `AUTH_HOOK_SECRET` | Verifies the signed webhook payload Supabase's Send Email auth hook delivers to `supabase/functions/auth-email-hook` |

(The anon key is public-safe by design and is fine hardcoded in a frontend bundle; only the service-role key needs to stay a real secret. All three secrets above are Supabase Edge Function secrets — set via `npx supabase secrets set` or Dashboard → Edge Functions → Secrets, not the Replit Secrets panel.)

### Supabase Auth → Redirect URLs (one-time manual step)

For magic links and password-reset emails to land correctly on Replit, add **both** of these entries in **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs**:

```
https://39ba6c1a-1d41-441a-a349-c581b0b75b96-00-3vq8iskxjk5bj-*.pike.replit.dev/**
https://*.pike.replit.dev/**
```

The first (narrower) entry matches only this repl's domain across session-suffix rotations (the last segment after `3vq8iskxjk5bj-` changes each session). The second is a broader fallback. Add whichever your Supabase plan allows.

The current Replit dev domain is:
```
39ba6c1a-1d41-441a-a349-c581b0b75b96-00-3vq8iskxjk5bj-clnwz5t9.pike.replit.dev
```

All auth redirect calls in the app already use `window.location.origin` dynamically, so no code changes are needed when the domain changes — only the Supabase allowlist entry needs to cover the new suffix (the wildcard above does this automatically).

## Design system

`src/index.css` contains the full Clariva design token set. Palette:
- **Sky** `#3db4d0` — primary brand
- **Navy** `#062f3e` — secondary / hero backgrounds
- **Amber** `#e8874a` — accent / CTA
- **Paper** `#f6f3ee` — warm background
- **Ink** `#0a1c26` — foreground text

## Key files

| Path | Purpose |
|------|---------|
| `src/App.tsx` | Router and layout setup |
| `src/lib/supabase-target.ts` | Supabase client (credentials live here) |
| `src/integrations/supabase/types.ts` | Generated DB types |
| `src/pages/Index.tsx` | Public landing page |
| `src/pages/Auth.tsx` | Sign-in / sign-up |
| `src/pages/Dashboard.tsx` | Coachee dashboard |
| `src/pages/admin/` | Admin panel pages |
| `vite.config.ts` | Vite config (port 5000, host 0.0.0.0 for Replit) |

## Roles

- **Coachee** — browse coaches, book sessions, chat, reflections
- **Coach** — manage bookings, availability, session notes, profile
- **Admin** — approve registrations, manage platform settings
