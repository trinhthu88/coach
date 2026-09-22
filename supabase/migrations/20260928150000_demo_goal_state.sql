-- ===========================================================================
-- The demo enrollments carry the goal every learner surface assumes.
-- ===========================================================================
--
-- 20260926600000 made the booking gate unconditional: a learner may book
-- nothing until their enrollment has an active goal. Goals are enrollment-
-- scoped, and supabase/seed-demo.sql creates one per demo enrollment BEFORE it
-- books anything -- which is why the repository's demo passes.
--
-- A database whose demo rows predate that rule has the activity but not the
-- goals (production: 21 enrollments, 0 goals). Applying the chain there would
-- leave every demo learner unable to book, their goal card empty and their
-- goal-setting period already overdue -- a demo that contradicts its own data.
-- This migration gives those enrollments the goal seed-demo.sql would have.
--
-- Demo data belongs in the repository (P1-8, 20260926900000), so this is
-- deliberately not a generator: it writes one goal per demo enrollment, with
-- seed-demo.sql's title, description and ratings, using the same deterministic
-- id (md5('demo-goal-' || enrollment)) so a later seed run updates that row
-- instead of creating a second one.
--
-- It cannot touch anything else:
--   * the learner's email must end in '@clariva.demo';
--   * the enrollment must be one of the seeded demo ids;
--   * an enrollment that already has ANY goal is skipped entirely, so a goal
--     someone wrote by hand is never joined by a second one.
-- On a database seeded from seed-demo.sql every row already exists and this is
-- a no-op. On a fresh or real-customer database it matches nothing at all.
--
-- An account somebody created by hand is therefore left alone even when it
-- logs in at clariva.demo: it is not a seeded enrollment, and it keeps the
-- gate in its natural state -- the one login that still shows a learner
-- meeting "set a goal before you book" the way a new learner meets it.
--
-- The goal is an alert-and-gate object only: it is not a requirement unit, so
-- no required / completed / due / overdue count changes here.
-- ===========================================================================

DO $demo_goals$
DECLARE
  e record;
  v_goal uuid;
  v_current smallint;
  v_created integer := 0;
BEGIN
  FOR e IN
    SELECT pe.id AS enrollment_id, pe.user_id, pe.start_date,
           coalesce(pe.end_date, c.end_date) AS target_date
    FROM public.programme_enrollments pe
    JOIN public.profiles pr ON pr.id = pe.user_id
    JOIN public.cohorts c ON c.id = pe.cohort_id
    WHERE pr.email LIKE '%@clariva.demo'
      AND pe.id::text LIKE 'd0000000-0000-4000-8000-0000000e%'
      AND NOT EXISTS (
        SELECT 1 FROM public.coachee_goals g WHERE g.enrollment_id = pe.id)
  LOOP
    -- Where the learner says they are, read from what they have actually
    -- completed, so the goal agrees with the progress on the same screen.
    SELECT CASE
             WHEN count(*) = 0 THEN 30
             WHEN count(*) FILTER (WHERE cal.is_completed) = count(*) THEN 80
             WHEN count(*) FILTER (WHERE cal.is_completed) * 2 >= count(*) THEN 60
             WHEN count(*) FILTER (WHERE cal.is_completed) > 0 THEN 45
             ELSE 30
           END
      INTO v_current
      FROM public.canonical_enrollment_requirement_calendar(e.enrollment_id, CURRENT_DATE) cal;

    v_goal := md5('demo-goal-' || e.enrollment_id)::uuid;

    INSERT INTO public.coachee_goals (
      id, coachee_id, enrollment_id, title, description, target_date, status, sort_order
    ) VALUES (
      v_goal, e.user_id, e.enrollment_id,
      'Lead team meetings that end in clear decisions',
      'Every meeting I run closes with an owner and a date for each decision.',
      -- validate_enrollment_goal() keeps a goal inside its enrollment window;
      -- an ongoing enrollment carries no end date of its own, so the cohort's
      -- end date is the target.
      greatest(e.target_date, e.start_date), 'active', 0
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.coachee_goal_ratings (
      goal_id, coachee_id, enrollment_id, start_rating, current_rating, target_rating
    ) VALUES (v_goal, e.user_id, e.enrollment_id, 30, v_current, 80)
    ON CONFLICT (goal_id) DO NOTHING;

    v_created := v_created + 1;
  END LOOP;

  RAISE NOTICE 'demo goal state: % demo enrollment(s) given their seed goal', v_created;
END
$demo_goals$;

DO $verify$
DECLARE
  v_ungoaled integer;
  v_extra integer;
BEGIN
  -- Every ongoing demo enrollment can book; nobody gained a second goal.
  SELECT count(*) INTO v_ungoaled
  FROM public.programme_enrollments pe
  JOIN public.profiles pr ON pr.id = pe.user_id
  WHERE pr.email LIKE '%@clariva.demo'
    AND pe.id::text LIKE 'd0000000-0000-4000-8000-0000000e%'
    AND pe.status IN ('active', 'at_risk', 'paused')
    AND NOT public.enrollment_has_active_goal(pe.id);
  IF v_ungoaled > 0 THEN
    RAISE EXCEPTION 'demo goal state: % ongoing demo enrollment(s) still cannot book', v_ungoaled;
  END IF;

  SELECT count(*) INTO v_extra
  FROM (SELECT g.enrollment_id FROM public.coachee_goals g
        WHERE g.status = 'active' GROUP BY g.enrollment_id HAVING count(*) > 3) x;
  IF v_extra > 0 THEN
    RAISE EXCEPTION 'demo goal state: % enrollment(s) exceed the 3 active goal maximum', v_extra;
  END IF;
END
$verify$;
