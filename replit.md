# Clariva — Private Coaching Marketplace

A role-based executive coaching platform connecting vetted coaches with invited coachees. Built with React 18, Vite, TypeScript, Tailwind CSS, and Supabase.

## How to run

```
npm run dev
```

The app runs on **port 5000** via the "Start application" workflow. Vite serves the React SPA directly (no separate Express server needed for dev).

## Stack

- **Frontend**: React 18, Vite 5, TypeScript, Tailwind CSS v3, shadcn/ui components
- **Database / Auth**: Supabase (PostgreSQL + Supabase Auth)
- **Routing**: React Router v6
- **State**: TanStack Query v5
- **Fonts**: Fraunces (serif display) + Montserrat (sans-serif body)

## Supabase connection

`src/lib/supabase-target.ts` is the active Supabase client. Vite aliases `@/integrations/supabase/client` → this file, bypassing the auto-generated Lovable client. Do **not** edit `src/integrations/supabase/client.ts` — it is shadowed by the alias.

### Env vars (Replit Secrets panel)

| Secret | Purpose |
|--------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-side / Edge Functions only) |

When `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set as Replit Secrets, they take precedence over the hardcoded fallback values in `supabase-target.ts`.

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
