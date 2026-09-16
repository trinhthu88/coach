-- Keep Sponsor Programme Journey on the same attributed-history rules as the
-- canonical enrollment progress contract.
--
-- This is additive and intentionally replaces only the new canonical journey
-- function. Existing Sponsor RPCs remain unchanged.

CREATE OR REPLACE FUNCTION public.sponsor_canonical_programme_journey(
  p_cohort_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH sponsor AS (
    SELECT sp.organization_id
    FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ),
  eligible AS (
    SELECT e.id, e.cohort_id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN sponsor s ON s.organization_id = c.organization_id
    WHERE e.cohort_id = p_cohort_id
      AND (
        SELECT count(*)
        FROM public.programme_enrollments ec
        WHERE ec.cohort_id = e.cohort_id
      ) >= public.sponsor_min_leaders_for_distribution()
  ),
  schedule AS (
    SELECT
      e.id AS enrollment_id,
      s.module,
      m.due_on,
      m.required_units,
      m.training_week_id
    FROM eligible e
    JOIN public.enrollment_module_snapshots s
      ON s.enrollment_id = e.id
    JOIN public.enrollment_module_milestones m
      ON m.enrollment_module_snapshot_id = s.id
    WHERE m.due_on IS NOT NULL
  ),
  activity AS (
    SELECT a.enrollment_id, a.module, a.occurred_on, coalesce(s.status::text, 'completed') AS status
    FROM public.session_activity_attributions a
    JOIN public.sessions s
      ON s.id = a.source_activity_id
    WHERE a.source_activity_type = 'coaching'

    UNION ALL

    SELECT a.enrollment_id, a.module, a.occurred_on, coalesce(s.status::text, 'completed')
    FROM public.session_activity_attributions a
    JOIN public.peer_sessions s
      ON s.id = a.source_activity_id
    WHERE a.source_activity_type = 'peer_coaching'

    UNION ALL

    SELECT a.enrollment_id, a.module, a.occurred_on, coalesce(s.status::text, 'completed')
    FROM public.session_activity_attributions a
    JOIN public.coachee_peer_sessions s
      ON s.id = a.source_activity_id
    WHERE a.source_activity_type = 'peer_coaching'

    UNION ALL

    SELECT a.enrollment_id, a.module, a.occurred_on, coalesce(s.status::text, 'completed')
    FROM public.session_activity_attributions a
    JOIN public.mentoring_sessions s
      ON s.id = a.source_activity_id
    WHERE a.source_activity_type = 'mentoring'

    UNION ALL

    SELECT a.enrollment_id, a.module, a.occurred_on, coalesce(s.status::text, 'completed')
    FROM public.session_activity_attributions a
    JOIN public.triad_sessions s
      ON s.id = a.source_activity_id
    WHERE a.source_activity_type = 'triad'

    UNION ALL

    SELECT a.enrollment_id, a.module, a.occurred_on, 'completed'
    FROM public.session_activity_attributions a
    WHERE a.source_activity_type IN ('training', 'quiz', 'daily_prompt')
  ),
  dates AS (
    SELECT
      s.due_on,
      string_agg(DISTINCT tw.title, ' · ' ORDER BY tw.title)
        FILTER (WHERE tw.title IS NOT NULL) AS label,
      to_jsonb(array_agg(DISTINCT s.module::text ORDER BY s.module::text)) AS module_scope
    FROM schedule s
    LEFT JOIN public.training_weeks tw ON tw.id = s.training_week_id
    GROUP BY s.due_on
  ),
  scoped_modules AS (
    SELECT
      d.due_on,
      e.id AS enrollment_id,
      s.module,
      sum(s.required_units)::integer AS required_units
    FROM dates d
    CROSS JOIN eligible e
    JOIN schedule s
      ON s.enrollment_id = e.id
     AND s.due_on <= d.due_on
    GROUP BY d.due_on, e.id, s.module
  ),
  leader_module_checkpoints AS (
    SELECT
      sm.due_on,
      sm.enrollment_id,
      sm.module,
      sm.required_units,
      count(a.occurred_on) FILTER (
        WHERE a.status = 'completed'
          AND a.occurred_on <= p_as_of
      )::integer AS completed_units
    FROM scoped_modules sm
    LEFT JOIN activity a
      ON a.enrollment_id = sm.enrollment_id
     AND a.module = sm.module
    GROUP BY sm.due_on, sm.enrollment_id, sm.module, sm.required_units
  ),
  leader_checkpoints AS (
    SELECT
      d.due_on,
      e.id AS enrollment_id,
      coalesce(sum(l.required_units), 0)::integer AS required_units,
      coalesce(sum(least(l.completed_units, l.required_units)), 0)::integer AS completed_units
    FROM dates d
    CROSS JOIN eligible e
    LEFT JOIN leader_module_checkpoints l
      ON l.due_on = d.due_on
     AND l.enrollment_id = e.id
    GROUP BY d.due_on, e.id
  ),
  totals AS (
    SELECT
      d.due_on,
      d.label,
      d.module_scope,
      sum(l.required_units)::integer AS required_units,
      sum(l.completed_units)::integer AS completed_units,
      count(*)::integer AS total_leaders,
      count(*) FILTER (
        WHERE l.required_units > 0
          AND l.completed_units >= l.required_units
      )::integer AS completed_leaders
    FROM dates d
    JOIN leader_checkpoints l ON l.due_on = d.due_on
    GROUP BY d.due_on, d.label, d.module_scope
  ),
  numbered AS (
    SELECT row_number() OVER (ORDER BY due_on)::integer AS checkpoint_number, *
    FROM totals
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'checkpoint_number', checkpoint_number,
    'due_on', due_on,
    'label', label,
    'module_scope', module_scope,
    'required_units', required_units,
    'completed_units', completed_units,
    'completed_leaders', completed_leaders,
    'total_leaders', total_leaders,
    'state', CASE
      WHEN p_as_of < due_on THEN 'upcoming'
      WHEN p_as_of = due_on THEN 'current'
      WHEN required_units > 0 AND completed_units >= required_units THEN 'completed'
      ELSE 'overdue'
    END
  ) ORDER BY due_on), '[]'::jsonb)
  FROM numbered;
$$;

REVOKE ALL ON FUNCTION public.sponsor_canonical_programme_journey(uuid, date)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sponsor_canonical_programme_journey(uuid, date)
  TO authenticated;