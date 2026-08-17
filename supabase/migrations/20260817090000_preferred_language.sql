-- Per-account language preference (English / Vietnamese switcher). Persisted on the
-- profile so it follows a user across devices once logged in, rather than only
-- living in browser localStorage.
--
-- No RLS policy changes needed: "Profiles: update own" (20260429193745_*) is a plain
-- `USING (id = auth.uid())` with no column-level WITH CHECK, so a user can already
-- write this column on their own profiles row.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en'
    CHECK (preferred_language IN ('en', 'vi'));
