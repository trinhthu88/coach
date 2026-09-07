-- Single-round-trip session summary for a user's own coaching dashboard.
-- Scoped to the `sessions` table (1:1 coaching) only — the dashboard cards
-- for mentoring/peer-coaching/triads each already share a react-query cache
-- key with their stats-bar tile (see DashboardStatsBar.tsx), so they are
-- intentionally left as-is here; folding those in is a separate, larger
-- refactor per table/module.
CREATE OR REPLACE FUNCTION public.dashboard_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF p_user_id != auth.uid() AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT jsonb_build_object(
    'upcoming_sessions', (
      SELECT coalesce(jsonb_agg(row_to_json(s.*)), '[]'::jsonb)
      FROM (
        SELECT *
        FROM sessions s
        WHERE (s.coach_id = p_user_id OR s.coachee_id = p_user_id)
          AND s.status IN ('confirmed', 'pending_coach_approval')
          AND s.start_time >= now()
        ORDER BY s.start_time ASC
        LIMIT 5
      ) s
    ),
    'completed_count', (
      SELECT count(*)
      FROM sessions s
      WHERE (s.coach_id = p_user_id OR s.coachee_id = p_user_id)
        AND s.status = 'completed'
    ),
    'pending_count', (
      SELECT count(*)
      FROM sessions s
      WHERE s.coach_id = p_user_id
        AND s.status = 'pending_coach_approval'
    )
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_summary(uuid) TO authenticated;
