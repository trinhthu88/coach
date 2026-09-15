-- Keep the Admin Coach editor's profile, approval, allowlist, and enrollment
-- changes in one transaction. Existing enrollment creation still performs all
-- snapshot/schedule/goal validation and raises on an ongoing-enrollment
-- conflict, which aborts this entire function call.
CREATE OR REPLACE FUNCTION public.admin_update_coach_configuration(
  p_coach_id uuid,
  p_full_name text,
  p_profile_status text,
  p_selectable_coach_ids uuid[] DEFAULT '{}'::uuid[],
  p_enrollment_id uuid DEFAULT NULL,
  p_programme_id uuid DEFAULT NULL,
  p_cohort_id uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  selected_coach_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     OR p_coach_id IS NULL
      OR p_profile_status NOT IN ('active', 'pending_approval', 'inactive', 'suspended', 'rejected', 'reach_limit')
  THEN
    RAISE EXCEPTION 'Only an administrator can update Coach configuration'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET full_name = NULLIF(left(trim(p_full_name), 200), ''),
      status = p_profile_status::public.user_status
  WHERE id = p_coach_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coach profile not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.coach_profiles
  SET approval_status = p_profile_status::public.user_status,
      last_approved_at = CASE
        WHEN p_profile_status = 'active' THEN COALESCE(last_approved_at, now())
        ELSE last_approved_at
      END
  WHERE id = p_coach_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coach profile details not found' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.coach_as_coachee_allowlist
  WHERE coach_user_id = p_coach_id
    AND NOT (selectable_coach_id = ANY(COALESCE(p_selectable_coach_ids, '{}'::uuid[])));

  FOREACH selected_coach_id IN ARRAY COALESCE(p_selectable_coach_ids, '{}'::uuid[])
  LOOP
    INSERT INTO public.coach_as_coachee_allowlist (
      coach_user_id, selectable_coach_id, created_by
    ) VALUES (p_coach_id, selected_coach_id, auth.uid())
    ON CONFLICT (coach_user_id, selectable_coach_id) DO NOTHING;
  END LOOP;

  IF p_programme_id IS NOT NULL OR p_cohort_id IS NOT NULL OR p_organization_id IS NOT NULL THEN
    IF p_programme_id IS NULL OR p_cohort_id IS NULL OR p_organization_id IS NULL THEN
      RAISE EXCEPTION 'Programme, cohort, and organization are required together'
        USING ERRCODE = '22023';
    END IF;

    IF p_enrollment_id IS NULL THEN
      PERFORM public.admin_create_programme_enrollment(
        p_coach_id, p_programme_id, p_cohort_id, p_organization_id,
        current_date, NULL
      );
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_coach_configuration(
  uuid, text, text, uuid[], uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_coach_configuration(
  uuid, text, text, uuid[], uuid, uuid, uuid, uuid
) TO authenticated;