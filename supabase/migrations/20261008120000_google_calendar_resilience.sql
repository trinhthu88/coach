ALTER TABLE public.google_calendar_connections
  ADD COLUMN consecutive_error_count integer NOT NULL DEFAULT 0
    CHECK (consecutive_error_count >= 0),
  ADD COLUMN needs_reconnect boolean NOT NULL DEFAULT false;

-- Existing short-lived states have no verifier and are rejected by the updated
-- callback. They expire naturally; new flows store a PKCE verifier.
ALTER TABLE public.google_calendar_oauth_states
  ADD COLUMN code_verifier text;

CREATE FUNCTION public.record_google_calendar_failure(p_coach_id uuid)
RETURNS TABLE (consecutive_error_count integer, needs_reconnect boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  UPDATE public.google_calendar_connections AS connection
  SET consecutive_error_count = connection.consecutive_error_count + 1,
      needs_reconnect = connection.consecutive_error_count + 1 >= 3,
      updated_at = now()
  WHERE connection.coach_id = p_coach_id
  RETURNING connection.consecutive_error_count, connection.needs_reconnect;
$function$;

REVOKE ALL ON FUNCTION public.record_google_calendar_failure(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_google_calendar_failure(uuid) TO service_role;
