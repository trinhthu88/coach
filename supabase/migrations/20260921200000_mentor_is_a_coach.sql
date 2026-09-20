-- A Mentor is a Coach with a cohort Mentoring assignment -- not a user type.
--
-- The Mentoring cutover moved eligibility off the user-global
-- mentoring_allowlist and onto cohort_mentors, which was right, but it kept a
-- second condition: the user also had to hold a mentor_profiles row with
-- is_active. That made "Mentor" a separate provider identity, administered in
-- its own screen, and it is why the Admin cohort Mentoring panel showed
-- "No mentors exist yet" on a system full of Coaches -- the candidate list was
-- drawn from mentor_profiles, which was empty.
--
-- The confirmed model is one provider identity:
--
--   User -> Coach identity
--             |-- cohort_coach_assignments  -> acts as Coach for that cohort
--             `-- cohort_mentors            -> acts as Mentor for that cohort
--
-- The two assignments are independent: the same Coach may deliver Coaching in
-- one cohort, Mentoring in another, both, or neither. Neither assignment
-- implies the other, and nothing is auto-copied between them.
--
-- Canonical Mentor eligibility becomes exactly:
--
--   the user is a Coach  AND  cohort_mentors has an active row for the
--   learner's cohort, within its service window
--
-- mentor_profiles is NOT dropped. Its bio and expertise_tags are presentation
-- metadata that may still be worth showing, and the table holds real rows. It
-- simply stops deciding whether anybody may be a Mentor.

-- ---------------------------------------------------------------------------
-- 1. Only a Coach may be an active cohort Mentor
-- ---------------------------------------------------------------------------
--
-- Enforced on the table so a direct write cannot introduce a Mentor who is not
-- a Coach; the Admin screen's filtering is a convenience, never the integrity
-- rule (section 16).
--
-- Only activation is gated, matching the Coaching and Mentoring session
-- validators: deactivating an assignment, or editing one that is already
-- inactive, must never be blocked -- that is how an Admin removes somebody.

CREATE OR REPLACE FUNCTION public.validate_cohort_mentor_is_coach()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.is_active
     AND (TG_OP = 'INSERT' OR NOT OLD.is_active OR NEW.mentor_user_id IS DISTINCT FROM OLD.mentor_user_id)
     AND NOT public.has_role(NEW.mentor_user_id, 'coach'::public.app_role) THEN
    RAISE EXCEPTION 'User % is not a Coach and cannot be assigned as Mentor for cohort %',
      NEW.mentor_user_id, NEW.cohort_id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cohort_mentors_validate_coach ON public.cohort_mentors;
CREATE TRIGGER cohort_mentors_validate_coach
  BEFORE INSERT OR UPDATE ON public.cohort_mentors
  FOR EACH ROW EXECUTE FUNCTION public.validate_cohort_mentor_is_coach();

COMMENT ON COLUMN public.cohort_mentors.mentor_user_id IS
  'The COACH acting as Mentor for this cohort. There is no separate Mentor '
  'user type: this is a Coach identity plus a cohort-scoped assignment.';

-- ---------------------------------------------------------------------------
-- 2. The pool: Coach identity + active assignment
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cohort_mentoring_mentor_pool(
  p_cohort_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (mentor_user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  -- mentor_profiles is deliberately NOT consulted: a Mentor is a Coach with an
  -- assignment, and requiring a second provider record made a Coach with no
  -- mentor_profiles row unbookable however the Admin had assigned them.
  SELECT cm.mentor_user_id
  FROM public.cohort_mentors cm
  WHERE cm.cohort_id = p_cohort_id
    AND cm.is_active
    AND public.has_role(cm.mentor_user_id, 'coach'::public.app_role)
    AND (cm.active_from IS NULL OR cm.active_from <= p_as_of)
    AND (cm.active_until IS NULL OR cm.active_until >= p_as_of);
$$;

COMMENT ON FUNCTION public.cohort_mentoring_mentor_pool(uuid, date) IS
  'Canonical Mentor eligibility for a cohort: a Coach identity with an active '
  'cohort_mentors assignment inside its service window. No mentor profile, no '
  'mentor role, no global allowlist.';

-- ---------------------------------------------------------------------------
-- 3. Mentor discovery reads the COACH profile
-- ---------------------------------------------------------------------------
--
-- Same signature, so the frontend call site is unchanged. The presentation
-- fields now come from where a Coach's details actually live: the shared
-- profile carries the name, avatar and bio; coach_profiles carries the
-- specialties shown as expertise.

CREATE OR REPLACE FUNCTION public.get_mentors_for_enrollment(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
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
DECLARE
  v_cohort uuid;
BEGIN
  SELECT e.cohort_id INTO v_cohort
  FROM public.programme_enrollments e
  WHERE e.id = p_enrollment_id
    AND (e.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

  -- No row means the enrollment does not exist or is not the caller's. Return
  -- nothing rather than raising, so the two cases are indistinguishable to a
  -- prober.
  IF v_cohort IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.mentor_user_id, pr.full_name, pr.avatar_url, pr.bio, cp.specialties
  FROM public.cohort_mentoring_mentor_pool(v_cohort, p_as_of) p
  LEFT JOIN public.profiles pr ON pr.id = p.mentor_user_id
  LEFT JOIN public.coach_profiles cp ON cp.id = p.mentor_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mentors_for_enrollment(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mentors_for_enrollment(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. mentor_profiles keeps its data and loses its authority
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.mentor_profiles IS
  'HISTORICAL / PRESENTATION ONLY as of 2026-09-21. bio and expertise_tags may '
  'still be shown, but this table decides nothing: Mentor eligibility is a '
  'Coach identity plus an active cohort_mentors assignment. Nothing in the '
  'runtime consults it to decide who may mentor.';

-- ---------------------------------------------------------------------------
-- 5. Verification
-- ---------------------------------------------------------------------------

DO $$
DECLARE bad text; n bigint;
BEGIN
  -- Eligibility must not consult mentor_profiles anywhere.
  SELECT string_agg(p.proname, ', ') INTO bad
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace AND ns.nspname = 'public'
  WHERE p.proname IN ('cohort_mentoring_mentor_pool', 'get_mentors_for_enrollment',
                      'can_book_mentoring_session_reason', 'book_mentoring_session_internal')
    -- Comments are stripped first: these bodies legitimately EXPLAIN that
    -- mentor_profiles is not consulted, and that prose must not trip the check.
    AND regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
          LIKE '%mentor_profiles%';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Mentor model: % still consults mentor_profiles for eligibility', bad;
  END IF;

  -- Every active assignment must reference a Coach.
  SELECT string_agg(cm.mentor_user_id::text, ', ') INTO bad
  FROM public.cohort_mentors cm
  WHERE cm.is_active
    AND NOT public.has_role(cm.mentor_user_id, 'coach'::public.app_role);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Mentor model: active cohort Mentors who are not Coaches: %', bad
      USING HINT = 'Grant the coach role, or deactivate the assignment, before deploying.';
  END IF;

  -- The integrity rule is attached.
  SELECT count(*) INTO n FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relname = 'cohort_mentors' AND NOT t.tgisinternal
    AND t.tgname = 'cohort_mentors_validate_coach';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Mentor model: the Coach-identity trigger is not attached to cohort_mentors';
  END IF;
END $$;
