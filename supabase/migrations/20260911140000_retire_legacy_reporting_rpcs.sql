-- Retire the pre-enrollment sponsor reporting surface.
--
-- The application now reads sponsor_enrollment_summaries(), the
-- cohort-scoped sponsor_cohort_summaries(), and
-- sponsor_organisation_summary().  There are no remaining callers for the
-- person/programme-scoped RPCs below.  Keep the historical migrations intact
-- (they document the fixes that were made), but remove their callable
-- production surface in a replay-safe migration.

-- The old visibility helper is also referenced by two RLS policies.  Inline
-- its enrollment/org predicate before dropping it so policy behavior does not
-- change and PostgreSQL has no dependent policy blocking the retirement.
DROP POLICY IF EXISTS "Profiles: sponsor view org members" ON public.profiles;
CREATE POLICY "Profiles: sponsor view org members" ON public.profiles
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.programme_enrollments pe
    LEFT JOIN public.cohorts c ON c.id = pe.cohort_id
    WHERE pe.user_id = profiles.id
      AND COALESCE(pe.organization_id, c.organization_id) IS NOT NULL
      AND COALESCE(pe.organization_id, c.organization_id) = public.get_sponsor_org(auth.uid())
  ));

DROP POLICY IF EXISTS "Coachee profiles: sponsor view org members" ON public.coachee_profiles;
CREATE POLICY "Coachee profiles: sponsor view org members" ON public.coachee_profiles
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.programme_enrollments pe
    LEFT JOIN public.cohorts c ON c.id = pe.cohort_id
    WHERE pe.user_id = coachee_profiles.id
      AND COALESCE(pe.organization_id, c.organization_id) IS NOT NULL
      AND COALESCE(pe.organization_id, c.organization_id) = public.get_sponsor_org(auth.uid())
  ));

DROP FUNCTION IF EXISTS public.sponsor_can_view_coachee(uuid);
-- Remove the zero-argument overloads left behind by the original aggregate
-- migration as well.  The UUID forms were replaced by the cohort RPCs, while
-- sponsor_satisfaction_summary(uuid) is the one enrollment-aware exception.
DROP FUNCTION IF EXISTS public.sponsor_roster();
DROP FUNCTION IF EXISTS public.sponsor_goal_growth_summary();
DROP FUNCTION IF EXISTS public.sponsor_satisfaction_summary();
DROP FUNCTION IF EXISTS public.sponsor_kpis();
DROP FUNCTION IF EXISTS public.sponsor_timeline();
DROP FUNCTION IF EXISTS public.sponsor_confidence_trend();
DROP FUNCTION IF EXISTS public.sponsor_engagement_red_flags(uuid);
DROP FUNCTION IF EXISTS public.sponsor_engagement_red_flags();
DROP FUNCTION IF EXISTS public.sponsor_goal_growth_summary(uuid);
DROP FUNCTION IF EXISTS public.sponsor_kpis(uuid);
DROP FUNCTION IF EXISTS public.sponsor_programme_engagement(uuid);
DROP FUNCTION IF EXISTS public.sponsor_programme_engagement();
DROP FUNCTION IF EXISTS public.sponsor_roster(uuid);
DROP FUNCTION IF EXISTS public.sponsor_satisfaction_trend(uuid);
DROP FUNCTION IF EXISTS public.sponsor_satisfaction_trend();
DROP FUNCTION IF EXISTS public.sponsor_coach_utilisation(uuid);
DROP FUNCTION IF EXISTS public.sponsor_coach_utilisation();
DROP FUNCTION IF EXISTS public.sponsor_timeline();

-- sponsor_satisfaction_summary(uuid) is intentionally retained: the latest
-- enrollment_sponsor_reporting migration replaced it with an
-- enrollment-aware, threshold-suppressed implementation and its callers and
-- contract tests still use it.

-- The old coach-programme re-evaluation trigger was the last live reader of
-- coach_programmes/coach_programme_enrollments.  Programme/module config is
-- now the source of truth, so remove the trigger before revoking table access.
DROP TRIGGER IF EXISTS trg_reevaluate_coach_limits_on_enrollment_change
  ON public.coach_programme_enrollments;
DROP TRIGGER IF EXISTS trg_reevaluate_coach_limits_on_programme_change
  ON public.coach_programmes;
DROP TRIGGER IF EXISTS trg_reevaluate_coach_limits_on_change
  ON public.coach_session_limits;
DROP FUNCTION IF EXISTS public.reevaluate_coach_limits_on_change();

-- Peer usage is still called by BookSession, but it now resolves the active
-- learner enrollment and peer_coaching module configuration.  NULL remains
-- the explicit unlimited value; sessions from another enrollment do not count.
CREATE OR REPLACE FUNCTION public.get_coach_peer_session_usage(_coach_id uuid)
RETURNS TABLE(peer_monthly_limit integer, used_this_month integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH active AS (
    SELECT pe.id, NULLIF(pm.config->>'monthly_limit', '')::integer AS module_limit
    FROM public.programme_enrollments pe
    JOIN public.programme_modules pm
      ON pm.programme_id = pe.programme_id
     AND pm.module = 'peer_coaching'::public.programme_module_type
     AND pm.enabled
    WHERE pe.user_id = _coach_id
      AND pe.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
  ),
  usage AS (
    SELECT count(*)::integer AS n
    FROM public.peer_sessions ps
    JOIN active a ON a.id = ps.enrollment_id
    WHERE ps.peer_coachee_id = _coach_id
      AND ps.status IN ('pending_coach_approval', 'confirmed', 'completed')
  )
  SELECT CASE WHEN bool_or(a.module_limit IS NULL) THEN NULL
              ELSE sum(a.module_limit)::integer END,
         (SELECT n FROM usage)
  FROM active a;
$$;

-- Completion-time enforcement remains a trigger on sessions/peer_sessions,
-- but is enrollment-scoped and reads only programme_modules.
CREATE OR REPLACE FUNCTION public.enforce_coach_as_coachee_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_enrollment_id uuid := COALESCE(NEW.enrollment_id, OLD.enrollment_id);
  learner_id uuid;
  module_name public.programme_module_type;
  module_config jsonb;
  limit_count integer;
  used_count integer;
BEGIN
  IF TG_TABLE_NAME = 'sessions' THEN
    learner_id := COALESCE(NEW.coachee_id, OLD.coachee_id);
    module_name := 'coaching'::public.programme_module_type;
  ELSE
    learner_id := COALESCE(NEW.peer_coachee_id, OLD.peer_coachee_id);
    module_name := 'peer_coaching'::public.programme_module_type;
  END IF;
  IF v_enrollment_id IS NULL OR learner_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT pm.config INTO module_config
  FROM public.programme_enrollments pe
  JOIN public.programme_modules pm
    ON pm.programme_id = pe.programme_id
   AND pm.module = module_name AND pm.enabled
  WHERE pe.id = v_enrollment_id AND pe.user_id = learner_id
    AND pe.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status);
  IF NOT FOUND THEN RETURN COALESCE(NEW, OLD); END IF;

  limit_count := NULLIF(module_config->>CASE WHEN module_name = 'coaching'::public.programme_module_type
                                             THEN 'receive_limit' ELSE 'monthly_limit' END, '')::integer;
  IF TG_TABLE_NAME = 'sessions' THEN
    SELECT count(*)::integer INTO used_count FROM public.sessions s
    WHERE s.enrollment_id = v_enrollment_id AND s.coachee_id = learner_id AND s.status = 'completed';
  ELSE
    SELECT count(*)::integer INTO used_count FROM public.peer_sessions ps
    WHERE ps.enrollment_id = v_enrollment_id
      AND ps.peer_coachee_id = learner_id AND ps.status = 'completed';
  END IF;
  IF limit_count IS NOT NULL AND used_count >= limit_count THEN
    RAISE EXCEPTION 'Programme enrollment session limit reached' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Mentoring limits are likewise derived from the learner's active programme
-- enrollment(s), not the retired coach-programme tables.
CREATE OR REPLACE FUNCTION public.get_mentoring_received_limit(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result integer;
BEGIN
  SELECT CASE WHEN bool_or(NULLIF(pm.config->>'receive_limit', '') IS NULL)
              THEN NULL ELSE sum(NULLIF(pm.config->>'receive_limit', '')::integer)::integer END
    INTO result
  FROM public.programme_enrollments pe
  JOIN public.programme_modules pm
    ON pm.programme_id = pe.programme_id
   AND pm.module = 'mentoring'::public.programme_module_type AND pm.enabled
  WHERE pe.user_id = p_user_id
    AND pe.status = 'active'::public.enrollment_status;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_mentoring_given_limit(p_mentor_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN bool_or(NULLIF(pm.config->>'give_limit', '') IS NULL)
              THEN NULL ELSE sum(NULLIF(pm.config->>'give_limit', '')::integer)::integer END
  FROM public.programme_enrollments pe
  JOIN public.programme_modules pm
    ON pm.programme_id = pe.programme_id
   AND pm.module = 'mentoring'::public.programme_module_type AND pm.enabled
  WHERE pe.user_id = p_mentor_id
    AND pe.status = 'active'::public.enrollment_status;
$$;

-- No application role should inspect the retired compatibility tables.  Keep
-- the tables/columns for audit and a future final-enforcement migration.
REVOKE ALL ON TABLE public.coach_programmes, public.coach_programme_enrollments
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_mentoring_session_usage(p_user_id uuid)
RETURNS TABLE(limit_count integer, used_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.get_mentoring_received_limit(p_user_id),
         (SELECT count(*)::integer
          FROM public.mentoring_sessions ms
          JOIN public.programme_enrollments pe ON pe.id = ms.enrollment_id
          WHERE pe.user_id = p_user_id
            AND pe.status = 'active'::public.enrollment_status
            AND ms.status IN ('pending_coach_approval', 'confirmed', 'completed'));
$$;

CREATE OR REPLACE FUNCTION public.get_mentoring_given_usage(p_mentor_id uuid)
RETURNS TABLE(limit_count integer, used_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.get_mentoring_given_limit(p_mentor_id),
         (SELECT count(*)::integer
          FROM public.mentoring_sessions ms
          JOIN public.programme_enrollments pe ON pe.id = ms.enrollment_id
          WHERE pe.user_id = p_mentor_id
            AND pe.status = 'active'::public.enrollment_status
            AND ms.status IN ('pending_coach_approval', 'confirmed', 'completed'));
$$;