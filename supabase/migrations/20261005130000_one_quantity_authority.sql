-- One quantity authority (L-1, D-1, L-2, D-7, L-4, L-15, P-5, P-12, A-10).
--
-- How many units a module requires has ONE answer: programme_modules.config
-- (required, required_units), materialised per cohort as cohort_requirement_dates
-- and counted by canonical_module_progress. Before this, enrollment_module_config
-- preferred the enrollment-time snapshot (enrollment_module_snapshots.config), so
-- raising Coaching from 2 to 3 units gave the learner 3 requirements and 3 in
-- learner_canonical_progress, but programme_required_units -- and with it
-- booking eligibility -- still answered 2.
--
-- 1. enrollment_module_config, programme_required_units and
--    get_enrollment_programme_modules read programme_modules.config only.
-- 2. enrollment_module_snapshots.config is historical: the capture trigger is
--    dropped and nothing reads the column for a current answer.
-- 3. Booking eligibility is
--      a free requirement (next_*_requirement IS NOT NULL)
--      + the Coach / Mentor is in the cohort pool
--      + the goal gate (enrollment_goal_gate_blocked).
--    can_book_session loses its legacy allowlist path (receive_limit,
--    programmes.coachee_session_limit) and its own session count;
--    can_book_mentoring_session_reason loses the Mentor give_limit and its own
--    session count. Neither is a programme requirement.

-- ---------------------------------------------------------------------------
-- 1. The programme template is the only config
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enrollment_module_config(p_enrollment_id uuid, p_module public.programme_module_type)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(pm.config, '{}'::jsonb)
  FROM public.programme_enrollments e
  LEFT JOIN public.programme_modules pm
    ON pm.programme_id = e.programme_id
   AND pm.module = p_module
   AND pm.enabled
  WHERE e.id = p_enrollment_id;
$$;

CREATE OR REPLACE FUNCTION public.programme_required_units(p_enrollment_id uuid, p_module public.programme_module_type)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN COALESCE((pm.config->>'required')::boolean, false)
        THEN COALESCE(public.programme_config_integer(pm.config, 'required_units'), 0)
      ELSE 0
    END
    FROM public.programme_enrollments e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.module = p_module
     AND pm.enabled
    WHERE e.id = p_enrollment_id
  ), 0);
$$;

CREATE OR REPLACE FUNCTION public.get_enrollment_programme_modules(p_enrollment_id uuid)
RETURNS TABLE (module public.programme_module_type, enabled boolean, config jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH modules AS (
    SELECT pm.module, COALESCE(pm.config, '{}'::jsonb) - 'distribution_mode' AS config
    FROM public.programme_enrollments e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.enabled
    WHERE e.id = p_enrollment_id
      AND (e.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
  )
  SELECT m.module, true,
    CASE
      WHEN NOT (m.config ? 'receive')
       AND COALESCE((m.config->>'required')::boolean, false)
       AND COALESCE(public.programme_config_integer(m.config, 'required_units'), 0) > 0
        THEN m.config || jsonb_build_object('receive', true)
      ELSE m.config
    END
  FROM modules m
  ORDER BY m.module;
$$;

-- ---------------------------------------------------------------------------
-- 2. Snapshots are historical
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS enrollment_module_snapshot_capture_config ON public.enrollment_module_snapshots;
DROP FUNCTION IF EXISTS public.capture_enrollment_module_config();
COMMENT ON COLUMN public.enrollment_module_snapshots.config IS
  'HISTORICAL. The programme config at enrollment time, captured until 20261005130000. Never a current requirement: read programme_modules.config.';

-- ---------------------------------------------------------------------------
-- 3. Eligibility = free requirement + pool + goal gate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_book_session(p_coachee_id uuid, p_coach_id uuid, p_enrollment_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE e public.programme_enrollments;
BEGIN
  IF p_coachee_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN false;
  END IF;

  SELECT * INTO e FROM public.programme_enrollments
  WHERE id = p_enrollment_id AND user_id = p_coachee_id;
  IF NOT FOUND
     OR e.status NOT IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
     OR e.cohort_id IS NULL THEN
    RETURN false;
  END IF;

  -- Never book into a cohort whose schedule does not match its programme.
  IF public.enrollment_schedule_violation(p_enrollment_id, 'coaching'::public.programme_module_type) IS NOT NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.next_coaching_requirement(p_enrollment_id)) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cohort_coaching_coach_pool(e.cohort_id) p WHERE p.coach_id = p_coach_id) THEN
    RETURN false;
  END IF;

  RETURN NOT public.enrollment_goal_gate_blocked(p_enrollment_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.can_book_mentoring_session_reason(p_mentee_id uuid, p_mentor_id uuid, p_enrollment_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE e public.programme_enrollments;
BEGIN
  IF p_mentee_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN 'forbidden';
  END IF;

  SELECT * INTO e FROM public.programme_enrollments
  WHERE id = p_enrollment_id AND user_id = p_mentee_id;
  IF NOT FOUND
     OR e.status NOT IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status) THEN
    RETURN 'inactive';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.programme_modules pm
    WHERE pm.programme_id = e.programme_id AND pm.module = 'mentoring' AND pm.enabled
  ) THEN
    RETURN 'module_access';
  END IF;

  IF e.cohort_id IS NULL THEN
    RETURN 'no_cohort';
  END IF;

  IF public.enrollment_schedule_violation(p_enrollment_id, 'mentoring'::public.programme_module_type) IS NOT NULL THEN
    RETURN 'cohort_schedule_invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cohort_mentoring_mentor_pool(e.cohort_id) p WHERE p.mentor_user_id = p_mentor_id
  ) THEN
    RETURN 'not_in_cohort_pool';
  END IF;

  IF public.programme_required_units(p_enrollment_id, 'mentoring'::public.programme_module_type) = 0 THEN
    RETURN 'no_mentoring_requirement';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.next_mentoring_requirement(p_enrollment_id)) THEN
    RETURN 'received_limit_reached';
  END IF;

  IF public.enrollment_goal_gate_blocked(p_enrollment_id) THEN
    RETURN 'goal_required_before_booking';
  END IF;

  RETURN 'ok';
END;
$$;

-- The goal gate is part of the reason itself now; the wrapper only binds the
-- caller.
CREATE OR REPLACE FUNCTION public.check_can_book_mentoring_session_reason_for_enrollment(p_mentor_id uuid, p_enrollment_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Reports 'goal_required_before_booking' when the goal gate blocks.
  SELECT public.can_book_mentoring_session_reason(auth.uid(), p_mentor_id, p_enrollment_id);
$$;

-- ---------------------------------------------------------------------------
-- 4. Final-state guard
-- ---------------------------------------------------------------------------
DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'enrollment_module_snapshot_capture_config') THEN
    RAISE EXCEPTION 'enrollment_module_snapshots config capture trigger still exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('enrollment_module_config', 'programme_required_units', 'get_enrollment_programme_modules',
                        'can_book_session', 'can_book_mentoring_session_reason')
      AND p.prosrc ~ '(enrollment_module_snapshots|receive_limit|coachee_session_limit|give_limit)'
  ) THEN
    RAISE EXCEPTION 'A quantity or eligibility function still reads a snapshot or a session limit';
  END IF;
END
$verify$;
