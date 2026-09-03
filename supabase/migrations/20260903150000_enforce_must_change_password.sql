-- RULES.md §1 gap: must_change_password was previously enforced only by
-- ProtectedRoute.tsx's frontend redirect to /set-new-password — a user who
-- called the Supabase API directly (bypassing the SPA) with a valid session
-- could still write sessions/peer_sessions/coachee_peer_sessions/
-- triad_sessions/mentoring_sessions while flagged for a forced password
-- change. This adds a server-side backstop: a BEFORE INSERT/UPDATE trigger
-- on those five tables that blocks the write if the *acting* user
-- (auth.uid()) has must_change_password = true, exempting admins (matching
-- the has_role(...,'admin') OR-pattern already used throughout RLS).
--
-- Deliberately checks auth.uid() (the actor), not the session's counterpart —
-- a coach whose coachee has must_change_password=true should still be able
-- to write their own session notes; only the flagged user's own writes are
-- blocked. The frontend redirect in ProtectedRoute.tsx stays the primary UX
-- path; this is a defense-in-depth backstop, not a replacement.

CREATE OR REPLACE FUNCTION public.enforce_must_change_password()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND must_change_password = true
  ) AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Password change required before this action'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER enforce_must_change_password_sessions
  BEFORE INSERT OR UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_must_change_password();

CREATE TRIGGER enforce_must_change_password_peer_sessions
  BEFORE INSERT OR UPDATE ON public.peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_must_change_password();

CREATE TRIGGER enforce_must_change_password_coachee_peer_sessions
  BEFORE INSERT OR UPDATE ON public.coachee_peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_must_change_password();

CREATE TRIGGER enforce_must_change_password_triad_sessions
  BEFORE INSERT OR UPDATE ON public.triad_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_must_change_password();

CREATE TRIGGER enforce_must_change_password_mentoring_sessions
  BEFORE INSERT OR UPDATE ON public.mentoring_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_must_change_password();
