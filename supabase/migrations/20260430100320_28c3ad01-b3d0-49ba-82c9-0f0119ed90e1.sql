-- Coachee → Coach allowlist (admin-managed)
CREATE TABLE IF NOT EXISTS public.coachee_coach_allowlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coachee_id uuid NOT NULL,
  coach_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (coachee_id, coach_id)
);

CREATE INDEX IF NOT EXISTS idx_allowlist_coachee ON public.coachee_coach_allowlist(coachee_id);
CREATE INDEX IF NOT EXISTS idx_allowlist_coach ON public.coachee_coach_allowlist(coach_id);

ALTER TABLE public.coachee_coach_allowlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allowlist: admin manage"
  ON public.coachee_coach_allowlist
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Allowlist: coachee view own"
  ON public.coachee_coach_allowlist
  FOR SELECT TO authenticated
  USING (coachee_id = auth.uid());

CREATE POLICY "Allowlist: coach view own"
  ON public.coachee_coach_allowlist
  FOR SELECT TO authenticated
  USING (coach_id = auth.uid());

-- Helper: does this coachee have any allowlist rows?
CREATE OR REPLACE FUNCTION public.coachee_has_allowlist(_coachee_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.coachee_coach_allowlist WHERE coachee_id = _coachee_id);
$$;

-- Helper: is a given coach visible to a given coachee?
CREATE OR REPLACE FUNCTION public.coach_visible_to_coachee(_coach_id uuid, _coachee_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coachee_coach_allowlist
    WHERE coachee_id = _coachee_id AND coach_id = _coach_id
  );
$$;

-- Tighten coach_profiles SELECT for coachees: only allowlisted coaches
DROP POLICY IF EXISTS "Coach profiles: view active" ON public.coach_profiles;

CREATE POLICY "Coach profiles: admin or self view"
  ON public.coach_profiles
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR id = auth.uid()
  );

CREATE POLICY "Coach profiles: coach view active"
  ON public.coach_profiles
  FOR SELECT TO authenticated
  USING (
    approval_status = 'active'::user_status
    AND has_role(auth.uid(), 'coach'::app_role)
  );

CREATE POLICY "Coach profiles: coachee view allowlisted"
  ON public.coach_profiles
  FOR SELECT TO authenticated
  USING (
    approval_status = 'active'::user_status
    AND has_role(auth.uid(), 'coachee'::app_role)
    AND public.coach_visible_to_coachee(id, auth.uid())
  );
