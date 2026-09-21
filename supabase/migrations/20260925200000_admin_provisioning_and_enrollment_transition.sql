-- Admin user provisioning + enrollment transitions (spec Part 2).
--
-- 1. Retire the staged_enrollments signup hook.
--    apply_staged_enrollment() inserted programme_enrollments WITHOUT user_id
--    (NOT NULL since 20260903100100) and bypassed every enrollment rule, so any
--    signup whose email had a staged row failed outright. Admin imports now go
--    through the canonical admin-invite-users edge function, which creates the
--    account and the enrollment (via admin_create_programme_enrollment)
--    directly. The table is kept read-only as an archive of old intents.
--
-- 2. bulk_invite_rows carries the new import columns (programme / cohort /
--    organization / sponsor fields) so an interrupted batch can be resumed with
--    exactly the values the admin confirmed in the preview.
--
-- 3. admin_transition_enrollment(): the one admin path to change a person's
--    programme / cohort / organization after creation. History is preserved:
--    an ongoing enrollment in a different programme or cohort is CLOSED
--    (status 'completed', ended_reason 'transferred', end_date = effective
--    date, superseded_by -> the new row) and never deleted or rewritten; the new
--    enrollment is created through admin_create_programme_enrollment (the
--    validated writer). Changing only the organization of the current
--    enrollment is a correction and updates that row in place.

-- ---------------------------------------------------------------------------
-- 1. staged_enrollments: drop the broken trigger, make the table read-only.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS apply_staged_enrollment_trg ON public.profiles;
DROP FUNCTION IF EXISTS public.apply_staged_enrollment();

DROP POLICY IF EXISTS "Staged: admin manage" ON public.staged_enrollments;
DROP POLICY IF EXISTS "Staged: admin read (retired)" ON public.staged_enrollments;
CREATE POLICY "Staged: admin read (retired)" ON public.staged_enrollments
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
COMMENT ON TABLE public.staged_enrollments IS
  'RETIRED (20260925200000). Historical staged import intents only; nothing reads or applies them. '
  'Admin imports use the admin-invite-users edge function.';

-- ---------------------------------------------------------------------------
-- 2. bulk_invite_rows: new import columns and statuses.
-- ---------------------------------------------------------------------------
ALTER TABLE public.bulk_invite_rows
  ADD COLUMN IF NOT EXISTS programme_id uuid REFERENCES public.programmes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cohort_id uuid REFERENCES public.cohorts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS accept_existing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE SET NULL;

ALTER TABLE public.bulk_invite_rows DROP CONSTRAINT IF EXISTS bulk_invite_rows_role_check;
ALTER TABLE public.bulk_invite_rows
  ADD CONSTRAINT bulk_invite_rows_role_check CHECK (role IN ('coach', 'coachee', 'sponsor'));

ALTER TABLE public.bulk_invite_rows DROP CONSTRAINT IF EXISTS bulk_invite_rows_status_check;
ALTER TABLE public.bulk_invite_rows
  ADD CONSTRAINT bulk_invite_rows_status_check
  CHECK (status IN ('pending', 'invited', 'enrolled', 'linked', 'partial', 'failed', 'skipped'));

-- ---------------------------------------------------------------------------
-- 3. Enrollment transition.
-- ---------------------------------------------------------------------------
ALTER TABLE public.programme_enrollments
  ADD COLUMN IF NOT EXISTS ended_reason text,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;

ALTER TABLE public.programme_enrollments DROP CONSTRAINT IF EXISTS programme_enrollments_ended_reason_check;
ALTER TABLE public.programme_enrollments
  ADD CONSTRAINT programme_enrollments_ended_reason_check
  CHECK (ended_reason IS NULL OR ended_reason IN ('transferred'));

COMMENT ON COLUMN public.programme_enrollments.ended_reason IS
  'Why a closed enrollment ended early. ''transferred'' = closed by admin_transition_enrollment when the person moved '
  'to another programme/cohort (status is then ''completed'' and superseded_by points at the new enrollment).';
COMMENT ON COLUMN public.programme_enrollments.superseded_by IS
  'The enrollment that replaced this one via admin_transition_enrollment.';

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
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
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
    -- Organization-only change: a correction of the current enrollment.
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
