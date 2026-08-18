-- Mentor status is admin-set (a coach becomes a mentor only when an admin
-- flags them), unlike coach_profiles.peer_coaching_opt_in which is a
-- self-service opt-in. This is deliberately a separate table rather than a
-- column on coach_profiles, since it carries its own admin-only write policy.
--
-- Confirmed before writing this: profiles(id) and has_role() already exist
-- (20260429193745_*). The "allowlisted mentee can view" SELECT policy is
-- added in the next migration, once mentoring_allowlist exists to join
-- against.

CREATE TABLE IF NOT EXISTS public.mentor_profiles (
  coach_user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  bio TEXT,
  expertise_tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mentor_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "MentorProfiles: admin manage"
  ON public.mentor_profiles FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "MentorProfiles: self view"
  ON public.mentor_profiles FOR SELECT TO authenticated
  USING (coach_user_id = auth.uid());

CREATE TRIGGER mentor_profiles_updated_at
  BEFORE UPDATE ON public.mentor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
