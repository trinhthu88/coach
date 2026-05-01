-- 1) Drop plaintext temporary password storage. Admins see the password
--    one time in the approval dialog; if they need to share it again they
--    click "Reset" to generate a new one.
DROP TABLE IF EXISTS public.admin_user_credentials;

-- 2) Restrict session_limits SELECT to the coachee's own row.
--    Global default rows (coachee_id IS NULL) are server-side only.
DROP POLICY IF EXISTS "Session limits: coachee view own" ON public.session_limits;
CREATE POLICY "Session limits: coachee view own"
ON public.session_limits
FOR SELECT
TO authenticated
USING (coachee_id = auth.uid());

-- 3) Same hardening for coach_session_limits (was also exposing global row).
DROP POLICY IF EXISTS "Coach session limits: coach view own" ON public.coach_session_limits;
CREATE POLICY "Coach session limits: coach view own"
ON public.coach_session_limits
FOR SELECT
TO authenticated
USING (coach_user_id = auth.uid());

-- 4) Pin search_path on the one trigger function that was missing it.
CREATE OR REPLACE FUNCTION public.touch_access_requests_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;