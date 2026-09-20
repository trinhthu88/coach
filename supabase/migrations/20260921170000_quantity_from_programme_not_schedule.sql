-- Quantity comes from the PROGRAMME, not from how much of it has been
-- scheduled yet (found by running the seed against the replayed chain).
--
-- 20260921140000 replaced the per-person allowances with "the number of cohort
-- requirement rows". That is the right authority one step too late:
-- cohort_requirement_dates is the MATERIALISATION of
-- programme_modules.config.required_units, not its source, and
-- materialize_missing_cohort_requirement_dates() returns 0 rows for a cohort
-- whose start_date or end_date is NULL. A cohort whose schedule had not been
-- materialised therefore reported "0 required" and refused every Mentoring
-- booking outright -- which the demo seed hit immediately.
--
-- Coaching never showed this because its is_programme_coaching branch only
-- engages when requirement rows exist, so an unmaterialised cohort quietly
-- fell through to the legacy allowlist path. Mentoring has no legacy path
-- left, so the same gap became a hard block.
--
-- required_units is read directly, with the materialised row count as the
-- fallback for a cohort scheduled ad hoc without a programme template. Both
-- are the same authority; neither is a per-person entitlement.

CREATE OR REPLACE FUNCTION public.programme_required_units(
  p_enrollment_id uuid,
  p_module public.programme_module_type
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT GREATEST(
    coalesce(
      public.programme_config_integer(
        public.enrollment_module_config(p_enrollment_id, p_module), 'required_units'),
      0),
    coalesce((
      SELECT count(*)::integer
      FROM public.cohort_requirement_dates d
      JOIN public.programme_enrollments e ON e.id = p_enrollment_id
      WHERE d.cohort_id = e.cohort_id
        AND d.programme_id = e.programme_id
        AND d.module = p_module
    ), 0)
  );
$$;

REVOKE ALL ON FUNCTION public.programme_required_units(uuid, public.programme_module_type) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.programme_required_units(uuid, public.programme_module_type) TO authenticated;

COMMENT ON FUNCTION public.programme_required_units(uuid, public.programme_module_type) IS
  'THE quantity authority for a module: programme_modules.config.required_units, '
  'with the materialised cohort requirement count as the floor for cohorts '
  'scheduled without a programme template. Never a per-person entitlement.';

-- Mentoring eligibility uses it.
CREATE OR REPLACE FUNCTION public.can_book_mentoring_session_reason(
  p_mentee_id uuid, p_mentor_id uuid, p_enrollment_id uuid
)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  e public.programme_enrollments;
  cfg jsonb;
  required_units integer;
  used_count integer;
  mentor_enrollment uuid;
  given_limit integer;
  given_used integer;
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

  cfg := public.enrollment_module_config(p_enrollment_id, 'mentoring'::public.programme_module_type);
  IF cfg IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.programme_modules pm
    WHERE pm.programme_id = e.programme_id AND pm.module = 'mentoring' AND pm.enabled
  ) THEN
    RETURN 'module_access';
  END IF;

  IF e.cohort_id IS NULL THEN
    RETURN 'no_cohort';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cohort_mentoring_mentor_pool(e.cohort_id) p
    WHERE p.mentor_user_id = p_mentor_id
  ) THEN
    RETURN 'not_in_cohort_pool';
  END IF;

  required_units := public.programme_required_units(
    p_enrollment_id, 'mentoring'::public.programme_module_type);
  IF required_units = 0 THEN
    RETURN 'no_mentoring_requirement';
  END IF;

  SELECT count(*)::integer INTO used_count
  FROM public.mentoring_sessions s
  WHERE s.enrollment_id = p_enrollment_id
    AND s.status IN ('pending_coach_approval', 'confirmed', 'completed');

  IF used_count >= required_units THEN
    RETURN 'received_limit_reached';
  END IF;

  SELECT id INTO mentor_enrollment FROM public.programme_enrollments
  WHERE user_id = p_mentor_id
    AND status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
  LIMIT 1;
  IF mentor_enrollment IS NOT NULL THEN
    given_limit := public.programme_config_integer(
      public.enrollment_module_config(mentor_enrollment, 'mentoring'::public.programme_module_type),
      'give_limit');
  END IF;
  IF mentor_enrollment IS NULL OR given_limit IS NULL THEN
    given_limit := public.get_mentoring_given_limit(p_mentor_id);
  END IF;
  SELECT count(*)::integer INTO given_used FROM public.mentoring_sessions
  WHERE mentor_id = p_mentor_id
    AND status IN ('pending_coach_approval', 'confirmed', 'completed');
  IF given_limit IS NOT NULL AND given_used >= given_limit THEN
    RETURN 'given_limit_reached';
  END IF;

  RETURN 'ok';
END;
$function$;

DO $$
BEGIN
  IF pg_get_functiondef('public.can_book_mentoring_session_reason(uuid,uuid,uuid)'::regprocedure)
       !~ 'programme_required_units' THEN
    RAISE EXCEPTION 'Quantity: Mentoring eligibility does not read the programme requirement';
  END IF;
  IF pg_get_functiondef('public.can_book_mentoring_session_reason(uuid,uuid,uuid)'::regprocedure)
       LIKE '%receive_limit%' THEN
    RAISE EXCEPTION 'Quantity: Mentoring eligibility still reads receive_limit';
  END IF;
END $$;
