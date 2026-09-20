-- Coaching completion becomes operational; evidence becomes reporting
-- (Coaching canonical remediation, phase 4).
--
-- 20260920130000 made a Coaching programme UNIT complete only once all four
-- learner evidence items existed: reflection, goal check-in, follow-up action
-- and satisfaction rating. That conflated two different facts. A meeting that
-- legitimately happened is a completed session whether or not the learner has
-- since written it up, and a cohort deadline measures whether the conversation
-- took place, not whether the paperwork followed.
--
-- The practical consequences were severe. A held session whose write-up was
-- outstanding counted as neither completed nor booked -- its occurred_on had
-- passed, so the booked filter (occurred_on >= as_of) excluded it too -- so a
-- learner's pace flipped to 'behind' the day after a session they had actually
-- attended. And because the reflection gate had no writer anywhere in the
-- product until 20260921xxxxx, unit_complete was unreachable: Coaching read
-- 0 completed units for every learner regardless of what they did.
--
-- After this migration, for all three modules:
--
--   Coaching   completed session attributed to a requirement -> one unit
--   Mentoring  completed session attributed to a requirement -> one unit
--   Triads     fulfilled cohort requirement                  -> one unit
--
-- Triads stay requirement-fulfilment based on purpose: a Triad requirement may
-- legitimately contain several completed sessions, and only the requirement
-- counts. That distinction is intentional and is NOT levelled here.
--
-- The evidence work is kept, not deleted. It is renamed so it can never again
-- be mistaken for programme completion: `unit_complete` becomes
-- `evidence_complete`. A future reader who wants to gate progress on evidence
-- now has to say so out loud.

-- ---------------------------------------------------------------------------
-- 1. Evidence: same four items, no longer called unit completion
-- ---------------------------------------------------------------------------
--
-- Dropped and recreated rather than replaced: the output column is renamed,
-- which CREATE OR REPLACE cannot do. The bulk reader is dropped first because
-- it depends on this one.

DROP FUNCTION IF EXISTS public.coaching_session_evidence_bulk(uuid[]);
DROP FUNCTION IF EXISTS public.coaching_session_evidence(uuid);

CREATE FUNCTION public.coaching_session_evidence(p_session_id uuid)
RETURNS TABLE (
  session_id uuid,
  enrollment_id uuid,
  session_completed boolean,
  has_reflection boolean,
  has_goal_checkin boolean,
  has_action boolean,
  has_satisfaction boolean,
  goal_checkin_required boolean,
  evidence_complete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH s AS (
    SELECT se.id, se.enrollment_id, se.status, se.coachee_rating
    FROM public.sessions se WHERE se.id = p_session_id
  ), gates AS (
    SELECT s.id, s.enrollment_id,
      (s.status = 'completed') AS session_completed,
      EXISTS (
        SELECT 1 FROM public.session_learning_reflections r
        WHERE r.enrollment_id = s.enrollment_id
          AND r.source_activity_type = 'coaching' AND r.source_activity_id = s.id
      ) AS has_reflection,
      EXISTS (
        SELECT 1 FROM public.goal_checkins c
        WHERE c.enrollment_id = s.enrollment_id
          AND c.source_activity_type = 'coaching' AND c.source_activity_id = s.id
      ) AS has_goal_checkin,
      EXISTS (
        SELECT 1 FROM public.enrollment_actions a
        WHERE a.enrollment_id = s.enrollment_id
          AND a.source_activity_type = 'coaching' AND a.source_activity_id = s.id
      ) AS has_action,
      (s.coachee_rating IS NOT NULL) AS has_satisfaction,
      -- The check-in item applies only when the enrollment actually holds an
      -- active goal; it is vacuous otherwise. This mattered more when it was a
      -- gate; it is kept because an outstanding-task list should not show an
      -- item the learner has no way to satisfy.
      EXISTS (
        SELECT 1 FROM public.coachee_goals g
        WHERE g.enrollment_id = s.enrollment_id AND g.status = 'active'
      ) AS goal_checkin_required
    FROM s
  )
  SELECT g.id, g.enrollment_id, g.session_completed,
    g.has_reflection, g.has_goal_checkin, g.has_action, g.has_satisfaction,
    g.goal_checkin_required,
    -- Reporting only. Nothing downstream reads this to decide a unit.
    (g.has_reflection
      AND (NOT g.goal_checkin_required OR g.has_goal_checkin)
      AND g.has_action
      AND g.has_satisfaction) AS evidence_complete
  FROM gates g;
$$;

REVOKE ALL ON FUNCTION public.coaching_session_evidence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coaching_session_evidence(uuid) TO authenticated;

COMMENT ON FUNCTION public.coaching_session_evidence(uuid) IS
  'After-session evidence completeness for one Coaching session: reflection, '
  'goal check-in, follow-up action, satisfaction. REPORTING ONLY -- it decides '
  'no programme unit. Programme completion is the session lifecycle, via '
  'canonical_coaching_requirement_fulfilment(). Coach private notes and Admin '
  'flags are not evidence items.';

CREATE FUNCTION public.coaching_session_evidence_bulk(p_session_ids uuid[])
RETURNS TABLE (
  session_id uuid,
  enrollment_id uuid,
  session_completed boolean,
  has_reflection boolean,
  has_goal_checkin boolean,
  has_action boolean,
  has_satisfaction boolean,
  goal_checkin_required boolean,
  evidence_complete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT e.*
  FROM unnest(coalesce(p_session_ids, ARRAY[]::uuid[])) AS s(id)
  CROSS JOIN LATERAL public.coaching_session_evidence(s.id) e;
$$;

REVOKE ALL ON FUNCTION public.coaching_session_evidence_bulk(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coaching_session_evidence_bulk(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.coaching_session_evidence_bulk(uuid[]) IS
  'coaching_session_evidence() over a set of sessions, for list views. Thin '
  'wrapper: the evidence rules live in one place only.';

-- ---------------------------------------------------------------------------
-- 2. Fulfilment follows the session lifecycle
-- ---------------------------------------------------------------------------
--
-- A Coaching requirement is fulfilled by a COMPLETED session attributed to it,
-- exactly as Mentoring is. post_session_pending is kept -- it is how the
-- learner's outstanding work stays visible -- but it now means "held, and the
-- write-up is still outstanding" rather than "does not count yet".

CREATE OR REPLACE FUNCTION public.canonical_coaching_requirement_fulfilment(p_enrollment_id uuid)
RETURNS TABLE (
  requirement_id uuid,
  ordinal integer,
  due_on date,
  fulfilled_on date,
  booked_on date,
  session_id uuid,
  post_session_pending boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH enrollment AS (
    SELECT e.id, e.cohort_id, e.programme_id
    FROM public.programme_enrollments e WHERE e.id = p_enrollment_id
  ), requirements AS (
    SELECT d.id, d.ordinal, d.due_on
    FROM public.cohort_requirement_dates d
    JOIN enrollment e ON e.cohort_id = d.cohort_id AND e.programme_id = d.programme_id
    WHERE d.module = 'coaching'::public.programme_module_type
  ), per_requirement AS (
    SELECT r.id AS requirement_id, r.ordinal, r.due_on,
      (SELECT s.id FROM public.sessions s
        WHERE s.cohort_requirement_id = r.id
          AND s.enrollment_id = p_enrollment_id
          AND s.status IN ('pending_coach_approval', 'confirmed', 'completed')
        ORDER BY CASE s.status WHEN 'completed' THEN 0 ELSE 1 END, s.start_time
        LIMIT 1) AS session_id
    FROM requirements r
  )
  SELECT pr.requirement_id, pr.ordinal, pr.due_on,
    -- Operational completion, not evidence.
    CASE WHEN s.status = 'completed' THEN (s.start_time AT TIME ZONE 'UTC')::date END AS fulfilled_on,
    CASE WHEN s.id IS NOT NULL AND s.status <> 'completed'
         THEN (s.start_time AT TIME ZONE 'UTC')::date END AS booked_on,
    pr.session_id,
    coalesce(s.status = 'completed' AND NOT ev.evidence_complete, false) AS post_session_pending
  FROM per_requirement pr
  LEFT JOIN public.sessions s ON s.id = pr.session_id
  LEFT JOIN LATERAL public.coaching_session_evidence(pr.session_id) ev ON pr.session_id IS NOT NULL
  ORDER BY pr.ordinal;
$$;

REVOKE ALL ON FUNCTION public.canonical_coaching_requirement_fulfilment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canonical_coaching_requirement_fulfilment(uuid) TO authenticated;

COMMENT ON FUNCTION public.canonical_coaching_requirement_fulfilment(uuid) IS
  'THE Coaching completion rule: one row per cohort Coaching requirement; a '
  'COMPLETED session attributed to a requirement fulfils it, once. Evidence '
  'never gates it -- post_session_pending only reports outstanding write-up.';

-- ---------------------------------------------------------------------------
-- 3. The learner's outstanding-work list
-- ---------------------------------------------------------------------------

-- Dropped first: the output column unit_complete is renamed to
-- evidence_complete, and CREATE OR REPLACE cannot change a return type.
DROP FUNCTION IF EXISTS public.coaching_post_session_checklist(uuid);

CREATE FUNCTION public.coaching_post_session_checklist(p_enrollment_id uuid)
RETURNS TABLE (
  requirement_id uuid,
  ordinal integer,
  due_on date,
  session_id uuid,
  session_status text,
  needs_reflection boolean,
  needs_goal_checkin boolean,
  needs_action boolean,
  needs_satisfaction boolean,
  evidence_complete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT f.requirement_id, f.ordinal, f.due_on, f.session_id, s.status::text,
    NOT ev.has_reflection,
    (ev.goal_checkin_required AND NOT ev.has_goal_checkin),
    NOT ev.has_action,
    NOT ev.has_satisfaction,
    ev.evidence_complete
  FROM public.canonical_coaching_requirement_fulfilment(p_enrollment_id) f
  JOIN public.sessions s ON s.id = f.session_id
  CROSS JOIN LATERAL public.coaching_session_evidence(f.session_id) ev
  WHERE s.status = 'completed'
  ORDER BY f.ordinal;
$$;

REVOKE ALL ON FUNCTION public.coaching_post_session_checklist(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coaching_post_session_checklist(uuid) TO authenticated;

COMMENT ON FUNCTION public.coaching_post_session_checklist(uuid) IS
  'The learner''s outstanding post-session work per held Coaching session. '
  'Reporting only: the unit is already complete once the session is.';

-- ---------------------------------------------------------------------------
-- 4. Verification
-- ---------------------------------------------------------------------------

DO $$
DECLARE n bigint; bad text;
BEGIN
  -- No Coaching function may still speak of unit completion.
  SELECT string_agg(p.proname, ', ') INTO bad
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace AND ns.nspname = 'public'
  WHERE p.proname LIKE 'coaching%' AND pg_get_functiondef(p.oid) LIKE '%unit_complete%';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Coaching remediation: unit_complete survives in %', bad;
  END IF;

  -- Fulfilment must not consult evidence to decide fulfilled_on.
  IF pg_get_functiondef('public.canonical_coaching_requirement_fulfilment(uuid)'::regprocedure)
       !~ 'WHEN s\.status = ''completed'' THEN' THEN
    RAISE EXCEPTION 'Coaching remediation: fulfilment does not follow the session lifecycle';
  END IF;

  -- Every Coaching requirement holding a completed session now reports as
  -- fulfilled, whatever its evidence looks like.
  SELECT count(*) INTO n
  FROM public.sessions s
  JOIN public.programme_enrollments e ON e.id = s.enrollment_id
  CROSS JOIN LATERAL public.canonical_coaching_requirement_fulfilment(e.id) f
  WHERE s.status = 'completed'
    AND s.cohort_requirement_id IS NOT NULL
    AND f.requirement_id = s.cohort_requirement_id
    AND f.fulfilled_on IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Coaching remediation: % completed sessions still report unfulfilled', n;
  END IF;
END $$;
