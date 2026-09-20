-- The experience wrapper already returns an empty object for an enrollment
-- that is not sponsor-visible. The booking helper is called only after that
-- check, so it must not repeat the full canonical progress calculation.

CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_next_booking(
  p_enrollment_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'next_session_at',
    (
      SELECT min(s.start_time)
      FROM public.sessions s
      WHERE s.enrollment_id = p_enrollment_id
        AND s.status IN ('pending_coach_approval', 'confirmed')
        AND s.start_time >= now()
    )
  );
$$;

REVOKE ALL ON FUNCTION public.sponsor_canonical_leader_next_booking(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_leader_next_booking(uuid)
  TO authenticated;