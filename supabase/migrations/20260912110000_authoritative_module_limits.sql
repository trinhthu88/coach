-- Authoritative module rules for new writes.
--
-- This migration is additive. Existing enrollment snapshots are never
-- rewritten, and legacy programme columns/functions remain available as
-- compatibility fallbacks for historical records.

ALTER TABLE public.enrollment_module_snapshots
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.enrollment_module_config(
  p_enrollment_id uuid,
  p_module public.programme_module_type
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(ms.config, '{}'::jsonb),
    pm.config,
    '{}'::jsonb
  )
  FROM public.programme_enrollments e
  LEFT JOIN public.enrollment_module_snapshots ms
    ON ms.enrollment_id = e.id AND ms.module = p_module
  LEFT JOIN public.programme_modules pm
    ON pm.programme_id = e.programme_id
   AND pm.module = p_module
   AND pm.enabled
  WHERE e.id = p_enrollment_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.enrollment_module_config(uuid, public.programme_module_type)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_enrollment_programme_modules(p_enrollment_id uuid)
RETURNS TABLE (
  module public.programme_module_type,
  enabled boolean,
  config jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ms.module, true,
    COALESCE(ms.config, '{}'::jsonb) || jsonb_build_object(
      'required', ms.required,
      'required_units', ms.required_units,
      'distribution_mode', ms.distribution_mode,
      'distribution_settings', ms.distribution_settings,
      'weight', ms.weight
    )
  FROM public.enrollment_module_snapshots ms
  JOIN public.programme_enrollments pe ON pe.id = ms.enrollment_id
  WHERE ms.enrollment_id = p_enrollment_id
    AND pe.user_id = auth.uid()
  UNION ALL
  SELECT pm.module, pm.enabled, pm.config
  FROM public.programme_enrollments pe
  JOIN public.programme_modules pm ON pm.programme_id = pe.programme_id
  WHERE pe.id = p_enrollment_id
    AND pe.user_id = auth.uid()
    AND pm.enabled = true
    AND NOT EXISTS (
      SELECT 1 FROM public.enrollment_module_snapshots ms
      WHERE ms.enrollment_id = pe.id
    );
$$;

REVOKE EXECUTE ON FUNCTION public.get_enrollment_programme_modules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_programme_modules(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.capture_enrollment_module_config()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.config = '{}'::jsonb THEN
    SELECT pm.config
      INTO NEW.config
    FROM public.programme_modules pm
    WHERE pm.id = NEW.programme_module_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enrollment_module_snapshot_capture_config
  ON public.enrollment_module_snapshots;
CREATE TRIGGER enrollment_module_snapshot_capture_config
  BEFORE INSERT ON public.enrollment_module_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.capture_enrollment_module_config();

CREATE OR REPLACE FUNCTION public.programme_config_integer(
  p_config jsonb,
  p_key text
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  value_text text := p_config->>p_key;
BEGIN
  IF value_text IS NULL OR value_text = '' THEN
    RETURN NULL;
  END IF;
  IF value_text !~ '^[0-9]+$' THEN
    RAISE EXCEPTION '% must be a non-negative integer', p_key USING ERRCODE = '22023';
  END IF;
  RETURN value_text::integer;
EXCEPTION
  WHEN numeric_value_out_of_range THEN
    RAISE EXCEPTION '% is outside the supported integer range', p_key USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_programme_module_config()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  required_units integer;
  required_flag boolean;
  give_limit integer;
  receive_limit integer;
  legacy_limit integer;
  triad_limit integer;
BEGIN
  required_units := COALESCE(public.programme_config_integer(NEW.config, 'required_units'), 0);
  required_flag := COALESCE((NEW.config->>'required')::boolean, false);

  IF required_flag AND required_units = 0 THEN
    RAISE EXCEPTION 'Required modules must have at least one required unit' USING ERRCODE = '22023';
  END IF;

  IF NEW.module IN ('coaching'::public.programme_module_type,
                    'mentoring'::public.programme_module_type) THEN
    give_limit := public.programme_config_integer(NEW.config, 'give_limit');
    receive_limit := public.programme_config_integer(NEW.config, 'receive_limit');
    IF COALESCE((NEW.config->>'give')::boolean, false)
       AND give_limit IS NOT NULL AND required_units > give_limit THEN
      RAISE EXCEPTION 'Required target cannot exceed the maximum sessions given' USING ERRCODE = '22023';
    END IF;
    IF COALESCE((NEW.config->>'receive')::boolean, false)
       AND receive_limit IS NOT NULL AND required_units > receive_limit THEN
      RAISE EXCEPTION 'Required target cannot exceed the maximum sessions received' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.module = 'peer_coaching'::public.programme_module_type THEN
    give_limit := public.programme_config_integer(NEW.config, 'give_limit');
    receive_limit := public.programme_config_integer(NEW.config, 'receive_limit');
    legacy_limit := public.programme_config_integer(NEW.config, 'monthly_limit');
    IF give_limit IS NULL THEN give_limit := legacy_limit; END IF;
    IF receive_limit IS NULL THEN receive_limit := legacy_limit; END IF;
    IF COALESCE((NEW.config->>'give')::boolean, false)
       AND give_limit IS NOT NULL AND required_units > give_limit THEN
      RAISE EXCEPTION 'Required target cannot exceed the maximum peer sessions given' USING ERRCODE = '22023';
    END IF;
    IF COALESCE((NEW.config->>'receive')::boolean, false)
       AND receive_limit IS NOT NULL AND required_units > receive_limit THEN
      RAISE EXCEPTION 'Required target cannot exceed the maximum peer sessions received' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.module = 'triads'::public.programme_module_type THEN
    triad_limit := public.programme_config_integer(NEW.config, 'max_triads');
    IF triad_limit IS NOT NULL AND required_units > triad_limit THEN
      RAISE EXCEPTION 'Required target cannot exceed the maximum triad sessions per participant' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS programme_modules_validate_config ON public.programme_modules;
CREATE TRIGGER programme_modules_validate_config
  BEFORE INSERT OR UPDATE OF config, enabled, module
  ON public.programme_modules
  FOR EACH ROW EXECUTE FUNCTION public.validate_programme_module_config();

-- Optional modules remain enabled and available, but never create required
-- progress obligations. Existing snapshots remain immutable; filtering here
-- changes only the authoritative progress view.
CREATE OR REPLACE FUNCTION public.get_enrollment_progress(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE(module public.programme_module_type, full_completion_pct numeric,
  due_adherence_pct numeric, pace_status text, completed_units integer,
  due_units integer, required_units integer, booked_units integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH enrollment AS (
    SELECT e.*, c.organization_id AS cohort_organization_id
    FROM public.programme_enrollments e
    LEFT JOIN public.cohorts c ON c.id = e.cohort_id
    WHERE e.id = p_enrollment_id
  ), authorized AS (
    SELECT 1
    FROM enrollment e
    WHERE e.user_id = auth.uid()
       OR public.has_role(auth.uid(),'admin'::public.app_role)
       OR public.coach_has_client(auth.uid(),e.user_id)
       OR EXISTS (
         SELECT 1 FROM public.sponsor_profiles sp
         WHERE sp.user_id = auth.uid()
           AND sp.organization_id = e.cohort_organization_id
           AND (SELECT count(*) FROM public.programme_enrollments ec
                LEFT JOIN public.cohorts ec_c ON ec_c.id = ec.cohort_id
                WHERE ec.cohort_id = e.cohort_id
                  AND ec_c.organization_id = sp.organization_id)
               >= public.sponsor_min_leaders_for_distribution()
       )
  ), snapshots AS (
    SELECT s.* FROM public.enrollment_module_snapshots s
    JOIN authorized ON true
    WHERE s.enrollment_id = p_enrollment_id
      AND s.required = true
  ), activity AS (
    SELECT 'coaching'::public.programme_module_type module,enrollment_id,status::text,start_time::date occurred_on FROM public.sessions
    UNION ALL SELECT 'peer_coaching',enrollment_id,status::text,start_time::date FROM public.peer_sessions
    UNION ALL SELECT 'peer_coaching',enrollment_id,status::text,start_time::date FROM public.coachee_peer_sessions
    UNION ALL SELECT 'mentoring',enrollment_id,status::text,start_time::date FROM public.mentoring_sessions
    UNION ALL SELECT 'triads',coach_enrollment_id,status::text,coalesce(start_time,proposed_start_time)::date FROM public.triad_sessions WHERE coach_enrollment_id IS NOT NULL
    UNION ALL SELECT 'triads',coachee_enrollment_id,status::text,coalesce(start_time,proposed_start_time)::date FROM public.triad_sessions WHERE coachee_enrollment_id IS NOT NULL
    UNION ALL SELECT 'triads',observer_enrollment_id,status::text,coalesce(start_time,proposed_start_time)::date FROM public.triad_sessions WHERE observer_enrollment_id IS NOT NULL
    UNION ALL SELECT 'training',enrollment_id,'completed',completed_at::date FROM public.training_progress WHERE completed_at IS NOT NULL
    UNION ALL SELECT 'quiz',sub.enrollment_id,'completed',sub.submitted_at::date
      FROM public.assignment_submissions sub
      JOIN public.assignments a ON a.id=sub.assignment_id
      WHERE sub.enrollment_id IS NOT NULL AND a.assignment_type='quiz'::public.assignment_type
    UNION ALL SELECT 'daily_prompt',enrollment_id,'completed',responded_at::date
      FROM public.daily_prompt_responses
      WHERE enrollment_id IS NOT NULL AND responded_at IS NOT NULL
  ), counts AS (
    SELECT s.id,
      count(a.*) FILTER (WHERE a.status='completed' AND a.occurred_on<=p_as_of)::integer completed,
      least(
        count(a.*) FILTER (WHERE a.status IN ('pending_coach_approval','confirmed') AND a.occurred_on>=p_as_of),
        greatest(s.required_units-count(a.*) FILTER (WHERE a.status='completed' AND a.occurred_on<=p_as_of),0)
      )::integer booked
    FROM snapshots s
    LEFT JOIN activity a ON a.enrollment_id=s.enrollment_id AND a.module=s.module
    GROUP BY s.id, s.required_units
  ), due AS (
    SELECT s.id,
      coalesce(sum(m.required_units) FILTER (WHERE m.due_on<=p_as_of),0)::integer units_due
    FROM snapshots s
    LEFT JOIN public.enrollment_module_milestones m ON m.enrollment_module_snapshot_id=s.id
    GROUP BY s.id
  )
  SELECT s.module,
    CASE WHEN s.required_units=0 THEN NULL ELSE round(least(c.completed,s.required_units)*100.0/s.required_units,1) END,
    CASE WHEN d.units_due=0 THEN NULL ELSE round(least(c.completed,d.units_due)*100.0/d.units_due,1) END,
    CASE WHEN s.required_units=0 OR c.completed>=s.required_units THEN 'completed'
      WHEN d.units_due=0 THEN 'not_yet_due'
      WHEN c.completed>=d.units_due THEN CASE WHEN c.completed>d.units_due THEN 'ahead' ELSE 'on_track' END
      WHEN c.completed+c.booked>=d.units_due THEN 'scheduled' ELSE 'behind' END,
    c.completed,d.units_due,s.required_units,c.booked
  FROM snapshots s JOIN counts c ON c.id=s.id JOIN due d ON d.id=s.id;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_enrollment_progress(
  p_enrollment_ids uuid[],
  p_as_of date DEFAULT current_date
)
RETURNS TABLE(enrollment_id uuid, full_completion_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH requested AS (
    SELECT DISTINCT unnest(p_enrollment_ids) AS enrollment_id
  ), module_values AS (
    SELECT r.enrollment_id, s.module, s.required_units, s.weight,
      ep.full_completion_pct,
      count(*) OVER (PARTITION BY r.enrollment_id) AS module_count,
      count(*) FILTER (WHERE s.required_units > 0)
        OVER (PARTITION BY r.enrollment_id) AS required_module_count,
      count(*) FILTER (WHERE s.weight IS NOT NULL AND s.weight >= 0 AND s.weight <= 100)
        OVER (PARTITION BY r.enrollment_id) AS valid_weight_count,
      sum(s.weight) OVER (PARTITION BY r.enrollment_id) AS weight_sum
    FROM requested r
    JOIN public.programme_enrollments e ON e.id = r.enrollment_id
    JOIN public.programme_modules pm ON pm.programme_id = e.programme_id AND pm.enabled
    JOIN public.enrollment_module_snapshots s
      ON s.enrollment_id = r.enrollment_id
     AND s.programme_module_id = pm.id
     AND s.required = true
    LEFT JOIN LATERAL public.get_enrollment_progress(r.enrollment_id, p_as_of) ep
      ON ep.module = s.module
    WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  ), aggregates AS (
    SELECT enrollment_id, module_count, required_module_count,
      count(*) FILTER (WHERE full_completion_pct IS NOT NULL) AS value_count,
      min(valid_weight_count) AS valid_weight_count,
      min(weight_sum) AS weight_sum,
      sum(full_completion_pct * weight / 100.0) AS weighted_value
    FROM module_values
    GROUP BY enrollment_id, module_count, required_module_count
  )
  SELECT enrollment_id,
    CASE
      WHEN required_module_count = 0
        OR required_module_count <> module_count
        OR value_count <> module_count
        OR valid_weight_count <> module_count
        OR weight_sum <> 100
      THEN NULL
      ELSE round(weighted_value, 1)
    END
  FROM aggregates;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_enrollment_progress(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_enrollment_progress(uuid[], date) TO authenticated;

-- Coaching hard cap. Pending and confirmed reservations consume the cap too,
-- so parallel booking attempts cannot overbook the entitlement.
CREATE OR REPLACE FUNCTION public.can_book_session(
  p_coachee_id uuid,
  p_coach_id uuid,
  p_enrollment_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  e public.programme_enrollments;
  cfg jsonb;
  receive_limit integer;
  legacy_limit integer;
  used_count integer;
BEGIN
  IF p_coachee_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN RETURN false; END IF;
  SELECT * INTO e FROM public.programme_enrollments
  WHERE id=p_enrollment_id AND user_id=p_coachee_id;
  IF NOT FOUND OR e.status NOT IN ('active'::public.enrollment_status,'at_risk'::public.enrollment_status) THEN RETURN false; END IF;
  cfg := public.enrollment_module_config(p_enrollment_id, 'coaching'::public.programme_module_type);
  IF cfg IS NULL OR (cfg->>'enabled') = 'false' THEN
    IF NOT EXISTS (SELECT 1 FROM public.programme_modules pm WHERE pm.programme_id=e.programme_id AND pm.module='coaching' AND pm.enabled) THEN RETURN false; END IF;
  END IF;
  IF public.has_role(p_coachee_id, 'coach'::public.app_role) THEN
    IF NOT EXISTS (SELECT 1 FROM public.coach_as_coachee_allowlist a WHERE a.coach_user_id=p_coachee_id AND a.selectable_coach_id=p_coach_id) THEN RETURN false; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.coachee_coach_allowlist a WHERE a.coachee_id=p_coachee_id AND a.coach_id=p_coach_id AND a.removed_at IS NULL) THEN RETURN false; END IF;
  END IF;
  receive_limit := public.programme_config_integer(cfg, 'receive_limit');
  SELECT coachee_session_limit INTO legacy_limit FROM public.programmes WHERE id=e.programme_id;
  receive_limit := COALESCE(receive_limit, legacy_limit);
  SELECT count(*)::integer INTO used_count FROM public.sessions
  WHERE enrollment_id=p_enrollment_id AND coachee_id=p_coachee_id
    AND status IN ('pending_coach_approval','confirmed','completed');
  RETURN receive_limit IS NULL OR used_count < receive_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_coaching_session_cap()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, pg_temp
AS $$
DECLARE limit_count integer; used_count integer;
BEGIN
  IF NEW.enrollment_id IS NULL THEN RAISE EXCEPTION 'Coaching booking requires an enrollment' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text, 0));
  IF NOT public.can_book_session(NEW.coachee_id, NEW.coach_id, NEW.enrollment_id)
     AND (TG_OP='INSERT' OR NEW.status IN ('pending_coach_approval','confirmed','completed')) THEN
    RAISE EXCEPTION 'Coaching entitlement has been exhausted or booking is not allowed' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sessions_validate_enrollment_cap ON public.sessions;
CREATE TRIGGER sessions_validate_enrollment_cap
  BEFORE INSERT ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_coaching_session_cap();

-- Coachee peer-practice had an enrollment ownership trigger but no capacity
-- gate. Add the same enrollment-scoped, race-safe shape as coach peer.
CREATE OR REPLACE FUNCTION public.get_coachee_peer_session_usage(p_enrollment_id uuid)
RETURNS TABLE(receive_limit integer, used_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public, pg_temp
AS $$
  SELECT public.programme_config_integer(public.enrollment_module_config(p_enrollment_id,'peer_coaching'::public.programme_module_type),'receive_limit'),
    (SELECT count(*)::integer FROM public.coachee_peer_sessions s
     WHERE s.enrollment_id=p_enrollment_id
       AND s.status IN ('pending_coach_approval','confirmed','completed'));
$$;

CREATE OR REPLACE FUNCTION public.can_book_coachee_peer_session(
  p_provider_id uuid,
  p_enrollment_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public, pg_temp
AS $$
DECLARE e public.programme_enrollments; cfg jsonb; limit_count integer; used_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT * INTO e FROM public.programme_enrollments WHERE id=p_enrollment_id AND user_id=auth.uid();
  IF NOT FOUND OR e.status NOT IN ('active'::public.enrollment_status,'at_risk'::public.enrollment_status) THEN RETURN false; END IF;
  IF p_provider_id=auth.uid() OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_provider_id AND p.peer_coaching_opt_in) THEN RETURN false; END IF;
  cfg := public.enrollment_module_config(p_enrollment_id,'peer_coaching'::public.programme_module_type);
  IF cfg IS NULL OR NOT EXISTS (SELECT 1 FROM public.programme_modules pm WHERE pm.programme_id=e.programme_id AND pm.module='peer_coaching' AND pm.enabled) THEN RETURN false; END IF;
  limit_count := COALESCE(public.programme_config_integer(cfg,'receive_limit'), public.programme_config_integer(cfg,'monthly_limit'));
  SELECT count(*)::integer INTO used_count FROM public.coachee_peer_sessions
    WHERE enrollment_id=p_enrollment_id AND status IN ('pending_coach_approval','confirmed','completed');
  RETURN limit_count IS NULL OR used_count < limit_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.book_coachee_peer_session(
  p_provider_id uuid, p_enrollment_id uuid, p_topic text,
  p_start_time timestamptz, p_duration_minutes integer, p_slot_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, pg_temp
AS $$
DECLARE booked_id uuid;
BEGIN
  IF NOT public.can_book_coachee_peer_session(p_provider_id,p_enrollment_id) THEN
    RAISE EXCEPTION 'Peer coaching entitlement has been exhausted or booking is not allowed' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.coachee_peer_sessions
    (peer_provider_id,peer_receiver_id,enrollment_id,topic,start_time,duration_minutes,status,slot_id)
  VALUES (p_provider_id,auth.uid(),p_enrollment_id,p_topic,p_start_time,p_duration_minutes,
          'pending_coach_approval'::public.session_status,p_slot_id)
  RETURNING id INTO booked_id;
  RETURN booked_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_coachee_peer_session_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, pg_temp AS $$
BEGIN
  IF NEW.enrollment_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text, 0));
  END IF;
  IF NEW.enrollment_id IS NULL OR NOT public.can_book_coachee_peer_session(NEW.peer_provider_id,NEW.enrollment_id) THEN
    RAISE EXCEPTION 'Peer coaching entitlement has been exhausted or booking is not allowed' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coachee_peer_sessions_validate_cap ON public.coachee_peer_sessions;
CREATE TRIGGER coachee_peer_sessions_validate_cap
  BEFORE INSERT ON public.coachee_peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_coachee_peer_session_cap();

DROP POLICY IF EXISTS "CoacheePeerSessions: receiver create own" ON public.coachee_peer_sessions;
CREATE POLICY "CoacheePeerSessions: receiver create own"
  ON public.coachee_peer_sessions FOR INSERT TO authenticated
  WITH CHECK (peer_receiver_id=auth.uid() AND public.can_book_coachee_peer_session(peer_provider_id,enrollment_id));

-- Mentoring: the selected mentee enrollment is authoritative for received
-- limits. The mentor's one ongoing enrollment is used for given limits when
-- available; the legacy mentor limit remains the safe fallback for history.
CREATE OR REPLACE FUNCTION public.get_mentoring_session_usage(p_enrollment_id uuid)
RETURNS TABLE(limit_count integer, used_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public, pg_temp AS $$
  SELECT COALESCE(
      public.programme_config_integer(public.enrollment_module_config(p_enrollment_id,'mentoring'::public.programme_module_type),'receive_limit'),
      (SELECT p.mentoring_received_limit FROM public.programmes p JOIN public.programme_enrollments e ON e.programme_id=p.id WHERE e.id=p_enrollment_id)
    ),
    (SELECT count(*)::integer FROM public.mentoring_sessions s
     WHERE s.enrollment_id=p_enrollment_id
       AND s.status IN ('pending_coach_approval','confirmed','completed'));
$$;

CREATE OR REPLACE FUNCTION public.can_book_mentoring_session_reason(
  p_mentee_id uuid, p_mentor_id uuid, p_enrollment_id uuid
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public, pg_temp AS $$
DECLARE e public.programme_enrollments; cfg jsonb; received_limit integer; received_used integer;
  mentor_enrollment uuid; given_limit integer; given_used integer;
BEGIN
  IF p_mentee_id IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN RETURN 'forbidden'; END IF;
  SELECT * INTO e FROM public.programme_enrollments WHERE id=p_enrollment_id AND user_id=p_mentee_id;
  IF NOT FOUND OR e.status NOT IN ('active'::public.enrollment_status,'at_risk'::public.enrollment_status) THEN RETURN 'inactive'; END IF;
  cfg := public.enrollment_module_config(p_enrollment_id,'mentoring'::public.programme_module_type);
  IF cfg IS NULL OR NOT EXISTS (SELECT 1 FROM public.programme_modules pm WHERE pm.programme_id=e.programme_id AND pm.module='mentoring' AND pm.enabled) THEN RETURN 'module_access'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mentoring_allowlist a JOIN public.mentor_profiles mp ON mp.coach_user_id=a.mentor_user_id WHERE a.mentee_user_id=p_mentee_id AND a.mentor_user_id=p_mentor_id AND mp.is_active) THEN RETURN 'not_allowlisted'; END IF;
  SELECT limit_count,used_count INTO received_limit,received_used FROM public.get_mentoring_session_usage(p_enrollment_id);
  IF received_limit IS NOT NULL AND received_used >= received_limit THEN RETURN 'received_limit_reached'; END IF;
  SELECT id INTO mentor_enrollment FROM public.programme_enrollments
    WHERE user_id=p_mentor_id AND status IN ('active'::public.enrollment_status,'at_risk'::public.enrollment_status)
    LIMIT 1;
  IF mentor_enrollment IS NOT NULL THEN
    given_limit := public.programme_config_integer(public.enrollment_module_config(mentor_enrollment,'mentoring'::public.programme_module_type),'give_limit');
  END IF;
  IF mentor_enrollment IS NULL OR given_limit IS NULL THEN given_limit := public.get_mentoring_given_limit(p_mentor_id); END IF;
  SELECT count(*)::integer INTO given_used FROM public.mentoring_sessions
    WHERE mentor_id=p_mentor_id AND status IN ('pending_coach_approval','confirmed','completed');
  IF given_limit IS NOT NULL AND given_used >= given_limit THEN RETURN 'given_limit_reached'; END IF;
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.can_book_mentoring_session(
  p_mentee_id uuid, p_mentor_id uuid, p_enrollment_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public, pg_temp AS $$
  SELECT public.can_book_mentoring_session_reason(p_mentee_id,p_mentor_id,p_enrollment_id)='ok';
$$;

CREATE OR REPLACE FUNCTION public.check_can_book_mentoring_session_reason(
  p_mentor_id uuid, p_enrollment_id uuid
) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public, pg_temp AS $$
  SELECT public.can_book_mentoring_session_reason(auth.uid(),p_mentor_id,p_enrollment_id);
$$;

CREATE OR REPLACE FUNCTION public.check_mentoring_session_usage(p_enrollment_id uuid)
RETURNS TABLE(limit_count integer, used_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public, pg_temp AS $$
  SELECT * FROM public.get_mentoring_session_usage(p_enrollment_id);
$$;

CREATE OR REPLACE FUNCTION public.get_mentoring_session_usage_for_enrollment(p_enrollment_id uuid)
RETURNS TABLE(limit_count integer, used_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public, pg_temp AS $$
  SELECT * FROM public.get_mentoring_session_usage(p_enrollment_id);
$$;

CREATE OR REPLACE FUNCTION public.check_can_book_mentoring_session_reason_for_enrollment(
  p_mentor_id uuid,
  p_enrollment_id uuid
) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public, pg_temp AS $$
  SELECT public.can_book_mentoring_session_reason(auth.uid(),p_mentor_id,p_enrollment_id);
$$;

CREATE OR REPLACE FUNCTION public.validate_mentoring_session_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, pg_temp AS $$
BEGIN
  IF NEW.enrollment_id IS NULL THEN RAISE EXCEPTION 'Mentoring booking requires an enrollment' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text, 0));
  IF TG_OP='INSERT' AND NOT public.can_book_mentoring_session(NEW.mentee_id,NEW.mentor_id,NEW.enrollment_id) THEN
    RAISE EXCEPTION 'Mentoring entitlement has been exhausted or booking is not allowed' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mentoring_sessions_validate_cap ON public.mentoring_sessions;
CREATE TRIGGER mentoring_sessions_validate_cap
  BEFORE INSERT ON public.mentoring_sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_mentoring_session_cap();

DROP POLICY IF EXISTS "MentoringSessions: mentee create own" ON public.mentoring_sessions;
CREATE POLICY "MentoringSessions: mentee create own"
  ON public.mentoring_sessions FOR INSERT TO authenticated
  WITH CHECK (mentee_id=auth.uid() AND public.can_book_mentoring_session(auth.uid(),mentor_id,enrollment_id));

-- Triad sessions consume one cap for every participant enrollment. The
-- existing ownership trigger continues to validate that each enrollment
-- belongs to the corresponding group member.
CREATE OR REPLACE FUNCTION public.validate_triad_session_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, pg_temp AS $$
DECLARE enrollment_id uuid; limit_count integer; used_count integer; cfg jsonb;
BEGIN
  FOREACH enrollment_id IN ARRAY ARRAY[NEW.coach_enrollment_id,NEW.coachee_enrollment_id,NEW.observer_enrollment_id] LOOP
    IF enrollment_id IS NULL THEN CONTINUE; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(enrollment_id::text, 0));
    cfg := public.enrollment_module_config(enrollment_id,'triads'::public.programme_module_type);
    limit_count := public.programme_config_integer(cfg,'max_triads');
    IF limit_count IS NULL THEN CONTINUE; END IF;
    SELECT count(*)::integer INTO used_count
    FROM public.triad_sessions ts
    WHERE ts.id IS DISTINCT FROM NEW.id
      AND ts.status IN ('proposed','pending_coach_approval','confirmed','completed')
      AND enrollment_id IN (ts.coach_enrollment_id,ts.coachee_enrollment_id,ts.observer_enrollment_id);
    IF used_count >= limit_count THEN
      RAISE EXCEPTION 'Triad session entitlement has been exhausted' USING ERRCODE='42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS triad_sessions_validate_cap ON public.triad_sessions;
CREATE TRIGGER triad_sessions_validate_cap
  BEFORE INSERT ON public.triad_sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_triad_session_cap();

REVOKE ALL ON FUNCTION public.get_coachee_peer_session_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coachee_peer_session_usage(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.can_book_coachee_peer_session(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_book_coachee_peer_session(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.book_coachee_peer_session(uuid,uuid,text,timestamptz,integer,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_coachee_peer_session(uuid,uuid,text,timestamptz,integer,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.check_can_book_mentoring_session_reason(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_can_book_mentoring_session_reason(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.check_mentoring_session_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_mentoring_session_usage(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_mentoring_session_usage_for_enrollment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mentoring_session_usage_for_enrollment(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.check_can_book_mentoring_session_reason_for_enrollment(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_can_book_mentoring_session_reason_for_enrollment(uuid,uuid) TO authenticated;