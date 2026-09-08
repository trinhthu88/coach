ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS logo_url         text,
  ADD COLUMN IF NOT EXISTS website          text,
  ADD COLUMN IF NOT EXISTS company_size     text CHECK (company_size IN ('1-50','50-200','200-1000','1000+')),
  ADD COLUMN IF NOT EXISTS hq_country       text,
  ADD COLUMN IF NOT EXISTS timezone         text,
  ADD COLUMN IF NOT EXISTS locale           text DEFAULT 'en' CHECK (locale IN ('en','vi','fr','zh')),
  ADD COLUMN IF NOT EXISTS contract_start   date,
  ADD COLUMN IF NOT EXISTS contract_end     date,
  ADD COLUMN IF NOT EXISTS coaching_budget  numeric(12,2),
  ADD COLUMN IF NOT EXISTS subscription_tier text CHECK (subscription_tier IN ('essentials','growth','enterprise')),
  ADD COLUMN IF NOT EXISTS billing_contact  jsonb,   -- {name, email}
  ADD COLUMN IF NOT EXISTS secondary_contact jsonb,  -- {name, email}
  ADD COLUMN IF NOT EXISTS account_manager_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS programme_objectives text[],
  ADD COLUMN IF NOT EXISTS focus_competencies   text[],
  ADD COLUMN IF NOT EXISTS admin_notes      text;

-- No new RLS policy needed: "Organizations: sponsor view own" (see
-- 20260811100100_sponsor_schema.sql) already grants sponsors SELECT on
-- their own org row via get_sponsor_org(auth.uid()), and these are plain
-- columns on that same row — every new field above is covered by it
-- automatically. Writes stay admin-only via "Organizations: admin manage",
-- also already in place. The policy this migration was drafted with
-- (`profiles.role` / `profiles.organization_id`) doesn't match this
-- schema — role lives in user_roles, and a sponsor's org lives in
-- sponsor_profiles.organization_id, not profiles — so it's skipped rather
-- than reproduced.
