---
name: Vite supabase alias
description: How the Clariva app's Supabase client is wired up on Replit and what breaks it.
---

## Rule
`src/lib/supabase-target.ts` uses hardcoded URL + anon key (safe — anon key is public). It is aliased in `vite.config.ts` so that all imports of `@/integrations/supabase/client` resolve to it instead of the auto-generated Lovable file.

**Do NOT** add a `define` block in `vite.config.ts` for `import.meta.env.VITE_SUPABASE_URL` — Vite replaces the literal at build time with an empty string (secrets aren't in process.env when the config is evaluated) which then overrides even the hardcoded fallback and crashes the Supabase client.

**Why:** Lovable's auto-generated client reads `VITE_SUPABASE_PUBLISHABLE_KEY` (not `VITE_SUPABASE_ANON_KEY`) and Lovable injects it at their build time. On Replit we bypass it entirely via the alias.

**How to apply:** If "Invalid supabaseUrl" appears in browser console, first check if `define` was re-added to vite.config.ts. If the alias is intact, clear the Vite dep cache: `rm -rf node_modules/.vite` then restart the workflow.
