-- Mentoring eligibility moves to the cohort mentor pool, and the preparation
-- document stops gating completion (Mentoring cutover).
--
-- Two changes, both narrow.
--
-- 1. can_book_mentoring_session_reason() already resolved the enrollment, the
--    enrollment's owner, its status, the mentoring module config and the
--    enrollment-specific received limit. Only the MENTOR check was
--    user-global: an EXISTS against mentoring_allowlist. That one clause is
--    replaced by the cohort mentor pool. Everything else is untouched, and the
--    signature is unchanged, so the RLS policy, the cap trigger and the
--    frontend pre-check all keep calling the same function.
--
-- 2. A Mentoring session could not be marked completed without a preparation
--    file. That made an optional artifact a hard precondition for recording
--    that a conversation happened -- the same conflation the Coaching cutover
--    removed between "the session took place" and "the paperwork exists".
--    The upload flow, storage security, mentor access, notes and timestamp all
--    remain; only the completion gate goes.

-- ---------------------------------------------------------------------------
-- 1. Cohort-scoped mentor eligibility
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_book_mentoring_session_reason(
  p_mentee_id uuid,
  p_mentor_id uuid,
  p_enrollment_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  e public.programme_enrollments;
  cfg jsonb;
  received_limit integer;
  received_used integer;
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

  -- WHO: the cohort mentor pool, which already requires an active mentor
  -- profile. The user-global mentoring_allowlist no longer decides this.
  IF e.cohort_id IS NULL THEN
    RETURN 'no_cohort';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cohort_mentoring_mentor_pool(e.cohort_id) p
    WHERE p.mentor_user_id = p_mentor_id
  ) THEN
    RETURN 'not_in_cohort_pool';
  END IF;

  SELECT limit_count, used_count INTO received_limit, received_used
  FROM public.get_mentoring_session_usage(p_enrollment_id);
  IF received_limit IS NOT NULL AND received_used >= received_limit THEN
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

COMMENT ON FUNCTION public.can_book_mentoring_session_reason(uuid, uuid, uuid) IS
  'Canonical Mentoring booking eligibility for one enrollment. WHO comes from '
  'cohort_mentors (via cohort_mentoring_mentor_pool, which also requires an '
  'active mentor profile); the user-global mentoring_allowlist is no longer '
  'consulted for programme Mentoring.';

-- The two-argument variants predate enrollment scoping. They cannot answer
-- "which enrollment?" and so cannot apply the cohort rule; they are marked
-- retired rather than dropped, because dropping them would break the RLS
-- policies and call sites that still reference them until those migrate.
COMMENT ON FUNCTION public.can_book_mentoring_session_reason(uuid, uuid) IS
  'RETIRED for programme Mentoring: not enrollment-aware, so it cannot apply '
  'the cohort mentor pool. Use the three-argument form. Retained only until '
  'every caller has migrated.';
COMMENT ON FUNCTION public.can_book_mentoring_session(uuid, uuid) IS
  'RETIRED for programme Mentoring: see can_book_mentoring_session_reason(uuid, uuid).';

-- ---------------------------------------------------------------------------
-- 2. The preparation document is optional
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_mentoring_sessions_prep_gate ON public.mentoring_sessions;

COMMENT ON FUNCTION public.enforce_mentoring_prep_file_before_completion() IS
  'RETIRED 2026-09-20 (Mentoring cutover). Blocked completion when no '
  'preparation file existed, making an optional artifact a precondition for '
  'recording that the session happened. No trigger calls it; retained for '
  'historical compatibility only.';

-- The feedback guard has the same defect for the same reason: a mentor could
-- not record feedback on a session that legitimately had no prep document.
DROP TRIGGER IF EXISTS trg_mentoring_feedback_requires_prep_file ON public.mentoring_feedback;
DROP TRIGGER IF EXISTS trg_mentoring_feedback_prep_gate ON public.mentoring_feedback;

COMMENT ON FUNCTION public.enforce_mentoring_feedback_requires_prep_file() IS
  'RETIRED 2026-09-20 (Mentoring cutover). Required a preparation file before '
  'mentor feedback could be recorded. The preparation document is optional and '
  'is not evidence of anything. Retained for historical compatibility only.';

-- ---------------------------------------------------------------------------
-- 3. Server-enforced cohort membership on the session itself (section 20)
-- ---------------------------------------------------------------------------
--
-- The cap trigger validates entitlement; this validates WHO. Enforced on the
-- table so a direct INSERT cannot bypass the booking path.

CREATE OR REPLACE FUNCTION public.validate_mentoring_session_cohort_mentor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cohort uuid;
BEGIN
  SELECT e.cohort_id INTO v_cohort
  FROM public.programme_enrollments e WHERE e.id = NEW.enrollment_id;

  -- Only newly-created bookings, a mentor reassignment, or a revival back into
  -- a live state are gated. Updating an already-live session that predates the
  -- pool -- cancelling it, completing it, adding notes -- must not be blocked,
  -- or this migration would freeze the 9 confirmed sessions that exist when it
  -- runs. Those are grandfathered by the backfill in 20260920200000.
  IF v_cohort IS NOT NULL
     AND NEW.status IN ('pending_coach_approval', 'confirmed')
     AND (
       TG_OP = 'INSERT'
       OR NEW.mentor_id IS DISTINCT FROM OLD.mentor_id
       OR OLD.status NOT IN ('pending_coach_approval', 'confirmed')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.cohort_mentoring_mentor_pool(v_cohort) p
       WHERE p.mentor_user_id = NEW.mentor_id
     ) THEN
    RAISE EXCEPTION 'Mentor % is not in the mentor pool for cohort %', NEW.mentor_id, v_cohort
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER mentoring_sessions_validate_cohort_mentor
  BEFORE INSERT OR UPDATE ON public.mentoring_sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_mentoring_session_cohort_mentor();
