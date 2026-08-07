# Clariva

A private, invite-driven coaching marketplace built for executive coaching programs. Clariva connects organisations, coaches and coachees in one place: coach discovery, session booking, availability management, in-app messaging, progress tracking and admin oversight.

This is a React + TypeScript single-page application backed by Lovable Cloud (Supabase). It is designed to be deployed as a static frontend with all data living in the backend.

## Tech stack

- **Frontend:** React 18, TypeScript 5, Vite 5, React Router 6
- **Styling:** Tailwind CSS 3, shadcn/ui primitives, custom semantic tokens in `src/index.css`
- **State & data:** TanStack Query, React Hook Form + Zod
- **Backend:** Lovable Cloud / Supabase (Auth, Postgres, Edge Functions, Storage, Realtime)
- **Charts:** Recharts
- **Tests:** Vitest + Testing Library + jsdom
- **MCP integration:** `@lovable.dev/mcp-js` for Claude access

## Getting started

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in the values from your Lovable Cloud backend:

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public anon key (RLS-protected) |
| `VITE_SUPABASE_PROJECT_ID` | Project reference ID |

### 3. Run the dev server

```bash
bun run dev
```

The app will be available at `http://localhost:8080`.

### 4. Run tests

```bash
bun run test
bun run test:watch
```

## Build & preview

```bash
bun run build
bun run preview
```

## Project structure

```text
src/
  components/        # Reusable UI components (shadcn + custom)
  context/           # React contexts (Auth, etc.)
  hooks/             # Custom React hooks
  integrations/      # Auto-generated Supabase client & types
  lib/               # Utilities, helpers, MCP server code
  pages/             # Route-level page components
  pages/admin/       # Admin-specific views
  pages/journey/     # Journey/goal wheel sub-components
  pages/session/     # Session detail sub-components
  assets/            # Static images and logos
  test/              # Test setup and example tests
supabase/
  functions/         # Edge functions (auth hooks, MCP, approvals)
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
- The `src/integrations/supabase/client.ts` and `types.ts` files are auto-generated. Do not edit them by hand.
- Backend schema changes should be made through migrations in the Lovable backend UI or Supabase CLI, then reflected in the frontend types.
- Keep `.env` out of version control. If it was ever committed, run `git rm --cached .env` locally.
