-- Part 2 of the enrollment-model task: fix two real cardinality bugs,
-- confirmed against the product rule "each person can only have one
-- *active* programme at a time; once they finish it they can start
-- another; full history (active + completed) must remain visible."
--
-- 1. coach_programme_enrollments had UNIQUE (coach_id) with no status
--    qualifier (20260811130000_coach_programmes_schema.sql) — structurally
--    impossible for a coach to ever get a second enrollment row, completed
--    or active. This silently broke "finish one programme, move to
--    another, keep history" for coaches. `ON CONFLICT (coach_id)` upserts
--    (AdminCoachProgrammes.tsx's changeEnrollment) relied on this constraint
--    to always update-in-place instead of transitioning; that call site is
--    fixed in the next migration's frontend counterpart (this migration is
--    schema-only).
--
-- 2. programme_enrollments had UNIQUE (coachee_id, programme_id) — the
--    opposite problem: it ALLOWED a coachee to be simultaneously enrolled in
--    several different programmes at once, and blocked ever re-enrolling a
--    coachee in the *same* programme a second time after completing it.
--
-- Checked before writing this: no coachee currently has two simultaneous
-- 'active' programme_enrollments rows (verified via a live query), so this
-- migration needs no data-dedup step first — contrast with
-- 20260811120000_fix_duplicate_programmes.sql, which did need one for a
-- different table.

-- coach_programme_enrollments has no end_date column (unlike
-- programme_enrollments, which already has one) — needed now that a
-- transition sets one when closing out the old active row.
ALTER TABLE public.coach_programme_enrollments
  ADD COLUMN end_date date;

ALTER TABLE public.coach_programme_enrollments
  DROP CONSTRAINT coach_programme_enrollments_coach_id_key;

CREATE UNIQUE INDEX ux_coach_programme_enrollments_one_active
  ON public.coach_programme_enrollments (coach_id)
  WHERE status = 'active'::enrollment_status;

ALTER TABLE public.programme_enrollments
  DROP CONSTRAINT programme_enrollments_coachee_id_programme_id_key;

CREATE UNIQUE INDEX ux_programme_enrollments_one_active
  ON public.programme_enrollments (coachee_id)
  WHERE status = 'active'::enrollment_status;
