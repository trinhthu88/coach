-- P1-5 / rule 6: one identity onboarding pattern -- remove must_change_password.
--
-- Every admin-created or approved account now receives a one-use setup link
-- (invite / magic link) that lands on /set-new-password; nobody is ever given
-- a temporary password. The must_change_password flag -- which existed to
-- force temporary-password users to pick a real one -- is therefore
-- meaningless, and its enforcement trigger on the five session tables only
-- added a second, divergent onboarding path. Both go.
--
--   1. Clear the flag (no one is left in a "must change" state).
--   2. Drop enforce_must_change_password() and its five triggers.
--   3. Drop profiles.must_change_password.

UPDATE public.profiles SET must_change_password = false WHERE must_change_password;

DROP TRIGGER IF EXISTS enforce_must_change_password_sessions ON public.sessions;
DROP TRIGGER IF EXISTS enforce_must_change_password_peer_sessions ON public.peer_sessions;
DROP TRIGGER IF EXISTS enforce_must_change_password_coachee_peer_sessions ON public.coachee_peer_sessions;
DROP TRIGGER IF EXISTS enforce_must_change_password_triad_sessions ON public.triad_sessions;
DROP TRIGGER IF EXISTS enforce_must_change_password_mentoring_sessions ON public.mentoring_sessions;
DROP FUNCTION IF EXISTS public.enforce_must_change_password();

ALTER TABLE public.profiles DROP COLUMN IF EXISTS must_change_password;
