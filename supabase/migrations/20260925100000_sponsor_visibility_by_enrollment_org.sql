-- Sponsor visibility is decided by ONE rule: programme_enrollments.organization_id.
--
-- A sponsor (sponsor_profiles: one organisation per sponsor) sees an
-- enrollment iff enrollment.organization_id = sponsor.organization_id.
-- An enrollment whose organization_id is NULL is visible to no sponsor.
-- cohorts.organization_id stays as a convenience/default field for Admin
-- (it pre-fills the enrollment organisation) but is NEVER an authorization
-- boundary: a cohort may mix learners from several organisations, and each
-- organisation's sponsor sees only their own learners in it. The cohort is a
-- drill-down filter over the sponsor's visible enrollments, not a scope.
--
-- The rule lives in exactly one place, public.sponsor_visible_enrollments();
-- public.sponsor_can_view_enrollment(uuid) is the per-row form of the same
-- set. Every sponsor surface below reads through them:
--
--   per-enrollment : sponsor_canonical_enrollment_progress (and the
--                    delegating sponsor_canonical_enrollment_metadata /
--                    sponsor_canonical_leader_progress, unchanged),
--                    sponsor_canonical_leader_schedule_state,
--                    sponsor_canonical_leader_experience,
--                    sponsor_canonical_leader_journey,
--                    get_enrollment_progress (historical, not client-callable)
--   cohort-level   : get_sponsor_programme_journey (and the delegating
--                    sponsor_canonical_programme_journey, unchanged),
--                    sponsor_canonical_cohort_progress_one,
--                    sponsor_canonical_cohort_progress,
--                    sponsor_canonical_organisation_progress
--   report requests: sponsor_submit_report_request (+ RLS policy fix)
--
-- Cohort-level functions aggregate ONLY the sponsor's visible enrollments in
-- the cohort, and a cohort is listed for a sponsor iff it contains at least
-- one visible enrollment.
--
-- Minimum-size privacy gate (sponsor_min_leaders_for_distribution, = 5)
-- ---------------------------------------------------------------------
-- Before this migration the gate hid EVERYTHING (named roster, leader
-- detail, cohort aggregates) when the cohort held fewer than 5 enrollments,
-- counted over the whole cohort. Under enrollment-org visibility that rule is
-- incoherent: whether sponsor A saw its own learners would depend on how
-- many learners OTHER organisations had placed in the same cohort, and a
-- sponsor with 3 learners in a mixed cohort would see nothing at all.
--
-- Decision: the gate no longer applies to named per-leader data or to
-- progress aggregates. The sponsor is entitled to see each of its own
-- learners by name (roster, leader detail, journey, schedule state,
-- experience), and every cohort/organisation aggregate is an exact rollup of
-- those same named rows, so suppressing an aggregate the sponsor can
-- recompute from rows it already sees protects nobody. The gate threshold
-- remains (sponsor_min_leaders_for_distribution) for anonymous distributions
-- only — views that describe a population WITHOUT naming its members (the
-- client's goal-growth distribution card reads it); any such distribution
-- must count the sponsor's visible enrollments, never the whole cohort.
-- The `suppressed` / `suppressed_cohort_count` columns are kept for API
-- compatibility and are now always false / 0 for rows a sponsor can see.
--
-- Data repair
-- -----------
-- programme_enrollments.organization_id was never backfilled. The one-time
-- UPDATE below copies the cohort organisation into enrollments that have
-- none. This is a data repair of existing rows, NOT an authorization
-- fallback: after it runs, no function consults cohorts.organization_id to
-- decide visibility.
--
-- Enrollment writers
-- ------------------
-- create_programme_enrollment, admin_create_programme_enrollment and
-- admin_update_coach_configuration no longer require the enrollment
-- organisation to equal the cohort organisation (mixed-organisation cohorts
-- are allowed). A NULL p_organization_id defaults to the cohort's
-- organisation. All other validation is unchanged.

-- ---------------------------------------------------------------------------
-- 0. Data repair (one-time; not an authorization fallback)
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  repaired integer;
BEGIN
  UPDATE public.programme_enrollments e
  SET organization_id = c.organization_id
  FROM public.cohorts c
  WHERE c.id = e.cohort_id
    AND e.organization_id IS NULL
    AND c.organization_id IS NOT NULL;
  GET DIAGNOSTICS repaired = ROW_COUNT;
  RAISE NOTICE 'sponsor visibility: backfilled organization_id on % programme_enrollments from their cohort (one-time data repair)', repaired;
END
$backfill$;

CREATE INDEX IF NOT EXISTS idx_programme_enrollments_organization
  ON public.programme_enrollments (organization_id);

-- ---------------------------------------------------------------------------
-- 1. THE sponsor visibility rule
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sponsor_visible_enrollments()
RETURNS TABLE (enrollment_id uuid, cohort_id uuid, organization_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- THE sponsor visibility rule: an enrollment is visible to the calling
  -- sponsor iff its organization_id equals the sponsor's organisation.
  -- A NULL enrollment organisation matches no sponsor. The cohort's
  -- organisation is deliberately not consulted.
  SELECT e.id, e.cohort_id, e.organization_id
  FROM public.sponsor_profiles sp
  JOIN public.programme_enrollments e
    ON e.organization_id = sp.organization_id
  WHERE sp.user_id = auth.uid()
    AND auth.uid() IS NOT NULL;
$$;

COMMENT ON FUNCTION public.sponsor_visible_enrollments() IS
  'THE sponsor visibility rule: enrollments whose organization_id equals the calling sponsor''s organisation (NULL organisation = visible to nobody). cohorts.organization_id is never an authorization boundary. Every sponsor surface reads through this set or sponsor_can_view_enrollment.';

CREATE OR REPLACE FUNCTION public.sponsor_can_view_enrollment(p_enrollment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Per-row form of sponsor_visible_enrollments(); same rule, no copy.
  SELECT EXISTS (
    SELECT 1
    FROM public.sponsor_visible_enrollments() v
    WHERE v.enrollment_id = p_enrollment_id
  );
$$;

COMMENT ON FUNCTION public.sponsor_can_view_enrollment(uuid) IS
  'True iff the calling sponsor may see this enrollment (membership in sponsor_visible_enrollments()).';

REVOKE ALL ON FUNCTION public.sponsor_visible_enrollments() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sponsor_can_view_enrollment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_visible_enrollments() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_can_view_enrollment(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Per-enrollment sponsor reads
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sponsor_canonical_enrollment_progress(p_cohort_id uuid DEFAULT NULL::uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(enrollment_id uuid, learner_display_name text, programme_label text, cohort_id uuid, cohort_label text, programme_id uuid, enrollment_start_date date, enrollment_end_date date, programme_start_date date, programme_end_date date, enrollment_status enrollment_status, stored_enrollment_status enrollment_status, effective_enrollment_status enrollment_status, required_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, progress_available boolean, coaching_required_units integer, coaching_completed_units integer, coaching_due_units integer, coaching_booked_units integer, training_required_units integer, training_completed_units integer, training_due_units integer, training_booked_units integer, peer_required_units integer, peer_completed_units integer, peer_due_units integer, peer_booked_units integer, mentoring_required_units integer, mentoring_completed_units integer, mentoring_due_units integer, mentoring_booked_units integer, triad_required_units integer, triad_completed_units integer, triad_due_units integer, triad_booked_units integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Sponsor: the sponsor's visible enrollments (enrollment organisation),
  -- optionally narrowed to one cohort. Numbers come from the one canonical
  -- construction.
  SELECT p.*
  FROM public.sponsor_visible_enrollments() v
  CROSS JOIN LATERAL public.canonical_enrollment_progress(v.enrollment_id, p_as_of) p
  WHERE p_cohort_id IS NULL OR v.cohort_id = p_cohort_id
  ORDER BY p.cohort_label, p.learner_display_name, p.enrollment_id;
$$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_schedule_state(p_enrollment_id uuid)
RETURNS TABLE (module public.programme_module_type, required_units integer, scheduled_units integer, state text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.*
  FROM public.canonical_enrollment_schedule_state(p_enrollment_id) s
  WHERE public.sponsor_can_view_enrollment(p_enrollment_id);
$$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_experience(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Sponsor: visible enrollment only (enrollment organisation).
  SELECT CASE
    WHEN public.sponsor_can_view_enrollment(p_enrollment_id)
    THEN public.canonical_enrollment_experience(p_enrollment_id, p_as_of)
    ELSE '{}'::jsonb
  END;
$$;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_leader_journey(
  p_enrollment_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Sponsor: visible enrollment only (enrollment organisation). Same
  -- construction as the learner self-view.
  SELECT CASE
    WHEN public.sponsor_can_view_enrollment(p_enrollment_id)
     AND EXISTS (
       SELECT 1 FROM public.programme_enrollments e
       WHERE e.id = p_enrollment_id AND e.cohort_id IS NOT NULL
     )
    THEN public.canonical_enrollment_journey(p_enrollment_id, p_as_of)
    ELSE '[]'::jsonb
  END;
$$;

REVOKE ALL ON FUNCTION public.sponsor_canonical_enrollment_progress(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sponsor_canonical_leader_schedule_state(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sponsor_canonical_leader_experience(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sponsor_canonical_leader_journey(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_enrollment_progress(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_leader_schedule_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_leader_experience(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_leader_journey(uuid, date) TO authenticated;

-- Historical snapshot engine (not client-callable): the sponsor branch reads
-- the same visibility rule. Body otherwise unchanged from
-- 20260914150000_bound_booked_progress_units.
CREATE OR REPLACE FUNCTION public.get_enrollment_progress(p_enrollment_id uuid,p_as_of date DEFAULT current_date)
RETURNS TABLE(module public.programme_module_type,full_completion_pct numeric,due_adherence_pct numeric,pace_status text,completed_units integer,due_units integer,required_units integer,booked_units integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
WITH enrollment AS (
  SELECT e.*
  FROM public.programme_enrollments e
  WHERE e.id=p_enrollment_id
), authorized AS (
  SELECT 1
  FROM enrollment e
  WHERE e.user_id=auth.uid()
     OR public.has_role(auth.uid(),'admin'::public.app_role)
     OR public.coach_has_client(auth.uid(),e.user_id)
     OR public.sponsor_can_view_enrollment(e.id)
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

REVOKE EXECUTE ON FUNCTION public.get_enrollment_progress(uuid, date) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.get_enrollment_progress(uuid, date) IS
  'HISTORICAL snapshot progress engine. Not client-callable; the canonical completion source is canonical_enrollment_progress.';

-- ---------------------------------------------------------------------------
-- 3. Cohort-level sponsor reads: aggregate ONLY the sponsor's visible
--    enrollments in the cohort.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sponsor_programme_journey(p_cohort_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eligible AS (
    -- The sponsor's visible enrollments in this cohort; other organisations'
    -- learners in the same cohort are not part of this sponsor's journey.
    SELECT v.enrollment_id AS id, v.cohort_id
    FROM public.sponsor_visible_enrollments() v
    WHERE v.cohort_id = p_cohort_id
  ), schedule AS (
    SELECT e.id AS enrollment_id, s.module, s.required_units,
      s.due_on, s.milestone_units, s.training_week_id
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_module_schedule(e.id) s
    WHERE s.due_on IS NOT NULL
  ), activity AS (
    SELECT e.id AS enrollment_id, a.module, a.occurred_on, a.status, a.requirement_due_on
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_activity(e.id) a
  ), dates AS (
    SELECT s.due_on,
      string_agg(DISTINCT tw.title, ' · ' ORDER BY tw.title)
        FILTER (WHERE tw.title IS NOT NULL) AS training_label,
      string_agg(DISTINCT s.module::text, ' · ' ORDER BY s.module::text) AS module_label,
      to_jsonb(array_agg(DISTINCT s.module::text ORDER BY s.module::text)) AS module_scope
    FROM schedule s
    LEFT JOIN public.training_weeks tw ON tw.id = s.training_week_id
    GROUP BY s.due_on
  ), scoped_modules AS (
    SELECT d.due_on, e.id AS enrollment_id, s.module,
      least(max(s.required_units), sum(s.milestone_units))::integer AS required_units
    FROM dates d
    CROSS JOIN eligible e
    JOIN schedule s
      ON s.enrollment_id = e.id
     AND s.due_on <= d.due_on
    GROUP BY d.due_on, e.id, s.module
  ), leader_module_checkpoints AS (
    SELECT sm.due_on, sm.enrollment_id, sm.module, sm.required_units,
      count(a.occurred_on) FILTER (
        WHERE a.status = 'completed'
          AND a.occurred_on <= least(p_as_of, sm.due_on)
          AND (a.requirement_due_on IS NULL OR a.requirement_due_on <= sm.due_on)
      )::integer AS completed_units
    FROM scoped_modules sm
    LEFT JOIN activity a
      ON a.enrollment_id = sm.enrollment_id
     AND a.module = sm.module
    GROUP BY sm.due_on, sm.enrollment_id, sm.module, sm.required_units
  ), leader_checkpoints AS (
    SELECT d.due_on, e.id AS enrollment_id,
      coalesce(sum(l.required_units), 0)::integer AS required_units,
      coalesce(sum(least(l.completed_units, l.required_units)), 0)::integer AS completed_units
    FROM dates d
    CROSS JOIN eligible e
    LEFT JOIN leader_module_checkpoints l
      ON l.due_on = d.due_on
     AND l.enrollment_id = e.id
    GROUP BY d.due_on, e.id
  ), totals AS (
    SELECT d.due_on,
      d.training_label AS label,
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
    GROUP BY d.due_on, d.training_label, d.module_label, d.module_scope
  ), numbered AS (
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
$function$;

REVOKE ALL ON FUNCTION public.get_sponsor_programme_journey(uuid, date) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.get_sponsor_programme_journey(uuid, date) IS
  'INTERNAL — cohort journey aggregate over the canonical schedule for the calling sponsor''s visible enrollments; clients use sponsor_canonical_programme_journey.';

-- The cohort and organisation rollups gain satisfaction_avg /
-- satisfaction_rated_count (and the organisation rollup its status / pace
-- counts), so their return types change: drop and recreate.
DROP FUNCTION IF EXISTS public.sponsor_canonical_organisation_progress(date);
DROP FUNCTION IF EXISTS public.sponsor_canonical_cohort_progress(uuid, date);
DROP FUNCTION IF EXISTS public.sponsor_canonical_cohort_progress_one(uuid, date);

CREATE FUNCTION public.sponsor_canonical_cohort_progress_one(
  p_cohort_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (
  cohort_id uuid,
  cohort_label text,
  programme_label text,
  programme_start_date date,
  programme_end_date date,
  enrollment_count integer,
  suppressed boolean,
  required_units integer,
  completed_units integer,
  due_units integer,
  booked_units integer,
  overdue_units integer,
  full_completion_pct numeric,
  due_adherence_pct numeric,
  schedule_coverage_pct numeric,
  pace_status text,
  active_count integer,
  at_risk_count integer,
  paused_count integer,
  completed_count integer,
  not_yet_due_count integer,
  ahead_count integer,
  on_track_count integer,
  scheduled_count integer,
  behind_count integer,
  completed_pace_count integer,
  on_track_pct numeric,
  coaching_required_units integer,
  coaching_completed_units integer,
  coaching_due_units integer,
  coaching_booked_units integer,
  coaching_completed_leaders integer,
  training_required_units integer,
  training_completed_units integer,
  training_due_units integer,
  training_booked_units integer,
  training_completed_leaders integer,
  peer_required_units integer,
  peer_completed_units integer,
  peer_due_units integer,
  peer_booked_units integer,
  peer_completed_leaders integer,
  mentoring_required_units integer,
  mentoring_completed_units integer,
  mentoring_due_units integer,
  mentoring_booked_units integer,
  mentoring_completed_leaders integer,
  triad_required_units integer,
  triad_completed_units integer,
  triad_due_units integer,
  triad_booked_units integer,
  triad_completed_leaders integer,
  programme_journey jsonb,
  progress_source_complete boolean,
  satisfaction_avg numeric,
  satisfaction_rated_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH visible AS (
    -- The sponsor's visible enrollments in this cohort (enrollment
    -- organisation). No row at all when the sponsor has none here.
    SELECT v.enrollment_id
    FROM public.sponsor_visible_enrollments() v
    WHERE v.cohort_id = p_cohort_id
  ), cohort_row AS (
    SELECT c.id, c.name, p.name AS programme_label, c.start_date, c.end_date,
      (SELECT count(*) FROM visible)::integer AS enrollment_count
    FROM public.cohorts c
    JOIN public.programmes p ON p.id = c.programme_id
    WHERE c.id = p_cohort_id
      AND EXISTS (SELECT 1 FROM visible)
  ), rows AS (
    SELECT r.*
    FROM public.sponsor_canonical_enrollment_progress(p_cohort_id, p_as_of) r
  ), satisfaction AS (
    -- Rating-weighted mean of the canonical per-enrollment satisfaction
    -- (canonical_enrollment_engagement), visible enrollments only.
    SELECT
      sum(g.satisfaction_avg * g.satisfaction_rated_count)
        FILTER (WHERE g.satisfaction_avg IS NOT NULL AND g.satisfaction_rated_count > 0) AS weighted_sum,
      coalesce(sum(g.satisfaction_rated_count)
        FILTER (WHERE g.satisfaction_avg IS NOT NULL AND g.satisfaction_rated_count > 0), 0)::integer AS rated_count
    FROM visible v
    CROSS JOIN LATERAL public.canonical_enrollment_engagement(v.enrollment_id) g
  ), grouped AS (
    SELECT c.id, c.name, c.programme_label, c.start_date, c.end_date,
      c.enrollment_count,
      coalesce(sum(r.required_units), 0)::integer AS required_units,
      coalesce(sum(r.completed_units), 0)::integer AS completed_units,
      coalesce(sum(r.due_units), 0)::integer AS due_units,
      coalesce(sum(r.booked_units), 0)::integer AS booked_units,
      count(r.enrollment_id) FILTER (WHERE r.effective_enrollment_status = 'active')::integer AS active_count,
      count(r.enrollment_id) FILTER (WHERE r.effective_enrollment_status = 'at_risk')::integer AS at_risk_count,
      count(r.enrollment_id) FILTER (WHERE r.effective_enrollment_status = 'paused')::integer AS paused_count,
      count(r.enrollment_id) FILTER (WHERE r.effective_enrollment_status = 'completed')::integer AS completed_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'not_yet_due')::integer AS not_yet_due_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'ahead')::integer AS ahead_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'on_track')::integer AS on_track_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'scheduled')::integer AS scheduled_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'behind')::integer AS behind_count,
      count(r.enrollment_id) FILTER (WHERE r.pace_status = 'completed')::integer AS completed_pace_count,
      coalesce(sum(r.coaching_required_units), 0)::integer AS coaching_required_units,
      coalesce(sum(r.coaching_completed_units), 0)::integer AS coaching_completed_units,
      coalesce(sum(r.coaching_due_units), 0)::integer AS coaching_due_units,
      coalesce(sum(r.coaching_booked_units), 0)::integer AS coaching_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.coaching_required_units > 0 AND r.coaching_completed_units >= r.coaching_required_units)::integer AS coaching_completed_leaders,
      coalesce(sum(r.training_required_units), 0)::integer AS training_required_units,
      coalesce(sum(r.training_completed_units), 0)::integer AS training_completed_units,
      coalesce(sum(r.training_due_units), 0)::integer AS training_due_units,
      coalesce(sum(r.training_booked_units), 0)::integer AS training_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.training_required_units > 0 AND r.training_completed_units >= r.training_required_units)::integer AS training_completed_leaders,
      coalesce(sum(r.peer_required_units), 0)::integer AS peer_required_units,
      coalesce(sum(r.peer_completed_units), 0)::integer AS peer_completed_units,
      coalesce(sum(r.peer_due_units), 0)::integer AS peer_due_units,
      coalesce(sum(r.peer_booked_units), 0)::integer AS peer_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.peer_required_units > 0 AND r.peer_completed_units >= r.peer_required_units)::integer AS peer_completed_leaders,
      coalesce(sum(r.mentoring_required_units), 0)::integer AS mentoring_required_units,
      coalesce(sum(r.mentoring_completed_units), 0)::integer AS mentoring_completed_units,
      coalesce(sum(r.mentoring_due_units), 0)::integer AS mentoring_due_units,
      coalesce(sum(r.mentoring_booked_units), 0)::integer AS mentoring_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.mentoring_required_units > 0 AND r.mentoring_completed_units >= r.mentoring_required_units)::integer AS mentoring_completed_leaders,
      coalesce(sum(r.triad_required_units), 0)::integer AS triad_required_units,
      coalesce(sum(r.triad_completed_units), 0)::integer AS triad_completed_units,
      coalesce(sum(r.triad_due_units), 0)::integer AS triad_due_units,
      coalesce(sum(r.triad_booked_units), 0)::integer AS triad_booked_units,
      count(r.enrollment_id) FILTER (WHERE r.triad_required_units > 0 AND r.triad_completed_units >= r.triad_required_units)::integer AS triad_completed_leaders,
      count(r.enrollment_id)::integer AS source_row_count
    FROM cohort_row c
    LEFT JOIN rows r ON r.cohort_id = c.id
    GROUP BY c.id, c.name, c.programme_label, c.start_date, c.end_date, c.enrollment_count
  ), calculated AS (
    SELECT g.*,
      CASE
        WHEN g.behind_count > 0 THEN 'behind'
        WHEN g.scheduled_count > 0 THEN 'scheduled'
        WHEN g.on_track_count > 0 THEN 'on_track'
        WHEN g.ahead_count > 0 THEN 'ahead'
        WHEN g.completed_pace_count = g.enrollment_count AND g.enrollment_count > 0 THEN 'completed'
        ELSE 'not_yet_due'
      END AS calculated_pace_status
    FROM grouped g
  )
  SELECT c.id, c.name, c.programme_label, c.start_date, c.end_date,
    c.enrollment_count,
    false,  -- see header: named data and exact rollups of it are not size-gated
    c.required_units,
    c.completed_units,
    c.due_units,
    c.booked_units,
    greatest(0, c.due_units - c.completed_units),
    CASE WHEN c.required_units = 0 THEN NULL ELSE round(least(c.completed_units, c.required_units) * 100.0 / c.required_units, 1) END,
    CASE WHEN c.due_units = 0 THEN NULL ELSE round(least(c.completed_units, c.due_units) * 100.0 / c.due_units, 1) END,
    CASE WHEN c.due_units = 0 THEN NULL ELSE round(least(c.completed_units + c.booked_units, c.due_units) * 100.0 / c.due_units, 1) END,
    c.calculated_pace_status,
    c.active_count,
    c.at_risk_count,
    c.paused_count,
    c.completed_count,
    c.not_yet_due_count,
    c.ahead_count,
    c.on_track_count,
    c.scheduled_count,
    c.behind_count,
    c.completed_pace_count,
    CASE WHEN c.enrollment_count = 0 THEN NULL ELSE round(c.on_track_count * 100.0 / c.enrollment_count, 1) END,
    c.coaching_required_units,
    c.coaching_completed_units,
    c.coaching_due_units,
    c.coaching_booked_units,
    c.coaching_completed_leaders,
    c.training_required_units,
    c.training_completed_units,
    c.training_due_units,
    c.training_booked_units,
    c.training_completed_leaders,
    c.peer_required_units,
    c.peer_completed_units,
    c.peer_due_units,
    c.peer_booked_units,
    c.peer_completed_leaders,
    c.mentoring_required_units,
    c.mentoring_completed_units,
    c.mentoring_due_units,
    c.mentoring_booked_units,
    c.mentoring_completed_leaders,
    c.triad_required_units,
    c.triad_completed_units,
    c.triad_due_units,
    c.triad_booked_units,
    c.triad_completed_leaders,
    public.sponsor_canonical_programme_journey(c.id, p_as_of),
    c.source_row_count = c.enrollment_count,
    CASE WHEN s.rated_count = 0 THEN NULL ELSE round(s.weighted_sum / s.rated_count, 2) END,
    s.rated_count
  FROM calculated c
  CROSS JOIN satisfaction s
  ORDER BY c.name;
$$;

CREATE FUNCTION public.sponsor_canonical_cohort_progress(
  p_cohort_id uuid DEFAULT NULL,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (
  cohort_id uuid,
  cohort_label text,
  programme_label text,
  programme_start_date date,
  programme_end_date date,
  enrollment_count integer,
  suppressed boolean,
  required_units integer,
  completed_units integer,
  due_units integer,
  booked_units integer,
  overdue_units integer,
  full_completion_pct numeric,
  due_adherence_pct numeric,
  schedule_coverage_pct numeric,
  pace_status text,
  active_count integer,
  at_risk_count integer,
  paused_count integer,
  completed_count integer,
  not_yet_due_count integer,
  ahead_count integer,
  on_track_count integer,
  scheduled_count integer,
  behind_count integer,
  completed_pace_count integer,
  on_track_pct numeric,
  coaching_required_units integer,
  coaching_completed_units integer,
  coaching_due_units integer,
  coaching_booked_units integer,
  coaching_completed_leaders integer,
  training_required_units integer,
  training_completed_units integer,
  training_due_units integer,
  training_booked_units integer,
  training_completed_leaders integer,
  peer_required_units integer,
  peer_completed_units integer,
  peer_due_units integer,
  peer_booked_units integer,
  peer_completed_leaders integer,
  mentoring_required_units integer,
  mentoring_completed_units integer,
  mentoring_due_units integer,
  mentoring_booked_units integer,
  mentoring_completed_leaders integer,
  triad_required_units integer,
  triad_completed_units integer,
  triad_due_units integer,
  triad_booked_units integer,
  triad_completed_leaders integer,
  programme_journey jsonb,
  progress_source_complete boolean,
  satisfaction_avg numeric,
  satisfaction_rated_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- A cohort is listed for a sponsor iff it contains at least one of the
  -- sponsor's visible enrollments; each cohort row is computed one cohort at
  -- a time (bounded per-cohort path, 20260917150000).
  SELECT progress.*
  FROM (
    SELECT DISTINCT v.cohort_id
    FROM public.sponsor_visible_enrollments() v
    WHERE v.cohort_id IS NOT NULL
      AND (p_cohort_id IS NULL OR v.cohort_id = p_cohort_id)
  ) visible_cohort
  CROSS JOIN LATERAL public.sponsor_canonical_cohort_progress_one(visible_cohort.cohort_id, p_as_of) progress
  ORDER BY progress.cohort_label, progress.cohort_id;
$$;

CREATE FUNCTION public.sponsor_canonical_organisation_progress(
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (
  cohort_count integer,
  enrollment_count integer,
  required_units integer,
  completed_units integer,
  due_units integer,
  booked_units integer,
  overdue_units integer,
  full_completion_pct numeric,
  due_adherence_pct numeric,
  schedule_coverage_pct numeric,
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
  suppressed_cohort_count integer,
  progress_source_complete boolean,
  active_count integer,
  at_risk_count integer,
  paused_count integer,
  completed_count integer,
  on_track_count integer,
  behind_count integer,
  satisfaction_avg numeric,
  satisfaction_rated_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- The organisation rollup is the sum of the sponsor's visible cohort rows,
  -- which are themselves rollups of the sponsor's visible enrollments only.
  WITH cohort_rows AS (
    SELECT *
    FROM public.sponsor_canonical_cohort_progress(NULL, p_as_of)
  ), totals AS (
    SELECT
      count(*)::integer AS cohort_count,
      coalesce(sum(c.enrollment_count), 0)::integer AS enrollment_count,
      sum(c.required_units)::integer AS required_units,
      sum(c.completed_units)::integer AS completed_units,
      sum(c.due_units)::integer AS due_units,
      sum(c.booked_units)::integer AS booked_units,
      sum(c.coaching_required_units)::integer AS coaching_required_units,
      sum(c.coaching_completed_units)::integer AS coaching_completed_units,
      sum(c.coaching_due_units)::integer AS coaching_due_units,
      sum(c.coaching_booked_units)::integer AS coaching_booked_units,
      sum(c.training_required_units)::integer AS training_required_units,
      sum(c.training_completed_units)::integer AS training_completed_units,
      sum(c.training_due_units)::integer AS training_due_units,
      sum(c.training_booked_units)::integer AS training_booked_units,
      sum(c.peer_required_units)::integer AS peer_required_units,
      sum(c.peer_completed_units)::integer AS peer_completed_units,
      sum(c.peer_due_units)::integer AS peer_due_units,
      sum(c.peer_booked_units)::integer AS peer_booked_units,
      sum(c.mentoring_required_units)::integer AS mentoring_required_units,
      sum(c.mentoring_completed_units)::integer AS mentoring_completed_units,
      sum(c.mentoring_due_units)::integer AS mentoring_due_units,
      sum(c.mentoring_booked_units)::integer AS mentoring_booked_units,
      sum(c.triad_required_units)::integer AS triad_required_units,
      sum(c.triad_completed_units)::integer AS triad_completed_units,
      sum(c.triad_due_units)::integer AS triad_due_units,
      sum(c.triad_booked_units)::integer AS triad_booked_units,
      count(*) FILTER (WHERE c.suppressed)::integer AS suppressed_cohort_count,
      coalesce(bool_and(c.progress_source_complete), false) AS progress_source_complete,
      coalesce(sum(c.active_count), 0)::integer AS active_count,
      coalesce(sum(c.at_risk_count), 0)::integer AS at_risk_count,
      coalesce(sum(c.paused_count), 0)::integer AS paused_count,
      coalesce(sum(c.completed_count), 0)::integer AS completed_count,
      coalesce(sum(c.on_track_count), 0)::integer AS on_track_count,
      coalesce(sum(c.behind_count), 0)::integer AS behind_count
    FROM cohort_rows c
  ), satisfaction AS (
    -- Same rating-weighted rule as the cohort rows, over the same visible
    -- enrollments (those in a cohort), computed from the unrounded source.
    SELECT
      sum(g.satisfaction_avg * g.satisfaction_rated_count)
        FILTER (WHERE g.satisfaction_avg IS NOT NULL AND g.satisfaction_rated_count > 0) AS weighted_sum,
      coalesce(sum(g.satisfaction_rated_count)
        FILTER (WHERE g.satisfaction_avg IS NOT NULL AND g.satisfaction_rated_count > 0), 0)::integer AS rated_count
    FROM public.sponsor_visible_enrollments() v
    CROSS JOIN LATERAL public.canonical_enrollment_engagement(v.enrollment_id) g
    WHERE v.cohort_id IS NOT NULL
  )
  SELECT t.cohort_count, t.enrollment_count,
    t.required_units, t.completed_units, t.due_units, t.booked_units,
    greatest(0, t.due_units - t.completed_units),
    CASE WHEN t.required_units = 0 THEN NULL ELSE round(least(t.completed_units, t.required_units) * 100.0 / t.required_units, 1) END,
    CASE WHEN t.due_units = 0 THEN NULL ELSE round(least(t.completed_units, t.due_units) * 100.0 / t.due_units, 1) END,
    CASE WHEN t.due_units = 0 THEN NULL ELSE round(least(t.completed_units + t.booked_units, t.due_units) * 100.0 / t.due_units, 1) END,
    t.coaching_required_units, t.coaching_completed_units, t.coaching_due_units, t.coaching_booked_units,
    t.training_required_units, t.training_completed_units, t.training_due_units, t.training_booked_units,
    t.peer_required_units, t.peer_completed_units, t.peer_due_units, t.peer_booked_units,
    t.mentoring_required_units, t.mentoring_completed_units, t.mentoring_due_units, t.mentoring_booked_units,
    t.triad_required_units, t.triad_completed_units, t.triad_due_units, t.triad_booked_units,
    t.suppressed_cohort_count, t.progress_source_complete,
    t.active_count, t.at_risk_count, t.paused_count, t.completed_count,
    t.on_track_count, t.behind_count,
    CASE WHEN s.rated_count = 0 THEN NULL ELSE round(s.weighted_sum / s.rated_count, 2) END,
    s.rated_count
  FROM totals t
  CROSS JOIN satisfaction s;
$$;

REVOKE ALL ON FUNCTION public.sponsor_canonical_cohort_progress_one(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sponsor_canonical_cohort_progress(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sponsor_canonical_organisation_progress(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_cohort_progress(uuid, date)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_organisation_progress(date)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Report requests
-- ---------------------------------------------------------------------------
-- A sponsor may request a report for a cohort iff that cohort contains at
-- least one of the sponsor's visible enrollments. The request belongs to the
-- sponsor's organisation (sponsor_profiles), not to the cohort's.
CREATE OR REPLACE FUNCTION public.sponsor_submit_report_request(
  p_cohort_id uuid, p_request_notes text DEFAULT NULL
) RETURNS public.sponsor_report_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result public.sponsor_report_requests;
BEGIN
  INSERT INTO public.sponsor_report_requests (organization_id, cohort_id, requested_by, request_notes)
  SELECT sp.organization_id, c.id, auth.uid(), NULLIF(left(p_request_notes, 2000), '')
  FROM public.sponsor_profiles sp
  JOIN public.cohorts c ON c.id = p_cohort_id
  WHERE sp.user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.sponsor_visible_enrollments() v
      WHERE v.cohort_id = c.id
    )
  RETURNING * INTO result;
  IF result.id IS NULL THEN RAISE EXCEPTION 'Cohort is not available to this sponsor'; END IF;
  RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.sponsor_submit_report_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_submit_report_request(uuid, text) TO authenticated;

-- The original policy compared sp.organization_id with an unqualified
-- organization_id, which resolves to sp.organization_id itself (always true):
-- every sponsor could read every organisation's requests. Qualify it.
DROP POLICY IF EXISTS sponsor_report_requests_sponsor_read ON public.sponsor_report_requests;
CREATE POLICY sponsor_report_requests_sponsor_read ON public.sponsor_report_requests
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid()
      AND sp.organization_id = sponsor_report_requests.organization_id
  ));

-- ---------------------------------------------------------------------------
-- 5. Enrollment writers: mixed-organisation cohorts are allowed; a NULL
--    organisation defaults to the cohort's.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_programme_enrollment(
  p_user_id uuid, p_programme_id uuid, p_cohort_id uuid, p_organization_id uuid,
  p_start_date date DEFAULT current_date, p_end_date date DEFAULT NULL
) RETURNS public.programme_enrollments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  existing public.programme_enrollments;
  result public.programme_enrollments;
  selected_cohort public.cohorts;
  effective_end_date date;
  effective_organization_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only an administrator can create enrolments' using errcode = '42501';
  end if;
  select * into selected_cohort from public.cohorts where id=p_cohort_id and programme_id=p_programme_id;
  if not found then
    raise exception 'The selected cohort does not belong to the selected programme' using errcode = 'P0001';
  end if;
  -- The enrollment's organisation is its own fact (sponsor visibility reads
  -- it); the cohort's organisation is only the default.
  effective_organization_id := coalesce(p_organization_id, selected_cohort.organization_id);
  effective_end_date := coalesce(p_end_date, selected_cohort.end_date);
  if effective_end_date is null then
    raise exception 'An enrollment end date is required to create its schedule snapshot' using errcode = 'P0001';
  end if;
  if (selected_cohort.start_date is not null and p_start_date < selected_cohort.start_date)
     or (selected_cohort.end_date is not null and effective_end_date > selected_cohort.end_date)
     or effective_end_date < p_start_date then
    raise exception 'Enrollment dates must fall within the cohort dates' using errcode = 'P0001';
  end if;
  -- Serialize enrollment attempts for one identity. The partial unique index
  -- remains the final race-safe guard even for callers that bypass this RPC.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select pe.* into existing from public.programme_enrollments pe
   where pe.user_id=p_user_id and pe.status in ('active','at_risk','paused') for update;
  if found then
    raise exception '%', jsonb_build_object(
      'code','ongoing_enrollment_exists','enrollment_id',existing.id,
      'programme_id',existing.programme_id,'cohort_id',existing.cohort_id,
      'status',existing.status,'start_date',existing.start_date,'end_date',existing.end_date
    )::text using errcode = 'P0001';
  end if;
  insert into public.programme_enrollments(user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
  values(p_user_id,p_programme_id,p_cohort_id,effective_organization_id,p_start_date,effective_end_date,'active') returning * into result;
  perform public.generate_enrollment_schedule(result.id);
  return result;
end $$;

CREATE OR REPLACE FUNCTION public.admin_create_programme_enrollment(
  p_user_id uuid, p_programme_id uuid, p_cohort_id uuid, p_organization_id uuid,
  p_start_date date DEFAULT current_date, p_end_date date DEFAULT NULL
) RETURNS public.programme_enrollments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  selected_cohort public.cohorts;
  existing public.programme_enrollments;
  result public.programme_enrollments;
  effective_end_date date;
  effective_organization_id uuid;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an administrator or service role can create enrolments'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO selected_cohort FROM public.cohorts
    WHERE id = p_cohort_id AND programme_id = p_programme_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected cohort does not belong to the selected programme'
      USING ERRCODE = 'P0001';
  END IF;
  -- The enrollment's organisation is its own fact (sponsor visibility reads
  -- it); the cohort's organisation is only the default.
  effective_organization_id := coalesce(p_organization_id, selected_cohort.organization_id);
  effective_end_date := coalesce(p_end_date, selected_cohort.end_date);
  IF effective_end_date IS NULL THEN
    RAISE EXCEPTION 'An enrollment end date is required to create its schedule snapshot'
      USING ERRCODE = 'P0001';
  END IF;
  IF (selected_cohort.start_date IS NOT NULL AND p_start_date < selected_cohort.start_date)
     OR (selected_cohort.end_date IS NOT NULL AND effective_end_date > selected_cohort.end_date)
     OR effective_end_date < p_start_date THEN
    RAISE EXCEPTION 'Enrollment dates must fall within the cohort dates' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  SELECT * INTO existing FROM public.programme_enrollments
    WHERE user_id = p_user_id AND status IN ('active', 'at_risk', 'paused') FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION '%', jsonb_build_object(
      'code','ongoing_enrollment_exists','enrollment_id',existing.id,
      'programme_id',existing.programme_id,'cohort_id',existing.cohort_id,
      'status',existing.status,'start_date',existing.start_date,'end_date',existing.end_date
    )::text USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.programme_enrollments
    (user_id, coachee_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
  VALUES (p_user_id, p_user_id, p_programme_id, p_cohort_id, effective_organization_id,
          p_start_date, effective_end_date, 'active')
  RETURNING * INTO result;
  PERFORM public.generate_enrollment_schedule(result.id);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.admin_create_programme_enrollment(uuid,uuid,uuid,uuid,date,date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_programme_enrollment(uuid,uuid,uuid,uuid,date,date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_update_coach_configuration(
  p_coach_id uuid,
  p_full_name text,
  p_profile_status text,
  p_selectable_coach_ids uuid[] DEFAULT '{}'::uuid[],
  p_enrollment_id uuid DEFAULT NULL,
  p_programme_id uuid DEFAULT NULL,
  p_cohort_id uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  selected_coach_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     OR p_coach_id IS NULL
      OR p_profile_status NOT IN ('active', 'pending_approval', 'inactive', 'suspended', 'rejected', 'reach_limit')
  THEN
    RAISE EXCEPTION 'Only an administrator can update Coach configuration'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET full_name = NULLIF(left(trim(p_full_name), 200), ''),
      status = p_profile_status::public.user_status
  WHERE id = p_coach_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coach profile not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.coach_profiles
  SET approval_status = p_profile_status::public.user_status,
      last_approved_at = CASE
        WHEN p_profile_status = 'active' THEN COALESCE(last_approved_at, now())
        ELSE last_approved_at
      END
  WHERE id = p_coach_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coach profile details not found' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.coach_as_coachee_allowlist
  WHERE coach_user_id = p_coach_id
    AND NOT (selectable_coach_id = ANY(COALESCE(p_selectable_coach_ids, '{}'::uuid[])));

  FOREACH selected_coach_id IN ARRAY COALESCE(p_selectable_coach_ids, '{}'::uuid[])
  LOOP
    INSERT INTO public.coach_as_coachee_allowlist (
      coach_user_id, selectable_coach_id, created_by
    ) VALUES (p_coach_id, selected_coach_id, auth.uid())
    ON CONFLICT (coach_user_id, selectable_coach_id) DO NOTHING;
  END LOOP;

  -- Programme and cohort are required together; the organisation is the
  -- enrollment's own and optional (NULL defaults to the cohort's inside
  -- admin_create_programme_enrollment).
  IF p_programme_id IS NOT NULL OR p_cohort_id IS NOT NULL OR p_organization_id IS NOT NULL THEN
    IF p_programme_id IS NULL OR p_cohort_id IS NULL THEN
      RAISE EXCEPTION 'Programme and cohort are required together'
        USING ERRCODE = '22023';
    END IF;

    IF p_enrollment_id IS NULL THEN
      PERFORM public.admin_create_programme_enrollment(
        p_coach_id, p_programme_id, p_cohort_id, p_organization_id,
        current_date, NULL
      );
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_coach_configuration(
  uuid, text, text, uuid[], uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_coach_configuration(
  uuid, text, text, uuid[], uuid, uuid, uuid, uuid
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Final-state guard: no live sponsor surface authorizes via the cohort's
--    organisation.
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  fn text;
  def text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.sponsor_canonical_enrollment_progress(uuid,date)',
    'public.sponsor_canonical_enrollment_metadata(uuid,uuid,date)',
    'public.sponsor_canonical_leader_progress(uuid,date)',
    'public.sponsor_canonical_leader_schedule_state(uuid)',
    'public.sponsor_canonical_leader_experience(uuid,date)',
    'public.sponsor_canonical_leader_journey(uuid,date)',
    'public.sponsor_canonical_programme_journey(uuid,date)',
    'public.get_sponsor_programme_journey(uuid,date)',
    'public.sponsor_canonical_cohort_progress_one(uuid,date)',
    'public.sponsor_canonical_cohort_progress(uuid,date)',
    'public.sponsor_canonical_organisation_progress(date)',
    'public.sponsor_submit_report_request(uuid,text)',
    'public.get_enrollment_progress(uuid,date)'
  ] LOOP
    def := pg_get_functiondef(fn::regprocedure);
    IF def ~* 'sp\.organization_id\s*=\s*c\.organization_id'
       OR def ~* 'c\.organization_id\s*=\s*sp\.organization_id'
       OR def ~* 'cohort_organization_id'
       OR def ~* 'ec_c\.organization_id' THEN
      RAISE EXCEPTION 'Sponsor surface % still authorizes via the cohort organisation', fn;
    END IF;
  END LOOP;
END
$guard$;
