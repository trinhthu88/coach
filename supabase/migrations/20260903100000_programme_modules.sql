-- Phase 0 (programme-module unification): defines which features a
-- programme includes and how each is configured. Replaces the pattern of
-- separate per-feature limit columns on programmes / coach_programmes with
-- one row per (programme, module) — see 20260903100100_unify_enrollments.sql
-- for the enrollment-side half of this unification.

CREATE TYPE public.programme_module_type AS ENUM (
  'coaching',
  'peer_coaching',
  'mentoring',
  'triads',
  'training',
  'quiz',
  'assessment',
  'daily_prompt'
);

CREATE TABLE public.programme_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES public.programmes(id) ON DELETE CASCADE,
  module public.programme_module_type NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (programme_id, module)
);

ALTER TABLE public.programme_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Programme modules: admin manage" ON public.programme_modules
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- NOTE: programme_enrollments.user_id doesn't exist until the next
-- migration (20260903100100_unify_enrollments.sql), which also recreates
-- this policy to key off user_id instead. Using coachee_id here only so
-- this migration is valid SQL against the pre-unification schema.
CREATE POLICY "Programme modules: enrolled users view" ON public.programme_modules
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.programme_enrollments pe
      WHERE pe.programme_id = programme_modules.programme_id
        AND pe.coachee_id = auth.uid()
        AND pe.status = 'active'
    )
  );

CREATE POLICY "Programme modules: sponsor view org" ON public.programme_modules
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.programme_enrollments pe
      WHERE pe.programme_id = programme_modules.programme_id
        AND pe.organization_id IS NOT NULL
        AND pe.organization_id = public.get_sponsor_org(auth.uid())
    )
  );

CREATE TRIGGER trg_programme_modules_updated BEFORE UPDATE ON public.programme_modules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_programme_modules_programme ON public.programme_modules(programme_id);
