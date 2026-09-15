-- A booking can only cover units that remain incomplete. Keep booked progress
-- bounded so sponsor reports cannot overstate schedule coverage.
CREATE OR REPLACE FUNCTION public.get_enrollment_progress(p_enrollment_id uuid,p_as_of date DEFAULT current_date)
RETURNS TABLE(module public.programme_module_type,full_completion_pct numeric,due_adherence_pct numeric,pace_status text,completed_units integer,due_units integer,required_units integer,booked_units integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
WITH enrollment AS (
  SELECT e.*, c.organization_id AS cohort_organization_id
  FROM public.programme_enrollments e
  LEFT JOIN public.cohorts c ON c.id=e.cohort_id
  WHERE e.id=p_enrollment_id
), authorized AS (
  SELECT 1
  FROM enrollment e
  WHERE e.user_id=auth.uid()
     OR public.has_role(auth.uid(),'admin'::public.app_role)
     OR public.coach_has_client(auth.uid(),e.user_id)
     OR EXISTS (
       SELECT 1
       FROM public.sponsor_profiles sp
       WHERE sp.user_id=auth.uid()
         AND sp.organization_id=e.cohort_organization_id
         AND (
           SELECT count(*)
           FROM public.programme_enrollments ec
           LEFT JOIN public.cohorts ec_c ON ec_c.id=ec.cohort_id
           WHERE ec.cohort_id=e.cohort_id
             AND ec_c.organization_id=sp.organization_id
         ) >= public.sponsor_min_leaders_for_distribution()
     )
), snapshots AS (
  SELECT s.*
  FROM public.enrollment_module_snapshots s
  JOIN authorized ON true
  WHERE s.enrollment_id=p_enrollment_id
), activity AS (
  SELECT a.module,a.enrollment_id,coalesce(s.status::text,'completed') status,a.occurred_on
  FROM public.session_activity_attributions a
  JOIN public.sessions s ON s.id=a.source_activity_id
  WHERE a.enrollment_id=p_enrollment_id AND a.source_activity_type='coaching'
  UNION ALL
  SELECT a.module,a.enrollment_id,coalesce(s.status::text,'completed'),a.occurred_on
  FROM public.session_activity_attributions a
  JOIN public.peer_sessions s ON s.id=a.source_activity_id
  WHERE a.enrollment_id=p_enrollment_id AND a.source_activity_type='peer_coaching'
  UNION ALL
  SELECT a.module,a.enrollment_id,coalesce(s.status::text,'completed'),a.occurred_on
  FROM public.session_activity_attributions a
  JOIN public.coachee_peer_sessions s ON s.id=a.source_activity_id
  WHERE a.enrollment_id=p_enrollment_id AND a.source_activity_type='peer_coaching'
  UNION ALL
  SELECT a.module,a.enrollment_id,coalesce(s.status::text,'completed'),a.occurred_on
  FROM public.session_activity_attributions a
  JOIN public.mentoring_sessions s ON s.id=a.source_activity_id
  WHERE a.enrollment_id=p_enrollment_id AND a.source_activity_type='mentoring'
  UNION ALL
  SELECT a.module,a.enrollment_id,coalesce(s.status::text,'completed'),a.occurred_on
  FROM public.session_activity_attributions a
  JOIN public.triad_sessions s ON s.id=a.source_activity_id
  WHERE a.enrollment_id=p_enrollment_id AND a.source_activity_type='triad'
  UNION ALL
  SELECT a.module,a.enrollment_id,'completed',a.occurred_on
  FROM public.session_activity_attributions a
  WHERE a.enrollment_id=p_enrollment_id
    AND a.source_activity_type IN ('training','quiz','daily_prompt')
), counts AS (
  SELECT s.id,
    count(a.*) FILTER (
      WHERE a.status='completed' AND a.occurred_on<=p_as_of
    )::int completed,
    count(a.*) FILTER (
      WHERE a.status IN ('pending_coach_approval','confirmed')
        AND a.occurred_on>=p_as_of
    )::int raw_booked
  FROM snapshots s
  LEFT JOIN activity a
    ON a.enrollment_id=s.enrollment_id AND a.module=s.module
  GROUP BY s.id
), bounded_counts AS (
  SELECT id,completed,
    least(raw_booked,greatest(required_units-completed,0))::int booked
  FROM counts
  JOIN snapshots USING (id)
), due AS (
  SELECT s.id,
    coalesce(sum(m.required_units) FILTER (WHERE m.due_on<=p_as_of),0)::int units_due
  FROM snapshots s
  LEFT JOIN public.enrollment_module_milestones m
    ON m.enrollment_module_snapshot_id=s.id
  GROUP BY s.id
)
SELECT s.module,
  CASE WHEN s.required_units=0 THEN NULL
       ELSE round(least(c.completed,s.required_units)*100.0/s.required_units,1)
  END,
  CASE WHEN d.units_due=0 THEN NULL
       ELSE round(least(c.completed,d.units_due)*100.0/d.units_due,1)
  END,
  CASE
    WHEN s.required_units=0 OR c.completed>=s.required_units THEN 'completed'
    WHEN d.units_due=0 THEN 'not_yet_due'
    WHEN c.completed>=d.units_due THEN
      CASE WHEN c.completed>d.units_due THEN 'ahead' ELSE 'on_track' END
    WHEN c.completed+c.booked>=d.units_due THEN 'scheduled'
    ELSE 'behind'
  END,
  c.completed,d.units_due,s.required_units,c.booked
FROM snapshots s
JOIN bounded_counts c ON c.id=s.id
JOIN due d ON d.id=s.id;
$$;