-- Admin-curated mentee<->mentor pairing — the fourth booking-eligibility
-- allowlist (RULES.md §3), same shape as coach_as_coachee_allowlist
-- (20260430143232_*.sql), except mentee_user_id can be either a coach or a
-- coachee (mentoring is open to both, unlike the coach-only/coachee-only
-- relationships).

CREATE TABLE IF NOT EXISTS public.mentoring_allowlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentee_user_id UUID NOT NULL,
  mentor_user_id UUID NOT NULL REFERENCES public.mentor_profiles(coach_user_id) ON DELETE CASCADE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mentee_user_id, mentor_user_id)
);

ALTER TABLE public.mentoring_allowlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "MentoringAllowlist: admin manage"
  ON public.mentoring_allowlist FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "MentoringAllowlist: mentee view own"
  ON public.mentoring_allowlist FOR SELECT TO authenticated
  USING (mentee_user_id = auth.uid());

CREATE POLICY "MentoringAllowlist: mentor view own"
  ON public.mentoring_allowlist FOR SELECT TO authenticated
  USING (mentor_user_id = auth.uid());

-- Deferred from 20260818140100_mentor_profiles.sql: lets an allowlisted
-- mentee read the mentor's profile (bio/expertise_tags) when picking a
-- mentor to book, without granting a blanket "view all mentors" policy.
CREATE POLICY "MentorProfiles: allowlisted mentee view"
  ON public.mentor_profiles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.mentoring_allowlist a
      WHERE a.mentor_user_id = mentor_profiles.coach_user_id AND a.mentee_user_id = auth.uid()
    )
  );
