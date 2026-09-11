-- Historical schedule snapshot audit and deterministic, retryable backfill.
-- This intentionally does not enforce NOT NULL dates: unresolved historical
-- enrollments must remain visible to administrators for remediation.

CREATE TABLE IF NOT EXISTS public.enrollment_schedule_backfill_audit (
  enrollment_id uuid PRIMARY KEY REFERENCES public.programme_enrollments(id) ON DELETE CASCADE,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.enrollment_schedule_backfill_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enrollment schedule audit: admin read"
  ON public.enrollment_schedule_backfill_audit;
CREATE POLICY "Enrollment schedule audit: admin read"
  ON public.enrollment_schedule_backfill_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE ALL ON public.enrollment_schedule_backfill_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.enrollment_schedule_backfill_audit TO authenticated;

CREATE OR REPLACE FUNCTION public.backfill_enrollment_schedule_snapshots(
  p_limit integer DEFAULT NULL
)
RETURNS TABLE (
  processed integer,
  succeeded integer,
  unresolved integer,
  skipped integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  e record;
  complete boolean;
  n_processed integer := 0;
  n_succeeded integer := 0;
  n_unresolved integer := 0;
  n_skipped integer := 0;
  failure_reason text;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an administrator can backfill enrollment schedules'
      USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NOT NULL AND p_limit < 0 THEN
    RAISE EXCEPTION 'Backfill limit must be nonnegative' USING ERRCODE = '22023';
  END IF;

  FOR e IN
    SELECT pe.id, pe.programme_id, pe.cohort_id, pe.start_date, pe.end_date
    FROM public.programme_enrollments pe
    ORDER BY pe.id
    LIMIT coalesce(p_limit, 2147483647)
  LOOP
    n_processed := n_processed + 1;
    -- The lock is per enrollment, rather than a batch lock, so a bad
    -- configuration cannot block unrelated historical enrollments.
    PERFORM pg_advisory_xact_lock(hashtextextended(e.id::text, 0));

    BEGIN
      complete := e.cohort_id IS NOT NULL AND e.end_date IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.programme_modules pm
          WHERE pm.programme_id = e.programme_id
            AND pm.enabled
            AND NOT EXISTS (
              SELECT 1
              FROM public.enrollment_module_snapshots s
              WHERE s.enrollment_id = e.id
                AND s.programme_module_id = pm.id
                AND s.starts_on = e.start_date
                AND s.ends_on = e.end_date
                AND s.required_units = coalesce((pm.config->>'required_units')::integer, 0)
                AND coalesce((
                  SELECT sum(mm.required_units)
                  FROM public.enrollment_module_milestones mm
                  WHERE mm.enrollment_module_snapshot_id = s.id
                ), 0) = s.required_units
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.enrollment_module_snapshots s
          WHERE s.enrollment_id = e.id
            AND NOT EXISTS (
              SELECT 1 FROM public.programme_modules pm
              WHERE pm.id = s.programme_module_id
                AND pm.programme_id = e.programme_id
                AND pm.enabled
            )
        );

      IF complete THEN
        DELETE FROM public.enrollment_schedule_backfill_audit
         WHERE enrollment_id = e.id;
        n_skipped := n_skipped + 1;
        CONTINUE;
      END IF;

      PERFORM public.generate_enrollment_schedule(e.id);
      DELETE FROM public.enrollment_schedule_backfill_audit
       WHERE enrollment_id = e.id;
      n_succeeded := n_succeeded + 1;
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM = 'Existing enrollment schedule snapshot is incomplete' THEN
          failure_reason := 'partial_snapshot';
        ELSIF e.cohort_id IS NULL OR e.end_date IS NULL THEN
          failure_reason := 'missing_schedule_context';
        ELSE
          failure_reason := 'invalid_or_ambiguous_configuration';
        END IF;
        INSERT INTO public.enrollment_schedule_backfill_audit
          (enrollment_id, reason, metadata, last_seen_at)
        VALUES (
          e.id,
          failure_reason,
          jsonb_build_object(
            'programme_id', e.programme_id,
            'cohort_id', e.cohort_id,
            'start_date', e.start_date,
            'end_date', e.end_date
          ),
          now()
        )
        ON CONFLICT (enrollment_id) DO UPDATE SET
          reason = EXCLUDED.reason,
          metadata = EXCLUDED.metadata,
          last_seen_at = now();
        n_unresolved := n_unresolved + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT n_processed, n_succeeded, n_unresolved, n_skipped;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_enrollment_schedule_backfill_ready()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE unresolved_count integer;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an administrator can assert enrollment schedule readiness'
      USING ERRCODE = '42501';
  END IF;
  SELECT count(*)::integer INTO unresolved_count
  FROM public.enrollment_schedule_backfill_audit;
  IF unresolved_count <> 0 THEN
    RAISE EXCEPTION 'Enrollment schedule backfill has % unresolved enrollments', unresolved_count
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_enrollment_schedule_snapshots(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_enrollment_schedule_snapshots(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.assert_enrollment_schedule_backfill_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_enrollment_schedule_backfill_ready() TO authenticated;