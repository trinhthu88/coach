-- ===========================================================================
-- Goal-setting period: one canonical cohort configuration.
-- ===========================================================================
--
-- Goals are enrollment-scoped (coachee_goals.enrollment_id, 1-3 active goals)
-- and a learner may book nothing before their first active goal exists
-- (20260926600000_booking_goal_gate_unconditional). What was missing is WHEN
-- goals are expected: the "goal setup deadline" was hard-coded as cohort start
-- + 7 days inside enrollment_goal_gate_state, so Admin could not configure it.
--
-- The cohort now owns the period (it answers WHEN for its learners):
--   cohorts.goal_setting_opens_on  -- default: the cohort start date
--   cohorts.goal_setting_due_on    -- default: the cohort start date + 7
-- NULL keeps the default, so every existing cohort behaves exactly as before.
-- The period is an alert / guidance date only: it never counts as a programme
-- requirement unit and never changes the booking decision.
-- ===========================================================================

ALTER TABLE public.cohorts
  ADD COLUMN IF NOT EXISTS goal_setting_opens_on date,
  ADD COLUMN IF NOT EXISTS goal_setting_due_on date;

ALTER TABLE public.cohorts DROP CONSTRAINT IF EXISTS cohorts_goal_setting_period_order;
ALTER TABLE public.cohorts
  ADD CONSTRAINT cohorts_goal_setting_period_order
    CHECK (goal_setting_opens_on IS NULL OR goal_setting_due_on IS NULL OR goal_setting_opens_on <= goal_setting_due_on);

COMMENT ON COLUMN public.cohorts.goal_setting_opens_on IS
  'Start of the goal-setting period for this cohort''s learners. NULL = the cohort start date.';
COMMENT ON COLUMN public.cohorts.goal_setting_due_on IS
  'Date by which each learner should have 1-3 active goals. NULL = cohort start + 7 days. Alert only; not a requirement unit.';

-- One resolver for the period, used by the gate state and anything else.
CREATE OR REPLACE FUNCTION public.enrollment_goal_setting_period(p_enrollment_id uuid)
RETURNS TABLE (opens_on date, due_on date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(c.goal_setting_opens_on, coalesce(c.start_date, e.start_date)),
    coalesce(c.goal_setting_due_on, coalesce(c.start_date, e.start_date) + 7)
  FROM public.programme_enrollments e
  LEFT JOIN public.cohorts c ON c.id = e.cohort_id
  WHERE e.id = p_enrollment_id;
$$;
REVOKE ALL ON FUNCTION public.enrollment_goal_setting_period(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enrollment_goal_gate_state(p_enrollment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_start date;
  v_active integer;
  v_eligible boolean;
  v_opens date;
  v_due date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.id = p_enrollment_id) THEN
    RETURN NULL;
  END IF;

  v_start := public.enrollment_goal_gate_start_date(p_enrollment_id);
  v_eligible := public.check_booking_eligibility(p_enrollment_id);
  SELECT p.opens_on, p.due_on INTO v_opens, v_due FROM public.enrollment_goal_setting_period(p_enrollment_id) p;
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
    'goal_setting_opens_on', v_opens,
    -- Compliance alert only; never part of the booking decision above.
    'goal_setup_deadline', v_due,
    'goal_setup_overdue', NOT v_eligible AND v_due IS NOT NULL AND current_date > v_due
  );
END;
$function$;
