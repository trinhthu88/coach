-- Phase 3 (triads) audit found that automated language+availability
-- auto-assign has no data to run on — there's no per-participant
-- availability table (coach_availability is keyed by coach, not
-- participant/coachee) and triads are self-scheduled by mutual agreement
-- instead (see TriadBookSession.tsx). Auto-assign is out of scope for now;
-- this column is added on its own so admin can see/set a participant's
-- spoken language when manually grouping triads in AdminTriads.tsx, and so
-- language-based auto-assign has something to build on later without
-- another migration.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS spoken_languages TEXT[] NOT NULL DEFAULT '{vi}';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_spoken_languages_nonempty CHECK (array_length(spoken_languages, 1) > 0);

COMMENT ON COLUMN public.profiles.spoken_languages IS
  'Languages this person can coach/converse in (values: vi, en). Editable on the coachee profile page. Default: Vietnamese only.';
