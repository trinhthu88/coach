-- Coaching cutover: production impact report (READ-ONLY, PRE-DEPLOYMENT).
--
-- Run this against production BEFORE deploying the Coaching/Mentoring
-- migrations. It needs none of the new schema: it works entirely from columns
-- that exist today, and projects what canonical progress WILL report.
--
--   psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f scripts/coaching-cutover-impact.sql
--
-- Nothing is written. No narrative is selected: enrollments are identified by
-- id and by counts only, never by what anybody wrote.
--
-- What changes, and why the numbers move
-- --------------------------------------
-- Today   Coaching completion counts completed sessions attributed to the
--         enrollment, capped at the programme requirement.
--
-- After   Completion counts cohort Coaching REQUIREMENTS fulfilled by a
--         completed session attributed to them (20260920130000 +
--         20260921130000), and 20260921180000 attributes existing sessions
--         deterministically: the Nth completed/live session of an enrollment,
--         in chronological order, fulfils the Nth Coaching requirement of its
--         cohort.
--
-- Two consequences follow, and this report separates them:
--
--   * a session becomes countable even when its post-session write-up is
--     incomplete (evidence no longer gates completion) -- progress goes UP;
--   * an enrollment cannot complete more units than its cohort has SCHEDULED,
--     so where a cohort schedules fewer Coaching requirements than the
--     programme requires, progress goes DOWN. That mismatch is real and is
--     surfaced by cohort_requirement_schedule_issues; fix the cohort schedule
--     to restore those units. The sessions are retained as raw activity either
--     way.
--
-- Sections 5-9 do the same for PEER, which changes more than Coaching does.
--
-- Today   Peer completion counts session_activity_attributions rows. Only the
--         RECEIVING side of a Peer meeting carries an enrollment_id, so the
--         provider's half of every real meeting counts toward nobody.
--
-- After   Peer completion counts cohort Peer REQUIREMENTS fulfilled by a
--         completed participation (20260921210000), and BOTH participants get
--         one. The backfill resolves the provider's enrollment with
--         only_enrollment_candidate() -- exactly one enrollment covering the
--         session date, or nothing -- so an ambiguous provider is left
--         unattributed rather than guessed at.
--
--         Peer also stops counting merely-BOOKED meetings. Today an
--         attribution row exists as soon as a session is created and the old
--         Peer branch reported every one of them as 'completed', so a
--         confirmed-but-not-yet-held session already counts. After the cutover
--         only a completed one does. That is the single most likely reason a
--         production Peer number goes DOWN, and it is correct.
--
--         Peer eligibility also becomes a COHORT decision (20260922110000):
--         own cohort, plus cohorts an Admin explicitly grants. Existing
--         sessions are untouched -- the check runs on INSERT -- but future
--         cross-cohort bookings stop until the grant exists.
--
-- NOT a concern, despite appearances: cancelled Peer sessions. The phase 1
-- backfill only ever attributes participations whose session is
-- pending/confirmed/completed, so a cancelled session never acquires a
-- requirement to release. The live-status rule added in 20260922120000
-- prevents the defect going forward; it repairs no existing production row.
--
-- Sections 3 and 7 are the ones to act on before deploying. Sections 8 and 9
-- are an Admin configuration task, not a blocker: they say who loses a partner
-- pool on day one.

BEGIN TRANSACTION READ ONLY;

\echo '== 1. Per-enrollment projection: today vs after the cutover'
WITH req AS (
  SELECT e.id AS enrollment_id,
    coalesce(nullif(pm.config->>'required_units', '')::int, 0) AS required_units,
    (SELECT count(*)::int FROM public.cohort_requirement_dates d
      WHERE d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
        AND d.module = 'coaching'::public.programme_module_type) AS scheduled_requirements,
    (SELECT count(*)::int FROM public.sessions s
      WHERE s.enrollment_id = e.id AND s.status = 'completed'
        AND (s.start_time AT TIME ZONE 'UTC')::date <= current_date) AS completed_sessions
  FROM public.programme_enrollments e
  LEFT JOIN public.programme_modules pm
    ON pm.programme_id = e.programme_id
   AND pm.module = 'coaching'::public.programme_module_type
), projected AS (
  SELECT r.*,
    least(r.completed_sessions, r.required_units) AS today_completed_units,
    least(r.completed_sessions, r.scheduled_requirements) AS after_completed_units
  FROM req r
)
SELECT p.enrollment_id, p.required_units, p.scheduled_requirements,
  p.completed_sessions, p.today_completed_units, p.after_completed_units,
  p.after_completed_units - p.today_completed_units AS delta,
  CASE
    WHEN p.after_completed_units > p.today_completed_units
      THEN 'gain: evidence no longer gates a held session'
    WHEN p.scheduled_requirements < p.required_units
      THEN 'LOSS: cohort schedules fewer Coaching requirements than the programme requires'
    ELSE 'LOSS: unexplained -- investigate before deploying'
  END AS reason
FROM projected p
WHERE p.after_completed_units <> p.today_completed_units
ORDER BY (p.after_completed_units - p.today_completed_units), p.enrollment_id;

\echo '== 2. Totals'
WITH req AS (
  SELECT e.id AS enrollment_id,
    coalesce(nullif(pm.config->>'required_units', '')::int, 0) AS required_units,
    (SELECT count(*)::int FROM public.cohort_requirement_dates d
      WHERE d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
        AND d.module = 'coaching'::public.programme_module_type) AS scheduled_requirements,
    (SELECT count(*)::int FROM public.sessions s
      WHERE s.enrollment_id = e.id AND s.status = 'completed'
        AND (s.start_time AT TIME ZONE 'UTC')::date <= current_date) AS completed_sessions
  FROM public.programme_enrollments e
  LEFT JOIN public.programme_modules pm
    ON pm.programme_id = e.programme_id
   AND pm.module = 'coaching'::public.programme_module_type
), projected AS (
  SELECT r.*, least(r.completed_sessions, r.required_units) AS today_u,
    least(r.completed_sessions, r.scheduled_requirements) AS after_u
  FROM req r
)
SELECT count(*) FILTER (WHERE after_u > today_u) AS enrollments_gaining,
  count(*) FILTER (WHERE after_u < today_u) AS enrollments_losing,
  coalesce(sum(today_u), 0) AS total_units_today,
  coalesce(sum(after_u), 0) AS total_units_after
FROM projected;

\echo '== 3. BLOCKER CHECK: cohorts scheduling fewer Coaching requirements than required'
\echo '   Fix these cohort schedules before deploying, or those learners lose units.'
SELECT c.id AS cohort_id, c.name AS cohort_name,
  coalesce(nullif(pm.config->>'required_units', '')::int, 0) AS programme_requires,
  count(d.id)::int AS cohort_schedules,
  (SELECT count(*)::int FROM public.programme_enrollments e
    WHERE e.cohort_id = c.id AND e.programme_id = pm.programme_id) AS affected_enrollments
FROM public.cohorts c
JOIN public.programme_modules pm
  ON pm.programme_id = c.programme_id
 AND pm.module = 'coaching'::public.programme_module_type
 AND pm.enabled
LEFT JOIN public.cohort_requirement_dates d
  ON d.cohort_id = c.id AND d.programme_id = pm.programme_id
 AND d.module = 'coaching'::public.programme_module_type
GROUP BY c.id, c.name, pm.config, pm.programme_id
HAVING count(d.id) < coalesce(nullif(pm.config->>'required_units', '')::int, 0)
ORDER BY affected_enrollments DESC, c.name;

\echo '== 4. Sessions that will remain raw activity (attributable to no requirement)'
WITH ranked AS (
  SELECT s.id, s.enrollment_id,
    row_number() OVER (PARTITION BY s.enrollment_id ORDER BY s.start_time, s.id) AS rn
  FROM public.sessions s
  WHERE s.enrollment_id IS NOT NULL
    AND s.status IN ('pending_coach_approval', 'confirmed', 'completed')
)
SELECT count(*) AS sessions_left_unattributed,
  count(DISTINCT r.enrollment_id) AS affected_enrollments
FROM ranked r
JOIN public.programme_enrollments e ON e.id = r.enrollment_id
WHERE r.rn > (
  SELECT count(*) FROM public.cohort_requirement_dates d
  WHERE d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
    AND d.module = 'coaching'::public.programme_module_type);

\echo ''
\echo '== 5. Per-enrollment PEER projection: today vs after the cutover'
\echo '   Gains are the provider halves that counted toward nobody until now.'
WITH participation AS (
  SELECT s.id AS session_id, s.status::text AS status,
    (s.start_time AT TIME ZONE 'UTC')::date AS on_date,
    s.peer_coachee_id AS receiver_id, s.peer_coach_id AS provider_id,
    s.enrollment_id AS receiver_enrollment
  FROM public.peer_sessions s
  UNION ALL
  SELECT s.id, s.status::text, (s.start_time AT TIME ZONE 'UTC')::date,
    s.peer_receiver_id, s.peer_provider_id, s.enrollment_id
  FROM public.coachee_peer_sessions s
), sides AS (
  -- The receiving side's enrollment is on the session already.
  SELECT p.session_id, p.status, 'receiver'::text AS role, p.receiver_enrollment AS enrollment_id
  FROM participation p
  UNION ALL
  -- The providing side has never been attributed. This is the SAME rule the
  -- backfill applies, so the projection and the deploy agree.
  SELECT p.session_id, p.status, 'provider',
    public.only_enrollment_candidate(p.provider_id, NULL, p.on_date)
  FROM participation p
), req AS (
  SELECT e.id AS enrollment_id,
    coalesce(nullif(pm.config->>'required_units', '')::int, 0) AS required_units,
    (SELECT count(*)::int FROM public.cohort_requirement_dates d
      WHERE d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
        AND d.module = 'peer_coaching'::public.programme_module_type) AS scheduled_requirements,
    (SELECT count(*)::int FROM public.session_activity_attributions a
      WHERE a.enrollment_id = e.id
        AND a.module = 'peer_coaching'::public.programme_module_type) AS counted_today,
    (SELECT count(*)::int FROM sides x
      WHERE x.enrollment_id = e.id AND x.status = 'completed') AS completed_participations,
    (SELECT count(*)::int FROM sides x
      WHERE x.enrollment_id = e.id AND x.status = 'completed' AND x.role = 'provider')
      AS completed_as_provider
  FROM public.programme_enrollments e
  LEFT JOIN public.programme_modules pm
    ON pm.programme_id = e.programme_id
   AND pm.module = 'peer_coaching'::public.programme_module_type
), projected AS (
  SELECT r.*,
    least(r.counted_today, r.required_units) AS today_completed_units,
    least(r.completed_participations, r.scheduled_requirements) AS after_completed_units
  FROM req r
)
SELECT p.enrollment_id, p.required_units, p.scheduled_requirements,
  p.completed_participations, p.completed_as_provider,
  p.today_completed_units, p.after_completed_units,
  p.after_completed_units - p.today_completed_units AS delta,
  CASE
    WHEN p.after_completed_units > p.today_completed_units AND p.completed_as_provider > 0
      THEN 'gain: this learner''s provider halves now count as their own units'
    WHEN p.after_completed_units > p.today_completed_units
      THEN 'gain: participation now attributed to a requirement'
    WHEN p.counted_today > p.completed_participations
      THEN 'LOSS (correct): a merely BOOKED session counts today and will not after'
    WHEN p.scheduled_requirements < p.required_units
      THEN 'LOSS: cohort schedules fewer Peer requirements than the programme requires'
    ELSE 'LOSS: unexplained -- investigate before deploying'
  END AS reason
FROM projected p
WHERE p.after_completed_units <> p.today_completed_units
ORDER BY (p.after_completed_units - p.today_completed_units), p.enrollment_id;

\echo ''
\echo '== 6. PEER totals'
WITH participation AS (
  SELECT s.id AS session_id, s.status::text AS status,
    (s.start_time AT TIME ZONE 'UTC')::date AS on_date,
    s.peer_coach_id AS provider_id, s.enrollment_id AS receiver_enrollment
  FROM public.peer_sessions s
  UNION ALL
  SELECT s.id, s.status::text, (s.start_time AT TIME ZONE 'UTC')::date,
    s.peer_provider_id, s.enrollment_id
  FROM public.coachee_peer_sessions s
), sides AS (
  SELECT p.session_id, p.status, p.receiver_enrollment AS enrollment_id FROM participation p
  UNION ALL
  SELECT p.session_id, p.status,
    public.only_enrollment_candidate(p.provider_id, NULL, p.on_date) FROM participation p
), req AS (
  SELECT e.id AS enrollment_id,
    coalesce(nullif(pm.config->>'required_units', '')::int, 0) AS required_units,
    (SELECT count(*)::int FROM public.cohort_requirement_dates d
      WHERE d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
        AND d.module = 'peer_coaching'::public.programme_module_type) AS scheduled_requirements,
    (SELECT count(*)::int FROM public.session_activity_attributions a
      WHERE a.enrollment_id = e.id
        AND a.module = 'peer_coaching'::public.programme_module_type) AS counted_today,
    (SELECT count(*)::int FROM sides x
      WHERE x.enrollment_id = e.id AND x.status = 'completed') AS completed_participations
  FROM public.programme_enrollments e
  LEFT JOIN public.programme_modules pm
    ON pm.programme_id = e.programme_id
   AND pm.module = 'peer_coaching'::public.programme_module_type
), projected AS (
  SELECT r.*, least(r.counted_today, r.required_units) AS today_u,
    least(r.completed_participations, r.scheduled_requirements) AS after_u
  FROM req r
)
SELECT count(*) FILTER (WHERE after_u > today_u) AS enrollments_gaining,
  count(*) FILTER (WHERE after_u < today_u) AS enrollments_losing,
  count(*) FILTER (WHERE after_u < today_u
    AND counted_today > completed_participations) AS losing_because_booked_not_held,
  coalesce(sum(today_u), 0) AS total_peer_units_today,
  coalesce(sum(after_u), 0) AS total_peer_units_after,
  (SELECT count(*) FROM sides WHERE enrollment_id IS NULL)
    AS participations_with_no_determinable_enrollment
FROM projected;

\echo ''
\echo '== 7. BLOCKER CHECK: cohorts scheduling fewer PEER requirements than required'
\echo '   Fix these cohort schedules before deploying, or those learners lose units.'
SELECT c.id AS cohort_id, c.name AS cohort_name,
  coalesce(nullif(pm.config->>'required_units', '')::int, 0) AS programme_requires,
  count(d.id)::int AS cohort_schedules,
  (SELECT count(*)::int FROM public.programme_enrollments e
    WHERE e.cohort_id = c.id AND e.programme_id = pm.programme_id) AS affected_enrollments
FROM public.cohorts c
JOIN public.programme_modules pm
  ON pm.programme_id = c.programme_id
 AND pm.module = 'peer_coaching'::public.programme_module_type
 AND pm.enabled
LEFT JOIN public.cohort_requirement_dates d
  ON d.cohort_id = c.id AND d.programme_id = pm.programme_id
 AND d.module = 'peer_coaching'::public.programme_module_type
GROUP BY c.id, c.name, pm.config, pm.programme_id
HAVING count(d.id) < coalesce(nullif(pm.config->>'required_units', '')::int, 0)
ORDER BY affected_enrollments DESC, c.name;

\echo ''
\echo '== 8. Cross-cohort Peer pairs in use today, and whether a grant can restore them'
\echo '   Existing sessions stay valid. These are the grants an Admin must add'
\echo '   in Admin -> Cohort -> Peer practice for the pairing to continue.'
WITH participation AS (
  SELECT s.id AS session_id, (s.start_time AT TIME ZONE 'UTC')::date AS on_date,
    s.enrollment_id AS receiver_enrollment, s.peer_coach_id AS provider_id
  FROM public.peer_sessions s
  WHERE s.status IN ('pending_coach_approval', 'confirmed', 'completed')
  UNION ALL
  SELECT s.id, (s.start_time AT TIME ZONE 'UTC')::date, s.enrollment_id, s.peer_provider_id
  FROM public.coachee_peer_sessions s
  WHERE s.status IN ('pending_coach_approval', 'confirmed', 'completed')
), pairs AS (
  SELECT re.cohort_id AS source_cohort_id, re.programme_id AS source_programme_id,
    pe.cohort_id AS partner_cohort_id, pe.programme_id AS partner_programme_id,
    p.session_id
  FROM participation p
  JOIN public.programme_enrollments re ON re.id = p.receiver_enrollment
  LEFT JOIN public.programme_enrollments pe
    ON pe.id = public.only_enrollment_candidate(p.provider_id, NULL, p.on_date)
)
SELECT sc.name AS source_cohort, pc.name AS partner_cohort,
  count(*)::int AS sessions_between_them,
  CASE
    WHEN pr.partner_cohort_id IS NULL
      THEN 'partner holds no single enrollment -- a Coach delivering peer practice, or ambiguous'
    WHEN pr.source_programme_id IS DISTINCT FROM pr.partner_programme_id
      THEN 'NOT GRANTABLE: different programmes -- this pairing ends at deploy'
    ELSE 'grantable: add source -> partner in Admin -> Cohort -> Peer practice'
  END AS action
FROM pairs pr
LEFT JOIN public.cohorts sc ON sc.id = pr.source_cohort_id
LEFT JOIN public.cohorts pc ON pc.id = pr.partner_cohort_id
WHERE pr.partner_cohort_id IS DISTINCT FROM pr.source_cohort_id
GROUP BY sc.name, pc.name, pr.partner_cohort_id, pr.source_programme_id, pr.partner_programme_id
ORDER BY sessions_between_them DESC, source_cohort, partner_cohort;

\echo ''
\echo '== 9. Learners whose partner pool becomes empty on day one'
\echo '   They could see every opted-in learner in the system; after the cutover'
\echo '   they see their own cohort only, and their cohort has nobody else.'
SELECT count(*)::int AS learners_with_no_same_cohort_partner
FROM public.programme_enrollments e
JOIN public.profiles me ON me.id = e.user_id
JOIN public.programme_modules pm
  ON pm.programme_id = e.programme_id
 AND pm.module = 'peer_coaching'::public.programme_module_type
 AND pm.enabled
WHERE e.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
  AND e.cohort_id IS NOT NULL
  AND me.peer_coaching_opt_in
  AND NOT EXISTS (
    SELECT 1 FROM public.programme_enrollments o
    JOIN public.profiles op ON op.id = o.user_id
    WHERE o.cohort_id = e.cohort_id
      AND o.user_id <> e.user_id
      AND o.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
      AND op.peer_coaching_opt_in
      AND op.status IN ('active'::public.user_status, 'reach_limit'::public.user_status));

ROLLBACK;
