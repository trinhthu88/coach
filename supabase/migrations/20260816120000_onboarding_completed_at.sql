-- Onboarding tour: tracks whether a coach/coachee has completed (or dismissed) the
-- first-login tour, so it auto-fires exactly once per account. NULL = not yet seen.
--
-- No RLS policy changes needed: "Profiles: update own" (20260429193745_*) is a plain
-- `USING (id = auth.uid())` with no column-level WITH CHECK, so a user can already
-- write this column on their own profiles row.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz NULL;
