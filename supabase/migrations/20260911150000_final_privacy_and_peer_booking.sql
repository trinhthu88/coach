-- Final privacy cutover and enrollment-aware peer booking.
-- Sponsors receive aggregates through SECURITY DEFINER reporting RPCs only.

DROP POLICY IF EXISTS "Profiles: sponsor view org members" ON public.profiles;
DROP POLICY IF EXISTS "Coachee profiles: sponsor view org members" ON public.coachee_profiles;
DROP POLICY IF EXISTS "Enrollments: sponsor view org" ON public.programme_enrollments;
DROP POLICY IF EXISTS "Programme modules: sponsor view org" ON public.programme_modules;

-- The historical "view active" profile policy was role-blind and therefore
-- also exposed every active learner to sponsors.  Keep ordinary discovery for
-- non-sponsors while making the sponsor role RPC-only.
DROP POLICY IF EXISTS "Profiles: view active" ON public.profiles;
CREATE POLICY "Profiles: view active" ON public.profiles
  FOR SELECT TO authenticated
  USING (status = 'active' AND NOT public.has_role(auth.uid(),'sponsor'::public.app_role));
DROP POLICY IF EXISTS "Coachee profiles: coach view booked" ON public.coachee_profiles;
CREATE POLICY "Coachee profiles: coach view booked" ON public.coachee_profiles
  FOR SELECT TO authenticated
  USING (
    NOT public.has_role(auth.uid(),'sponsor'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.coachee_id = coachee_profiles.id AND s.coach_id = auth.uid()
    )
  );

-- A sponsor must never be able to turn a reporting key into an individual
-- learner/progress lookup.  The reporting RPCs perform the same check before
-- invoking this function.
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
    JOIN authorized ON true WHERE s.enrollment_id=p_enrollment_id
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
      WHERE sub.enrollment_id IS NOT NULL
        AND a.assignment_type='quiz'::public.assignment_type
    UNION ALL SELECT 'daily_prompt',enrollment_id,'completed',responded_at::date
      FROM public.daily_prompt_responses
      WHERE enrollment_id IS NOT NULL
        AND responded_at IS NOT NULL
  ), counts AS (
    SELECT s.id,count(a.*) FILTER (WHERE a.status='completed' AND a.occurred_on<=p_as_of)::integer completed,
      least(count(a.*) FILTER (WHERE a.status IN ('pending_coach_approval','confirmed') AND a.occurred_on>=p_as_of),
        greatest(s.required_units-count(a.*) FILTER (WHERE a.status='completed' AND a.occurred_on<=p_as_of),0))::integer booked
    FROM snapshots s LEFT JOIN activity a ON a.enrollment_id=s.enrollment_id AND a.module=s.module GROUP BY s.id, s.required_units
  ), due AS (
    SELECT s.id,coalesce(sum(m.required_units) FILTER (WHERE m.due_on<=p_as_of),0)::integer units_due
    FROM snapshots s LEFT JOIN public.enrollment_module_milestones m ON m.enrollment_module_snapshot_id=s.id GROUP BY s.id
  )
  SELECT s.module,CASE WHEN s.required_units=0 THEN NULL ELSE round(least(c.completed,s.required_units)*100.0/s.required_units,1) END,
    CASE WHEN d.units_due=0 THEN NULL ELSE round(least(c.completed,d.units_due)*100.0/d.units_due,1) END,
    CASE WHEN s.required_units=0 OR c.completed>=s.required_units THEN 'completed'
      WHEN d.units_due=0 THEN 'not_yet_due' WHEN c.completed>=d.units_due THEN
        CASE WHEN c.completed>d.units_due THEN 'ahead' ELSE 'on_track' END
      WHEN c.completed+c.booked>=d.units_due THEN 'scheduled' ELSE 'behind' END,
    c.completed,d.units_due,s.required_units,c.booked
  FROM snapshots s JOIN counts c ON c.id=s.id JOIN due d ON d.id=s.id;
$$;

CREATE OR REPLACE FUNCTION public.get_peer_session_usage(p_enrollment_id uuid)
RETURNS TABLE(monthly_limit integer, used_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT NULLIF(pm.config->>'monthly_limit','')::integer,
    (SELECT count(*)::integer FROM public.peer_sessions ps
     WHERE ps.enrollment_id=e.id
       AND ps.status IN ('pending_coach_approval','confirmed','completed'))
  FROM public.programme_enrollments e
  JOIN public.programme_modules pm ON pm.programme_id=e.programme_id
    AND pm.module='peer_coaching'::public.programme_module_type AND pm.enabled
  WHERE e.id=p_enrollment_id AND e.user_id=auth.uid()
    AND e.status IN ('active'::public.enrollment_status,'at_risk'::public.enrollment_status);
$$;

CREATE OR REPLACE FUNCTION public.can_book_peer_session(
  p_peer_coach_id uuid, p_enrollment_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
    AND e.user_id=auth.uid()
    AND e.status IN ('active'::public.enrollment_status,'at_risk'::public.enrollment_status)
    AND e.user_id <> p_peer_coach_id
    AND EXISTS (SELECT 1 FROM public.coach_profiles cp
                WHERE cp.id=p_peer_coach_id AND cp.peer_coaching_opt_in)
    AND EXISTS (SELECT 1 FROM public.programme_modules pm
                WHERE pm.programme_id=e.programme_id
                  AND pm.module='peer_coaching'::public.programme_module_type
                  AND pm.enabled)
    AND (
      (SELECT NULLIF(pm.config->>'monthly_limit','')::integer
       FROM public.programme_modules pm
       WHERE pm.programme_id=e.programme_id
         AND pm.module='peer_coaching'::public.programme_module_type
         AND pm.enabled) IS NULL
      OR EXISTS (SELECT 1 FROM public.get_peer_session_usage(p_enrollment_id)
                WHERE used_count < monthly_limit)
    )
  FROM public.programme_enrollments e WHERE e.id=p_enrollment_id;
$$;

CREATE OR REPLACE FUNCTION public.validate_peer_session_enrollment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE received_limit integer; received_count integer;
BEGIN
  IF NEW.enrollment_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.id=NEW.enrollment_id AND e.user_id=NEW.peer_coachee_id
      AND e.status IN ('active'::public.enrollment_status,'at_risk'::public.enrollment_status)
  ) THEN RAISE EXCEPTION 'Peer booking receiver enrollment is invalid' USING ERRCODE='42501'; END IF;
  IF NEW.peer_coach_id = NEW.peer_coachee_id OR NOT EXISTS (
    SELECT 1 FROM public.coach_profiles cp WHERE cp.id=NEW.peer_coach_id AND cp.peer_coaching_opt_in
  ) THEN RAISE EXCEPTION 'Peer booking participant is invalid' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    JOIN public.programme_modules pm ON pm.programme_id=e.programme_id
      AND pm.module='peer_coaching'::public.programme_module_type AND pm.enabled
    WHERE e.id=NEW.enrollment_id
  ) THEN RAISE EXCEPTION 'Peer coaching is not enabled for this enrollment' USING ERRCODE='42501'; END IF;
  SELECT NULLIF(pm.config->>'monthly_limit','')::integer
    INTO received_limit
  FROM public.programme_enrollments e
  JOIN public.programme_modules pm ON pm.programme_id=e.programme_id
    AND pm.module='peer_coaching'::public.programme_module_type AND pm.enabled
  WHERE e.id=NEW.enrollment_id;
  IF received_limit IS NOT NULL THEN
    SELECT count(*)::integer INTO received_count FROM public.peer_sessions ps
    WHERE ps.enrollment_id=NEW.enrollment_id
      AND ps.status IN ('pending_coach_approval','confirmed','completed')
      AND ps.id IS DISTINCT FROM NEW.id;
    IF received_count >= received_limit THEN
      RAISE EXCEPTION 'Peer coaching entitlement has been exhausted' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.book_peer_session(
  p_peer_coach_id uuid, p_enrollment_id uuid, p_topic text,
  p_start_time timestamptz, p_duration_minutes integer, p_slot_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE booked_id uuid;
BEGIN
  IF NOT public.can_book_peer_session(p_peer_coach_id,p_enrollment_id) THEN
    RAISE EXCEPTION 'Peer booking is not allowed for this enrollment' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.peer_sessions
    (peer_coach_id,peer_coachee_id,enrollment_id,topic,start_time,duration_minutes,status,slot_id)
  VALUES
    (p_peer_coach_id,auth.uid(),p_enrollment_id,p_topic,p_start_time,
     p_duration_minutes,'pending_coach_approval'::public.session_status,p_slot_id)
  RETURNING id INTO booked_id;
  RETURN booked_id;
END;
$$;

DROP TRIGGER IF EXISTS peer_sessions_enrollment_booking_scope ON public.peer_sessions;
CREATE TRIGGER peer_sessions_enrollment_booking_scope
  BEFORE INSERT OR UPDATE OF enrollment_id,peer_coach_id,peer_coachee_id
  ON public.peer_sessions FOR EACH ROW EXECUTE FUNCTION public.validate_peer_session_enrollment();

DROP POLICY IF EXISTS "Peer sessions: peer-coachee create own" ON public.peer_sessions;
CREATE POLICY "Peer sessions: peer-coachee create own" ON public.peer_sessions
  FOR INSERT TO authenticated WITH CHECK (
    peer_coachee_id=auth.uid() AND public.can_book_peer_session(peer_coach_id,enrollment_id)
  );

REVOKE ALL ON FUNCTION public.get_peer_session_usage(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_peer_session_usage(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.can_book_peer_session(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_book_peer_session(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.book_peer_session(uuid,uuid,text,timestamptz,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.book_peer_session(uuid,uuid,text,timestamptz,integer,uuid) TO authenticated;