-- Sponsor privacy cutover.  This surface is deliberately separate from the
-- historical sponsor RPCs: it is enrollment keyed, cohort-owned, and exposes
-- no person-scoped activity identifiers.

DROP FUNCTION IF EXISTS public.sponsor_enrollment_summaries(uuid);
CREATE OR REPLACE FUNCTION public.sponsor_enrollment_summaries(
  p_cohort_id uuid
)
RETURNS TABLE (
  enrollment_id uuid,
  learner_display_name text,
  programme_label text,
  cohort_id uuid,
  cohort_label text,
  enrollment_status public.enrollment_status,
  required_units integer,
  completed_units integer,
  due_units integer,
  due_adherence_pct numeric,
  pace_status text,
  coaching_completed_count integer,
  mentoring_completed_count integer,
  peer_completed_count integer,
  triad_completed_count integer,
  goal_count integer,
  open_action_count integer,
  completed_action_count integer
  ,programme_id uuid
  ,enrollment_start_date date
  ,enrollment_end_date date
  ,programme_start_date date
  ,programme_end_date date
  ,full_completion_pct numeric
  ,booked_units integer
  ,overdue_units integer
  ,schedule_coverage_pct numeric
  ,goal_setup boolean
  ,goal_progress_pct numeric
  ,total_action_count integer
  ,action_completion_pct numeric
  ,satisfaction_avg numeric
  ,satisfaction_rated_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH authorized AS (
    SELECT sp.organization_id
    FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ), eligible AS (
    SELECT e.*, c.name AS cohort_label, p.name AS programme_label,
           c.start_date AS programme_start_date, c.end_date AS programme_end_date,
           pr.full_name AS learner_display_name
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN public.programmes p ON p.id = e.programme_id
    JOIN public.profiles pr ON pr.id = e.user_id
    JOIN authorized a ON a.organization_id = c.organization_id
    WHERE p_cohort_id IS NOT NULL
      AND e.cohort_id = p_cohort_id
      AND (SELECT count(*) FROM public.programme_enrollments ec
           JOIN public.cohorts ec_c ON ec_c.id = ec.cohort_id
           WHERE ec.cohort_id = p_cohort_id
             AND ec_c.organization_id = a.organization_id)
          >= public.sponsor_min_leaders_for_distribution()
  ), progress AS (
     SELECT e.id AS enrollment_id,
      coalesce(sum(g.required_units), 0)::integer AS required_units,
      coalesce(sum(g.completed_units), 0)::integer AS completed_units,
      coalesce(sum(g.due_units), 0)::integer AS due_units,
      CASE WHEN sum(g.due_units) = 0 THEN NULL
           ELSE least(100, round(sum(g.completed_units) * 100.0 / sum(g.due_units), 1)) END AS due_adherence_pct,
       CASE WHEN bool_or(g.pace_status = 'behind') THEN 'behind'
           WHEN bool_or(g.pace_status = 'scheduled') THEN 'scheduled'
           WHEN bool_or(g.pace_status = 'on_track') THEN 'on_track'
           WHEN bool_or(g.pace_status = 'ahead') THEN 'ahead'
           WHEN bool_and(g.pace_status = 'completed') THEN 'completed'
           ELSE 'not_yet_due' END AS pace_status
       ,coalesce(sum(g.booked_units),0)::integer AS booked_units
     FROM eligible e
     LEFT JOIN LATERAL public.get_enrollment_progress(e.id, current_date) g ON true
     GROUP BY e.id
  ), completed AS (
    SELECT e.id AS enrollment_id,
      count(*) FILTER (WHERE x.domain = 'coaching')::integer AS coaching,
      count(*) FILTER (WHERE x.domain = 'mentoring')::integer AS mentoring,
      count(*) FILTER (WHERE x.domain = 'peer')::integer AS peer,
      count(*) FILTER (WHERE x.domain = 'triad')::integer AS triad
    FROM eligible e
    LEFT JOIN LATERAL (
      SELECT 'coaching'::text AS domain FROM public.sessions s WHERE s.enrollment_id=e.id AND s.status='completed'
      UNION ALL SELECT 'mentoring' FROM public.mentoring_sessions s WHERE s.enrollment_id=e.id AND s.status='completed'
      UNION ALL SELECT 'peer' FROM public.peer_sessions s WHERE s.enrollment_id=e.id AND s.status='completed'
      UNION ALL SELECT 'peer' FROM public.coachee_peer_sessions s WHERE s.enrollment_id=e.id AND s.status='completed'
      UNION ALL SELECT 'triad' FROM public.triad_sessions s
        WHERE s.status='completed' AND e.id IN (s.coach_enrollment_id,s.coachee_enrollment_id,s.observer_enrollment_id)
    ) x ON true
    GROUP BY e.id
  ), goals AS (
    SELECT e.id AS enrollment_id,
      count(g.id)::integer AS goal_count,
      count(g.id) FILTER (WHERE gr.id IS NOT NULL)::integer AS goal_setup,
      round(avg(CASE WHEN gr.target_rating IS NULL OR gr.start_rating IS NULL
        OR gr.target_rating = gr.start_rating THEN NULL
        ELSE least(100, greatest(0, (gr.current_rating - gr.start_rating) * 100.0 /
          (gr.target_rating - gr.start_rating))) END),1) AS goal_progress_pct
    FROM eligible e
    LEFT JOIN public.coachee_goals g ON g.enrollment_id=e.id
    LEFT JOIN public.coachee_goal_ratings gr ON gr.goal_id=g.id AND gr.enrollment_id=e.id
    GROUP BY e.id
  ), actions AS (
    SELECT e.id AS enrollment_id,
      count(a.id) FILTER (WHERE a.status IN ('open','in_progress'))::integer AS open_action_count,
       count(a.id) FILTER (WHERE a.status = 'completed')::integer AS completed_action_count,
       count(a.id)::integer AS total_action_count
    FROM eligible e
    LEFT JOIN public.enrollment_actions a ON a.enrollment_id=e.id
    GROUP BY e.id
  ), satisfaction AS (
    SELECT e.id AS enrollment_id, count(s.id)::integer AS rated_count,
      round(avg(s.coachee_rating),2) AS avg_rating
    FROM eligible e
    LEFT JOIN public.sessions s ON s.enrollment_id=e.id
      AND s.status='completed' AND s.coachee_rating IS NOT NULL
    GROUP BY e.id
  )
  SELECT e.id, e.learner_display_name, e.programme_label, e.cohort_id,
    e.cohort_label, e.status, coalesce(pr.required_units,0),
    coalesce(pr.completed_units,0), coalesce(pr.due_units,0), pr.due_adherence_pct,
    pr.pace_status, coalesce(x.coaching,0), coalesce(x.mentoring,0),
    coalesce(x.peer,0), coalesce(x.triad,0), coalesce(g.goal_count,0),
     coalesce(a.open_action_count,0), coalesce(a.completed_action_count,0),
     e.programme_id, e.start_date, e.end_date, e.programme_start_date, e.programme_end_date,
     CASE WHEN coalesce(pr.required_units,0)=0 THEN NULL
       ELSE round(least(pr.completed_units,pr.required_units)*100.0/pr.required_units,1) END,
     coalesce(pr.booked_units,0),
     greatest(0, coalesce(pr.due_units,0) - coalesce(pr.completed_units,0)),
     CASE WHEN coalesce(pr.due_units,0)=0 THEN NULL
       ELSE round(least(pr.completed_units + pr.booked_units,pr.due_units)*100.0/pr.due_units,1) END,
     (coalesce(g.goal_setup,0) > 0), g.goal_progress_pct,
     coalesce(a.total_action_count,0),
     CASE WHEN coalesce(a.total_action_count,0)=0 THEN NULL
       ELSE round(a.completed_action_count*100.0/a.total_action_count,1) END,
     sat.avg_rating, coalesce(sat.rated_count,0)
  FROM eligible e
  LEFT JOIN progress pr ON pr.enrollment_id=e.id
  LEFT JOIN completed x ON x.enrollment_id=e.id
  LEFT JOIN goals g ON g.enrollment_id=e.id
  LEFT JOIN actions a ON a.enrollment_id=e.id
  LEFT JOIN satisfaction sat ON sat.enrollment_id=e.id
  ORDER BY e.cohort_label, e.learner_display_name, e.id;
$$;

-- get_enrollment_progress remains the general learner/provider/admin API.  The
-- sponsor reporting function invokes it only after its exact cohort and
-- sponsor-organization checks have reduced the input set; this does not grant
-- sponsors direct table access or change the API's scalar progress contract.
DROP FUNCTION IF EXISTS public.get_enrollment_progress(uuid,date);
CREATE OR REPLACE FUNCTION public.get_enrollment_progress(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE(module public.programme_module_type, full_completion_pct numeric,
  due_adherence_pct numeric, pace_status text, completed_units integer,
  due_units integer, required_units integer, booked_units integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH authorized AS (
    SELECT 1 FROM public.programme_enrollments e
    LEFT JOIN public.cohorts c ON c.id=e.cohort_id
    WHERE e.id=p_enrollment_id AND (
      e.user_id=auth.uid()
      OR public.has_role(auth.uid(),'admin'::public.app_role)
      OR public.coach_has_client(auth.uid(),e.user_id)
      OR EXISTS (SELECT 1 FROM public.sponsor_profiles sp
                 WHERE sp.user_id=auth.uid()
                   AND sp.organization_id=c.organization_id)
    )
  ), snapshots AS (
    SELECT s.* FROM public.enrollment_module_snapshots s
    JOIN authorized ON true WHERE s.enrollment_id=p_enrollment_id
  ), activity AS (
    SELECT 'coaching'::public.programme_module_type module,enrollment_id,status::text,start_time::date occurred_on FROM public.sessions
    UNION ALL SELECT 'peer_coaching',enrollment_id,status::text,start_time::date FROM public.peer_sessions
    UNION ALL SELECT 'peer_coaching',enrollment_id,status::text,start_time::date FROM public.coachee_peer_sessions
    UNION ALL SELECT 'mentoring',enrollment_id,status::text,start_time::date FROM public.mentoring_sessions
    UNION ALL SELECT 'triads',coach_enrollment_id,status::text,coalesce(start_time,proposed_start_time)::date FROM public.triad_sessions WHERE coach_enrollment_id IS NOT NULL
    UNION ALL SELECT 'triads',coachee_enrollment_id,status::text,coalesce(start_time,proposed_start_time)::date FROM public.triad_sessions WHERE coachee_enrollment_id IS NOT NULL
    UNION ALL SELECT 'triads',observer_enrollment_id,status::text,coalesce(start_time,proposed_start_time)::date FROM public.triad_sessions WHERE observer_enrollment_id IS NOT NULL
    UNION ALL SELECT 'training',enrollment_id,'completed',completed_at::date FROM public.training_progress WHERE completed_at IS NOT NULL
  ), counts AS (
    SELECT s.id,count(a.*) FILTER (WHERE a.status='completed' AND a.occurred_on<=p_as_of)::integer completed,
      least(count(a.*) FILTER (WHERE a.status IN ('pending_coach_approval','confirmed') AND a.occurred_on>=p_as_of),
        greatest(s.required_units-count(a.*) FILTER (WHERE a.status='completed' AND a.occurred_on<=p_as_of),0))::integer booked
    FROM snapshots s LEFT JOIN activity a ON a.enrollment_id=s.enrollment_id AND a.module=s.module GROUP BY s.id, s.required_units
  ), due AS (
    SELECT s.id,coalesce(sum(m.required_units) FILTER (WHERE m.due_on<=p_as_of),0)::integer units_due
    FROM snapshots s LEFT JOIN public.enrollment_module_milestones m ON m.enrollment_module_snapshot_id=s.id GROUP BY s.id
  )
  SELECT s.module,CASE WHEN s.required_units=0 THEN NULL ELSE round(least(c.completed,s.required_units)*100.0/s.required_units,1) END,
    CASE WHEN d.units_due=0 THEN NULL ELSE round(least(c.completed,d.units_due)*100.0/d.units_due,1) END,
    CASE WHEN s.required_units=0 OR c.completed>=s.required_units THEN 'completed'
      WHEN d.units_due=0 THEN 'not_yet_due' WHEN c.completed>=d.units_due THEN
        CASE WHEN c.completed>d.units_due THEN 'ahead' ELSE 'on_track' END
      WHEN c.completed+c.booked>=d.units_due THEN 'scheduled' ELSE 'behind' END,
    c.completed,d.units_due,s.required_units,c.booked
  FROM snapshots s JOIN counts c ON c.id=s.id JOIN due d ON d.id=s.id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_enrollment_progress(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_progress(uuid,date) TO authenticated;

DROP FUNCTION IF EXISTS public.sponsor_cohort_summaries(uuid);
CREATE OR REPLACE FUNCTION public.sponsor_cohort_summaries(
  p_cohort_id uuid DEFAULT NULL
)
RETURNS TABLE (
  cohort_id uuid,
  cohort_label text,
  programme_label text,
  enrollment_count integer,
  suppressed boolean,
  required_units integer,
  completed_units integer,
  due_units integer,
  due_adherence_pct numeric,
  pace_status text,
  coaching_completed_count integer,
  mentoring_completed_count integer,
  peer_completed_count integer,
  triad_completed_count integer,
  goal_count integer,
  open_action_count integer,
  completed_action_count integer
  ,active_count integer
  ,at_risk_count integer
  ,paused_count integer
  ,completed_count integer
  ,not_yet_due_count integer
  ,ahead_count integer
  ,on_track_count integer
  ,scheduled_count integer
  ,behind_count integer
  ,full_completion_pct numeric
  ,booked_units integer
  ,overdue_units integer
  ,schedule_coverage_pct numeric
  ,completed_pace_count integer
  ,satisfaction_avg numeric
  ,satisfaction_rated_count integer
  ,goal_setup_count integer
  ,goal_progress_pct numeric
  ,total_action_count integer
  ,action_completion_pct numeric
  ,on_track_pct numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH sponsor AS (
    SELECT organization_id FROM public.sponsor_profiles WHERE user_id = auth.uid()
  ), cohort_list AS (
    SELECT c.id AS cohort_id, c.name AS cohort_label, p.name AS programme_label,
           count(e.id)::integer AS enrollment_count
    FROM public.cohorts c
    JOIN public.programmes p ON p.id = c.programme_id
    JOIN sponsor s ON s.organization_id = c.organization_id
    LEFT JOIN public.programme_enrollments e ON e.cohort_id = c.id
    WHERE p_cohort_id IS NULL OR c.id = p_cohort_id
    GROUP BY c.id, c.name, p.name
  ), rows AS (
    SELECT
      cl.cohort_id AS scoped_cohort_id,
      r.required_units,
      r.completed_units,
      r.due_units,
      r.pace_status,
      r.coaching_completed_count,
      r.mentoring_completed_count,
      r.peer_completed_count,
      r.triad_completed_count,
      r.goal_count,
      r.open_action_count,
      r.completed_action_count,
      r.total_action_count,
      r.action_completion_pct,
      r.goal_setup,
      r.goal_progress_pct,
      r.satisfaction_avg,
      r.satisfaction_rated_count,
      r.overdue_units,
      r.booked_units,
      r.enrollment_status
    FROM cohort_list cl
    LEFT JOIN LATERAL public.sponsor_enrollment_summaries(cl.cohort_id) r ON true
  ), grouped AS (
    SELECT cl.cohort_id, cl.cohort_label, cl.programme_label, cl.enrollment_count AS n,
      sum(r.required_units)::integer required_units, sum(r.completed_units)::integer completed_units,
      sum(r.due_units)::integer due_units,
      least(100, round(sum(r.completed_units) * 100.0 / nullif(sum(r.due_units),0), 1)) due_adherence_pct,
      sum(r.coaching_completed_count)::integer coaching,
      sum(r.mentoring_completed_count)::integer mentoring,
      sum(r.peer_completed_count)::integer peer,
      sum(r.triad_completed_count)::integer triad,
      sum(r.goal_count)::integer goals, sum(r.open_action_count)::integer open_actions,
      sum(r.completed_action_count)::integer completed_actions,
      sum(r.total_action_count)::integer total_actions,
      round(sum(r.completed_action_count) * 100.0 / nullif(sum(r.total_action_count),0),1) action_completion_pct,
      count(*) FILTER (WHERE r.goal_setup)::integer goal_setup_count,
      round(avg(r.goal_progress_pct),1) goal_progress_pct,
      sum(r.satisfaction_avg * r.satisfaction_rated_count) / nullif(sum(r.satisfaction_rated_count),0) satisfaction_avg,
      sum(r.satisfaction_rated_count)::integer satisfaction_rated_count,
       count(*) FILTER (WHERE r.pace_status='behind')::integer behind,
      count(*) FILTER (WHERE r.pace_status='scheduled')::integer scheduled,
      count(*) FILTER (WHERE r.pace_status='on_track')::integer on_track,
      count(*) FILTER (WHERE r.pace_status='ahead')::integer ahead,
       count(*) FILTER (WHERE r.pace_status='completed')::integer finished,
       count(*) FILTER (WHERE r.enrollment_status='active')::integer active_count,
       count(*) FILTER (WHERE r.enrollment_status='at_risk')::integer at_risk_count,
       count(*) FILTER (WHERE r.enrollment_status='paused')::integer paused_count,
       count(*) FILTER (WHERE r.enrollment_status='completed')::integer completed_count,
       count(*) FILTER (WHERE r.pace_status='not_yet_due')::integer not_yet_due_count,
       round(count(*) FILTER (WHERE r.pace_status='on_track') * 100.0 /
         nullif(cl.enrollment_count,0),1) on_track_pct,
       sum(r.overdue_units)::integer overdue_units
      ,least(100, round(sum(r.completed_units) * 100.0 / nullif(sum(r.required_units),0),1)) full_completion_pct
      ,sum(r.booked_units)::integer booked_units
      ,least(100, round(sum(r.completed_units + r.booked_units) * 100.0 / nullif(sum(r.due_units),0),1)) schedule_coverage_pct
      ,count(*) FILTER (WHERE r.pace_status='completed')::integer completed_pace_count
    FROM cohort_list cl
    LEFT JOIN rows r ON r.scoped_cohort_id = cl.cohort_id
    GROUP BY cl.cohort_id, cl.cohort_label, cl.programme_label, cl.enrollment_count
  )
  SELECT cohort_id, cohort_label, programme_label,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE n END,
    n < public.sponsor_min_leaders_for_distribution(),
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE required_units END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE completed_units END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE due_units END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE due_adherence_pct END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL
      WHEN behind > 0 THEN 'behind' WHEN scheduled > 0 THEN 'scheduled'
      WHEN on_track > 0 THEN 'on_track' WHEN ahead > 0 THEN 'ahead'
      WHEN finished = n THEN 'completed' ELSE 'not_yet_due' END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE coaching END, CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE mentoring END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE peer END, CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE triad END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE goals END, CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE open_actions END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE completed_actions END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE active_count END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE at_risk_count END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE paused_count END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE completed_count END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE not_yet_due_count END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE ahead END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE on_track END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE scheduled END,
     CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE behind END
     ,CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE full_completion_pct END
     ,CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE booked_units END
     ,CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE overdue_units END
     ,CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE schedule_coverage_pct END
     ,CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE completed_pace_count END
     ,CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE satisfaction_avg END
     ,CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE satisfaction_rated_count END
     ,CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE goal_setup_count END
     ,CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE goal_progress_pct END
     ,CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE total_actions END
     ,CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE action_completion_pct END
     ,CASE WHEN n < public.sponsor_min_leaders_for_distribution() THEN NULL ELSE on_track_pct END
  FROM grouped ORDER BY cohort_label;
$$;

REVOKE ALL ON FUNCTION public.sponsor_enrollment_summaries(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sponsor_cohort_summaries(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_enrollment_summaries(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_cohort_summaries(uuid) TO authenticated;

-- Numeric-only satisfaction aggregate. It deliberately exposes no session
-- text, provider identity, comments, or private notes.
DROP FUNCTION IF EXISTS public.sponsor_satisfaction_summary(uuid);
CREATE OR REPLACE FUNCTION public.sponsor_satisfaction_summary(p_cohort_id uuid)
RETURNS TABLE(cohort_id uuid, rated_session_count integer, avg_rating numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT e.cohort_id,
         CASE WHEN count(DISTINCT e.id) < public.sponsor_min_leaders_for_distribution()
           THEN NULL ELSE count(s.coachee_rating)::integer END,
         CASE WHEN count(DISTINCT e.id) < public.sponsor_min_leaders_for_distribution()
           THEN NULL ELSE round(avg(s.coachee_rating)::numeric,2) END
  FROM public.programme_enrollments e
  JOIN public.cohorts c ON c.id=e.cohort_id
  JOIN public.sponsor_profiles sp ON sp.organization_id=c.organization_id
  LEFT JOIN public.sessions s ON s.enrollment_id=e.id AND s.status='completed' AND s.coachee_rating IS NOT NULL
   WHERE sp.user_id=auth.uid() AND e.cohort_id=p_cohort_id
  GROUP BY e.cohort_id;
$$;
REVOKE ALL ON FUNCTION public.sponsor_satisfaction_summary(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_satisfaction_summary(uuid) TO authenticated;