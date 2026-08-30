-- Second half of the same browser-testing find as 20260830130000_*: a
-- coachee mentee's date picker on MentoringBookSession.tsx showed every
-- date as unavailable, even for a mentor with an open, correctly-typed
-- coach_availability slot. Root cause is one level further down than
-- profiles: "Availability: authenticated view" (20260429210100_*) checks
-- `EXISTS (coach_profiles cp WHERE cp.id = coach_availability.coach_id AND
-- cp.approval_status = 'active')` — but that EXISTS subquery runs under the
-- *querying user's* RLS on coach_profiles, not bypassed. And
-- coach_profiles' own SELECT policies for a coachee viewer
-- ("Coach profiles: coachee view allowlisted", 20260430100320_*) only
-- check coachee_coach_allowlist via coach_visible_to_coachee() — nothing
-- knows about mentoring_allowlist. So a coachee mentee had no RLS path to
-- see the mentor's coach_profiles row at all, which made the mentor's
-- availability invisible too, even though mentor_profiles/
-- mentoring_allowlist/coach_availability were all otherwise correct.
--
-- (A coach mentee doesn't hit this: "Coach profiles: coach view active"
-- already grants any coach visibility into any active coach's
-- coach_profiles row, no allowlist check. This gap is coachee-mentee-only.)
--
-- Additive policy rather than broadening coach_visible_to_coachee() — that
-- function's name and existing callers are specific to the
-- coachee_coach_allowlist relationship; mentoring is a separate allowlist.

CREATE POLICY "Coach profiles: mentee view allowlisted mentor"
  ON public.coach_profiles
  FOR SELECT TO authenticated
  USING (
    approval_status = 'active'::user_status
    AND EXISTS (
      SELECT 1 FROM public.mentoring_allowlist a
      WHERE a.mentor_user_id = coach_profiles.id AND a.mentee_user_id = auth.uid()
    )
  );
