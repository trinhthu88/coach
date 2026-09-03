-- Phase 3 (triads): groups of 3 participants admin-assigns within a cohort
-- to practice coaching in rotating Coach/Coachee/Observer roles. Booking and
-- reflection are separate tables (next two migrations) — this one is just
-- group membership, mirroring the admin-curated-allowlist shape used
-- elsewhere (mentoring_allowlist) rather than an open opt-in pool, since
-- triads need exactly 3 fixed members, not a pairing.

CREATE TABLE public.triad_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id UUID NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  programme_id UUID NOT NULL REFERENCES public.programmes(id) ON DELETE CASCADE,
  name TEXT,                             -- "Triad A", "Group 1" — auto-generated if null
  member_1_id UUID NOT NULL REFERENCES public.profiles(id),
  member_2_id UUID NOT NULL REFERENCES public.profiles(id),
  member_3_id UUID NOT NULL REFERENCES public.profiles(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- All 3 members must be different
  CONSTRAINT triad_members_distinct CHECK (
    member_1_id != member_2_id
    AND member_1_id != member_3_id
    AND member_2_id != member_3_id
  )
);

ALTER TABLE public.triad_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Triad groups: admin manage" ON public.triad_groups
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Members can view their own triad group
CREATE POLICY "Triad groups: members view own" ON public.triad_groups
  FOR SELECT TO authenticated
  USING (
    auth.uid() IN (member_1_id, member_2_id, member_3_id)
    AND is_active = true
    AND public.has_programme_module('triads'::programme_module_type)
  );

CREATE TRIGGER trg_triad_groups_updated BEFORE UPDATE ON public.triad_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_triad_groups_cohort ON public.triad_groups(cohort_id);
CREATE INDEX idx_triad_groups_programme ON public.triad_groups(programme_id);
