-- ===========================================================================
-- Coaching-only engagements (finding P-13; decision 4)
--
-- Coach invites are replaced. A 1:1 coaching client is an Admin-created
-- engagement: one cohort per client engagement, the coach its only Coach,
-- run by exactly the same canonical engine as a group programme. A Coach can
-- only REFER a client, which Admin reviews; a referral grants nothing.
--
--   1. cohorts.kind: 'group' (default) or 'engagement'.
--   2. admin_create_coaching_engagement(): in one transaction -- the
--      programme must have the Coaching module only; a cohort
--      'Coaching – <learner> – <coach>' of kind engagement; the coach as its
--      only cohort_coach_assignments row; the Coaching requirement dates
--      spread evenly from start to end (admin_set_cohort_requirement_dates);
--      the enrollment (admin_create_programme_enrollment).
--   3. coach_engagement_enrollments(): the engagement learners a Coach is
--      assigned to, so a client appears on the Coach's list before the first
--      session.
--   4. access_requests.referred_by_coach_id / suggested_programme_id and
--      coach_refer_client(): a pending request for Admin.
--   5. The coach invite path is retired: no app role writes
--      coachee_coach_allowlist; remove_own_coachee and
--      get_own_coach_invite_slots are dropped (booking never read the
--      allowlist since 20261005130000).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Cohort kind
-- ---------------------------------------------------------------------------
ALTER TABLE public.cohorts ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'group';
ALTER TABLE public.cohorts DROP CONSTRAINT IF EXISTS cohorts_kind_check;
ALTER TABLE public.cohorts ADD CONSTRAINT cohorts_kind_check CHECK (kind IN ('group', 'engagement'));

-- ---------------------------------------------------------------------------
-- 2. Create an engagement
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_coaching_engagement(
  p_learner_id uuid, p_coach_id uuid, p_programme_id uuid, p_start date, p_end date,
  p_organization_id uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_units integer;
  v_learner text;
  v_coach text;
  v_cohort uuid;
  v_items jsonb;
  v_enrollment public.programme_enrollments;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an Admin may create a coaching engagement' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'An engagement needs a start before its end' USING ERRCODE = '22023';
  END IF;

  -- The programme runs Coaching and nothing else.
  IF NOT EXISTS (SELECT 1 FROM public.programme_modules pm
                 WHERE pm.programme_id = p_programme_id AND pm.enabled
                   AND pm.module = 'coaching'::public.programme_module_type)
     OR EXISTS (SELECT 1 FROM public.programme_modules pm
                WHERE pm.programme_id = p_programme_id AND pm.enabled
                  AND pm.module <> 'coaching'::public.programme_module_type) THEN
    RAISE EXCEPTION 'A coaching engagement needs a programme with the Coaching module only' USING ERRCODE = '22023';
  END IF;
  SELECT CASE WHEN coalesce((pm.config->>'required')::boolean, false)
              THEN public.programme_config_integer(pm.config, 'required_units') END
    INTO v_units
  FROM public.programme_modules pm
  WHERE pm.programme_id = p_programme_id AND pm.module = 'coaching'::public.programme_module_type;
  IF coalesce(v_units, 0) < 1 THEN
    RAISE EXCEPTION 'The programme requires no Coaching units' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_coach_eligible(p_coach_id) THEN
    RAISE EXCEPTION 'Coach % is not an active, approved Coach', p_coach_id USING ERRCODE = '42501';
  END IF;
  SELECT full_name INTO v_learner FROM public.profiles WHERE id = p_learner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Learner % does not exist', p_learner_id USING ERRCODE = '23503';
  END IF;
  SELECT full_name INTO v_coach FROM public.profiles WHERE id = p_coach_id;

  INSERT INTO public.cohorts (name, programme_id, organization_id, start_date, end_date, kind)
  VALUES (format('Coaching – %s – %s', coalesce(v_learner, 'Learner'), coalesce(v_coach, 'Coach')),
          p_programme_id, p_organization_id, p_start, p_end, 'engagement')
  RETURNING id INTO v_cohort;

  INSERT INTO public.cohort_coach_assignments (cohort_id, coach_id) VALUES (v_cohort, p_coach_id);

  -- Coaching N of U is due at start + N/U of the engagement.
  SELECT jsonb_agg(jsonb_build_object(
           'requirement_id', d.id,
           'due_on', p_start + round((p_end - p_start) * d.ordinal / v_units::numeric)::integer))
    INTO v_items
  FROM public.cohort_requirement_dates d
  WHERE d.cohort_id = v_cohort AND d.module = 'coaching'::public.programme_module_type;
  PERFORM public.admin_set_cohort_requirement_dates(v_cohort, coalesce(v_items, '[]'::jsonb));

  v_enrollment := public.admin_create_programme_enrollment(
    p_learner_id, p_programme_id, v_cohort, p_organization_id, p_start, p_end);
  RETURN v_enrollment.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_create_coaching_engagement(uuid, uuid, uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_coaching_engagement(uuid, uuid, uuid, date, date, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. A Coach's engagement clients
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coach_engagement_enrollments()
 RETURNS TABLE(enrollment_id uuid, user_id uuid, cohort_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT e.id, e.user_id, e.cohort_id
  FROM public.programme_enrollments e
  JOIN public.cohorts c ON c.id = e.cohort_id AND c.kind = 'engagement'
  JOIN public.cohort_coach_assignments a ON a.cohort_id = c.id AND a.coach_id = auth.uid() AND a.is_active
  WHERE auth.uid() IS NOT NULL
    AND e.status IN ('active'::public.enrollment_status, 'paused'::public.enrollment_status);
$function$;
REVOKE ALL ON FUNCTION public.coach_engagement_enrollments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_engagement_enrollments() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Refer a client
-- ---------------------------------------------------------------------------
ALTER TABLE public.access_requests
  ADD COLUMN IF NOT EXISTS referred_by_coach_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_programme_id uuid REFERENCES public.programmes(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.coach_refer_client(
  p_full_name text, p_email text, p_suggested_programme_id uuid DEFAULT NULL, p_note text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'coach'::public.app_role) THEN
    RAISE EXCEPTION 'Only a Coach may refer a client' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_full_name), '') IS NULL OR nullif(btrim(p_email), '') IS NULL THEN
    RAISE EXCEPTION 'A name and an email are required' USING ERRCODE = '22023';
  END IF;
  -- A pending request for Admin. It creates no account and grants no access.
  INSERT INTO public.access_requests (role, full_name, email, motivation, status, referred_by_coach_id, suggested_programme_id)
  -- 'executive' is the learner role an access request carries.
  VALUES ('executive', btrim(p_full_name), lower(btrim(p_email)), nullif(btrim(p_note), ''), 'pending',
          auth.uid(), p_suggested_programme_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.coach_refer_client(text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_refer_client(text, text, uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The coach invite path is retired
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.coachee_coach_allowlist FROM anon, authenticated;
DROP FUNCTION IF EXISTS public.remove_own_coachee(uuid);
DROP FUNCTION IF EXISTS public.get_own_coach_invite_slots();
