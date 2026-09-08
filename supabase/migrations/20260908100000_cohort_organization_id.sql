ALTER TABLE public.cohorts
  ADD COLUMN IF NOT EXISTS organization_id UUID
    REFERENCES public.organizations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.cohorts.organization_id IS
  'When set, every leader enrolled in this cohort is considered part of this
   organization. Visible to the org sponsor via the sponsor_* RPCs.';
