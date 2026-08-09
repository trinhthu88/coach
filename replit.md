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

Credentials are hardcoded in `src/lib/supabase-target.ts`. Vite aliases `@/integrations/supabase/client` → this file so the auto-generated Lovable client is bypassed. Do not edit `src/integrations/supabase/client.ts` — it is overridden by the alias.

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
