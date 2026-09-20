-- Close the remaining user-global Mentoring paths (Mentoring cutover, part 2).
--
-- The first cutover repointed the authoritative booking check at the cohort
-- mentor pool but left the pre-cutover overloads executable and merely
-- commented RETIRED. A commented function still runs, so a user-global booking
-- path remained reachable. This closes it.
--
-- Three groups, each handled on its own merits.
--
--  A. User-global BOOKING overloads -> fail closed.
--     They take no enrollment, so they cannot apply the cohort rule and cannot
--     be fixed in place; and they are PostgREST-exposed, so dropping them
--     would 404 any caller instead of telling it what went wrong. They now
--     raise. Nothing in this repository calls them: the RLS INSERT policy and
--     validate_mentoring_session_cap() both use the three-argument form, and
--     the frontend calls check_can_book_mentoring_session_reason_for_enrollment().
--
--  B. User-global LEARNER usage/limit -> dropped.
--     get_mentoring_received_limit() summed the mentoring entitlement of every
--     enrollment a learner had ever held, so a historical enrollment inflated
--     the current one's allowance. It has no callers at all -- not one
--     function, policy or page -- so it is dropped rather than stubbed.
--
--  C. MENTOR capacity -> kept, authorization corrected.
--     check_mentoring_given_usage() reports how much of a mentor's give-side
--     capacity is used. That is provider analytics about the mentor, not
--     learner programme progress, so person scope is correct. But it decided
--     WHO MAY ASK by looking for a mentoring_allowlist pairing, which made the
--     allowlist authoritative for mentor discovery. It now asks the cohort
--     pool instead.

-- ---------------------------------------------------------------------------
-- A. User-global booking overloads fail closed
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_book_mentoring_session_reason(
  p_mentee_id uuid,
  p_mentor_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION
    'Programme Mentoring eligibility requires an enrollment. Use can_book_mentoring_session_reason(mentee, mentor, enrollment).'
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.can_book_mentoring_session(
  p_mentee_id uuid,
  p_mentor_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION
    'Programme Mentoring eligibility requires an enrollment. Use can_book_mentoring_session(mentee, mentor, enrollment).'
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.check_can_book_mentoring_session_reason(p_mentor_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION
    'Programme Mentoring eligibility requires an enrollment. Use check_can_book_mentoring_session_reason(mentor, enrollment).'
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.check_can_book_mentoring_session(p_mentor_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION
    'Programme Mentoring eligibility requires an enrollment. Use check_can_book_mentoring_session_reason(mentor, enrollment).'
    USING ERRCODE = '42501';
END;
$$;

COMMENT ON FUNCTION public.can_book_mentoring_session_reason(uuid, uuid) IS
  'FAILS CLOSED. User-global Mentoring booking is retired; an enrollment is '
  'required so the cohort mentor pool can be applied.';
COMMENT ON FUNCTION public.can_book_mentoring_session(uuid, uuid) IS
  'FAILS CLOSED. See can_book_mentoring_session_reason(uuid, uuid).';
COMMENT ON FUNCTION public.check_can_book_mentoring_session_reason(uuid) IS
  'FAILS CLOSED. See can_book_mentoring_session_reason(uuid, uuid).';
COMMENT ON FUNCTION public.check_can_book_mentoring_session(uuid) IS
  'FAILS CLOSED. See can_book_mentoring_session_reason(uuid, uuid).';

-- ---------------------------------------------------------------------------
-- B. User-global learner entitlement is dropped
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_mentoring_received_limit(uuid);

-- The zero-argument usage reader answered "my Mentoring usage" with no
-- enrollment, which cannot be right for a learner holding more than one. Its
-- enrollment-scoped sibling, check_mentoring_session_usage(p_enrollment_id),
-- stays.
DROP FUNCTION IF EXISTS public.check_mentoring_session_usage();

-- ---------------------------------------------------------------------------
-- C. Mentor capacity keeps person scope, loses allowlist authorization
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_mentoring_given_usage(p_mentor_id uuid)
RETURNS TABLE (limit_count integer, used_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  -- Deliberately person-scoped: this is the MENTOR's delivery capacity across
  -- everyone they mentor, not any learner's programme progress. Aggregating it
  -- per enrollment would answer a different question.
  --
  -- Who may ask: an admin, the mentor about themselves, or a learner who
  -- shares a cohort with that mentor -- the same set that may see the mentor
  -- in their picker. A mentoring_allowlist pairing no longer grants it.
  SELECT g.limit_count, g.used_count
  FROM public.get_mentoring_given_usage(p_mentor_id) g
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
     OR auth.uid() = p_mentor_id
     OR EXISTS (
       SELECT 1
       FROM public.programme_enrollments e
       CROSS JOIN LATERAL public.cohort_mentoring_mentor_pool(e.cohort_id) p
       WHERE e.user_id = auth.uid()
         AND p.mentor_user_id = p_mentor_id
     );
$$;

REVOKE ALL ON FUNCTION public.check_mentoring_given_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_mentoring_given_usage(uuid) TO authenticated;

COMMENT ON FUNCTION public.check_mentoring_given_usage(uuid) IS
  'Mentor delivery capacity (provider analytics, person-scoped by design). '
  'Visible to an admin, the mentor, or a learner who shares a cohort with '
  'them. Not learner programme progress.';

COMMENT ON FUNCTION public.get_mentoring_session_usage(uuid) IS
  'Learner Mentoring entitlement usage for ONE enrollment. Programme
 entitlement is per enrollment: a historical enrollment must never consume the
 current one''s allowance.';
COMMENT ON FUNCTION public.get_mentoring_given_limit(uuid) IS
  'Mentor give-side capacity (provider scope, by design).';
COMMENT ON FUNCTION public.get_mentoring_given_usage(uuid) IS
  'Mentor give-side usage (provider scope, by design).';

-- ---------------------------------------------------------------------------
-- D. User-global mentor discovery fails closed
-- ---------------------------------------------------------------------------
--
-- get_my_mentors() answered "every mentor allowlisted to me" with no
-- enrollment, so a learner holding two enrollments got both cohorts' mentors
-- merged into one list -- the cross-enrollment leakage this cutover exists to
-- remove. It is the last executable path by which mentoring_allowlist could
-- drive CURRENT mentor discovery.
--
-- Its replacement is get_mentors_for_enrollment(p_enrollment_id). Like the
-- booking overloads above it is PostgREST-exposed, so it raises rather than
-- disappearing.

-- Its original signature returned a different column set, so it is dropped and
-- recreated rather than replaced in place.
DROP FUNCTION IF EXISTS public.get_my_mentors();

CREATE FUNCTION public.get_my_mentors()
RETURNS TABLE (
  mentor_user_id uuid,
  full_name text,
  avatar_url text,
  bio text,
  expertise_tags text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION
    'Mentor discovery is scoped to an enrollment. Use get_mentors_for_enrollment(p_enrollment_id).'
    USING ERRCODE = '42501';
END;
$$;

COMMENT ON FUNCTION public.get_my_mentors() IS
  'FAILS CLOSED. User-global mentor discovery is retired: it merged the mentor '
  'pools of every enrollment a learner held. Use get_mentors_for_enrollment().';

-- is_allowlisted_pair() is deliberately left intact. It backs
-- "Profiles: counterpart via allowlist", which decides whether two people may
-- see each other's NAME AND AVATAR -- not whether anything may be booked. It
-- also covers coachee_coach_allowlist, so changing it would reach beyond
-- Mentoring. Historical profile visibility is the one allowlist use section 4
-- permits.
COMMENT ON FUNCTION public.is_allowlisted_pair(uuid, uuid) IS
  'HISTORICAL PROFILE VISIBILITY ONLY. Decides whether two counterparts may see '
  'each other''s profile. It authorizes no booking, no mentor discovery and no '
  'programme progress; programme eligibility comes from the cohort pools.';
