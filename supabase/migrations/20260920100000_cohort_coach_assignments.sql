-- Cohort-level Coach pool for programme Coaching (Coaching redesign, deployment 1).
--
-- Programme Coaching eligibility moves from the learner-level allowlists
-- (coachee_coach_allowlist / coach_as_coachee_allowlist) to the cohort the
-- learner is actually enrolled in:
--
--   enrollment -> enrollment.cohort_id -> cohort Coach assignments -> eligible Coaches
--
-- The learner-level allowlists are NOT touched here. They still govern the
-- non-programme relationships documented in RULES.md section 3 and stay the
-- authority for those until deployment 2 retires the programme-Coaching
-- dependency. This migration only introduces the new canonical relation.
--
-- A Coach does not need a programme enrollment to deliver Coaching for a
-- cohort; delivering Coaching and being enrolled as a learner are different
-- relationships and must not be conflated.

CREATE TABLE public.cohort_coach_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  coach_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  -- Optional service window. NULL active_from means "since assignment";
  -- NULL active_until means "open ended".
  active_from date,
  active_until date,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One row per Coach per cohort. Re-assigning a previously removed Coach
  -- flips is_active rather than inserting a second row, so history stays on
  -- one row and the booking path never sees two candidates for one Coach.
  CONSTRAINT cohort_coach_assignments_unique UNIQUE (cohort_id, coach_id),
  CONSTRAINT cohort_coach_assignments_window CHECK (
    active_from IS NULL OR active_until IS NULL OR active_until >= active_from
  )
);

COMMENT ON TABLE public.cohort_coach_assignments IS
  'Canonical pool of Coaches who may deliver programme Coaching for a cohort. '
  'Replaces learner-level coach allowlists as the programme Coaching authority.';

CREATE INDEX cohort_coach_assignments_cohort_active_idx
  ON public.cohort_coach_assignments (cohort_id) WHERE is_active;
CREATE INDEX cohort_coach_assignments_coach_idx
  ON public.cohort_coach_assignments (coach_id);

ALTER TABLE public.cohort_coach_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cohort coach assignments: admin manage"
  ON public.cohort_coach_assignments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- A Coach may see the cohorts they are assigned to deliver.
CREATE POLICY "Cohort coach assignments: coach view own"
  ON public.cohort_coach_assignments
  FOR SELECT TO authenticated
  USING (coach_id = auth.uid());

-- A learner may see the Coach pool of a cohort they are enrolled in; this is
-- exactly the set they are allowed to choose from when booking.
CREATE POLICY "Cohort coach assignments: learner view own cohort"
  ON public.cohort_coach_assignments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.cohort_id = cohort_coach_assignments.cohort_id
      AND e.user_id = auth.uid()
  ));

REVOKE ALL ON public.cohort_coach_assignments FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cohort_coach_assignments TO authenticated;

CREATE TRIGGER cohort_coach_assignments_set_updated_at
  BEFORE UPDATE ON public.cohort_coach_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Canonical eligibility read used by the booking path, the frontend Coach
-- picker and the Admin cohort screen. One definition, so the picker and the
-- server-side revalidation can never disagree.
CREATE OR REPLACE FUNCTION public.cohort_coaching_coach_pool(
  p_cohort_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (coach_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT a.coach_id
  FROM public.cohort_coach_assignments a
  WHERE a.cohort_id = p_cohort_id
    AND a.is_active
    AND (a.active_from IS NULL OR a.active_from <= p_as_of)
    AND (a.active_until IS NULL OR a.active_until >= p_as_of);
$$;

REVOKE ALL ON FUNCTION public.cohort_coaching_coach_pool(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cohort_coaching_coach_pool(uuid, date) TO authenticated;

-- Eligibility for a specific enrollment: resolves the cohort itself so no
-- caller has to supply (or can forge) a cohort id.
CREATE OR REPLACE FUNCTION public.enrollment_coaching_coach_pool(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (coach_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p.coach_id
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.cohort_coaching_coach_pool(e.cohort_id, p_as_of) p
  WHERE e.id = p_enrollment_id;
$$;

REVOKE ALL ON FUNCTION public.enrollment_coaching_coach_pool(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enrollment_coaching_coach_pool(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- Backfill from observed delivery history (section 33: evidence, not invention)
-- ---------------------------------------------------------------------------
--
-- Every (cohort, coach) pair that has actually delivered a Coaching session to
-- an enrollment in that cohort becomes an active assignment. This is recorded
-- fact, not an inferred policy: without it the 22 confirmed sessions that exist
-- at cutover would reference Coaches who are in no pool, and the cohort pool
-- check in 20260920110000 would reject any later change to them.
--
-- Coaches with no delivery history are NOT added; Admin assigns those
-- explicitly on the cohort screen.

INSERT INTO public.cohort_coach_assignments (cohort_id, coach_id, is_active, assigned_at, assigned_by)
SELECT DISTINCT e.cohort_id, s.coach_id, true, now(), NULL::uuid
FROM public.sessions s
JOIN public.programme_enrollments e ON e.id = s.enrollment_id
WHERE e.cohort_id IS NOT NULL
  AND s.coach_id IS NOT NULL
ON CONFLICT (cohort_id, coach_id) DO NOTHING;

COMMENT ON COLUMN public.cohort_coach_assignments.assigned_by IS
  'Admin who made the assignment. NULL for rows created by the 2026-09-20 '
  'backfill from observed delivery history.';
