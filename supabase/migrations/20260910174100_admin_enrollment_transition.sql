-- Service-role/admin enrollment transition for trusted seed and provisioning jobs.
-- Unlike the client RPC, this accepts Supabase service-role JWTs without
-- pretending to be an authenticated admin user.
CREATE OR REPLACE FUNCTION public.admin_create_programme_enrollment(
  p_user_id uuid, p_programme_id uuid, p_cohort_id uuid, p_organization_id uuid,
  p_start_date date DEFAULT current_date, p_end_date date DEFAULT NULL
) RETURNS public.programme_enrollments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  selected_cohort public.cohorts;
  existing public.programme_enrollments;
  result public.programme_enrollments;
  effective_end_date date;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an administrator or service role can create enrolments'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO selected_cohort FROM public.cohorts
    WHERE id = p_cohort_id AND programme_id = p_programme_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected cohort does not belong to the selected programme'
      USING ERRCODE = 'P0001';
  END IF;
  IF selected_cohort.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'The selected organisation does not own the selected cohort'
      USING ERRCODE = '42501';
  END IF;
  effective_end_date := coalesce(p_end_date, selected_cohort.end_date);
  IF effective_end_date IS NULL THEN
    RAISE EXCEPTION 'An enrollment end date is required to create its schedule snapshot'
      USING ERRCODE = 'P0001';
  END IF;
  IF (selected_cohort.start_date IS NOT NULL AND p_start_date < selected_cohort.start_date)
     OR (selected_cohort.end_date IS NOT NULL AND effective_end_date > selected_cohort.end_date)
     OR effective_end_date < p_start_date THEN
    RAISE EXCEPTION 'Enrollment dates must fall within the cohort dates' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  SELECT * INTO existing FROM public.programme_enrollments
    WHERE user_id = p_user_id AND status IN ('active', 'at_risk', 'paused') FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION '%', jsonb_build_object(
      'code','ongoing_enrollment_exists','enrollment_id',existing.id,
      'programme_id',existing.programme_id,'cohort_id',existing.cohort_id,
      'status',existing.status,'start_date',existing.start_date,'end_date',existing.end_date
    )::text USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.programme_enrollments
    (user_id, coachee_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
  VALUES (p_user_id, p_user_id, p_programme_id, p_cohort_id, p_organization_id,
          p_start_date, effective_end_date, 'active')
  RETURNING * INTO result;
  PERFORM public.generate_enrollment_schedule(result.id);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.admin_create_programme_enrollment(uuid,uuid,uuid,uuid,date,date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_programme_enrollment(uuid,uuid,uuid,uuid,date,date)
  TO service_role;