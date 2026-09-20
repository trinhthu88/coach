-- Ledger reconciliation for 20260918120000_canonical_enrollment_engagement.
--
-- The migration's SQL was applied to the hosted project with a raw query, so
-- its effects are live but supabase_migrations.schema_migrations has no row
-- for it. This script ONLY records the ledger row. It never re-runs the
-- migration, creates/alters/drops/grants anything, or touches application
-- data. It aborts unless every object the migration defines is present with
-- exactly the repository definition (md5 of the stored function body, which
-- PostgreSQL keeps verbatim) and the repository's execute grants.
--
-- Expected hashes are generated from the repository migration file; a
-- frontend test keeps them in sync with it.

BEGIN;

DO $guard$
DECLARE
  expected record;
  live_md5 text;
  live_auth boolean;
  live_anon boolean;
  live_secdef boolean;
  live_config text;
  live_count integer;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.canonical_goal_progress(uuid)', 'f6402de85614c547e007ddef96522167', false),
    ('public.canonical_enrollment_engagement(uuid)', '2e20dcae967c4856dcc82f8b398251fd', false),
    ('public.learner_canonical_engagement(uuid)', 'c255070730f2e11443777719de69e998', true),
    ('public.learner_canonical_goal_progress(uuid)', '0a2e5ca141771693764b3b74ada63478', true),
    ('public.sponsor_canonical_enrollment_metadata(uuid,uuid,date)', 'd693e0ef9723c2975abbe79bc0aed3c7', true)
    ) AS e(signature, body_md5, authenticated_exec)
  LOOP
    SELECT count(*) INTO live_count FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = split_part(split_part(expected.signature, '.', 2), '(', 1);
    IF live_count <> 1 THEN
      RAISE EXCEPTION 'Ledger reconciliation aborted: % has % live definitions (expected exactly 1)', expected.signature, live_count;
    END IF;
    SELECT md5(p.prosrc), has_function_privilege('authenticated', p.oid, 'execute'),
           has_function_privilege('anon', p.oid, 'execute'), p.prosecdef,
           coalesce(array_to_string(p.proconfig, ','), '')
      INTO live_md5, live_auth, live_anon, live_secdef, live_config
    FROM pg_proc p WHERE p.oid = expected.signature::regprocedure;
    IF live_md5 IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'Ledger reconciliation aborted: % body differs from the repository migration', expected.signature;
    END IF;
    IF live_auth IS DISTINCT FROM expected.authenticated_exec OR live_anon THEN
      RAISE EXCEPTION 'Ledger reconciliation aborted: % grants differ from the repository migration', expected.signature;
    END IF;
    IF NOT live_secdef OR live_config <> 'search_path=public, pg_temp' THEN
      RAISE EXCEPTION 'Ledger reconciliation aborted: % security settings differ from the repository migration', expected.signature;
    END IF;
  END LOOP;
END
$guard$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by)
SELECT '20260918120000', 'canonical_enrollment_engagement',
  ARRAY['-- One canonical goals / actions / programme-experience summary per enrollment.
--
-- Before this migration the same three aggregates were written twice in SQL
-- (sponsor_canonical_enrollment_metadata''s goals/actions/satisfaction CTEs
-- and sponsor_leader_engagement_summary) and a third time in TypeScript for
-- the learner self-view (useGoalRatingRows'' average + useEnrollmentActions
-- Summary''s counts), and the copies had drifted:
--   * sponsor totals counted cancelled enrollment_actions; the learner
--     excluded them ("a cancelled action is not a commitment the learner is
--     judged against" — the documented product rule in
--     useEnrollmentActionsSummary);
--   * the learner rounded each goal''s progress before averaging, the sponsor
--     averaged unrounded values;
--   * sponsor goal counts included archived goals (the learner''s "delete
--     goal" archives the row), and treated a Target below Start as negative
--     progress where the learner treated it as undefined.
-- The unified rules: archived goals and cancelled actions are excluded; a
-- goal needs Start, Current and a Target above Start to have progress.
--
-- canonical_goal_progress() is the single per-goal progress definition and
-- canonical_enrollment_engagement() the single enrollment summary (its
-- average goal progress is built from canonical_goal_progress). Both are
-- internal (no direct grant): sponsor_canonical_enrollment_metadata reads the
-- summary for Sponsor screens; learner_canonical_engagement() and
-- learner_canonical_goal_progress() expose them to the learner for their own
-- enrollment only (per-goal values are never exposed to a sponsor).
-- Only ids, ratings, counts and averages are returned — goal wording, action
-- detail and rating comments never are, so the sponsor privacy contract is
-- unchanged.

CREATE OR REPLACE FUNCTION public.canonical_goal_progress(
  p_enrollment_id uuid
)
RETURNS TABLE (
  goal_id uuid,
  has_rating boolean,
  start_rating smallint,
  current_rating smallint,
  target_rating smallint,
  progress_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    g.id,
    gr.id IS NOT NULL,
    gr.start_rating,
    gr.current_rating,
    gr.target_rating,
    CASE
      WHEN gr.target_rating IS NULL
        OR gr.start_rating IS NULL
        OR gr.current_rating IS NULL
        OR gr.target_rating <= gr.start_rating
      THEN NULL
      ELSE least(100, greatest(0,
        (gr.current_rating - gr.start_rating) * 100.0
          / (gr.target_rating - gr.start_rating)
      ))
    END::numeric
  FROM public.coachee_goals g
  LEFT JOIN public.coachee_goal_ratings gr
    ON gr.goal_id = g.id
   AND gr.enrollment_id = g.enrollment_id
  WHERE g.enrollment_id = p_enrollment_id
    AND g.status <> ''archived'';
$$;

REVOKE ALL ON FUNCTION public.canonical_goal_progress(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.canonical_enrollment_engagement(
  p_enrollment_id uuid
)
RETURNS TABLE (
  goal_count integer,
  goal_setup boolean,
  goal_progress_pct numeric,
  open_action_count integer,
  completed_action_count integer,
  total_action_count integer,
  action_completion_pct numeric,
  satisfaction_avg numeric,
  satisfaction_rated_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH goals AS (
    SELECT
      count(gp.goal_id)::integer AS goal_count,
      coalesce(bool_or(gp.has_rating), false) AS goal_setup,
      round(avg(gp.progress_pct), 1) AS goal_progress_pct
    FROM public.canonical_goal_progress(p_enrollment_id) gp
  ), actions AS (
    SELECT
      count(a.id) FILTER (WHERE a.status IN (''open'', ''in_progress''))::integer AS open_action_count,
      count(a.id) FILTER (WHERE a.status = ''completed'')::integer AS completed_action_count,
      count(a.id)::integer AS total_action_count
    FROM public.enrollment_actions a
    WHERE a.enrollment_id = p_enrollment_id
      AND a.status <> ''cancelled''
  ), satisfaction AS (
    SELECT
      round(avg(s.coachee_rating), 2) AS satisfaction_avg,
      count(s.id)::integer AS satisfaction_rated_count
    FROM public.sessions s
    WHERE s.enrollment_id = p_enrollment_id
      AND s.status = ''completed''
      AND s.coachee_rating IS NOT NULL
  )
  SELECT
    g.goal_count,
    g.goal_setup,
    g.goal_progress_pct,
    a.open_action_count,
    a.completed_action_count,
    a.total_action_count,
    CASE WHEN a.total_action_count = 0 THEN NULL
      ELSE round(a.completed_action_count * 100.0 / a.total_action_count, 1)
    END,
    s.satisfaction_avg,
    s.satisfaction_rated_count
  FROM goals g
  CROSS JOIN actions a
  CROSS JOIN satisfaction s;
$$;

REVOKE ALL ON FUNCTION public.canonical_enrollment_engagement(uuid)
  FROM PUBLIC, anon, authenticated;

-- Learner self-view: same row, authorized only for the enrollment''s own
-- learner (no sponsor organisation / cohort-size checks — those protect the
-- learner from a sponsor, not from themselves).
CREATE OR REPLACE FUNCTION public.learner_canonical_engagement(
  p_enrollment_id uuid
)
RETURNS TABLE (
  goal_count integer,
  goal_setup boolean,
  goal_progress_pct numeric,
  open_action_count integer,
  completed_action_count integer,
  total_action_count integer,
  action_completion_pct numeric,
  satisfaction_avg numeric,
  satisfaction_rated_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.*
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_enrollment_engagement(e.id) c
  WHERE e.id = p_enrollment_id
    AND e.user_id = auth.uid()
    AND auth.uid() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.learner_canonical_engagement(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.learner_canonical_engagement(uuid)
  TO authenticated;

-- Learner self-view: per-goal progress for the learner''s own enrollment,
-- the same values canonical_enrollment_engagement averages.
CREATE OR REPLACE FUNCTION public.learner_canonical_goal_progress(
  p_enrollment_id uuid
)
RETURNS TABLE (
  goal_id uuid,
  has_rating boolean,
  start_rating smallint,
  current_rating smallint,
  target_rating smallint,
  progress_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT gp.*
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_goal_progress(e.id) gp
  WHERE e.id = p_enrollment_id
    AND e.user_id = auth.uid()
    AND auth.uid() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.learner_canonical_goal_progress(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.learner_canonical_goal_progress(uuid)
  TO authenticated;

-- Sponsor metadata now reads the same definition instead of its own copy.
-- Progress columns and authorization (sponsor_canonical_enrollment_progress)
-- are unchanged.
CREATE OR REPLACE FUNCTION public.sponsor_canonical_enrollment_metadata(
  p_cohort_id uuid DEFAULT NULL,
  p_enrollment_id uuid DEFAULT NULL,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (
  enrollment_id uuid,
  learner_display_name text,
  programme_label text,
  cohort_id uuid,
  cohort_label text,
  programme_id uuid,
  enrollment_start_date date,
  enrollment_end_date date,
  programme_start_date date,
  programme_end_date date,
  enrollment_status public.enrollment_status,
  stored_enrollment_status public.enrollment_status,
  effective_enrollment_status public.enrollment_status,
  required_units integer,
  completed_units integer,
  due_units integer,
  booked_units integer,
  overdue_units integer,
  full_completion_pct numeric,
  due_adherence_pct numeric,
  pace_status text,
  progress_available boolean,
  coaching_required_units integer,
  coaching_completed_units integer,
  coaching_due_units integer,
  coaching_booked_units integer,
  training_required_units integer,
  training_completed_units integer,
  training_due_units integer,
  training_booked_units integer,
  peer_required_units integer,
  peer_completed_units integer,
  peer_due_units integer,
  peer_booked_units integer,
  mentoring_required_units integer,
  mentoring_completed_units integer,
  mentoring_due_units integer,
  mentoring_booked_units integer,
  triad_required_units integer,
  triad_completed_units integer,
  triad_due_units integer,
  triad_booked_units integer,
  goal_count integer,
  goal_setup boolean,
  goal_progress_pct numeric,
  open_action_count integer,
  completed_action_count integer,
  total_action_count integer,
  action_completion_pct numeric,
  satisfaction_avg numeric,
  satisfaction_rated_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT p.*
    FROM public.sponsor_canonical_enrollment_progress(p_cohort_id, p_as_of) p
    WHERE p_enrollment_id IS NULL OR p.enrollment_id = p_enrollment_id
  )
  SELECT b.*,
    coalesce(c.goal_count, 0),
    coalesce(c.goal_setup, false),
    c.goal_progress_pct,
    coalesce(c.open_action_count, 0),
    coalesce(c.completed_action_count, 0),
    coalesce(c.total_action_count, 0),
    c.action_completion_pct,
    c.satisfaction_avg,
    coalesce(c.satisfaction_rated_count, 0)
  FROM base b
  LEFT JOIN LATERAL public.canonical_enrollment_engagement(b.enrollment_id) c ON true
  ORDER BY b.cohort_label, b.learner_display_name, b.enrollment_id;
$$;

REVOKE ALL ON FUNCTION public.sponsor_canonical_enrollment_metadata(uuid, uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_enrollment_metadata(uuid, uuid, date)
  TO authenticated;
'],
  current_setting('ledger.recorded_by', true)
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations
  WHERE version = '20260918120000' OR name = 'canonical_enrollment_engagement'
);

COMMIT;
