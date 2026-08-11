-- ============================================================
-- Program Sponsor role: organizations, sponsor_profiles, and the
-- enrollment/goal columns + RLS a sponsor needs.
--
-- Privacy model: sponsors get direct RLS SELECT only on profiles,
-- coachee_profiles, and programme_enrollments, scoped to their own
-- organization via get_sponsor_org()/sponsor_can_view_coachee(). They get
-- NO RLS access to sessions, coachee_goals, coachee_goal_ratings,
-- session_messages, coach_client_notes, coach_session_private_notes,
-- coachee_reflections, or peer_sessions/peer_session_competency_feedback —
-- aggregated views of that data are exposed only through SECURITY DEFINER
-- functions added in a later migration, scoped server-side to
-- get_sponsor_org(auth.uid()) so a sponsor can never query raw rows.
-- ============================================================

-- ============================================================
-- ORGANIZATIONS
-- ============================================================
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  industry text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_organizations_updated BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- SPONSOR PROFILES
-- One sponsor per organization for now (documented decision — easy to
-- relax later by dropping this constraint if a company needs multiple
-- sponsor seats).
-- ============================================================
CREATE TABLE public.sponsor_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  title text,
  department text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id)
);
ALTER TABLE public.sponsor_profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_sponsor_profiles_updated BEFORE UPDATE ON public.sponsor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_sponsor_profiles_organization ON public.sponsor_profiles(organization_id);

-- ============================================================
-- programme_enrollments: link to organization (nullable — enrollments are
-- created via the existing access_requests -> staged_enrollments flow
-- before an admin links them to a sponsor's organization).
-- Deliberately NOT on cohorts: a cohort can contain leaders from multiple
-- sponsor companies.
-- ============================================================
ALTER TABLE public.programme_enrollments
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX idx_programme_enrollments_organization ON public.programme_enrollments(organization_id);

-- ============================================================
-- coachee_goals: schema-only opt-in flag for a future "share this goal
-- with my sponsor" feature. No UI reads or writes this yet.
-- ============================================================
ALTER TABLE public.coachee_goals
  ADD COLUMN shared_with_sponsor boolean NOT NULL DEFAULT false;

-- ============================================================
-- HELPERS
-- ============================================================

-- A sponsor's organization, or NULL if the user isn't a sponsor.
CREATE OR REPLACE FUNCTION public.get_sponsor_org(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.sponsor_profiles WHERE user_id = _user_id
$$;

-- Can the calling sponsor see this coachee? True only if the coachee has an
-- enrollment linked to the sponsor's organization. Shared by the profiles
-- and coachee_profiles policies below so the join logic lives in one place.
CREATE OR REPLACE FUNCTION public.sponsor_can_view_coachee(_coachee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.programme_enrollments pe
    WHERE pe.coachee_id = _coachee_id
      AND pe.organization_id IS NOT NULL
      AND pe.organization_id = public.get_sponsor_org(auth.uid())
  );
$$;

-- Keep the priority ordering exhaustive now that a 4th role exists. This
-- function has no callers in the app today (role resolution for multi-role
-- users happens client-side in AuthContext.tsx), but leaving it silently
-- incomplete would be a trap for whoever calls it next.
CREATE OR REPLACE FUNCTION public.get_primary_role(_user_id UUID)
RETURNS public.app_role
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY CASE role
    WHEN 'admin' THEN 1
    WHEN 'coach' THEN 2
    WHEN 'coachee' THEN 3
    WHEN 'sponsor' THEN 4
  END
  LIMIT 1
$$;

-- ============================================================
-- RLS POLICIES — organizations
-- ============================================================
CREATE POLICY "Organizations: admin manage" ON public.organizations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Organizations: sponsor view own" ON public.organizations
  FOR SELECT TO authenticated
  USING (id = public.get_sponsor_org(auth.uid()));

-- ============================================================
-- RLS POLICIES — sponsor_profiles
-- ============================================================
CREATE POLICY "Sponsor profiles: admin manage" ON public.sponsor_profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Sponsor profiles: view own" ON public.sponsor_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- RLS POLICIES — programme_enrollments (sponsor read, scoped to org)
-- ============================================================
CREATE POLICY "Enrollments: sponsor view org" ON public.programme_enrollments
  FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = public.get_sponsor_org(auth.uid()));

-- ============================================================
-- RLS POLICIES — profiles / coachee_profiles (sponsor read, scoped to org)
-- ============================================================
CREATE POLICY "Profiles: sponsor view org members" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.sponsor_can_view_coachee(id));

CREATE POLICY "Coachee profiles: sponsor view org members" ON public.coachee_profiles
  FOR SELECT TO authenticated
  USING (public.sponsor_can_view_coachee(id));
