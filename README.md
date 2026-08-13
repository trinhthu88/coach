# Clariva

A private, invite-driven coaching marketplace built for executive coaching programs. Clariva connects organisations, coaches and coachees in one place: coach discovery, session booking, availability management, in-app messaging, progress tracking and admin oversight.

This is a React + TypeScript single-page application backed by Supabase. It is designed to be deployed as a static frontend with all data living in the backend.

Development happens on Replit; pushes go to GitHub (`origin`), which is the source of truth for deployment.

## Tech stack

- **Frontend:** React 18, TypeScript 5, Vite 5, React Router 6
- **Styling:** Tailwind CSS 3, shadcn/ui primitives, custom semantic tokens in `src/index.css`
- **State & data:** TanStack Query, React Hook Form + Zod
- **Backend:** Supabase (Auth, Postgres, Edge Functions, Storage, Realtime)
- **Charts:** Recharts
- **Tests:** Vitest + Testing Library + jsdom

## Getting started

See `replit.md` for the authoritative Replit dev setup (env vars, redirect URLs, workflow). Summary:

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

The Supabase URL and anon key are hardcoded in `src/lib/supabase-target.ts` (the anon key is public-safe by design) — no env var setup is needed for those. Set this as a Replit Secret (see `replit.md`):

| Variable | Purpose |
|----------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-side / Edge Functions only) |

### 3. Run the dev server

```bash
npm run dev
```

The app runs on port `5000`.

### 4. Run tests

```bash
npm run test
npm run test:watch
```

## Build & preview

```bash
npm run build
npm run preview
```

## Project structure

```text
src/
  components/        # Reusable UI components (shadcn + custom)
  context/           # React contexts (Auth, etc.)
  hooks/             # Custom React hooks
  integrations/      # Auto-generated Supabase types
  lib/               # Utilities, helpers, Supabase client target
  pages/             # Route-level page components
  pages/admin/       # Admin-specific views
  pages/journey/     # Journey/goal wheel sub-components
  pages/session/     # Session detail sub-components
  assets/            # Static images and logos
  test/              # Test setup and example tests
supabase/
  functions/         # Edge functions (auth hooks, approvals)
  config.toml        # Supabase CLI configuration
public/              # Static public assets
```

## Key features

- **Role-based access:** Admin, coach and coachee views with protected routes.
- **Coach marketplace:** Coachees can browse, favourite and book vetted coaches.
- **Session management:** Booking, availability, calendar and messaging tied to sessions.
- **Journey tracking:** Programme overview, goal wheel radar chart and per-session goal ratings.
- **Admin oversight:** Pending access requests, programme/cohort management, session limits and analytics.
- **Security:** Row-level security (RLS) on all tables, role-based policies, no plaintext secrets in the repo.

## Notes for contributors

- Always use the semantic colour tokens in `src/index.css` (e.g. `bg-primary`, `text-secondary`). Do not hard-code hex values in components.
- The active Supabase client lives in `src/lib/supabase-target.ts` (aliased from `@/integrations/supabase/client` in `vite.config.ts`). `src/integrations/supabase/types.ts` is auto-generated — do not hand-edit either.
- Backend schema changes go through migrations in `supabase/migrations/`, applied with `npx supabase db push`, then reflected in frontend types with `npx supabase gen types typescript --linked`.
- Keep `.env` out of version control. If it was ever committed, run `git rm --cached .env` locally.
