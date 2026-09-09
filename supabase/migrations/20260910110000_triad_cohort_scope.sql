-- Cohort-scoping for triads: sponsor_programme_engagement() needs to know
-- which cohort a triad_group belongs to (so a cohort's engagement numbers
-- don't blend in other cohorts' triads), and which week a round happens in.
--
-- NOTE for whoever reconciles this later: public.triad_rounds already
-- exists (20260906120000_triad_redesign.sql) with (programme_id,
-- round_number) UNIQUE and a training_week_id FK — it already answers "what
-- week does round N of programme P happen in" for admin-configured rounds.
-- programme_triad_rounds below is a second, simpler table with the same
-- (programme_id, round_number) shape but a raw `at_week` integer instead of
-- an FK, added because that's what this task specified. Nothing in this
-- migration (or the sponsor_programme_engagement() rewrite that follows it)
-- reads from programme_triad_rounds — it's seeded here for future use, not
-- consumed yet. Consider whether triad_rounds should just grow an `at_week`
-- computed column instead of carrying two overlapping tables long-term.
CREATE TABLE IF NOT EXISTS public.programme_triad_rounds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id uuid NOT NULL REFERENCES public.programmes(id) ON DELETE CASCADE,
  round_number integer NOT NULL,
  at_week      integer NOT NULL,  -- "this round happens during week N"
  UNIQUE (programme_id, round_number)
);

ALTER TABLE public.programme_triad_rounds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Programme triad rounds: authenticated view" ON public.programme_triad_rounds;
CREATE POLICY "Programme triad rounds: authenticated view" ON public.programme_triad_rounds
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Programme triad rounds: admin manage" ON public.programme_triad_rounds;
CREATE POLICY "Programme triad rounds: admin manage" ON public.programme_triad_rounds
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Seed one row per programme that has the triads module enabled, deriving
-- at_week from the programme's actual admin-configured triad_rounds (via
-- their training_week_id -> training_weeks.week_number) rather than
-- hardcoding numbers — for TASC - Essential Course this resolves to
-- round_number=1 -> at_week=2 and round_number=2 -> at_week=4, matching
-- 20260907120000_seed_tasc_essential_course.sql's actual seeded rounds.
-- A programme with triads enabled but no triad_rounds configured yet
-- (no training_week_id set) contributes no rows here — nothing to seed.
INSERT INTO public.programme_triad_rounds (programme_id, round_number, at_week)
SELECT tr.programme_id, tr.round_number, tw.week_number
FROM public.triad_rounds tr
JOIN public.training_weeks tw ON tw.id = tr.training_week_id
JOIN public.programme_modules pm ON pm.programme_id = tr.programme_id
  AND pm.module = 'triads'::programme_module_type AND pm.enabled = true
ON CONFLICT (programme_id, round_number) DO UPDATE SET at_week = EXCLUDED.at_week;

-- cohort_id already exists on triad_groups (NOT NULL in the original
-- 20260903130000_triad_groups.sql, relaxed to nullable by
-- 20260906120000_triad_redesign.sql once rounds took over as the grouping
-- axis) — IF NOT EXISTS makes this a no-op. round_number is new: a
-- denormalized copy of triad_round_id's round_number for cheap filtering
-- without a join.
ALTER TABLE public.triad_groups
  ADD COLUMN IF NOT EXISTS cohort_id uuid REFERENCES public.cohorts(id);

ALTER TABLE public.triad_groups
  ADD COLUMN IF NOT EXISTS round_number integer;

-- Backfill cohort_id for any triad_groups row that somehow has none (every
-- row created through the current admin flow already sets it) by resolving
-- from member_1_id's most recent cohorted enrollment.
UPDATE public.triad_groups tg
SET cohort_id = (
  SELECT pe.cohort_id
  FROM public.programme_enrollments pe
  WHERE pe.user_id = tg.member_1_id
    AND pe.cohort_id IS NOT NULL
  ORDER BY pe.created_at DESC
  LIMIT 1
)
WHERE tg.cohort_id IS NULL;

-- Backfill round_number from the existing triad_round_id link, for every
-- row that has one.
UPDATE public.triad_groups tg
SET round_number = tr.round_number
FROM public.triad_rounds tr
WHERE tg.triad_round_id = tr.id
  AND tg.round_number IS NULL;

-- NOT NULL deliberately not added on either column yet — see task note:
-- add it in a follow-up migration once the backfill is confirmed working
-- in production.
