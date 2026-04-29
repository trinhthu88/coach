
REVOKE EXECUTE ON FUNCTION public.get_coachee_session_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coachee_session_usage(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.validate_session_duration() FROM PUBLIC, anon;
