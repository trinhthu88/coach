-- ============================================================================
-- CANONICAL ENGAGEMENT SIGNALS: one calculation each for
--   * "inactive 7+ days"   (was: AdminAlerts scan, Admin Analytics red flags
--                           and send-programme-reminders, each with its own
--                           signals, population and grain), and
--   * Triad reflection rate (was: Admin Analytics per week and the weekly
--                           admin email, with different denominators).
-- Admin surfaces read the admin_* wrappers; the Edge Functions (service
-- role) read the same *_internal constructions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Inactivity. Population: enrollments whose EFFECTIVE status is active
--    (canonical_enrollment_progress; only a stored 'active' can be
--    effectively active) and that started at least 7 days before p_as_of.
--    Activity signals, per enrollment: Training week completed, any
--    assignment (quiz) submission, Training reflection submission, daily
--    prompt response, Triad reflection. Inactive = no signal in the 7 days
--    before p_as_of (or none ever).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_enrollment_inactivity_internal(p_as_of timestamptz DEFAULT now())
RETURNS TABLE (enrollment_id uuid, user_id uuid, programme_id uuid, cohort_id uuid,
  last_activity_at timestamptz, days_since_last_activity integer, is_inactive boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH candidates AS (
    SELECT e.id, e.user_id, e.programme_id, e.cohort_id
    FROM public.programme_enrollments e
    LEFT JOIN LATERAL (
      SELECT p.effective_enrollment_status FROM public.canonical_enrollment_progress(e.id, p_as_of::date) p
    ) p ON true
    WHERE e.status = 'active'
      AND coalesce(p.effective_enrollment_status, e.status) = 'active'
      AND e.start_date <= (p_as_of - interval '7 days')::date
  ), signals AS (
    SELECT tp.enrollment_id, tp.completed_at AS at FROM public.training_progress tp WHERE tp.completed_at IS NOT NULL
    UNION ALL SELECT s.enrollment_id, s.submitted_at FROM public.assignment_submissions s
    UNION ALL SELECT rs.enrollment_id, rs.submitted_at FROM public.reflection_submissions rs
    UNION ALL SELECT r.enrollment_id, r.responded_at FROM public.daily_prompt_responses r WHERE r.responded_at IS NOT NULL
    UNION ALL SELECT tr.enrollment_id, tr.submitted_at FROM public.triad_reflections tr
  ), last_activity AS (
    SELECT c.id, max(s.at) FILTER (WHERE s.at <= p_as_of) AS at
    FROM candidates c LEFT JOIN signals s ON s.enrollment_id = c.id
    GROUP BY c.id
  )
  SELECT c.id, c.user_id, c.programme_id, c.cohort_id, l.at,
    CASE WHEN l.at IS NOT NULL THEN floor(extract(epoch FROM p_as_of - l.at) / 86400)::integer END,
    l.at IS NULL OR l.at < p_as_of - interval '7 days'
  FROM candidates c JOIN last_activity l ON l.id = c.id;
$$;
COMMENT ON FUNCTION public.canonical_enrollment_inactivity_internal(timestamptz) IS
  'THE "inactive 7+ days" rule (population, signals, window). Internal; Admin reads admin_enrollment_inactivity, Edge Functions read this.';

CREATE OR REPLACE FUNCTION public.admin_enrollment_inactivity(p_programme_id uuid DEFAULT NULL)
RETURNS TABLE (enrollment_id uuid, user_id uuid, full_name text, programme_id uuid, cohort_id uuid,
  last_activity_at timestamptz, days_since_last_activity integer, is_inactive boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can read engagement signals' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT i.enrollment_id, i.user_id, pr.full_name, i.programme_id, i.cohort_id,
    i.last_activity_at, i.days_since_last_activity, i.is_inactive
  FROM public.canonical_enrollment_inactivity_internal(now()) i
  JOIN public.profiles pr ON pr.id = i.user_id
  WHERE p_programme_id IS NULL OR i.programme_id = p_programme_id;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Triad reflection rate. Expected: one reflection per member of each
--    COMPLETED Triad session of the programme's groups (membership of the
--    session's historical group; optionally within a session-date window).
--    Submitted: that member's reflection exists. Rows per Training week plus
--    one total row (is_total). A session belongs to no requirement unit.
--    Week bucketing reuses THE canonical training schedule
--    (canonical_training_learning_items: the member enrollment's weeks and
--    their cohort dates) — the session falls in the latest week dated on or
--    before it. No week boundary is computed here.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.triad_reflection_rate_internal(p_programme_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (training_week_id uuid, is_total boolean, expected_reflections integer, submitted_reflections integer, rate_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH expected AS (
    SELECT wk.training_week_id,
      EXISTS (SELECT 1 FROM public.triad_reflections r
              WHERE r.triad_session_id = s.id AND r.enrollment_id = m.enrollment_id) AS submitted
    FROM public.triad_sessions s
    JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id
    JOIN public.programme_enrollments e ON e.id = m.enrollment_id
    LEFT JOIN LATERAL (
      SELECT i.training_week_id
      FROM public.canonical_training_learning_items(m.enrollment_id, current_date) i
      WHERE i.training_week_id IS NOT NULL AND i.due_on <= s.scheduled_start_time::date
      ORDER BY i.due_on DESC, i.training_week_id
      LIMIT 1
    ) wk ON true
    WHERE e.programme_id = p_programme_id
      AND s.status = 'completed'
      AND (p_from IS NULL OR s.scheduled_start_time::date >= p_from)
      AND (p_to IS NULL OR s.scheduled_start_time::date <= p_to)
  )
  SELECT x.training_week_id, grouping(x.training_week_id) = 1,
    count(*)::integer, count(*) FILTER (WHERE x.submitted)::integer,
    round(100.0 * count(*) FILTER (WHERE x.submitted) / nullif(count(*), 0), 1)
  FROM expected x
  GROUP BY ROLLUP (x.training_week_id);
$$;
COMMENT ON FUNCTION public.triad_reflection_rate_internal(uuid, date, date) IS
  'THE Triad reflection rate (engagement, never completion). Internal; Admin reads admin_programme_triad_reflection_rate, Edge Functions read this.';

CREATE OR REPLACE FUNCTION public.admin_programme_triad_reflection_rate(p_programme_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (training_week_id uuid, is_total boolean, expected_reflections integer, submitted_reflections integer, rate_pct numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can read engagement signals' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.triad_reflection_rate_internal(p_programme_id, p_from, p_to);
END $$;

-- ----------------------------------------------------------------------------
-- 3. Access.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.canonical_enrollment_inactivity_internal(timestamptz),
  public.triad_reflection_rate_internal(uuid, date, date),
  public.admin_enrollment_inactivity(uuid),
  public.admin_programme_triad_reflection_rate(uuid, date, date)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.canonical_enrollment_inactivity_internal(timestamptz),
  public.triad_reflection_rate_internal(uuid, date, date)
TO service_role;
GRANT EXECUTE ON FUNCTION
  public.admin_enrollment_inactivity(uuid),
  public.admin_programme_triad_reflection_rate(uuid, date, date)
TO authenticated;
