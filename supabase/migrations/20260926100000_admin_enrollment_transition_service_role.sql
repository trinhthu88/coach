-- Admin enrollment transitions: callable by the admin provisioning service,
-- and organization corrections keep the value they replace.
--
-- 1. admin_transition_enrollment() only accepted a signed-in admin, so the
--    admin-invite-users edge function (service role, caller already verified
--    as admin) could not move an existing person to another cohort from a
--    bulk import; such rows were skipped with "change it from the edit
--    sheet". It now accepts service_role exactly like
--    admin_create_programme_enrollment() does. The import offers the move
--    explicitly and executes it only once the admin accepts it in the preview.
--
-- 2. An organization-only change updates the ongoing enrollment in place (it
--    is a correction of that enrollment, not a new one), but the previous
--    organization used to be returned and then lost. Every such correction is
--    now recorded in programme_enrollment_organization_changes, so editing the
--    current enrollment never erases what it said before. Programme/cohort
--    changes already close the old enrollment and open a new one.

CREATE TABLE IF NOT EXISTS public.programme_enrollment_organization_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.programme_enrollments(id) ON DELETE CASCADE,
  previous_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  new_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS programme_enrollment_organization_changes_enrollment_idx
  ON public.programme_enrollment_organization_changes (enrollment_id, changed_at DESC);

ALTER TABLE public.programme_enrollment_organization_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enrollment org changes: admin read" ON public.programme_enrollment_organization_changes;
CREATE POLICY "Enrollment org changes: admin read"
  ON public.programme_enrollment_organization_changes
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE ALL ON public.programme_enrollment_organization_changes FROM anon;
GRANT SELECT ON public.programme_enrollment_organization_changes TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_transition_enrollment(
  p_user_id uuid,
  p_programme_id uuid,
  p_cohort_id uuid,
  p_organization_id uuid DEFAULT NULL,
  p_effective_date date DEFAULT current_date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cohort public.cohorts;
  v_programme_id uuid;
  v_organization_id uuid;
  v_effective date := coalesce(p_effective_date, current_date);
  v_current public.programme_enrollments;
  v_has_current boolean;
  v_new public.programme_enrollments;
  v_start date;
BEGIN
  -- service_role: the admin-invite-users edge function, which has already
  -- verified that its caller is an administrator (same rule as
  -- admin_create_programme_enrollment).
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an administrator can change enrolments' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_cohort_id IS NULL THEN
    RAISE EXCEPTION 'A person and a cohort are required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Person not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_cohort FROM public.cohorts WHERE id = p_cohort_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cohort not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_cohort.programme_id IS NULL THEN
    RAISE EXCEPTION 'The selected cohort has no programme' USING ERRCODE = 'P0001';
  END IF;
  -- The cohort owns the programme; a conflicting explicit programme is an error.
  IF p_programme_id IS NOT NULL AND p_programme_id <> v_cohort.programme_id THEN
    RAISE EXCEPTION 'The selected cohort does not belong to the selected programme' USING ERRCODE = 'P0001';
  END IF;
  v_programme_id := v_cohort.programme_id;
  -- Organization is optional and defaults to the cohort's organization.
  v_organization_id := coalesce(p_organization_id, v_cohort.organization_id);
  IF v_organization_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_organization_id) THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
  END IF;

  -- Same lock admin_create_programme_enrollment takes (re-entrant in-session).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT * INTO v_current FROM public.programme_enrollments
   WHERE user_id = p_user_id AND status IN ('active', 'at_risk', 'paused')
   FOR UPDATE;
  v_has_current := FOUND;

  IF v_has_current
     AND v_current.programme_id = v_programme_id
     AND v_current.cohort_id IS NOT DISTINCT FROM p_cohort_id THEN
    IF v_current.organization_id IS NOT DISTINCT FROM v_organization_id THEN
      RETURN jsonb_build_object('action', 'unchanged', 'enrollment_id', v_current.id);
    END IF;
    -- Organization-only change: a correction of the current enrollment. The
    -- value it replaces is kept in programme_enrollment_organization_changes.
    INSERT INTO public.programme_enrollment_organization_changes
      (enrollment_id, previous_organization_id, new_organization_id, changed_by)
    VALUES (v_current.id, v_current.organization_id, v_organization_id, auth.uid());
    UPDATE public.programme_enrollments
       SET organization_id = v_organization_id
     WHERE id = v_current.id;
    RETURN jsonb_build_object(
      'action', 'organization_updated',
      'enrollment_id', v_current.id,
      'previous_organization_id', v_current.organization_id
    );
  END IF;

  IF v_has_current THEN
    -- Close, never delete or rewrite programme/cohort/organization.
    UPDATE public.programme_enrollments
       SET status = 'completed'::public.enrollment_status,
           ended_reason = 'transferred',
           end_date = greatest(v_current.start_date, least(coalesce(v_current.end_date, v_effective), v_effective))
     WHERE id = v_current.id;
  END IF;

  -- A future cohort starts on its own start date.
  v_start := greatest(v_effective, coalesce(v_cohort.start_date, v_effective));
  v_new := public.admin_create_programme_enrollment(
    p_user_id, v_programme_id, p_cohort_id, v_organization_id, v_start, NULL
  );

  IF v_has_current THEN
    UPDATE public.programme_enrollments SET superseded_by = v_new.id WHERE id = v_current.id;
  END IF;

  RETURN jsonb_build_object(
    'action', CASE WHEN v_has_current THEN 'transitioned' ELSE 'created' END,
    'enrollment_id', v_new.id,
    'closed_enrollment_id', CASE WHEN v_has_current THEN v_current.id END
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_transition_enrollment(uuid, uuid, uuid, uuid, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_transition_enrollment(uuid, uuid, uuid, uuid, date)
  TO authenticated, service_role;
