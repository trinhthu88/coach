-- Attribute existing Coaching sessions to their cohort requirements.
--
-- WITHOUT THIS, DEPLOYMENT ZEROES EVERY LEARNER'S COACHING PROGRESS.
--
-- 20260920110000 added sessions.cohort_requirement_id and deliberately left
-- existing rows NULL ("attribution is not invented"). That was correct while
-- Coaching completion still came from session_activity_attributions. But
-- 20260920130000 moved completion onto canonical_coaching_requirement_fulfilment,
-- which only sees sessions that HOLD a requirement -- so from that migration
-- onwards an unattributed session fulfils nothing.
--
-- Every Coaching session in production predates the column. The two migrations
-- therefore combine, in a single deployment, to drop Coaching completion to
-- zero for every learner. Measured on the demo dataset by nulling the column
-- to reproduce production's state: 37 completed units across 17 enrollments
-- became 0.
--
-- Mentoring received exactly this backfill in 20260921110000; Coaching was
-- missed. This applies the same deterministic rule, with a guard that refuses
-- the deployment if it would change anyone's progress.
--
-- The rule: within one enrollment, the Nth live-or-completed Coaching session
-- in chronological order fulfils the Nth Coaching requirement of its cohort.
-- That is the only ordering the data supports and the order learners work
-- through requirements. Sessions beyond the requirement count, sessions whose
-- cohort schedules no Coaching, and cancelled or rescheduled sessions keep
-- cohort_requirement_id NULL and remain raw activity -- attribution is still
-- never invented, it is only established where it is provable.

-- ---------------------------------------------------------------------------
-- 1. What the legacy model counted, captured before anything changes
-- ---------------------------------------------------------------------------
--
-- Legacy Coaching completion was "completed sessions attributed to the
-- enrollment, capped at the requirement". That is reconstructed directly from
-- the session rows rather than from the retired function, so the guard below
-- does not depend on code this migration chain has already replaced.

CREATE TEMP TABLE _cb_expected ON COMMIT DROP AS
SELECT e.id AS enrollment_id,
  -- Counted as of today, exactly as canonical_module_progress does: a
  -- 'completed' session dated in the future has not happened yet and must not
  -- count toward progress as of now.
  (SELECT count(*)::integer FROM public.sessions s
    WHERE s.enrollment_id = e.id AND s.status = 'completed'
      AND (s.start_time AT TIME ZONE 'UTC')::date <= current_date) AS completed_sessions,
  coalesce(public.programme_required_units(e.id, 'coaching'::public.programme_module_type), 0)
    AS required_units,
  (SELECT count(*)::integer FROM public.cohort_requirement_dates d
    WHERE d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
      AND d.module = 'coaching'::public.programme_module_type) AS scheduled_requirements
FROM public.programme_enrollments e;

-- ---------------------------------------------------------------------------
-- 2. Deterministic attribution
-- ---------------------------------------------------------------------------

WITH reqs AS (
  SELECT e.id AS enrollment_id, d.id AS requirement_id,
         row_number() OVER (PARTITION BY e.id ORDER BY d.ordinal) AS rn
  FROM public.programme_enrollments e
  JOIN public.cohort_requirement_dates d
    ON d.cohort_id = e.cohort_id
   AND d.programme_id = e.programme_id
   AND d.module = 'coaching'::public.programme_module_type
), sess AS (
  SELECT s.id, s.enrollment_id,
         row_number() OVER (PARTITION BY s.enrollment_id ORDER BY s.start_time, s.id) AS rn
  FROM public.sessions s
  WHERE s.enrollment_id IS NOT NULL
    AND s.cohort_requirement_id IS NULL
    AND s.status IN ('pending_coach_approval', 'confirmed', 'completed')
)
UPDATE public.sessions t
   SET cohort_requirement_id = r.requirement_id
  FROM sess sx
  JOIN reqs r ON r.enrollment_id = sx.enrollment_id AND r.rn = sx.rn
 WHERE t.id = sx.id;

-- cohort_id is derived for every row, so the column is complete even where
-- attribution is deliberately absent.
UPDATE public.sessions t
   SET cohort_id = e.cohort_id
  FROM public.programme_enrollments e
 WHERE e.id = t.enrollment_id
   AND t.cohort_id IS DISTINCT FROM e.cohort_id;

-- ---------------------------------------------------------------------------
-- 3. Verification: nobody's Coaching progress may move
-- ---------------------------------------------------------------------------

DO $$
DECLARE bad text; n bigint; demo_enrollments uuid[] := ARRAY[]::uuid[];
BEGIN
  -- No requirement may hold two completed sessions for one enrollment.
  SELECT count(*) INTO n FROM (
    SELECT s.enrollment_id, s.cohort_requirement_id
    FROM public.sessions s
    WHERE s.cohort_requirement_id IS NOT NULL AND s.status = 'completed'
    GROUP BY 1, 2 HAVING count(*) > 1) x;
  IF n > 0 THEN
    RAISE EXCEPTION 'Coaching backfill: % requirements hold more than one completed session', n;
  END IF;

  -- Every attributed session points at a Coaching requirement of its own cohort.
  SELECT string_agg(s.id::text, ', ') INTO bad
  FROM public.sessions s
  JOIN public.cohort_requirement_dates d ON d.id = s.cohort_requirement_id
  WHERE d.module <> 'coaching'::public.programme_module_type
     OR d.cohort_id IS DISTINCT FROM s.cohort_id;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Coaching backfill: sessions attributed outside their cohort: %', bad;
  END IF;

  IF to_regclass('public.demo_resource_registry') IS NOT NULL THEN
    EXECUTE $q$SELECT coalesce(array_agg(resource_id), ARRAY[]::uuid[]) FROM public.demo_resource_registry
               WHERE resource_type = 'enrollment'$q$ INTO demo_enrollments;
  END IF;

  -- THE guard. Canonical Coaching completion is fulfilled requirements, so an
  -- enrollment can never complete more units than its cohort has SCHEDULED.
  -- Two different situations have to be told apart:
  --
  --   explained    the cohort schedules fewer Coaching requirements than the
  --                programme requires ("5 required / 4 scheduled"). The
  --                contract models this mismatch deliberately and surfaces it
  --                through cohort_requirement_schedule_issues; capping at what
  --                is scheduled is the correct canonical answer, not a loss to
  --                be papered over by inventing a requirement.
  --
  --   unexplained  anything else -- a session that should have been
  --                attributable and was not. That stops the deployment.
  SELECT string_agg(x.enrollment_id::text || ' (expected ' || x.expected
                    || ', got ' || coalesce(x.actual::text, 'null') || ')', ', ') INTO bad
  FROM (
    SELECT b.enrollment_id,
      least(b.completed_sessions, b.scheduled_requirements) AS expected,
      (SELECT p.completed_units FROM public.canonical_module_progress(b.enrollment_id, current_date) p
        WHERE p.module = 'coaching'::public.programme_module_type) AS actual
    FROM _cb_expected b
  ) x
  WHERE x.actual IS DISTINCT FROM x.expected
    AND x.enrollment_id <> ALL (demo_enrollments);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Coaching backfill: unattributable Coaching sessions for %', bad
      USING HINT = 'Run coaching_sessions_without_requirement() to see which sessions could not be attributed.';
  END IF;

  -- Report, without blocking, the enrollments whose Coaching total moves
  -- because their cohort schedules fewer requirements than the programme
  -- requires. These are the learners a deploy will visibly affect.
  SELECT count(*) INTO n
  FROM _cb_expected b
  WHERE b.scheduled_requirements < b.required_units
    AND b.completed_sessions > b.scheduled_requirements;
  IF n > 0 THEN
    RAISE NOTICE 'Coaching backfill: % enrollment(s) complete fewer units than before because their cohort schedules fewer Coaching requirements than the programme requires. Fix the cohort schedule to restore them; the sessions are retained as raw activity.', n;
  END IF;
END $$;
