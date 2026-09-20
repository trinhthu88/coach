-- Programme Coaching eligibility moves to the cohort Coach pool
-- (Coaching redesign, deployment 1).
--
-- can_book_session() is the gate behind validate_coaching_session_cap() and
-- the "Sessions: coachee create own" RLS policy. As written it enforces the two
-- models section 41 explicitly forbids for programme Coaching:
--
--   * Coach eligibility from the learner-level allowlists
--     (coachee_coach_allowlist / coach_as_coachee_allowlist);
--   * Coaching quantity from a per-person cap
--     (programme_modules.config.receive_limit, falling back to
--     programmes.coachee_session_limit).
--
-- Until this is replaced the new architecture cannot function at all: a
-- correctly-formed cohort booking is rejected before it reaches any of the new
-- constraints. So it is superseded here, in deployment 1, rather than in the
-- held deployment 2 -- which only drops structures.
--
-- The signature is unchanged, so the RLS policy, the trigger and the frontend
-- RPC call sites keep working untouched.
--
-- Scope of the change, deliberately narrow:
--
--   PROGRAMME Coaching  (enrollment has a cohort that schedules Coaching)
--     -> cohort Coach pool decides WHO
--     -> cohort requirement count decides HOW MANY
--
--   everything else     (coach-as-coachee, cohort-less enrollments)
--     -> unchanged legacy allowlist + cap behaviour
--
-- Nothing is dropped. The allowlist tables keep their authority over the
-- relationships RULES.md section 3 documents.

CREATE OR REPLACE FUNCTION public.can_book_session(
  p_coachee_id uuid,
  p_coach_id uuid,
  p_enrollment_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  e public.programme_enrollments;
  cfg jsonb;
  receive_limit integer;
  legacy_limit integer;
  used_count integer;
  required_units integer;
  is_programme_coaching boolean;
BEGIN
  IF p_coachee_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN false;
  END IF;

  SELECT * INTO e FROM public.programme_enrollments
  WHERE id = p_enrollment_id AND user_id = p_coachee_id;
  IF NOT FOUND
     OR e.status NOT IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status) THEN
    RETURN false;
  END IF;

  cfg := public.enrollment_module_config(p_enrollment_id, 'coaching'::public.programme_module_type);
  IF cfg IS NULL OR (cfg->>'enabled') = 'false' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.programme_modules pm
      WHERE pm.programme_id = e.programme_id AND pm.module = 'coaching' AND pm.enabled
    ) THEN
      RETURN false;
    END IF;
  END IF;

  -- Is this programme Coaching? It is exactly when the enrollment's cohort
  -- schedules Coaching requirements. That is the same canonical object the
  -- Triad model uses, so no separate Coaching configuration decides it.
  is_programme_coaching := e.cohort_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cohort_requirement_dates d
    WHERE d.cohort_id = e.cohort_id
      AND d.programme_id = e.programme_id
      AND d.module = 'coaching'::public.programme_module_type
  );

  IF is_programme_coaching THEN
    -- WHO: the cohort Coach pool, not an allowlist.
    IF NOT EXISTS (
      SELECT 1 FROM public.cohort_coaching_coach_pool(e.cohort_id) p
      WHERE p.coach_id = p_coach_id
    ) THEN
      RETURN false;
    END IF;

    -- HOW MANY: the number of scheduled cohort requirements, not a per-person
    -- lifetime cap. A learner may hold at most one live-or-completed session
    -- per requirement, which the partial unique index already guarantees; this
    -- is the aggregate form of the same rule.
    SELECT count(*)::integer INTO required_units
    FROM public.cohort_requirement_dates d
    WHERE d.cohort_id = e.cohort_id
      AND d.programme_id = e.programme_id
      AND d.module = 'coaching'::public.programme_module_type;

    SELECT count(*)::integer INTO used_count
    FROM public.sessions s
    WHERE s.enrollment_id = p_enrollment_id
      AND s.status IN ('pending_coach_approval', 'confirmed', 'completed');

    RETURN used_count < required_units;
  END IF;

  -- ---- Legacy path, unchanged: not programme Coaching. ----
  IF public.has_role(p_coachee_id, 'coach'::public.app_role) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.coach_as_coachee_allowlist a
      WHERE a.coach_user_id = p_coachee_id AND a.selectable_coach_id = p_coach_id
    ) THEN
      RETURN false;
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.coachee_coach_allowlist a
      WHERE a.coachee_id = p_coachee_id AND a.coach_id = p_coach_id AND a.removed_at IS NULL
    ) THEN
      RETURN false;
    END IF;
  END IF;

  receive_limit := public.programme_config_integer(cfg, 'receive_limit');
  SELECT coachee_session_limit INTO legacy_limit FROM public.programmes WHERE id = e.programme_id;
  receive_limit := COALESCE(receive_limit, legacy_limit);

  SELECT count(*)::integer INTO used_count FROM public.sessions
  WHERE enrollment_id = p_enrollment_id AND coachee_id = p_coachee_id
    AND status IN ('pending_coach_approval', 'confirmed', 'completed');

  RETURN receive_limit IS NULL OR used_count < receive_limit;
END;
$function$;

COMMENT ON FUNCTION public.can_book_session(uuid, uuid, uuid) IS
  'Coaching booking eligibility. For programme Coaching (enrollment cohort '
  'schedules Coaching requirements) WHO comes from cohort_coach_assignments and '
  'HOW MANY from the cohort requirement count. Learner-level allowlists and '
  'per-person caps remain in force only for non-programme bookings.';
