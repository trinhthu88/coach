-- ===========================================================================
-- Browser-computed numbers move to SQL (Prompt 15, Part B)
--
-- Each fact is one SQL construction with a role wrapper; the page renders it.
--
--   6. admin_dashboard_summary(), admin_analytics_summary(): held sessions and
--      hours over reporting_enrollments() -- Coaching and Mentoring sessions
--      held, Peer counted in canonical units (canonical_peer_requirement_
--      fulfilment), coach-pool practice separately; "at risk" is
--      sponsor_needs_attention over the ongoing reported enrollments.
--   7. admin_programme_training_engagement(programme): per Training week,
--      over canonical_training_week_fulfilment of the programme's ongoing
--      reported enrollments (Admin Analytics and the weekly admin email).
--   8. coach_client_summary(): per client of the calling Coach, the current
--      enrollment chosen here, its canonical progress, sessions with this
--      Coach, the next one, and actions overdue as of programme_today().
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 6. Held sessions, the one construction behind the Admin counts
-- ---------------------------------------------------------------------------
-- kind: coaching | mentoring | peer (a canonical Peer unit: one per learner
-- and requirement) | practice (coach-pool Peer practice, earns no unit).
CREATE OR REPLACE FUNCTION public.reported_held_sessions_internal()
 RETURNS TABLE(kind text, enrollment_id uuid, session_id uuid, held_on date, duration_minutes integer,
               provider_id uuid, learner_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT 'coaching', s.enrollment_id, s.id, (s.start_time AT TIME ZONE public.programme_time_zone())::date,
         s.duration_minutes, s.coach_id, s.coachee_id
  FROM public.sessions s JOIN public.reporting_enrollments() r ON r.enrollment_id = s.enrollment_id
  WHERE s.status = 'completed'
  UNION ALL
  SELECT 'mentoring', m.enrollment_id, m.id, (m.start_time AT TIME ZONE public.programme_time_zone())::date,
         m.duration_minutes, m.mentor_id, m.mentee_id
  FROM public.mentoring_sessions m JOIN public.reporting_enrollments() r ON r.enrollment_id = m.enrollment_id
  WHERE m.status = 'completed'
  UNION ALL
  SELECT 'peer', r.enrollment_id, f.peer_session_id, f.fulfilled_on, c.duration_minutes, c.peer_provider_id, r.user_id
  FROM public.reporting_enrollments() r
  CROSS JOIN LATERAL public.canonical_peer_requirement_fulfilment(r.enrollment_id) f
  JOIN public.coachee_peer_sessions c ON c.id = f.peer_session_id
  WHERE f.fulfilled_on IS NOT NULL
  UNION ALL
  SELECT 'practice', p.enrollment_id, p.id, (p.start_time AT TIME ZONE public.programme_time_zone())::date,
         p.duration_minutes, p.peer_coach_id, p.peer_coachee_id
  FROM public.peer_sessions p JOIN public.reporting_enrollments() r ON r.enrollment_id = p.enrollment_id
  WHERE p.status = 'completed';
$function$;
REVOKE ALL ON FUNCTION public.reported_held_sessions_internal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reported_held_sessions_internal() TO service_role;

-- The Admin dashboard: held sessions this month and over the last eight
-- months (programme sessions and practice apart), and the upcoming Coaching
-- sessions that still have no meeting link.
CREATE OR REPLACE FUNCTION public.admin_dashboard_summary(p_as_of date DEFAULT public.programme_today())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_month date := date_trunc('month', p_as_of)::date;
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an Admin may read the dashboard summary' USING ERRCODE = '42501';
  END IF;
  WITH held AS (
    SELECT h.kind, date_trunc('month', h.held_on)::date AS month
    FROM public.reported_held_sessions_internal() h
    WHERE h.held_on >= (v_month - interval '7 months')::date AND h.held_on <= p_as_of
  ), months AS (
    SELECT (v_month - make_interval(months => g))::date AS month FROM generate_series(7, 0, -1) g
  ), monthly AS (
    SELECT m.month,
      count(h.kind) FILTER (WHERE h.kind <> 'practice')::integer AS sessions,
      count(h.kind) FILTER (WHERE h.kind = 'practice')::integer AS practice
    FROM months m LEFT JOIN held h ON h.month = m.month
    GROUP BY m.month
  )
  SELECT jsonb_build_object(
    'month', v_month,
    'sessions_this_month', (SELECT sessions FROM monthly WHERE month = v_month),
    'practice_this_month', (SELECT practice FROM monthly WHERE month = v_month),
    'monthly', (SELECT jsonb_agg(jsonb_build_object('month', month, 'sessions', sessions, 'practice', practice) ORDER BY month) FROM monthly),
    'pending_link_sessions', (
      SELECT count(*)::integer FROM public.sessions s JOIN public.reporting_enrollments() r ON r.enrollment_id = s.enrollment_id
      WHERE s.status IN ('pending_coach_approval', 'confirmed') AND s.start_time >= now()
        AND nullif(btrim(s.meeting_url), '') IS NULL))
  INTO v_out;
  RETURN v_out;
END;
$function$;

-- Admin Analytics: the same held sessions in total, hours, the learners, at
-- risk (the Sponsor rule), satisfaction, Coaches by delivered sessions, and
-- coach-pool practice with its competency feedback.
CREATE OR REPLACE FUNCTION public.admin_analytics_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
  v_competencies constant text[] := ARRAY['ethical_practice', 'coaching_mindset', 'maintains_agreements', 'trust_safety',
    'maintains_presence', 'listens_actively', 'evokes_awareness', 'facilitates_growth'];
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an Admin may read the analytics summary' USING ERRCODE = '42501';
  END IF;
  WITH held AS (
    SELECT * FROM public.reported_held_sessions_internal()
  ), hours AS (
    -- A session's hours once, however many learners it counts for.
    SELECT DISTINCT kind = 'practice' AS practice, kind IN ('coaching') AS coaching, session_id, duration_minutes FROM held
  ), ongoing AS (
    SELECT r.enrollment_id FROM public.reporting_enrollments() r WHERE public.enrollment_is_ongoing(r.enrollment_id)
  ), attention AS (
    SELECT count(*)::integer AS n FROM ongoing o
    CROSS JOIN LATERAL public.canonical_enrollment_progress(o.enrollment_id, public.programme_today()) p
    WHERE p.progress_available AND public.sponsor_needs_attention(p.pace_status, p.overdue_units)
  ), ratings AS (
    SELECT s.rating FROM public.reporting_enrollments() r
    CROSS JOIN LATERAL public.canonical_enrollment_satisfaction(r.enrollment_id) s
  ), coaches AS (
    SELECT h.provider_id AS coach_id, count(*)::integer AS delivered, count(DISTINCT h.learner_id)::integer AS coachees
    FROM held h WHERE h.kind = 'coaching' GROUP BY h.provider_id
  ), practice AS (
    SELECT x.id, sum(x.given)::integer AS given, sum(x.received)::integer AS received FROM (
      SELECT provider_id AS id, 1 AS given, 0 AS received FROM held WHERE kind = 'practice'
      UNION ALL SELECT learner_id, 0, 1 FROM held WHERE kind = 'practice') x
    GROUP BY x.id
  ), feedback AS (
    SELECT f.* FROM public.peer_session_competency_feedback f
    JOIN public.peer_sessions p ON p.id = f.peer_session_id
    JOIN public.reporting_enrollments() r ON r.enrollment_id = p.enrollment_id
  ), feedback_values AS (
    SELECT f.peer_coach_id, k.key, (to_jsonb(f) ->> k.key)::numeric AS v
    FROM feedback f CROSS JOIN unnest(v_competencies) k(key)
    WHERE to_jsonb(f) ->> k.key IS NOT NULL
  ), coach_competency AS (
    -- The mean of the eight competency means, as the page showed it.
    SELECT peer_coach_id, round(avg(per_key), 2) AS avg_comp FROM (
      SELECT peer_coach_id, key, avg(v) AS per_key FROM feedback_values GROUP BY peer_coach_id, key) k
    GROUP BY peer_coach_id
  )
  SELECT jsonb_build_object(
    'coaching_sessions', (SELECT count(*) FROM held WHERE kind = 'coaching'),
    'mentoring_sessions', (SELECT count(*) FROM held WHERE kind = 'mentoring'),
    'peer_units', (SELECT count(*) FROM held WHERE kind = 'peer'),
    'practice_sessions', (SELECT count(*) FROM held WHERE kind = 'practice'),
    'total_minutes', (SELECT coalesce(sum(duration_minutes), 0) FROM hours),
    'learners_enrolled', (SELECT count(DISTINCT user_id) FROM public.reporting_enrollments()),
    'at_risk', (SELECT n FROM attention),
    'satisfaction', (SELECT jsonb_build_object(
        'average', round(avg(rating), 2), 'rated', count(*),
        'distribution', jsonb_build_array(count(*) FILTER (WHERE rating = 1), count(*) FILTER (WHERE rating = 2),
          count(*) FILTER (WHERE rating = 3), count(*) FILTER (WHERE rating = 4), count(*) FILTER (WHERE rating = 5)))
      FROM ratings),
    'top_coaches', coalesce((SELECT jsonb_agg(jsonb_build_object('coach_id', c.coach_id, 'name', pr.full_name,
        'delivered', c.delivered, 'coachees', c.coachees,
        'rating', CASE WHEN cp.rating_avg IS NULL THEN NULL ELSE cp.rating_avg END) ORDER BY c.delivered DESC, pr.full_name)
      FROM (SELECT * FROM coaches ORDER BY delivered DESC LIMIT 10) c
      JOIN public.profiles pr ON pr.id = c.coach_id
      LEFT JOIN public.coach_profiles cp ON cp.id = c.coach_id), '[]'::jsonb),
    'practice_by_coach', coalesce((SELECT jsonb_agg(jsonb_build_object('coach_id', cp.id, 'name', pr.full_name,
        'given', coalesce(pc.given, 0), 'received', coalesce(pc.received, 0), 'avg_competency', cc.avg_comp)
        ORDER BY coalesce(pc.given, 0) DESC, pr.full_name)
      FROM public.coach_profiles cp
      JOIN public.profiles pr ON pr.id = cp.id
      LEFT JOIN practice pc ON pc.id = cp.id
      LEFT JOIN coach_competency cc ON cc.peer_coach_id = cp.id
      WHERE cp.peer_coaching_opt_in), '[]'::jsonb),
    'practice_feedback_count', (SELECT count(*) FROM feedback),
    'competency_avg', coalesce((SELECT jsonb_object_agg(key, round(avg_v, 2)) FROM (
        SELECT key, avg(v) AS avg_v FROM feedback_values GROUP BY key) a), '{}'::jsonb))
  INTO v_out;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_dashboard_summary(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_analytics_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_summary(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_analytics_summary() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Training engagement per week, from the canonical week fulfilment
-- ---------------------------------------------------------------------------
-- One row per visible Training week of the programme and a total row
-- (is_total). Counts are learners (the programme's ongoing reported
-- enrollments); a percentage is over the learners for whom the part is
-- required, NULL when nobody has it.
CREATE OR REPLACE FUNCTION public.admin_programme_training_engagement(p_programme_id uuid)
 RETURNS TABLE(training_week_id uuid, week_number integer, title text, is_total boolean, enrolled_count integer,
               completed_count integer, skill_card_completed_count integer, skill_card_pct numeric,
               quiz_completed_count integer, quiz_pct numeric, quiz_avg_score numeric,
               reflection_completed_count integer, reflection_pct numeric,
               prompt_responded_count integer, prompt_pct numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Only an Admin may read Training engagement' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH learners AS (
    SELECT r.enrollment_id FROM public.reporting_enrollments() r
    WHERE r.programme_id = p_programme_id AND public.enrollment_is_ongoing(r.enrollment_id)
  ), weeks AS (
    SELECT tw.id, tw.week_number, tw.title FROM public.training_weeks tw
    WHERE tw.programme_id = p_programme_id AND tw.is_visible
  ), facts AS (
    SELECT l.enrollment_id, f.*
    FROM learners l CROSS JOIN LATERAL public.canonical_training_week_fulfilment(l.enrollment_id, public.programme_today()) f
    JOIN weeks w ON w.id = f.training_week_id
  ), scores AS (
    SELECT a.training_week_id AS week_id, avg(s.score_pct) AS avg_score
    FROM public.assignment_submissions s
    JOIN public.assignments a ON a.id = s.assignment_id AND a.assignment_type = 'quiz' AND a.is_visible
    JOIN learners l ON l.enrollment_id = s.enrollment_id
    WHERE a.training_week_id IN (SELECT id FROM weeks) AND s.score_pct IS NOT NULL
    GROUP BY a.training_week_id
  ), per_week AS (
    SELECT w.id, w.week_number, w.title,
      (SELECT count(*) FROM learners)::integer AS enrolled,
      count(f.enrollment_id) FILTER (WHERE f.week_complete)::integer AS completed,
      count(f.enrollment_id) FILTER (WHERE f.skill_card_required)::integer AS sc_req,
      count(f.enrollment_id) FILTER (WHERE f.skill_card_required AND f.skill_card_completed)::integer AS sc_done,
      count(f.enrollment_id) FILTER (WHERE f.quiz_required)::integer AS q_req,
      count(f.enrollment_id) FILTER (WHERE f.quiz_required AND f.quiz_completed)::integer AS q_done,
      count(f.enrollment_id) FILTER (WHERE f.reflection_required)::integer AS r_req,
      count(f.enrollment_id) FILTER (WHERE f.reflection_required AND f.reflection_completed)::integer AS r_done,
      count(f.enrollment_id) FILTER (WHERE f.daily_prompts_required > 0)::integer AS p_req,
      count(f.enrollment_id) FILTER (WHERE f.daily_prompts_required > 0 AND f.daily_prompts_completed > 0)::integer AS p_done
    FROM weeks w LEFT JOIN facts f ON f.training_week_id = w.id
    GROUP BY w.id, w.week_number, w.title
  ), pct AS (
    SELECT p.*, sc.avg_score FROM per_week p LEFT JOIN scores sc ON sc.week_id = p.id
  )
  SELECT x.id, x.week_number, x.title, false, x.enrolled, x.completed,
    x.sc_done, round(100.0 * x.sc_done / nullif(x.sc_req, 0), 1),
    x.q_done, round(100.0 * x.q_done / nullif(x.q_req, 0), 1), round(x.avg_score, 1),
    x.r_done, round(100.0 * x.r_done / nullif(x.r_req, 0), 1),
    x.p_done, round(100.0 * x.p_done / nullif(x.p_req, 0), 1)
  FROM pct x
  UNION ALL
  SELECT NULL::uuid, NULL::integer, NULL::text, true, (SELECT count(*) FROM learners)::integer,
    sum(x.completed)::integer,
    sum(x.sc_done)::integer, round(100.0 * sum(x.sc_done) / nullif(sum(x.sc_req), 0), 1),
    sum(x.q_done)::integer, round(100.0 * sum(x.q_done) / nullif(sum(x.q_req), 0), 1),
    (SELECT round(avg(s.score_pct), 1) FROM public.assignment_submissions s
       JOIN public.assignments a ON a.id = s.assignment_id AND a.assignment_type = 'quiz' AND a.is_visible
       JOIN learners l ON l.enrollment_id = s.enrollment_id
      WHERE a.training_week_id IN (SELECT id FROM weeks) AND s.score_pct IS NOT NULL),
    sum(x.r_done)::integer, round(100.0 * sum(x.r_done) / nullif(sum(x.r_req), 0), 1),
    sum(x.p_done)::integer, round(100.0 * sum(x.p_done) / nullif(sum(x.p_req), 0), 1)
  FROM pct x
  ORDER BY 4, 2;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_programme_training_engagement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_programme_training_engagement(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. A Coach's clients
-- ---------------------------------------------------------------------------
-- A client: a learner with a confirmed or completed Coaching session with the
-- calling Coach, or the learner of an engagement the Coach is assigned to.
-- Their current enrollment is chosen here: of the enrollments this Coach
-- coaches in (a session, or the cohort's Coach pool), the ongoing one, else
-- the latest. Sessions, actions, goals and milestones are those of this
-- Coach's sessions in that enrollment.
CREATE OR REPLACE FUNCTION public.coach_client_summary()
 RETURNS TABLE(client_id uuid, full_name text, email text, avatar_url text, enrollment_id uuid,
               progress_available boolean, completion_pct numeric, pace_status text,
               total_sessions integer, completed_sessions integer, cancelled_sessions integer,
               upcoming_sessions integer, first_session_at timestamptz, last_session_at timestamptz,
               next_session_at timestamptz, action_items_total integer, action_items_done integer,
               overdue_actions integer, goals jsonb, milestones_done integer, milestones_total integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH me AS (SELECT auth.uid() AS id WHERE auth.uid() IS NOT NULL),
  linked AS (
    SELECT s.coachee_id AS client_id, s.enrollment_id FROM public.sessions s, me
    WHERE s.coach_id = me.id AND s.status IN ('confirmed', 'completed') AND s.enrollment_id IS NOT NULL
    UNION
    SELECT e.user_id, e.id FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id AND c.kind = 'engagement'
    JOIN public.cohort_coach_assignments a ON a.cohort_id = c.id, me
    WHERE a.coach_id = me.id
  ), current AS (
    SELECT DISTINCT ON (l.client_id) l.client_id, l.enrollment_id
    FROM linked l JOIN public.programme_enrollments e ON e.id = l.enrollment_id
    ORDER BY l.client_id, public.enrollment_is_ongoing(l.enrollment_id) DESC, e.start_date DESC NULLS LAST, e.created_at DESC
  ), my_sessions AS (
    SELECT s.*, cu.client_id FROM current cu JOIN public.sessions s ON s.enrollment_id = cu.enrollment_id, me
    WHERE s.coach_id = me.id AND s.coachee_id = cu.client_id
  ), actions AS (
    SELECT a.*, ms.client_id FROM my_sessions ms
    JOIN public.enrollment_actions a ON a.source_activity_type = 'coaching' AND a.source_activity_id = ms.id
  ), milestones AS (
    SELECT DISTINCT m.id, m.goal_id, m.is_done, a.client_id FROM actions a JOIN public.coachee_milestones m ON m.id = a.milestone_id
  )
  SELECT cu.client_id, pr.full_name, pr.email, pr.avatar_url, cu.enrollment_id,
    coalesce(p.progress_available, false),
    CASE WHEN p.progress_available THEN p.full_completion_pct END,
    CASE WHEN p.progress_available THEN p.pace_status END,
    (SELECT count(*) FROM my_sessions ms WHERE ms.client_id = cu.client_id)::integer,
    (SELECT count(*) FROM my_sessions ms WHERE ms.client_id = cu.client_id AND ms.status = 'completed')::integer,
    (SELECT count(*) FROM my_sessions ms WHERE ms.client_id = cu.client_id AND ms.status = 'cancelled')::integer,
    (SELECT count(*) FROM my_sessions ms WHERE ms.client_id = cu.client_id
       AND ms.status IN ('pending_coach_approval', 'confirmed') AND ms.start_time >= now())::integer,
    (SELECT min(ms.start_time) FROM my_sessions ms WHERE ms.client_id = cu.client_id),
    (SELECT max(ms.start_time) FROM my_sessions ms WHERE ms.client_id = cu.client_id AND ms.status = 'completed'),
    (SELECT min(ms.start_time) FROM my_sessions ms WHERE ms.client_id = cu.client_id
       AND ms.status IN ('pending_coach_approval', 'confirmed') AND ms.start_time >= now()),
    (SELECT count(*) FROM actions a WHERE a.client_id = cu.client_id)::integer,
    (SELECT count(*) FROM actions a WHERE a.client_id = cu.client_id AND a.status = 'completed')::integer,
    (SELECT count(*) FROM actions a WHERE a.client_id = cu.client_id AND a.status <> 'completed'
       AND a.due_date IS NOT NULL AND a.due_date < public.programme_today())::integer,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'status', g.status) ORDER BY g.created_at)
              FROM public.coachee_goals g WHERE g.id IN (SELECT m.goal_id FROM milestones m WHERE m.client_id = cu.client_id)), '[]'::jsonb),
    (SELECT count(*) FROM milestones m WHERE m.client_id = cu.client_id AND m.is_done)::integer,
    (SELECT count(*) FROM milestones m WHERE m.client_id = cu.client_id)::integer
  FROM current cu
  JOIN public.profiles pr ON pr.id = cu.client_id
  LEFT JOIN LATERAL public.canonical_enrollment_progress(cu.enrollment_id, public.programme_today()) p ON true
  ORDER BY pr.full_name;
$function$;
REVOKE ALL ON FUNCTION public.coach_client_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_client_summary() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. The next session, per module
-- ---------------------------------------------------------------------------
-- One construction over canonical_session_history: per module (practice
-- apart) the earliest live session still ahead -- requested, confirmed or
-- proposed -- with what the dashboard cards show about it.
CREATE OR REPLACE FUNCTION public.canonical_next_session_by_module(p_enrollment_id uuid)
 RETURNS TABLE(module public.programme_module_type, is_practice boolean, session_key text, source_table text,
               source_id uuid, start_time timestamptz, status text, title text, counterpart_names text[],
               upcoming_count integer, prep_file_submitted boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH live AS (
    SELECT h.*, h.source_table = 'peer_sessions' AS practice
    FROM public.canonical_session_history(p_enrollment_id) h
    WHERE h.status IN ('pending_coach_approval', 'confirmed', 'proposed') AND h.start_time >= now()
  ), counted AS (
    SELECT l.*, count(*) OVER (PARTITION BY l.module, l.practice)::integer AS n FROM live l
  )
  SELECT DISTINCT ON (c.module, c.practice) c.module, c.practice, c.session_key, c.source_table, c.source_id,
    c.start_time, c.status, c.title, c.counterpart_names, c.n,
    CASE WHEN c.source_table = 'mentoring_sessions'
         THEN EXISTS (SELECT 1 FROM public.mentoring_sessions m WHERE m.id = c.source_id AND m.prep_file_path IS NOT NULL) END
  FROM counted c
  ORDER BY c.module, c.practice, c.start_time;
$function$;
REVOKE ALL ON FUNCTION public.canonical_next_session_by_module(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_next_session_by_module(uuid) TO service_role;

-- The learner's own (coach-as-learner too). Keeps its earlier columns
-- (module, next_session_at, session_key) for the Sessions hub.
DROP FUNCTION IF EXISTS public.learner_next_session_by_module(uuid);
CREATE OR REPLACE FUNCTION public.learner_next_session_by_module(p_enrollment_id uuid)
 RETURNS TABLE(module public.programme_module_type, next_session_at timestamptz, session_key text,
               is_practice boolean, source_table text, source_id uuid, status text, title text,
               counterpart_names text[], upcoming_count integer, prep_file_submitted boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT n.module, n.start_time, n.session_key, n.is_practice, n.source_table, n.source_id, n.status, n.title,
    n.counterpart_names, n.upcoming_count, n.prep_file_submitted
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_next_session_by_module(e.id) n
  WHERE e.id = p_enrollment_id AND e.user_id = auth.uid() AND auth.uid() IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.learner_next_session_by_module(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_next_session_by_module(uuid) TO authenticated, service_role;

-- The calling Coach's side: the sessions they deliver (Coaching, Mentoring,
-- coach-pool practice given), read from each learner's canonical history.
-- Per module: the next one, how many are ahead, awaiting the Coach's answer,
-- delivered, and the learners served (confirmed or held).
CREATE OR REPLACE FUNCTION public.coach_next_session_by_module()
 RETURNS TABLE(module public.programme_module_type, is_practice boolean, source_table text, source_id uuid,
               start_time timestamptz, status text, title text, learner_name text, enrollment_id uuid,
               upcoming_count integer, pending_count integer, delivered_count integer, learner_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH me AS (SELECT auth.uid() AS id WHERE auth.uid() IS NOT NULL),
  enrollments AS (
    SELECT s.enrollment_id FROM public.sessions s, me WHERE s.coach_id = me.id AND s.enrollment_id IS NOT NULL
    UNION SELECT m.enrollment_id FROM public.mentoring_sessions m, me WHERE m.mentor_id = me.id AND m.enrollment_id IS NOT NULL
    UNION SELECT p.enrollment_id FROM public.peer_sessions p, me WHERE p.peer_coach_id = me.id AND p.enrollment_id IS NOT NULL
  ), mine AS (
    SELECT h.*, e.id AS enr, e.user_id AS learner_id, h.source_table = 'peer_sessions' AS practice
    FROM enrollments x
    JOIN public.programme_enrollments e ON e.id = x.enrollment_id
    CROSS JOIN LATERAL public.canonical_session_history(e.id) h, me
    WHERE (h.source_table = 'sessions' AND EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = h.source_id AND s.coach_id = me.id))
       OR (h.source_table = 'mentoring_sessions' AND EXISTS (SELECT 1 FROM public.mentoring_sessions m WHERE m.id = h.source_id AND m.mentor_id = me.id))
       OR (h.source_table = 'peer_sessions' AND h.participant_role <> 'provider'
           AND EXISTS (SELECT 1 FROM public.peer_sessions p WHERE p.id = h.source_id AND p.peer_coach_id = me.id))
  ), agg AS (
    SELECT m.module, m.practice,
      count(*) FILTER (WHERE m.status IN ('pending_coach_approval', 'confirmed', 'proposed') AND m.start_time >= now())::integer AS upcoming,
      count(*) FILTER (WHERE m.status = 'pending_coach_approval')::integer AS pending,
      count(*) FILTER (WHERE m.status = 'completed')::integer AS delivered,
      count(DISTINCT m.learner_id) FILTER (WHERE m.status IN ('confirmed', 'completed'))::integer AS learners
    FROM mine m GROUP BY m.module, m.practice
  ), nxt AS (
    SELECT DISTINCT ON (m.module, m.practice) m.*
    FROM mine m
    WHERE m.status IN ('pending_coach_approval', 'confirmed', 'proposed') AND m.start_time >= now()
    ORDER BY m.module, m.practice, m.start_time
  )
  SELECT a.module, a.practice, n.source_table, n.source_id, n.start_time, n.status, n.title, pr.full_name, n.enr,
    a.upcoming, a.pending, a.delivered, a.learners
  FROM agg a
  LEFT JOIN nxt n ON n.module = a.module AND n.practice = a.practice
  LEFT JOIN public.profiles pr ON pr.id = n.learner_id
  ORDER BY a.module, a.practice;
$function$;
REVOKE ALL ON FUNCTION public.coach_next_session_by_module() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_next_session_by_module() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. The learner's Training summary
-- ---------------------------------------------------------------------------
-- Quiz scores (one per Training quiz, as the database scored it) and their
-- mean; the Daily Prompt streak: consecutive answered prompts counted back
-- from the latest one already due -- a prompt is due once its week is open
-- (canonical_training_week_fulfilment.available_on) plus its day offset, in
-- programme time.
CREATE OR REPLACE FUNCTION public.learner_training_summary(p_enrollment_id uuid)
 RETURNS TABLE(quiz_avg numeric, quiz_scores jsonb, reflection_streak integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH mine AS (
    SELECT e.id FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id AND e.user_id = auth.uid() AND auth.uid() IS NOT NULL
  ), weeks AS (
    SELECT f.training_week_id, f.week_number, f.available_on
    FROM mine CROSS JOIN LATERAL public.canonical_training_week_fulfilment(mine.id, public.programme_today()) f
  ), scores AS (
    SELECT DISTINCT ON (a.id) w.week_number, s.score_pct
    FROM weeks w
    JOIN public.assignments a ON a.training_week_id = w.training_week_id AND a.assignment_type = 'quiz' AND a.is_visible
    JOIN public.assignment_submissions s ON s.assignment_id = a.id AND s.enrollment_id = p_enrollment_id AND s.score_pct IS NOT NULL
    ORDER BY a.id, s.attempt_no
  ), due AS (
    SELECT p.id, w.week_number, coalesce(p.day_offset, 1) AS day_offset,
      EXISTS (SELECT 1 FROM public.daily_prompt_responses r
              WHERE r.daily_prompt_id = p.id AND r.enrollment_id = p_enrollment_id AND r.responded_at IS NOT NULL) AS answered
    FROM weeks w
    JOIN public.daily_prompts p ON p.training_week_id = w.training_week_id AND p.is_visible
    WHERE w.available_on IS NOT NULL AND w.available_on + coalesce(p.day_offset, 1) - 1 <= public.programme_today()
  ), ranked AS (
    SELECT d.*, row_number() OVER (ORDER BY d.week_number DESC, d.day_offset DESC, d.id DESC) AS rn FROM due d
  )
  SELECT
    (SELECT round(avg(score_pct), 1) FROM scores),
    coalesce((SELECT jsonb_agg(jsonb_build_object('week_number', week_number, 'score_pct', score_pct) ORDER BY week_number) FROM scores), '[]'::jsonb),
    coalesce((SELECT min(rn) - 1 FROM ranked WHERE NOT answered), (SELECT count(*) FROM ranked))::integer
  FROM mine;
$function$;
REVOKE ALL ON FUNCTION public.learner_training_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_training_summary(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12. What each Coach has delivered (Admin -> Registrations)
-- ---------------------------------------------------------------------------
-- Held Coaching sessions per Coach and the learners they served, over the
-- reporting population -- the same held sessions Admin Analytics counts.
CREATE OR REPLACE FUNCTION public.admin_coach_delivery_summary()
 RETURNS TABLE(coach_id uuid, delivered_sessions integer, learners_served integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an Admin may read Coach delivery' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT h.provider_id, count(*)::integer, count(DISTINCT h.learner_id)::integer
  FROM public.reported_held_sessions_internal() h
  WHERE h.kind = 'coaching'
  GROUP BY h.provider_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_coach_delivery_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_coach_delivery_summary() TO authenticated, service_role;
