-- P0-4: booking requires at least one active goal -- always.
--
-- 20260925400000 left days 1-7 of a cohort open (a grace period) and blocked
-- only from day 8. The contract is now:
--
--   BOOKING RULE   check_booking_eligibility(enrollment) = at least one
--                  active goal on the enrollment. No active goal -> every
--                  booking path (Coaching, Mentoring, Peer, Triads) refuses
--                  with "Create at least one goal first". Availability,
--                  providers and Triad information stay readable regardless.
--
--   COMPLIANCE     goal_setup_deadline = cohort start + 7 days. After it, an
--   ALERT          enrollment with no active goal is flagged "goal setup
--                  overdue" to the Learner and Admin. This is an ALERT only;
--                  it does not change the booking rule.
--
-- One rule, one place: every booking RPC already calls
-- assert_enrollment_goal_gate() -> enrollment_goal_gate_state(); changing the
-- state function changes every path at once. Signatures are unchanged.
-- "Active and not archived" is status = 'active' (archiving is a status value;
-- coachee_goals has no archived_at column).

CREATE OR REPLACE FUNCTION public.check_booking_eligibility(p_enrollment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coachee_goals g
    WHERE g.enrollment_id = p_enrollment_id
      AND g.status = 'active'
  );
$$;
REVOKE ALL ON FUNCTION public.check_booking_eligibility(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.check_booking_eligibility(uuid) IS
  'THE booking eligibility rule: the enrollment has at least one active goal. Called (via '
  'assert_enrollment_goal_gate) by every booking RPC. INTERNAL; clients read enrollment_goal_gate().';

-- The older name is the same rule, never a second copy.
CREATE OR REPLACE FUNCTION public.enrollment_has_active_goal(p_enrollment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.check_booking_eligibility(p_enrollment_id);
$$;

CREATE OR REPLACE FUNCTION public.enrollment_goal_gate_state(p_enrollment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_start date;
  v_active integer;
  v_eligible boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.id = p_enrollment_id) THEN
    RETURN NULL;
  END IF;

  v_start := public.enrollment_goal_gate_start_date(p_enrollment_id);
  v_eligible := public.check_booking_eligibility(p_enrollment_id);
  SELECT count(*)::integer INTO v_active
  FROM public.coachee_goals g
  WHERE g.enrollment_id = p_enrollment_id AND g.status = 'active';

  RETURN jsonb_build_object(
    'enrollment_id', p_enrollment_id,
    'blocked', NOT v_eligible,
    'reason', CASE WHEN NOT v_eligible THEN 'goal_required_before_booking' END,
    'has_active_goal', v_eligible,
    'active_goal_count', v_active,
    'max_active_goals', 3,
    'gate_starts_on', v_start,
    -- Compliance alert only; never part of the booking decision above.
    'goal_setup_deadline', v_start + 7,
    'goal_setup_overdue', NOT v_eligible AND v_start IS NOT NULL AND current_date > v_start + 7
  );
END;
$$;

COMMENT ON FUNCTION public.enrollment_goal_gate_state(uuid) IS
  'THE booking goal gate: {blocked, reason, has_active_goal, active_goal_count, max_active_goals, '
  'gate_starts_on, goal_setup_deadline, goal_setup_overdue}. blocked = NOT check_booking_eligibility '
  '(no grace period). goal_setup_overdue (after cohort start + 7 days with no active goal) is an alert only. INTERNAL.';

CREATE OR REPLACE FUNCTION public.assert_enrollment_goal_gate(p_enrollment_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.id = p_enrollment_id)
     AND NOT public.check_booking_eligibility(p_enrollment_id) THEN
    RAISE EXCEPTION 'Create at least one goal first'
      USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object(
          'code', 'goal_required_before_booking',
          'enrollment_id', p_enrollment_id)::text,
        HINT = 'Create at least one goal first.';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_enrollment_goal_gate(uuid) IS
  'Raises "Create at least one goal first" (P0001, detail code goal_required_before_booking) when '
  'check_booking_eligibility() is false. Called by every server booking path. INTERNAL.';

-- Admin view of the compliance alert: ongoing enrollments past their goal
-- setup deadline with no active goal.
CREATE OR REPLACE FUNCTION public.admin_goal_setup_overdue()
RETURNS TABLE (enrollment_id uuid, user_id uuid, learner_name text, cohort_id uuid, goal_setup_deadline date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT e.id, e.user_id, p.full_name, e.cohort_id, (s->>'goal_setup_deadline')::date
  FROM public.programme_enrollments e
  JOIN public.profiles p ON p.id = e.user_id
  CROSS JOIN LATERAL public.enrollment_goal_gate_state(e.id) s
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
    AND e.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status, 'paused'::public.enrollment_status)
    AND (s->>'goal_setup_overdue')::boolean
  ORDER BY (s->>'goal_setup_deadline')::date, p.full_name;
$$;
REVOKE ALL ON FUNCTION public.admin_goal_setup_overdue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_goal_setup_overdue() TO authenticated;
COMMENT ON FUNCTION public.admin_goal_setup_overdue() IS
  'Admin alert: ongoing enrollments past cohort start + 7 days with no active goal ("Goal setup overdue"). '
  'Alert only; booking is governed by check_booking_eligibility().';
