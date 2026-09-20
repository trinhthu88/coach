-- Cohort-level mentor pool for programme Mentoring (Mentoring cutover).
--
-- Mentoring eligibility moves from the user-global pairing
--
--   mentoring_allowlist(mentee_user_id, mentor_user_id)
--
-- to the cohort the learner is actually enrolled in:
--
--   enrollment -> enrollment.cohort_id -> cohort mentor pool -> eligible mentors
--
-- This is the same shape the Coaching cutover used for cohort_coach_assignments,
-- deliberately: Mentoring is not a special case, and a second provider-pool
-- abstraction would be the parallel source of truth this work removes.
--
-- Mentoring deadlines are NOT introduced here. cohort_requirement_dates is
-- already generic over module and already holds 6 'mentoring' rows in
-- production, so the cohort schedule half of the model exists.
--
-- mentoring_allowlist is not dropped. It keeps its rows for historical
-- attribution; deployment 2 decides its fate once this has run in production.

CREATE TABLE public.cohort_mentors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  mentor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  active_from date,
  active_until date,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One row per mentor per cohort. Re-assigning a removed mentor flips
  -- is_active rather than inserting a second row, so the booking path never
  -- sees two candidates for one mentor and the history stays on one row.
  CONSTRAINT cohort_mentors_unique UNIQUE (cohort_id, mentor_user_id),
  CONSTRAINT cohort_mentors_window CHECK (
    active_from IS NULL OR active_until IS NULL OR active_until >= active_from
  )
);

COMMENT ON TABLE public.cohort_mentors IS
  'Canonical pool of mentors who may deliver Mentoring for a cohort. Replaces '
  'the user-global mentoring_allowlist as the programme Mentoring authority.';

CREATE INDEX cohort_mentors_cohort_active_idx
  ON public.cohort_mentors (cohort_id) WHERE is_active;
CREATE INDEX cohort_mentors_mentor_idx ON public.cohort_mentors (mentor_user_id);

ALTER TABLE public.cohort_mentors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cohort mentors: admin manage"
  ON public.cohort_mentors
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Cohort mentors: mentor view own"
  ON public.cohort_mentors
  FOR SELECT TO authenticated
  USING (mentor_user_id = auth.uid());

-- A learner may see the mentor pool of a cohort they are enrolled in, and only
-- that one. This is what stops a learner probing another cohort's pool.
CREATE POLICY "Cohort mentors: learner view own cohort"
  ON public.cohort_mentors
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.cohort_id = cohort_mentors.cohort_id
      AND e.user_id = auth.uid()
  ));

REVOKE ALL ON public.cohort_mentors FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cohort_mentors TO authenticated;

CREATE TRIGGER cohort_mentors_set_updated_at
  BEFORE UPDATE ON public.cohort_mentors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Canonical pool readers
-- ---------------------------------------------------------------------------
--
-- A mentor is bookable only if they are BOTH assigned to the cohort AND hold an
-- active mentor profile. Keeping both conditions in one definition stops the
-- frontend picker and the server-side revalidation from disagreeing.

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
  SELECT cm.mentor_user_id
  FROM public.cohort_mentors cm
  JOIN public.mentor_profiles mp ON mp.coach_user_id = cm.mentor_user_id
  WHERE cm.cohort_id = p_cohort_id
    AND cm.is_active
    AND mp.is_active
    AND (cm.active_from IS NULL OR cm.active_from <= p_as_of)
    AND (cm.active_until IS NULL OR cm.active_until >= p_as_of);
$$;

REVOKE ALL ON FUNCTION public.cohort_mentoring_mentor_pool(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cohort_mentoring_mentor_pool(uuid, date) TO authenticated;

-- Enrollment-scoped mentor list. The caller supplies only an enrollment they
-- own, so no one can name a cohort to probe its pool.
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
  SELECT p.mentor_user_id, pr.full_name, pr.avatar_url, mp.bio, mp.expertise_tags
  FROM public.cohort_mentoring_mentor_pool(v_cohort, p_as_of) p
  JOIN public.mentor_profiles mp ON mp.coach_user_id = p.mentor_user_id
  LEFT JOIN public.profiles pr ON pr.id = p.mentor_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mentors_for_enrollment(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mentors_for_enrollment(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- Backfill (section 19): only where the mapping is unambiguous
-- ---------------------------------------------------------------------------
--
-- Source 1 -- observed delivery history. Every (cohort, mentor) pair that has
-- actually delivered a Mentoring session to an enrollment in that cohort. This
-- is recorded fact, and without it the 9 confirmed sessions live at cutover
-- would reference mentors who are in no pool.
INSERT INTO public.cohort_mentors (cohort_id, mentor_user_id, is_active, assigned_at, assigned_by)
SELECT DISTINCT e.cohort_id, s.mentor_id, true, now(), NULL::uuid
FROM public.mentoring_sessions s
JOIN public.programme_enrollments e ON e.id = s.enrollment_id
WHERE e.cohort_id IS NOT NULL
  AND s.mentor_id IS NOT NULL
ON CONFLICT (cohort_id, mentor_user_id) DO NOTHING;

-- Source 2 -- the user-global allowlist, but ONLY where the mentee belongs to
-- exactly one cohort. A mentee spanning several cohorts gives no basis for
-- deciding which pool the pairing meant, and guessing would silently grant
-- booking rights the Admin never expressed. Those rows are left for the audit
-- below instead.
INSERT INTO public.cohort_mentors (cohort_id, mentor_user_id, is_active, assigned_at, assigned_by)
SELECT DISTINCT single.cohort_id, a.mentor_user_id, true, now(), a.created_by
FROM public.mentoring_allowlist a
JOIN LATERAL (
  SELECT (array_agg(DISTINCT e.cohort_id))[1] AS cohort_id, count(DISTINCT e.cohort_id) AS n
  FROM public.programme_enrollments e
  WHERE e.user_id = a.mentee_user_id AND e.cohort_id IS NOT NULL
) single ON single.n = 1
ON CONFLICT (cohort_id, mentor_user_id) DO NOTHING;

-- Read-only audit of allowlist pairings that could NOT be mapped. Reported,
-- never guessed.
CREATE OR REPLACE FUNCTION public.mentoring_allowlist_unmapped()
RETURNS TABLE (
  mentee_user_id uuid,
  mentor_user_id uuid,
  distinct_cohorts bigint,
  reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT a.mentee_user_id, a.mentor_user_id, x.n,
    CASE WHEN x.n = 0 THEN 'mentee has no cohort'
         WHEN x.n > 1 THEN 'mentee spans several cohorts'
         ELSE 'mapped' END
  FROM public.mentoring_allowlist a
  CROSS JOIN LATERAL (
    SELECT count(DISTINCT e.cohort_id) AS n
    FROM public.programme_enrollments e
    WHERE e.user_id = a.mentee_user_id AND e.cohort_id IS NOT NULL
  ) x
  WHERE x.n <> 1;
$$;

REVOKE ALL ON FUNCTION public.mentoring_allowlist_unmapped() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mentoring_allowlist_unmapped() TO authenticated;
