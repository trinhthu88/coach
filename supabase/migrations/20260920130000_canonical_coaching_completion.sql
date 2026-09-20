-- Canonical Coaching unit completion (Coaching redesign, deployment 1).
--
-- Section 16/17: a Coaching SESSION being completed is not the same fact as a
-- Coaching UNIT being completed. The Coach marks the session held; the unit
-- only completes once the learner has produced all four mandatory pieces of
-- evidence:
--
--   1. reflection          session_learning_reflections
--   2. goal check-in       goal_checkins
--   3. follow-up action    enrollment_actions
--   4. satisfaction        sessions.coachee_rating
--
-- The Coach's private note and Admin flag are deliberately NOT gates.
--
-- Everything downstream -- Coachee, Coach, Sponsor, Admin, Journey -- reads
-- this through sponsor_canonical_activity, which canonical_module_progress
-- already consumes. No role recomputes it. That is what makes section 27 true
-- by construction rather than by convention.

-- ---------------------------------------------------------------------------
-- 1. The four evidence gates for one Coaching session
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.coaching_session_evidence(p_session_id uuid)
RETURNS TABLE (
  session_id uuid,
  enrollment_id uuid,
  session_completed boolean,
  has_reflection boolean,
  has_goal_checkin boolean,
  has_action boolean,
  has_satisfaction boolean,
  goal_checkin_required boolean,
  unit_complete boolean
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
      -- Section 20, resolved explicitly rather than silently: the check-in
      -- gate applies when the enrollment actually has at least one ACTIVE
      -- goal, and the learner must check in against at least one of them.
      -- It is deliberately vacuous for an enrollment carrying no active goal,
      -- because a gate that cannot be satisfied would permanently block the
      -- unit -- 19 of 65 production enrollments hold zero goals. This is a
      -- surfaced decision, not an invented interpretation.
      EXISTS (
        SELECT 1 FROM public.coachee_goals g
        WHERE g.enrollment_id = s.enrollment_id AND g.status = 'active'
      ) AS goal_checkin_required
    FROM s
  )
  SELECT g.id, g.enrollment_id, g.session_completed,
    g.has_reflection, g.has_goal_checkin, g.has_action, g.has_satisfaction,
    g.goal_checkin_required,
    (g.session_completed
      AND g.has_reflection
      AND (NOT g.goal_checkin_required OR g.has_goal_checkin)
      AND g.has_action
      AND g.has_satisfaction) AS unit_complete
  FROM gates g;
$$;

REVOKE ALL ON FUNCTION public.coaching_session_evidence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coaching_session_evidence(uuid) TO authenticated;

COMMENT ON FUNCTION public.coaching_session_evidence(uuid) IS
  'The four mandatory post-session learner evidence gates for a Coaching '
  'session. Coach private notes and Admin flags are not gates.';

-- ---------------------------------------------------------------------------
-- 2. Per-requirement fulfilment, mirroring the Triad shape
-- ---------------------------------------------------------------------------

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
      -- The single live-or-completed session that owns this requirement. The
      -- partial unique index in 20260920110000 guarantees at most one live
      -- session, and a completed one is terminal, so this is unambiguous.
      (SELECT s.id FROM public.sessions s
        WHERE s.cohort_requirement_id = r.id
          AND s.enrollment_id = p_enrollment_id
          AND s.status IN ('pending_coach_approval', 'confirmed', 'completed')
        ORDER BY CASE s.status WHEN 'completed' THEN 0 ELSE 1 END, s.start_time
        LIMIT 1) AS session_id
    FROM requirements r
  )
  SELECT pr.requirement_id, pr.ordinal, pr.due_on,
    CASE WHEN ev.unit_complete THEN (s.start_time AT TIME ZONE 'UTC')::date END AS fulfilled_on,
    CASE WHEN s.id IS NOT NULL AND NOT coalesce(ev.unit_complete, false)
         THEN (s.start_time AT TIME ZONE 'UTC')::date END AS booked_on,
    pr.session_id,
    coalesce(s.status = 'completed' AND NOT ev.unit_complete, false) AS post_session_pending
  FROM per_requirement pr
  LEFT JOIN public.sessions s ON s.id = pr.session_id
  LEFT JOIN LATERAL public.coaching_session_evidence(pr.session_id) ev ON pr.session_id IS NOT NULL
  ORDER BY pr.ordinal;
$$;

REVOKE ALL ON FUNCTION public.canonical_coaching_requirement_fulfilment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canonical_coaching_requirement_fulfilment(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Wire Coaching into the canonical activity spine
-- ---------------------------------------------------------------------------
--
-- Coaching stops emitting one row per session attribution (which carried no
-- requirement due date and counted a session as complete the moment the Coach
-- marked it held) and starts emitting one row per cohort Coaching requirement,
-- exactly as Triads does. A session whose post-session evidence is still
-- outstanding reports as 'confirmed', not 'completed', so it counts as booked
-- rather than complete -- and stays overdue if its deadline has passed.
--
-- Safe with respect to history: every production enrollment that has Coaching
-- activity also has Coaching requirements in its cohort (40 enrollments), and
-- no enrollment has Coaching activity without them, so nothing loses progress.

CREATE OR REPLACE FUNCTION public.sponsor_canonical_activity(p_enrollment_id uuid)
RETURNS TABLE(module programme_module_type, occurred_on date, status text, requirement_due_on date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Coaching: one row per cohort Coaching requirement.
  SELECT 'coaching'::public.programme_module_type,
    coalesce(f.fulfilled_on, f.booked_on),
    CASE WHEN f.fulfilled_on IS NOT NULL THEN 'completed' ELSE 'confirmed' END,
    f.due_on
  FROM public.canonical_coaching_requirement_fulfilment(p_enrollment_id) f
  WHERE coalesce(f.fulfilled_on, f.booked_on) IS NOT NULL

  UNION ALL
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed'), NULL::date
  FROM public.session_activity_attributions a
  LEFT JOIN public.peer_sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'peer_coaching'

  UNION ALL
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed'), NULL::date
  FROM public.session_activity_attributions a
  LEFT JOIN public.coachee_peer_sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'peer_coaching'
    AND NOT EXISTS (
      SELECT 1 FROM public.peer_sessions existing_peer
      WHERE existing_peer.id = a.source_activity_id
    )

  UNION ALL
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed'), NULL::date
  FROM public.session_activity_attributions a
  LEFT JOIN public.mentoring_sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'mentoring'

  UNION ALL
  -- Triads: one row per cohort Triad requirement (fulfilled, else booked,
  -- else proposed), never one per session.
  SELECT 'triads'::public.programme_module_type,
    coalesce(f.fulfilled_on, f.booked_on, f.proposed_on),
    CASE WHEN f.fulfilled_on IS NOT NULL THEN 'completed'
         WHEN f.booked_on IS NOT NULL THEN 'confirmed'
         ELSE 'proposed' END,
    f.due_on
  FROM public.canonical_triad_requirement_fulfilment(p_enrollment_id) f
  WHERE coalesce(f.fulfilled_on, f.booked_on, f.proposed_on) IS NOT NULL

  UNION ALL
  SELECT a.module, a.occurred_on, 'completed', NULL::date
  FROM public.session_activity_attributions a
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type IN ('quiz', 'daily_prompt')

  UNION ALL
  SELECT 'training'::public.programme_module_type,
    i.completed_on,
    'completed',
    NULL::date
  FROM public.canonical_training_learning_items(p_enrollment_id, current_date) i
  WHERE i.completed_units > 0
    AND i.completed_on IS NOT NULL;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Learner-facing post-session checklist (section 28)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.coaching_post_session_checklist(p_enrollment_id uuid)
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
  unit_complete boolean
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
    ev.unit_complete
  FROM public.canonical_coaching_requirement_fulfilment(p_enrollment_id) f
  JOIN public.sessions s ON s.id = f.session_id
  CROSS JOIN LATERAL public.coaching_session_evidence(f.session_id) ev
  WHERE s.status = 'completed'
  ORDER BY f.ordinal;
$$;

REVOKE ALL ON FUNCTION public.coaching_post_session_checklist(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coaching_post_session_checklist(uuid) TO authenticated;
