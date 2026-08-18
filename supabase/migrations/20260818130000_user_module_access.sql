-- Generic per-user, per-module access toggle. First consumer is the new
-- Mentoring module (Relationship 4 in RULES.md §3), but the table/CHECK
-- constraint/helper function are written to be reused by future modules —
-- add the new module name to the CHECK constraint when that happens.
--
-- Default is opt-in: no row for a user+module means disabled. This mirrors
-- the "admin must explicitly curate" posture of the allowlist tables
-- (coachee_coach_allowlist, coach_as_coachee_allowlist) rather than the open
-- opt-in pool used by peer coaching.
--
-- Confirmed before writing this: has_role() and profiles(id) already exist
-- (20260429193745_*), and this is the first table of its kind — no prior
-- module-access mechanism to reconcile with.

CREATE TABLE IF NOT EXISTS public.user_module_access (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, module),
  CONSTRAINT user_module_access_module_chk CHECK (module IN ('mentoring'))
);

ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "UserModuleAccess: own view"
  ON public.user_module_access FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "UserModuleAccess: admin manage"
  ON public.user_module_access FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER user_module_access_updated_at
  BEFORE UPDATE ON public.user_module_access
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
