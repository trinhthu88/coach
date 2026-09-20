-- Mentor profile visibility follows the cohort mentor pool (Mentoring cutover).
--
-- Two SELECT policies decided whether a learner may see a mentor's profile by
-- looking for a user-global mentoring_allowlist pairing. Now that the cohort
-- pool decides who may be booked, a mentor assigned to the learner's cohort
-- but absent from the allowlist would appear in the booking list and then
-- render without a name or bio -- eligible to book, invisible to read.
--
-- Both policies gain the cohort-pool branch. The allowlist branch is KEPT:
-- mentoring_allowlist still holds historical pairings, and removing the branch
-- would retroactively hide mentors from learners who can still see their past
-- Mentoring sessions.
--
-- These are SELECT-only policies on profile data. Widening them grants no
-- booking right: eligibility is decided by
-- can_book_mentoring_session_reason() and the session trigger, not by whether
-- a profile can be read.

DROP POLICY IF EXISTS "MentorProfiles: allowlisted mentee view" ON public.mentor_profiles;

CREATE POLICY "MentorProfiles: mentee view cohort or historical mentor"
  ON public.mentor_profiles
  FOR SELECT TO authenticated
  USING (
    -- Current: the mentor is in the pool of a cohort the learner is enrolled in.
    EXISTS (
      SELECT 1
      FROM public.programme_enrollments e
      CROSS JOIN LATERAL public.cohort_mentoring_mentor_pool(e.cohort_id) p
      WHERE e.user_id = auth.uid()
        AND p.mentor_user_id = mentor_profiles.coach_user_id
    )
    -- Historical: a pairing that existed before the cutover.
    OR EXISTS (
      SELECT 1 FROM public.mentoring_allowlist a
      WHERE a.mentor_user_id = mentor_profiles.coach_user_id
        AND a.mentee_user_id = auth.uid()
    )
    -- Historical: a mentor who actually delivered a session to this learner,
    -- so past sessions never render against an unreadable profile.
    OR EXISTS (
      SELECT 1 FROM public.mentoring_sessions s
      WHERE s.mentor_id = mentor_profiles.coach_user_id
        AND s.mentee_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Coach profiles: mentee view allowlisted mentor" ON public.coach_profiles;

CREATE POLICY "Coach profiles: mentee view cohort or historical mentor"
  ON public.coach_profiles
  FOR SELECT TO authenticated
  USING (
    approval_status = 'active'::public.user_status
    AND (
      EXISTS (
        SELECT 1
        FROM public.programme_enrollments e
        CROSS JOIN LATERAL public.cohort_mentoring_mentor_pool(e.cohort_id) p
        WHERE e.user_id = auth.uid()
          AND p.mentor_user_id = coach_profiles.id
      )
      OR EXISTS (
        SELECT 1 FROM public.mentoring_allowlist a
        WHERE a.mentor_user_id = coach_profiles.id
          AND a.mentee_user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.mentoring_sessions s
        WHERE s.mentor_id = coach_profiles.id
          AND s.mentee_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Enrollment-scoped replacement for get_my_mentors()
-- ---------------------------------------------------------------------------
--
-- get_my_mentors() takes no arguments and answers "every mentor allowlisted to
-- me", which cannot express the cohort model: a learner with two enrollments
-- would get both cohorts' mentors merged into one list, exactly the historical
-- leakage this cutover forbids. get_mentors_for_enrollment() replaces it.

COMMENT ON FUNCTION public.get_my_mentors() IS
  'RETIRED for programme Mentoring (2026-09-20): user-global, so it merges the '
  'mentor pools of every enrollment a learner has ever had. Use '
  'get_mentors_for_enrollment(p_enrollment_id). Retained until all callers migrate.';
