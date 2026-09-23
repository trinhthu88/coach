-- ===========================================================================
-- P1 -- source-of-truth correctness (RULES_AUDIT.md, "P1")
--
--   4. Enrollment <-> cohort <-> programme is enforced by the database: an
--      enrollment's cohort must run its programme, and a cohort's programme
--      cannot change once it has enrollments.
--   5. A Coaching / Mentoring session completed before its requirement window
--      (due_on - 14) no longer occupies the requirement for ever: booking,
--      next_*_requirement and Mentoring auto-attribution treat it as free.
--   6. A session requirement exists only as a stored cohort_requirement_dates
--      row: a programme unit without one is not counted as required.
--   7. Training likewise: a week is a requirement only with its stored row,
--      and its due date is that row's date, never a computed fallback. A week
--      with no pacing date opens at its due date (no longer at cohort end).
--   8. The end date that freezes progress (enrollment end, else cohort end) is
--      the end date that settles completed / at_risk.
--   9. A stored 'at_risk' is read as 'active'; risk is derived (pace_status,
--      and at_risk after the end when incomplete). The admin profile sheet
--      shows the canonical status.
--  10. coachee_goal_ratings.goal_id references coachee_goals.
--   +  Assignments and daily prompts with learner answers cannot be deleted
--      (same cascade as the P0 training-week guard).
--
-- Function bodies below are the live definitions with only the marked lines
-- changed (each change is commented "20261001110000").
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 4. Enrollment <-> cohort <-> programme
-- ---------------------------------------------------------------------------
-- validate_programme_enrollment() (20260910150000) was written for this and
-- never attached. It fires on INSERT and when the cohort or programme of an
-- enrollment changes -- not on every UPDATE, so a legacy mismatched row can
-- still be paused, ended or annotated (requirement_integrity_issues reports
-- such rows instead). A NULL cohort is left to the writers and the existing
-- integrity report: the WHEN clause below only checks a stated cohort.
DROP TRIGGER IF EXISTS validate_enrollment_cohort_programme ON public.programme_enrollments;
CREATE TRIGGER validate_enrollment_cohort_programme
  BEFORE INSERT ON public.programme_enrollments
  FOR EACH ROW
  WHEN (NEW.cohort_id IS NOT NULL)
  EXECUTE FUNCTION public.validate_programme_enrollment();

DROP TRIGGER IF EXISTS validate_enrollment_cohort_programme_change ON public.programme_enrollments;
CREATE TRIGGER validate_enrollment_cohort_programme_change
  BEFORE UPDATE OF cohort_id, programme_id ON public.programme_enrollments
  FOR EACH ROW
  WHEN (NEW.cohort_id IS NOT NULL
        AND (NEW.cohort_id IS DISTINCT FROM OLD.cohort_id OR NEW.programme_id IS DISTINCT FROM OLD.programme_id))
  EXECUTE FUNCTION public.validate_programme_enrollment();

CREATE OR REPLACE FUNCTION public.guard_cohort_programme_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.programme_id IS DISTINCT FROM OLD.programme_id
     AND EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.cohort_id = OLD.id)
  THEN
    RAISE EXCEPTION 'Cannot change the programme of a cohort that has enrollments'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_cohort_programme ON public.cohorts;
CREATE TRIGGER guard_cohort_programme
  BEFORE UPDATE OF programme_id ON public.cohorts
  FOR EACH ROW EXECUTE FUNCTION public.guard_cohort_programme_change();

-- ---------------------------------------------------------------------------
-- 5. Early sessions do not keep a requirement (RULES_AUDIT 1b')
-- ---------------------------------------------------------------------------
-- A Coaching / Mentoring session completed before its requirement's window
-- (due_on - 14) never counts (20260930100000). It also used to OCCUPY the
-- requirement: booking refused a second session and next_*_requirement
-- skipped it, so the requirement could never be completed. One predicate now
-- says what occupies a requirement, and every path reads it.
CREATE OR REPLACE FUNCTION public.session_occupies_requirement(
  p_status public.session_status, p_start_time timestamptz, p_due_on date
) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_status IN ('pending_coach_approval'::public.session_status, 'confirmed'::public.session_status)
      OR (p_status = 'completed'::public.session_status
          AND (p_start_time AT TIME ZONE 'UTC')::date >= public.canonical_session_requirement_available_on(p_due_on));
$$;
REVOKE ALL ON FUNCTION public.session_occupies_requirement(public.session_status, timestamptz, date) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.session_occupies_requirement(public.session_status, timestamptz, date) IS
  'A session holds its requirement when it is live, or completed on/after the requirement window opens (due_on - 14). '
  'A session completed earlier neither counts nor blocks. Internal.';

CREATE OR REPLACE FUNCTION public.book_coaching_session_internal(
  p_enrollment_id uuid,
  p_coach_id uuid,
  p_slot_id uuid,
  p_requirement_id uuid,
  p_topic text,
  p_start_time timestamptz DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_enr record;
  v_slot record;
  v_req record;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_start timestamptz;
  v_duration integer;
  v_session_id uuid;
BEGIN
  -- Booking goal gate: a NEW booking needs an active goal after the grace
  -- period. A reschedule (same requirement released in this transaction) is
  -- not a new booking.
  IF NOT public.coaching_reschedule_in_progress(p_enrollment_id, p_requirement_id) THEN
    PERFORM public.assert_enrollment_goal_gate(p_enrollment_id);
  END IF;

  -- Lock the race-sensitive resource FIRST, before any validation, so two
  -- concurrent bookings for one slot cannot both pass their checks.
  SELECT ca.id, ca.coach_id, ca.slot_date, ca.start_time, ca.end_time,
         ca.is_booked, ca.slot_type
    INTO v_slot
  FROM public.coach_availability ca
  WHERE ca.id = p_slot_id
  FOR UPDATE;

  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'Availability slot % does not exist', p_slot_id USING ERRCODE = '23503';
  END IF;

  SELECT e.id, e.user_id, e.cohort_id, e.programme_id, e.status
    INTO v_enr
  FROM public.programme_enrollments e
  WHERE e.id = p_enrollment_id;

  IF v_enr.id IS NULL THEN
    RAISE EXCEPTION 'Enrollment % does not exist', p_enrollment_id USING ERRCODE = '23503';
  END IF;
  IF v_enr.status <> 'active'::public.enrollment_status THEN
    RAISE EXCEPTION 'Enrollment is not active (status=%)', v_enr.status USING ERRCODE = '42501';
  END IF;
  IF v_enr.cohort_id IS NULL THEN
    RAISE EXCEPTION 'Enrollment has no cohort; Coaching cannot be booked' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.programme_modules m
    WHERE m.programme_id = v_enr.programme_id
      AND m.module = 'coaching'::public.programme_module_type
      AND m.enabled
  ) THEN
    RAISE EXCEPTION 'Coaching is not enabled for this programme' USING ERRCODE = '42501';
  END IF;

  SELECT d.id, d.cohort_id, d.module, d.due_on, d.ordinal
    INTO v_req
  FROM public.cohort_requirement_dates d
  WHERE d.id = p_requirement_id;

  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Coaching requirement % does not exist', p_requirement_id USING ERRCODE = '23503';
  END IF;
  IF v_req.module <> 'coaching'::public.programme_module_type THEN
    RAISE EXCEPTION 'Requirement % is not a Coaching requirement', p_requirement_id USING ERRCODE = '23514';
  END IF;
  IF v_req.cohort_id IS DISTINCT FROM v_enr.cohort_id THEN
    RAISE EXCEPTION 'Requirement belongs to a different cohort' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.cohort_requirement_id = p_requirement_id
      AND s.enrollment_id = p_enrollment_id
      AND s.status IN ('pending_coach_approval', 'confirmed', 'completed')
      -- A session completed before the requirement's window never counts,
      -- so it does not keep the requirement either (20261001110000).
      AND public.session_occupies_requirement(s.status, s.start_time, v_req.due_on)
  ) THEN
    RAISE EXCEPTION 'Coaching requirement % already has a live or completed session', p_requirement_id
      USING ERRCODE = '23505';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cohort_coaching_coach_pool(v_enr.cohort_id) p
    WHERE p.coach_id = p_coach_id
  ) THEN
    RAISE EXCEPTION 'Coach % is not assigned to cohort %', p_coach_id, v_enr.cohort_id
      USING ERRCODE = '42501';
  END IF;

  IF v_slot.coach_id IS DISTINCT FROM p_coach_id THEN
    RAISE EXCEPTION 'Availability slot belongs to a different Coach' USING ERRCODE = '42501';
  END IF;
  IF v_slot.slot_type <> 'coaching'::public.availability_slot_type THEN
    RAISE EXCEPTION 'Availability slot is not a Coaching slot (type=%)', v_slot.slot_type
      USING ERRCODE = '23514';
  END IF;
  IF v_slot.is_booked THEN
    RAISE EXCEPTION 'Availability slot is no longer available' USING ERRCODE = '23505';
  END IF;

  v_slot_start := (v_slot.slot_date + v_slot.start_time) AT TIME ZONE 'UTC';
  v_slot_end   := (v_slot.slot_date + v_slot.end_time) AT TIME ZONE 'UTC';

  v_start := COALESCE(p_start_time, v_slot_start);
  v_duration := COALESCE(
    p_duration_minutes,
    GREATEST(EXTRACT(EPOCH FROM (v_slot_end - v_slot_start))::integer / 60, 1));

  IF v_duration <= 0 THEN
    RAISE EXCEPTION 'Duration must be positive' USING ERRCODE = '23514';
  END IF;

  -- The requested window must lie inside the published slot. This is what makes
  -- the caller-supplied values safe to accept.
  IF v_start < v_slot_start OR (v_start + make_interval(mins => v_duration)) > v_slot_end THEN
    RAISE EXCEPTION 'Requested time % for % minutes falls outside the availability slot (% to %)',
      v_start, v_duration, v_slot_start, v_slot_end USING ERRCODE = '23514';
  END IF;

  IF v_start < now() THEN
    RAISE EXCEPTION 'Availability slot is in the past' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.session_transition', 'on', true);

  INSERT INTO public.sessions (
    enrollment_id, cohort_requirement_id, coach_id, coachee_id,
    slot_id, topic, start_time, duration_minutes, status
  ) VALUES (
    p_enrollment_id, p_requirement_id, p_coach_id, v_enr.user_id,
    p_slot_id, p_topic, v_start, v_duration, 'pending_coach_approval'
  )
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.book_mentoring_session_internal(
  p_enrollment_id uuid,
  p_mentor_id uuid,
  p_slot_id uuid,
  p_topic text,
  p_requirement_id uuid DEFAULT NULL,
  p_start_time timestamptz DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_enr record;
  v_slot record;
  v_req record;
  v_requirement uuid;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_start timestamptz;
  v_duration integer;
  v_session_id uuid;
BEGIN
  -- Booking goal gate (Mentoring has no reschedule path through here).
  PERFORM public.assert_enrollment_goal_gate(p_enrollment_id);

  SELECT ca.id, ca.coach_id, ca.slot_date, ca.start_time, ca.end_time,
         ca.is_booked, ca.slot_type
    INTO v_slot
  FROM public.coach_availability ca WHERE ca.id = p_slot_id FOR UPDATE;

  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'Availability slot % does not exist', p_slot_id USING ERRCODE = '23503';
  END IF;

  SELECT e.id, e.user_id, e.cohort_id, e.programme_id, e.status
    INTO v_enr
  FROM public.programme_enrollments e WHERE e.id = p_enrollment_id;

  IF v_enr.id IS NULL THEN
    RAISE EXCEPTION 'Enrollment % does not exist', p_enrollment_id USING ERRCODE = '23503';
  END IF;
  IF v_enr.status NOT IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status) THEN
    RAISE EXCEPTION 'Enrollment is not active (status=%)', v_enr.status USING ERRCODE = '42501';
  END IF;
  IF v_enr.cohort_id IS NULL THEN
    RAISE EXCEPTION 'Enrollment has no cohort; Mentoring cannot be booked' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.programme_modules m
    WHERE m.programme_id = v_enr.programme_id
      AND m.module = 'mentoring'::public.programme_module_type AND m.enabled
  ) THEN
    RAISE EXCEPTION 'Mentoring is not enabled for this programme' USING ERRCODE = '42501';
  END IF;

  -- WHO first: eligibility does not depend on the schedule.
  IF NOT EXISTS (
    SELECT 1 FROM public.cohort_mentoring_mentor_pool(v_enr.cohort_id) p
    WHERE p.mentor_user_id = p_mentor_id
  ) THEN
    RAISE EXCEPTION 'Mentor % is not assigned to cohort %', p_mentor_id, v_enr.cohort_id
      USING ERRCODE = '42501';
  END IF;

  IF v_slot.coach_id IS DISTINCT FROM p_mentor_id THEN
    RAISE EXCEPTION 'Availability slot belongs to a different mentor' USING ERRCODE = '42501';
  END IF;
  IF v_slot.slot_type <> 'mentoring'::public.availability_slot_type THEN
    RAISE EXCEPTION 'Availability slot is not a Mentoring slot (type=%)', v_slot.slot_type
      USING ERRCODE = '23514';
  END IF;
  IF v_slot.is_booked THEN
    RAISE EXCEPTION 'Availability slot is no longer available' USING ERRCODE = '23505';
  END IF;

  -- WHICH requirement. Explicit always wins and is fully validated.
  IF p_requirement_id IS NOT NULL THEN
    SELECT d.id, d.cohort_id, d.programme_id, d.module, d.due_on INTO v_req
    FROM public.cohort_requirement_dates d WHERE d.id = p_requirement_id;

    IF v_req.id IS NULL THEN
      RAISE EXCEPTION 'Mentoring requirement % does not exist', p_requirement_id USING ERRCODE = '23503';
    END IF;
    IF v_req.module <> 'mentoring'::public.programme_module_type THEN
      RAISE EXCEPTION 'Requirement % is not a Mentoring requirement', p_requirement_id USING ERRCODE = '23514';
    END IF;
    IF v_req.cohort_id IS DISTINCT FROM v_enr.cohort_id
       OR v_req.programme_id IS DISTINCT FROM v_enr.programme_id THEN
      RAISE EXCEPTION 'Requirement belongs to a different cohort or programme' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.mentoring_sessions s
      WHERE s.cohort_requirement_id = p_requirement_id
        AND s.enrollment_id = p_enrollment_id
        AND s.status IN ('pending_coach_approval', 'confirmed', 'completed')
        -- A session completed before the window does not keep the requirement.
        AND public.session_occupies_requirement(s.status, s.start_time, v_req.due_on)
    ) THEN
      RAISE EXCEPTION 'Mentoring requirement % already has a live or completed session', p_requirement_id
        USING ERRCODE = '23505';
    END IF;
    v_requirement := p_requirement_id;
  ELSE
    SELECT f.requirement_id INTO v_requirement
    FROM public.next_mentoring_requirement(p_enrollment_id) f;
    IF v_requirement IS NULL THEN
      RAISE EXCEPTION 'No unfulfilled Mentoring requirement remains for this enrollment'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  v_slot_start := (v_slot.slot_date + v_slot.start_time) AT TIME ZONE 'UTC';
  v_slot_end   := (v_slot.slot_date + v_slot.end_time) AT TIME ZONE 'UTC';
  v_start := COALESCE(p_start_time, v_slot_start);
  v_duration := COALESCE(p_duration_minutes,
    GREATEST(EXTRACT(EPOCH FROM (v_slot_end - v_slot_start))::integer / 60, 1));

  IF v_duration <= 0 THEN
    RAISE EXCEPTION 'Duration must be positive' USING ERRCODE = '23514';
  END IF;
  IF v_start < v_slot_start OR (v_start + make_interval(mins => v_duration)) > v_slot_end THEN
    RAISE EXCEPTION 'Requested time % for % minutes falls outside the availability slot (% to %)',
      v_start, v_duration, v_slot_start, v_slot_end USING ERRCODE = '23514';
  END IF;
  IF v_start < now() THEN
    RAISE EXCEPTION 'Availability slot is in the past' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.session_transition', 'on', true);

  INSERT INTO public.mentoring_sessions (
    enrollment_id, cohort_requirement_id, mentor_id, mentee_id,
    slot_id, topic, start_time, duration_minutes, status
  ) VALUES (
    p_enrollment_id, v_requirement, p_mentor_id, v_enr.user_id,
    p_slot_id, p_topic, v_start, v_duration, 'pending_coach_approval'
  )
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;

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
        -- 20261001110000: a completed session inside the window, then a
        -- live one, then (only when nothing else exists) one completed before
        -- the window -- it is kept visible but never counts or blocks.
        ORDER BY CASE WHEN s.status = 'completed' AND public.session_occupies_requirement(s.status, s.start_time, r.due_on) THEN 0
                      WHEN s.status <> 'completed' THEN 1 ELSE 2 END, s.start_time
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

CREATE OR REPLACE FUNCTION public.canonical_mentoring_requirement_fulfilment(p_enrollment_id uuid)
RETURNS TABLE (
  requirement_id uuid,
  ordinal integer,
  due_on date,
  fulfilled_on date,
  booked_on date,
  session_id uuid
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
    WHERE d.module = 'mentoring'::public.programme_module_type
  ), per_requirement AS (
    SELECT r.id AS requirement_id, r.ordinal, r.due_on,
      -- The single live-or-completed session by which THIS enrollment owns
      -- this requirement. The partial unique index guarantees at most one live
      -- session per learner per requirement; a completed one is terminal.
      (SELECT s.id FROM public.mentoring_sessions s
        WHERE s.cohort_requirement_id = r.id
          AND s.enrollment_id = p_enrollment_id
          AND s.status IN ('pending_coach_approval', 'confirmed', 'completed')
        -- 20261001110000: a completed session inside the window, then a
        -- live one, then (only when nothing else exists) one completed before
        -- the window -- it is kept visible but never counts or blocks.
        ORDER BY CASE WHEN s.status = 'completed' AND public.session_occupies_requirement(s.status, s.start_time, r.due_on) THEN 0
                      WHEN s.status <> 'completed' THEN 1 ELSE 2 END, s.start_time
        LIMIT 1) AS session_id
    FROM requirements r
  )
  SELECT pr.requirement_id, pr.ordinal, pr.due_on,
    -- A Mentoring requirement is fulfilled by a completed session. The
    -- preparation document, mentor feedback and mentee reflection are
    -- after-session evidence and gate nothing.
    CASE WHEN s.status = 'completed' THEN (s.start_time AT TIME ZONE 'UTC')::date END AS fulfilled_on,
    CASE WHEN s.id IS NOT NULL AND s.status <> 'completed'
         THEN (s.start_time AT TIME ZONE 'UTC')::date END AS booked_on,
    pr.session_id
  FROM per_requirement pr
  LEFT JOIN public.mentoring_sessions s ON s.id = pr.session_id
  ORDER BY pr.ordinal;
$$;

CREATE OR REPLACE FUNCTION public.next_coaching_requirement(p_enrollment_id uuid)
RETURNS TABLE (requirement_id uuid, ordinal integer, due_on date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT f.requirement_id, f.ordinal, f.due_on
  FROM public.canonical_coaching_requirement_fulfilment(p_enrollment_id) f
  -- Free = no session, or only one completed before the window (20261001110000).
  WHERE f.session_id IS NULL
     OR f.fulfilled_on < public.canonical_session_requirement_available_on(f.due_on)
  ORDER BY f.ordinal
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.next_mentoring_requirement(p_enrollment_id uuid)
RETURNS TABLE (requirement_id uuid, ordinal integer, due_on date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT f.requirement_id, f.ordinal, f.due_on
  FROM public.canonical_mentoring_requirement_fulfilment(p_enrollment_id) f
  -- Free = no session, or only one completed before the window (20261001110000).
  WHERE f.session_id IS NULL
     OR f.fulfilled_on < public.canonical_session_requirement_available_on(f.due_on)
  ORDER BY f.ordinal
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.validate_mentoring_session_requirement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_enrollment_cohort uuid;
  v_req record;
BEGIN
  IF NEW.enrollment_id IS NULL THEN
    RETURN NEW;  -- validate_enrollment_activity already rejects this.
  END IF;

  SELECT e.cohort_id INTO v_enrollment_cohort
  FROM public.programme_enrollments e WHERE e.id = NEW.enrollment_id;

  -- cohort_id is derived, never supplied.
  NEW.cohort_id := v_enrollment_cohort;

  -- A new session with no requirement stated takes the learner's next
  -- unfulfilled Mentoring requirement -- the same deterministic rule as the
  -- backfill, and the order the learner actually works through them.
  --
  -- Without this, every Mentoring session created by a path that does not yet
  -- name a requirement (today: the direct client insert, until the booking RPC
  -- lands) would score zero against canonical progress, because fulfilment is
  -- now requirement-attributed. Naming a requirement explicitly always wins;
  -- this only fills a gap, and never invents one where the cohort schedules no
  -- Mentoring or every requirement is already taken.
  IF TG_OP = 'INSERT'
     AND NEW.cohort_requirement_id IS NULL
     AND v_enrollment_cohort IS NOT NULL
     AND NEW.status IN ('pending_coach_approval', 'confirmed', 'completed') THEN
    SELECT d.id INTO NEW.cohort_requirement_id
    FROM public.cohort_requirement_dates d
    JOIN public.programme_enrollments e ON e.id = NEW.enrollment_id
    WHERE d.cohort_id = e.cohort_id
      AND d.programme_id = e.programme_id
      AND d.module = 'mentoring'::public.programme_module_type
      AND NOT EXISTS (
        SELECT 1 FROM public.mentoring_sessions s
        WHERE s.enrollment_id = NEW.enrollment_id
          AND s.cohort_requirement_id = d.id
          AND s.status IN ('pending_coach_approval', 'confirmed', 'completed')
          AND public.session_occupies_requirement(s.status, s.start_time, d.due_on)
      )
    ORDER BY d.ordinal
    LIMIT 1;
  END IF;

  IF NEW.cohort_requirement_id IS NOT NULL THEN
    SELECT d.id, d.cohort_id, d.module INTO v_req
    FROM public.cohort_requirement_dates d WHERE d.id = NEW.cohort_requirement_id;

    IF v_req.id IS NULL THEN
      RAISE EXCEPTION 'Mentoring requirement % does not exist', NEW.cohort_requirement_id
        USING ERRCODE = '23503';
    END IF;
    IF v_req.module <> 'mentoring'::public.programme_module_type THEN
      RAISE EXCEPTION 'Session requirement % is not a mentoring requirement (module=%)',
        NEW.cohort_requirement_id, v_req.module USING ERRCODE = '23514';
    END IF;
    IF v_req.cohort_id IS DISTINCT FROM v_enrollment_cohort THEN
      RAISE EXCEPTION 'Mentoring requirement belongs to cohort %, enrollment belongs to cohort %',
        v_req.cohort_id, v_enrollment_cohort USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 6 + 7. Only stored requirements are required (RULES_AUDIT 7d, 7d', 4.5)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_enrollment_requirement_calendar(
  p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE
) RETURNS TABLE (
  enrollment_id uuid, programme_id uuid, cohort_id uuid, organization_id uuid,
  module public.programme_module_type, requirement_id uuid, requirement_index integer,
  requirement_label text, training_week_id uuid, due_on date, is_required boolean,
  is_due_as_of boolean, is_completed boolean, completed_on date, is_overdue boolean,
  completion_source text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH eff AS (
    SELECT coalesce(public.canonical_enrollment_effective_as_of(p_enrollment_id, p_as_of), p_as_of) AS as_of
  ), enrollment AS (
    SELECT e.id, e.programme_id, e.cohort_id, e.organization_id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.id = p_enrollment_id
  ), session_units AS (
    SELECT pm.module, g.i AS ordinal
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.enabled
     AND pm.module <> 'training'::public.programme_module_type
     AND coalesce((pm.config->>'required')::boolean, false)
    CROSS JOIN LATERAL generate_series(1, coalesce(public.programme_config_integer(pm.config, 'required_units'), 0)) g(i)
  ), fulfilment AS (
    SELECT f.requirement_id, f.fulfilled_on, 'coaching_session'::text AS source
    FROM public.canonical_coaching_requirement_fulfilment(p_enrollment_id) f
    UNION ALL
    SELECT f.requirement_id, f.fulfilled_on, 'mentoring_session'
    FROM public.canonical_mentoring_requirement_fulfilment(p_enrollment_id) f
    UNION ALL
    SELECT f.requirement_id, f.fulfilled_on, 'peer_session'
    FROM public.canonical_peer_requirement_fulfilment(p_enrollment_id) f
    UNION ALL
    SELECT f.cohort_requirement_date_id, f.fulfilled_on, 'triad_session'
    FROM public.canonical_triad_requirement_fulfilment(p_enrollment_id) f
  ), rows AS (
    SELECT u.module, d.id AS requirement_id, u.ordinal AS requirement_index,
      public.cohort_requirement_label(u.module, u.ordinal) AS requirement_label,
      NULL::uuid AS training_week_id, d.due_on,
      -- Counts only within [due_on - 14, effective as-of].
      CASE WHEN f.fulfilled_on BETWEEN public.canonical_session_requirement_available_on(d.due_on) AND (SELECT eff.as_of FROM eff)
        THEN f.fulfilled_on END AS completed_on,
      CASE WHEN f.fulfilled_on BETWEEN public.canonical_session_requirement_available_on(d.due_on) AND (SELECT eff.as_of FROM eff)
        THEN f.source END AS completion_source
    FROM session_units u
    CROSS JOIN enrollment e
    -- 20261001110000: only a requirement with its own stored date exists. A
    -- programme unit the cohort has not materialised is a schedule gap
    -- (requirement_integrity_issues), not a requirement nobody can complete.
    JOIN public.cohort_requirement_dates d
      ON d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
     AND d.module = u.module AND d.ordinal = u.ordinal
    LEFT JOIN fulfilment f ON f.requirement_id = d.id

    UNION ALL
    SELECT 'training'::public.programme_module_type, d.id,
      coalesce(d.ordinal, row_number() OVER (ORDER BY tw.week_number)::integer),
      public.cohort_requirement_label('training', coalesce(d.ordinal, tw.week_number), tw.week_number, tw.title),
      i.training_week_id, i.due_on,
      CASE WHEN i.completed_units > 0 THEN i.completed_on END,
      CASE WHEN i.completed_units > 0 THEN 'training_week' END
    FROM public.canonical_training_learning_items(p_enrollment_id, (SELECT eff.as_of FROM eff)) i
    CROSS JOIN enrollment e
    JOIN public.training_weeks tw ON tw.id = i.training_week_id
    JOIN public.cohort_requirement_dates d
      ON d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
     AND d.module = 'training'::public.programme_module_type AND d.training_week_id = i.training_week_id
  )
  SELECT e.id, e.programme_id, e.cohort_id, e.organization_id,
    r.module, r.requirement_id, r.requirement_index, r.requirement_label, r.training_week_id,
    r.due_on,
    true,
    r.due_on IS NOT NULL AND r.due_on <= (SELECT eff.as_of FROM eff),
    r.completed_on IS NOT NULL,
    r.completed_on,
    -- Overdue = the due date has PASSED and the requirement is still open.
    r.due_on IS NOT NULL AND r.due_on < (SELECT eff.as_of FROM eff) AND r.completed_on IS NULL,
    r.completion_source
  FROM rows r
  CROSS JOIN enrollment e
  ORDER BY r.module, r.requirement_index;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_training_week_fulfilment(
  p_enrollment_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  training_week_id uuid,
  week_number integer,
  due_on date,
  available_on date,
  unlock_on date,
  skill_card_required boolean,
  skill_card_completed boolean,
  skill_card_completed_at timestamptz,
  quiz_required boolean,
  quiz_completed boolean,
  quiz_completed_at timestamptz,
  reflection_required boolean,
  reflection_completed boolean,
  reflection_completed_at timestamptz,
  daily_prompts_required integer,
  daily_prompts_completed integer,
  week_complete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH eff AS (
    SELECT coalesce(public.canonical_enrollment_effective_as_of(p_enrollment_id, p_as_of), p_as_of) AS as_of
  ), enrollment AS (
    SELECT e.id, e.programme_id, e.cohort_id, c.start_date, c.end_date
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.id = p_enrollment_id
  ), configured AS (
    SELECT e.*,
      pm.config,
      CASE
        WHEN jsonb_typeof(pm.config->'learning_components') = 'array'
          THEN pm.config->'learning_components'
        ELSE jsonb_build_array('skill_cards', 'reflections')
          || CASE WHEN EXISTS (
            SELECT 1 FROM public.programme_modules q
            WHERE q.programme_id = e.programme_id
              AND q.module = 'quiz'::public.programme_module_type
              AND q.enabled
              AND coalesce((q.config->>'required')::boolean, false)
          ) THEN jsonb_build_array('quizzes') ELSE '[]'::jsonb END
          || CASE WHEN EXISTS (
            SELECT 1 FROM public.programme_modules d
            WHERE d.programme_id = e.programme_id
              AND d.module = 'daily_prompt'::public.programme_module_type
              AND d.enabled
              AND coalesce((d.config->>'required')::boolean, false)
          ) THEN jsonb_build_array('daily_prompts') ELSE '[]'::jsonb END
      END AS components
    FROM enrollment e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.module = 'training'::public.programme_module_type
     AND pm.enabled
     AND coalesce((pm.config->>'required')::boolean, false)
  ), selected AS (
    SELECT DISTINCT
      c.id AS enrollment_id,
      c.programme_id,
      c.cohort_id,
      tw.id AS training_week_id,
      tw.week_number,
      tw.is_visible,
      tw.skill_card_visible,
      coalesce(cwo.is_visible, true) AS override_visible,
      -- 20261001110000: the week's stored requirement date, never a computed
      -- stand-in. A week without a stored row is not a requirement (below).
      d.due_on AS due_on,
      -- Opens at its pacing date; with no pacing date at all, at its due date
      -- (previously the cohort END date, i.e. after it was due).
      least(
        c.end_date,
        coalesce(
          cwo.unlock_date,
          (c.start_date + ((tw.week_number - 1) * interval '7 days'))::date,
          tw.unlock_date,
          d.due_on
        )
      ) AS available_on,
      coalesce(cwo.unlock_date,
        (c.start_date + ((tw.week_number - 1) * interval '7 days'))::date,
        tw.unlock_date) AS unlock_on,
      c.components
    FROM configured c
    JOIN public.training_weeks tw ON tw.programme_id = c.programme_id
    LEFT JOIN LATERAL jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(c.config->'distribution_settings'->'training_week_ids') = 'array'
          THEN c.config->'distribution_settings'->'training_week_ids'
        ELSE '[]'::jsonb
      END
    ) selected_week(week_id) ON true
    LEFT JOIN public.cohort_week_overrides cwo
      ON cwo.cohort_id = c.cohort_id
     AND cwo.training_week_id = tw.id
    JOIN public.cohort_requirement_dates d
      ON d.cohort_id = c.cohort_id
     AND d.programme_id = c.programme_id
     AND d.module = 'training'::public.programme_module_type
     AND d.training_week_id = tw.id
    WHERE jsonb_typeof(c.config->'distribution_settings'->'training_week_ids') IS DISTINCT FROM 'array'
       OR tw.id::text = selected_week.week_id
  ), quiz AS (
    SELECT
      s.training_week_id,
      count(a.id)::integer AS total,
      count(a.id) FILTER (
        WHERE sub.submitted_at IS NOT NULL
          AND sub.submitted_at::date <= (SELECT eff.as_of FROM eff)
          AND sub.submitted_at::date >= s.available_on
      )::integer AS completed,
      max(sub.submitted_at) FILTER (
        WHERE sub.submitted_at IS NOT NULL
          AND sub.submitted_at::date <= (SELECT eff.as_of FROM eff)
          AND sub.submitted_at::date >= s.available_on
      ) AS completed_at
    FROM selected s
    LEFT JOIN public.assignments a
      ON a.training_week_id = s.training_week_id
     AND a.assignment_type = 'quiz'::public.assignment_type
     AND a.is_visible
    LEFT JOIN public.assignment_submissions sub
      ON sub.assignment_id = a.id
     AND sub.enrollment_id = p_enrollment_id
    GROUP BY s.training_week_id
  ), reflection AS (
    SELECT
      s.training_week_id,
      count(pr.id)::integer AS total,
      count(pr.id) FILTER (
        WHERE rs.submitted_at IS NOT NULL
          AND rs.submitted_at::date <= (SELECT eff.as_of FROM eff)
          AND rs.submitted_at::date >= s.available_on
      )::integer AS completed,
      max(rs.submitted_at) FILTER (
        WHERE rs.submitted_at IS NOT NULL
          AND rs.submitted_at::date <= (SELECT eff.as_of FROM eff)
          AND rs.submitted_at::date >= s.available_on
      ) AS completed_at
    FROM selected s
    LEFT JOIN public.programme_reflections pr
      ON pr.programme_id = s.programme_id
     AND pr.appears_at_week = s.week_number
     AND pr.is_visible
    LEFT JOIN public.reflection_submissions rs
      ON rs.reflection_id = pr.id
     AND rs.enrollment_id = p_enrollment_id
    GROUP BY s.training_week_id
  ), prompts AS (
    SELECT
      s.training_week_id,
      count(dp.id)::integer AS total,
      count(dp.id) FILTER (
        WHERE dpr.responded_at IS NOT NULL
          AND dpr.responded_at::date <= (SELECT eff.as_of FROM eff)
          AND dpr.responded_at::date >= s.available_on
      )::integer AS completed
    FROM selected s
    LEFT JOIN public.daily_prompts dp
      ON dp.training_week_id = s.training_week_id
     AND dp.is_visible
    LEFT JOIN public.daily_prompt_responses dpr
      ON dpr.daily_prompt_id = dp.id
     AND dpr.enrollment_id = p_enrollment_id
    GROUP BY s.training_week_id
  ), values AS (
    SELECT
      s.training_week_id,
      s.week_number,
      s.due_on,
      s.available_on,
      s.unlock_on,
      (s.is_visible AND s.skill_card_visible AND s.override_visible) AS skill_card_required,
      tp.completed_at IS NOT NULL
        AND tp.completed_at::date <= (SELECT eff.as_of FROM eff)
        AND tp.completed_at::date >= s.available_on
        AND s.available_on IS NOT NULL
        AND s.available_on <= (SELECT eff.as_of FROM eff) AS skill_card_completed,
      CASE WHEN tp.completed_at::date BETWEEN s.available_on AND (SELECT eff.as_of FROM eff)
        THEN tp.completed_at END AS skill_card_completed_at,
      (s.components ? 'quizzes') AND coalesce(q.total, 0) > 0 AS quiz_required,
      (s.components ? 'quizzes')
        AND coalesce(q.total, 0) > 0
        AND coalesce(q.completed, 0) >= q.total
        AND s.available_on IS NOT NULL
        AND s.available_on <= (SELECT eff.as_of FROM eff) AS quiz_completed,
      q.completed_at AS quiz_completed_at,
      (s.components ? 'reflections') AND coalesce(r.total, 0) > 0 AS reflection_required,
      (s.components ? 'reflections')
        AND coalesce(r.total, 0) > 0
        AND coalesce(r.completed, 0) >= r.total
        AND s.available_on IS NOT NULL
        AND s.available_on <= (SELECT eff.as_of FROM eff) AS reflection_completed,
      r.completed_at AS reflection_completed_at,
      CASE WHEN s.components ? 'daily_prompts' THEN coalesce(p.total, 0) ELSE 0 END AS daily_prompts_required,
      CASE WHEN s.components ? 'daily_prompts' THEN coalesce(p.completed, 0) ELSE 0 END AS daily_prompts_completed
    FROM selected s
    LEFT JOIN public.training_progress tp
      ON tp.enrollment_id = p_enrollment_id
     AND tp.training_week_id = s.training_week_id
    LEFT JOIN quiz q ON q.training_week_id = s.training_week_id
    LEFT JOIN reflection r ON r.training_week_id = s.training_week_id
    LEFT JOIN prompts p ON p.training_week_id = s.training_week_id
    WHERE s.is_visible AND s.skill_card_visible AND s.override_visible
  )
  SELECT v.training_week_id,
    v.week_number,
    v.due_on,
    v.available_on,
    v.unlock_on,
    v.skill_card_required,
    v.skill_card_completed,
    v.skill_card_completed_at,
    v.quiz_required,
    v.quiz_completed,
    v.quiz_completed_at,
    v.reflection_required,
    v.reflection_completed,
    v.reflection_completed_at,
    v.daily_prompts_required,
    v.daily_prompts_completed,
    (
      v.skill_card_required AND v.skill_card_completed
      AND (NOT v.quiz_required OR v.quiz_completed)
      AND (NOT v.reflection_required OR v.reflection_completed)
    ) AS week_complete
  FROM values v
  ORDER BY v.week_number, v.training_week_id;
$function$;


-- ---------------------------------------------------------------------------
-- 8 + 9. One end date; at_risk is derived, not stored (RULES_AUDIT 7d''', 2)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_enrollment_progress(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eligible AS (
    SELECT e.id, e.programme_id, e.cohort_id, e.user_id,
      -- The enrollment's EFFECTIVE window: its own dates, else its cohort's.
      -- An ongoing enrollment normally carries no end date of its own, and
      -- every surface (learner header, journey card, sponsor, admin) must
      -- show one date range, not "May 25 - ".
      coalesce(e.start_date, c.start_date) AS start_date,
      coalesce(e.end_date, c.end_date) AS end_date, e.status, c.name AS cohort_label,
      c.start_date AS programme_start_date, c.end_date AS programme_end_date,
      p.name AS programme_label, pr.full_name AS learner_display_name
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN public.programmes p ON p.id = e.programme_id
    JOIN public.profiles pr ON pr.id = e.user_id
    WHERE e.id = p_enrollment_id
  ), module_rows AS (
    SELECT e.*, g.module,
      g.required_units AS module_required_units,
      g.completed_units AS module_completed_units,
      g.due_units AS module_due_units,
      g.booked_units AS module_booked_units,
      g.overdue_units AS module_overdue_units,
      g.pace_status AS module_pace_status
    FROM eligible e
    LEFT JOIN LATERAL public.canonical_module_progress(e.id, p_as_of) g ON true
  ), grouped AS (
    SELECT e.id, e.learner_display_name, e.programme_label, e.cohort_id,
      e.cohort_label, e.programme_id, e.start_date, e.end_date,
      e.programme_start_date, e.programme_end_date, e.status,
      count(m.module)::integer AS module_count,
      coalesce(sum(m.module_required_units), 0)::integer AS required_units,
      coalesce(sum(m.module_completed_units), 0)::integer AS completed_units,
      coalesce(sum(m.module_due_units), 0)::integer AS due_units,
      coalesce(sum(m.module_booked_units), 0)::integer AS booked_units,
      coalesce(sum(m.module_overdue_units), 0)::integer AS overdue_units,
      coalesce(max(m.module_required_units) FILTER (WHERE m.module = 'coaching'), 0)::integer AS coaching_required_units,
      coalesce(max(m.module_completed_units) FILTER (WHERE m.module = 'coaching'), 0)::integer AS coaching_completed_units,
      coalesce(max(m.module_due_units) FILTER (WHERE m.module = 'coaching'), 0)::integer AS coaching_due_units,
      coalesce(max(m.module_booked_units) FILTER (WHERE m.module = 'coaching'), 0)::integer AS coaching_booked_units,
      coalesce(max(m.module_required_units) FILTER (WHERE m.module = 'training'), 0)::integer AS training_required_units,
      coalesce(max(m.module_completed_units) FILTER (WHERE m.module = 'training'), 0)::integer AS training_completed_units,
      coalesce(max(m.module_due_units) FILTER (WHERE m.module = 'training'), 0)::integer AS training_due_units,
      coalesce(max(m.module_booked_units) FILTER (WHERE m.module = 'training'), 0)::integer AS training_booked_units,
      coalesce(max(m.module_required_units) FILTER (WHERE m.module = 'peer_coaching'), 0)::integer AS peer_required_units,
      coalesce(max(m.module_completed_units) FILTER (WHERE m.module = 'peer_coaching'), 0)::integer AS peer_completed_units,
      coalesce(max(m.module_due_units) FILTER (WHERE m.module = 'peer_coaching'), 0)::integer AS peer_due_units,
      coalesce(max(m.module_booked_units) FILTER (WHERE m.module = 'peer_coaching'), 0)::integer AS peer_booked_units,
      coalesce(max(m.module_required_units) FILTER (WHERE m.module = 'mentoring'), 0)::integer AS mentoring_required_units,
      coalesce(max(m.module_completed_units) FILTER (WHERE m.module = 'mentoring'), 0)::integer AS mentoring_completed_units,
      coalesce(max(m.module_due_units) FILTER (WHERE m.module = 'mentoring'), 0)::integer AS mentoring_due_units,
      coalesce(max(m.module_booked_units) FILTER (WHERE m.module = 'mentoring'), 0)::integer AS mentoring_booked_units,
      coalesce(max(m.module_required_units) FILTER (WHERE m.module = 'triads'), 0)::integer AS triad_required_units,
      coalesce(max(m.module_completed_units) FILTER (WHERE m.module = 'triads'), 0)::integer AS triad_completed_units,
      coalesce(max(m.module_due_units) FILTER (WHERE m.module = 'triads'), 0)::integer AS triad_due_units,
      coalesce(max(m.module_booked_units) FILTER (WHERE m.module = 'triads'), 0)::integer AS triad_booked_units,
      count(m.module) FILTER (WHERE m.module_pace_status = 'behind')::integer AS behind_count,
      count(m.module) FILTER (WHERE m.module_pace_status = 'scheduled')::integer AS scheduled_count,
      count(m.module) FILTER (WHERE m.module_pace_status = 'on_track')::integer AS on_track_count,
      count(m.module) FILTER (WHERE m.module_pace_status = 'ahead')::integer AS ahead_count,
      coalesce(bool_and(m.module_pace_status = 'completed')
        FILTER (WHERE m.module IS NOT NULL), false) AS all_completed
    FROM eligible e
    LEFT JOIN module_rows m ON m.id = e.id
    GROUP BY e.id, e.learner_display_name, e.programme_label, e.cohort_id,
      e.cohort_label, e.programme_id, e.start_date, e.end_date,
      e.programme_start_date, e.programme_end_date, e.status
  ), calculated AS (
    SELECT g.*,
      CASE
        WHEN g.module_count = 0 THEN 'not_yet_due'
        WHEN g.behind_count > 0 THEN 'behind'
        WHEN g.scheduled_count > 0 THEN 'scheduled'
        WHEN g.on_track_count > 0 THEN 'on_track'
        WHEN g.ahead_count > 0 THEN 'ahead'
        WHEN g.all_completed THEN 'completed'
        ELSE 'not_yet_due'
      END AS calculated_pace_status
    FROM grouped g
  )
  SELECT c.id, c.learner_display_name, c.programme_label, c.cohort_id,
    c.cohort_label, c.programme_id, c.start_date, c.end_date,
    c.programme_start_date, c.programme_end_date,
    CASE
      -- 20261001110000: the end that freezes progress (enrollment end, else
      -- cohort end) is the end that settles the status.
      WHEN c.status IN ('active', 'at_risk') AND c.end_date < p_as_of
      THEN CASE WHEN c.all_completed THEN 'completed'::public.enrollment_status
                ELSE 'at_risk'::public.enrollment_status END
      -- A stored at_risk is a legacy progress word in the lifecycle column:
      -- the enrollment is ongoing, so it is active; risk is pace_status.
      WHEN c.status = 'at_risk' THEN 'active'::public.enrollment_status
      ELSE c.status
    END,
    c.status,
    CASE
      -- 20261001110000: the end that freezes progress (enrollment end, else
      -- cohort end) is the end that settles the status.
      WHEN c.status IN ('active', 'at_risk') AND c.end_date < p_as_of
      THEN CASE WHEN c.all_completed THEN 'completed'::public.enrollment_status
                ELSE 'at_risk'::public.enrollment_status END
      -- A stored at_risk is a legacy progress word in the lifecycle column:
      -- the enrollment is ongoing, so it is active; risk is pace_status.
      WHEN c.status = 'at_risk' THEN 'active'::public.enrollment_status
      ELSE c.status
    END,
    c.required_units, c.completed_units, c.due_units, c.booked_units,
    c.overdue_units,
    CASE WHEN c.required_units = 0 THEN NULL
      ELSE round(least(c.completed_units, c.required_units) * 100.0 / c.required_units, 1)
    END,
    CASE WHEN c.due_units = 0 THEN NULL
      ELSE round(least(c.completed_units, c.due_units) * 100.0 / c.due_units, 1)
    END,
    c.calculated_pace_status, c.module_count > 0,
    c.coaching_required_units, c.coaching_completed_units, c.coaching_due_units, c.coaching_booked_units,
    c.training_required_units, c.training_completed_units, c.training_due_units, c.training_booked_units,
    c.peer_required_units, c.peer_completed_units, c.peer_due_units, c.peer_booked_units,
    c.mentoring_required_units, c.mentoring_completed_units, c.mentoring_due_units, c.mentoring_booked_units,
    c.triad_required_units, c.triad_completed_units, c.triad_due_units, c.triad_booked_units
  FROM calculated c;
$function$;

-- ---------------------------------------------------------------------------
-- 10. Goal ratings reference their goal
-- ---------------------------------------------------------------------------
-- Goals are archived, never deleted, by the app; RESTRICT keeps it that way.
-- An orphaned rating (its goal gone) stops the migration rather than being
-- deleted silently: resolve it by hand first.
DO $orphans$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM public.coachee_goal_ratings r
  LEFT JOIN public.coachee_goals g ON g.id = r.goal_id
  WHERE g.id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '% coachee_goal_ratings rows reference a missing goal; resolve them before 20261001110000', n;
  END IF;
END
$orphans$;

ALTER TABLE public.coachee_goal_ratings
  DROP CONSTRAINT IF EXISTS coachee_goal_ratings_goal_id_fkey,
  ADD CONSTRAINT coachee_goal_ratings_goal_id_fkey
    FOREIGN KEY (goal_id) REFERENCES public.coachee_goals(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- + Learner answers survive content edits
-- ---------------------------------------------------------------------------
-- assignment_submissions and daily_prompt_responses CASCADE from their
-- assignment / prompt, exactly the silent wipe 20261001100000 closed for
-- training weeks.
CREATE OR REPLACE FUNCTION public.guard_assignment_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.assignment_submissions s WHERE s.assignment_id = OLD.id) THEN
    RAISE EXCEPTION 'Cannot delete an assignment that has learner submissions'
      USING ERRCODE = '23503', HINT = 'Hide it (is_visible = false) instead.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS guard_assignment_delete ON public.assignments;
CREATE TRIGGER guard_assignment_delete
  BEFORE DELETE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_assignment_delete();

CREATE OR REPLACE FUNCTION public.guard_daily_prompt_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.daily_prompt_responses r WHERE r.daily_prompt_id = OLD.id) THEN
    RAISE EXCEPTION 'Cannot delete a daily prompt that has learner responses'
      USING ERRCODE = '23503', HINT = 'Hide it (is_visible = false) instead.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS guard_daily_prompt_delete ON public.daily_prompts;
CREATE TRIGGER guard_daily_prompt_delete
  BEFORE DELETE ON public.daily_prompts
  FOR EACH ROW EXECUTE FUNCTION public.guard_daily_prompt_delete();
