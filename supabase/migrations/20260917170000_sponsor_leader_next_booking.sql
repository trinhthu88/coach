-- Add the next sponsor-safe coaching booking without changing the canonical
-- completion, due, overdue, or checkpoint calculations.
--
-- The existing experience function remains the source of all progress facts.
-- This wrapper only enriches its coaching payload with the earliest future
-- pending/confirmed session for the same enrollment.

ALTER FUNCTION public.sponsor_canonical_leader_experience(uuid, date)
  RENAME TO sponsor_canonical_leader_experience_base;

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
        AND EXISTS (
          SELECT 1
          FROM public.sponsor_canonical_leader_progress(p_enrollment_id, current_date)
        )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_experience(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN base = '{}'::jsonb THEN base
    ELSE base || jsonb_build_object(
      'coaching_utilisation',
      coalesce(base->'coaching_utilisation', '{}'::jsonb)
        || public.sponsor_canonical_leader_next_booking(p_enrollment_id)
    )
  END
  FROM public.sponsor_canonical_leader_experience_base(p_enrollment_id, p_as_of) AS base;
$$;

REVOKE ALL ON FUNCTION public.sponsor_canonical_leader_next_booking(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_leader_next_booking(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.sponsor_canonical_leader_experience(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_leader_experience(uuid, date)
  TO authenticated;