-- LIVE DATABASE AUDIT vs REPOSITORY (READ-ONLY).
--
-- Answers "what is actually deployed?" before any fix is applied.
--
--   psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/live-db-audit.sql \
--        > /tmp/live-db-audit.txt 2>&1
--
-- The whole script runs inside BEGIN TRANSACTION READ ONLY, so the database
-- physically refuses any write this file could contain. It creates nothing,
-- drops nothing and calls no application function: every check reads the
-- catalogue directly, so it works for a role with SELECT only.
--
-- Sections 2 and 4 need the repository side to compare against. Section 2
-- prints the applied versions; diff them against scripts/repo-migrations.txt
-- (regenerate with: ls supabase/migrations/*.sql | sed 's|.*/||' | cut -d_ -f1).
-- Section 4 prints a normalised md5 of each live function body; compare it
-- with the same digest taken from a local replay of the repository.

BEGIN TRANSACTION READ ONLY;

\pset pager off
\pset format aligned

\echo ''
\echo '=============================================================='
\echo '0. Identity'
\echo '=============================================================='
SELECT current_database() AS database,
       current_user       AS role,
       version()          AS server,
       now()              AS taken_at;

\echo ''
\echo '=============================================================='
\echo '2. Applied migrations (compare with the repo file list)'
\echo '=============================================================='

SELECT count(*) AS applied_migrations FROM supabase_migrations.schema_migrations;

\echo ''
\echo '-- 2a. Every applied version, in order. Diff this against the repo.'
SELECT version,
       coalesce(name, '(no name)') AS name,
       coalesce(array_length(statements, 1), 0) AS statements_applied
FROM supabase_migrations.schema_migrations
ORDER BY version;

\echo ''
\echo '-- 2b. Highest applied version, and the gap shape'
SELECT min(version) AS earliest,
       max(version) AS latest,
       count(*)     AS total
FROM supabase_migrations.schema_migrations;

\echo ''
\echo '=============================================================='
\echo '3. Critical canonical objects'
\echo '=============================================================='

\echo ''
\echo '-- 3a. FUNCTIONS'
WITH expected(fn, required_by) AS (VALUES
  ('canonical_module_progress',                    'progress spine — every role'),
  ('canonical_enrollment_progress',                'progress spine — every role'),
  ('canonical_coaching_requirement_fulfilment',    'Coaching fulfilment'),
  ('canonical_mentoring_requirement_fulfilment',   'Mentoring fulfilment'),
  ('canonical_peer_requirement_fulfilment',        'Peer fulfilment'),
  ('canonical_triad_requirement_fulfilment',       'Triad fulfilment'),
  ('sponsor_canonical_activity',                   'activity union feeding progress'),
  ('sponsor_canonical_module_schedule',            'required_units + deadlines'),
  ('sponsor_canonical_enrollment_progress',        'Sponsor projection'),
  ('learner_canonical_progress',                   'Learner projection'),
  ('admin_canonical_enrollment_progress',          'Admin projection'),
  ('canonical_enrollment_journey',                 'journey checkpoints'),
  ('sync_cohort_requirement_dates',                'requirement cardinality reconciler'),
  ('cohort_required_module_units',                 'programme quantity scope'),
  ('programme_required_units',                     'quantity authority for eligibility'),
  ('can_book_session',                             'Coaching eligibility'),
  ('book_coaching_session',                        'Coaching booking RPC'),
  ('book_mentoring_session',                       'Mentoring booking RPC'),
  ('book_coachee_peer_session',                    'Peer (learner-to-learner) booking'),
  ('book_peer_session',                            'Peer (coach pool) booking'),
  ('validate_peer_session_participant',            'Peer participant integrity'),
  ('validate_peer_cohort_permission',              'Peer cohort rule'),
  ('peer_partner_enrollment',                      'Peer provider attribution'),
  ('eligible_peer_partners',                       'Peer partner pool'),
  ('triad_validate_group_member',                  'Triad membership integrity'),
  ('coaching_sessions_without_requirement',        'orphan diagnostic'),
  ('mentoring_sessions_without_requirement',       'orphan diagnostic'),
  ('peer_participants_without_requirement',        'orphan diagnostic'),
  ('cohort_requirement_schedule_issues',           'schedule diagnostic')
)
SELECT e.fn AS object,
       'function' AS type,
       CASE WHEN p.n > 0 THEN 'YES' ELSE 'NO  <-- MISSING' END AS exists_in_live_db,
       coalesce(p.n, 0) AS overloads,
       e.required_by AS required_by_canonical_model
FROM expected e
LEFT JOIN LATERAL (
  SELECT count(*) AS n
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = e.fn
) p ON true
ORDER BY (p.n > 0), e.fn;

\echo ''
\echo '-- 3b. TRIGGERS (by table and function)'
WITH expected(tbl, fn) AS (VALUES
  ('cohorts',                   'sync_cohort_requirement_dates'),
  ('programme_modules',         'sync_cohort_requirement_dates'),
  ('programme_enrollments',     'sync_cohort_requirement_dates'),
  ('cohort_module_deadlines',   'sync_cohort_requirement_dates'),
  ('peer_sessions',             'sync_peer_session_participants'),
  ('coachee_peer_sessions',     'sync_peer_session_participants'),
  ('peer_session_participants', 'validate_peer_session_participant'),
  ('triad_group_members',       'triad_validate_group_member'),
  ('sessions',                  'attribute_new_activity_trigger'),
  ('mentoring_sessions',        'attribute_new_activity_trigger'),
  ('peer_sessions',             'attribute_new_activity_trigger'),
  ('coachee_peer_sessions',     'attribute_new_activity_trigger'),
  ('training_progress',         'attribute_new_activity_trigger')
)
SELECT e.tbl AS "table",
       e.fn  AS trigger_function,
       CASE WHEN t.n > 0 THEN 'YES' ELSE 'NO  <-- MISSING' END AS exists_in_live_db,
       coalesce(t.names, '') AS trigger_names
FROM expected e
LEFT JOIN LATERAL (
  SELECT count(*) AS n, string_agg(tg.tgname, ', ') AS names
  FROM pg_trigger tg
  JOIN pg_class c   ON c.oid = tg.tgrelid
  JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
  JOIN pg_proc pr   ON pr.oid = tg.tgfoid
  WHERE NOT tg.tgisinternal AND c.relname = e.tbl
    -- The trigger function's name is what identifies it; trigger names have
    -- changed across migrations while the function stayed the same.
    AND pr.proname = e.fn
) t ON true
ORDER BY (t.n > 0), e.tbl, e.fn;

\echo ''
\echo '-- 3c. INDEXES / CONSTRAINTS'
WITH expected(obj) AS (VALUES
  ('sessions_one_live_session_per_requirement'),
  ('mentoring_sessions_one_live_session_per_requirement'),
  ('peer_participants_one_fulfilment_per_requirement'),
  ('ux_programme_enrollments_one_ongoing')
)
SELECT e.obj AS object,
       'index/constraint' AS type,
       CASE WHEN i.relname IS NOT NULL THEN 'YES' ELSE 'NO  <-- MISSING' END AS exists_in_live_db,
       coalesce(pg_get_indexdef(i.oid), '') AS definition
FROM expected e
LEFT JOIN pg_class i ON i.relname = e.obj AND i.relkind = 'i'
LEFT JOIN pg_namespace ns ON ns.oid = i.relnamespace AND ns.nspname = 'public'
ORDER BY (i.relname IS NOT NULL), e.obj;

\echo ''
\echo '-- 3d. TABLES'
WITH expected(tbl) AS (VALUES
  ('cohort_requirement_dates'),
  ('cohort_module_deadlines'),
  ('peer_session_participants'),
  ('session_learning_reflections'),
  ('session_activity_attributions')
)
SELECT e.tbl AS object, 'table' AS type,
       CASE WHEN to_regclass('public.' || e.tbl) IS NOT NULL THEN 'YES' ELSE 'NO  <-- MISSING' END
         AS exists_in_live_db
FROM expected e
ORDER BY (to_regclass('public.' || e.tbl) IS NOT NULL), e.tbl;

\echo ''
\echo '-- 3e. COLUMNS'
WITH expected(tbl, col) AS (VALUES
  ('sessions',                  'cohort_requirement_id'),
  ('mentoring_sessions',        'cohort_requirement_id'),
  ('peer_session_participants', 'cohort_requirement_id'),
  ('peer_session_participants', 'enrollment_id'),
  ('peer_session_participants', 'session_status')
)
SELECT e.tbl || '.' || e.col AS object, 'column' AS type,
       CASE WHEN c.column_name IS NOT NULL THEN 'YES' ELSE 'NO  <-- MISSING' END AS exists_in_live_db,
       coalesce(c.data_type, '') AS data_type,
       coalesce(c.is_nullable, '') AS nullable
FROM expected e
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public' AND c.table_name = e.tbl AND c.column_name = e.col
ORDER BY (c.column_name IS NOT NULL), e.tbl, e.col;

\echo ''
\echo '=============================================================='
\echo '4. Function fingerprints (for staleness comparison)'
\echo '=============================================================='
\echo '-- Normalised: comments stripped, whitespace collapsed, lowercased, so'
\echo '-- cosmetic formatting cannot make a matching body look different.'
\echo '-- Compare each digest with the same function from a LOCAL replay of'
\echo '-- the repository. A difference means a later redefining migration'
\echo '-- never reached this database.'

SELECT pr.proname AS function,
       pg_get_function_identity_arguments(pr.oid) AS args,
       md5(lower(regexp_replace(
              regexp_replace(pg_get_functiondef(pr.oid), '--[^\n]*', '', 'g'),
              '\s+', ' ', 'g'))) AS normalised_md5,
       length(pg_get_functiondef(pr.oid)) AS raw_length
FROM pg_proc pr
JOIN pg_namespace ns ON ns.oid = pr.pronamespace AND ns.nspname = 'public'
WHERE pr.prokind = 'f'   -- pg_get_functiondef() errors on aggregates
  AND pr.proname IN (
    'canonical_module_progress','canonical_enrollment_progress',
    'canonical_coaching_requirement_fulfilment','canonical_mentoring_requirement_fulfilment',
    'canonical_peer_requirement_fulfilment','canonical_triad_requirement_fulfilment',
    'sponsor_canonical_activity','sponsor_canonical_module_schedule',
    'sponsor_canonical_enrollment_progress','learner_canonical_progress',
    'admin_canonical_enrollment_progress','canonical_enrollment_journey',
    'sync_cohort_requirement_dates','cohort_required_module_units',
    'programme_required_units','can_book_session','book_coaching_session',
    'book_mentoring_session','book_coachee_peer_session','book_peer_session',
    'validate_peer_session_participant','validate_peer_cohort_permission',
    'peer_partner_enrollment','eligible_peer_partners','triad_validate_group_member',
    'coaching_sessions_without_requirement','mentoring_sessions_without_requirement',
    'peer_participants_without_requirement','cohort_requirement_schedule_issues',
    'can_book_mentoring_session_reason','cohort_mentoring_mentor_pool',
    'get_mentors_for_enrollment','validate_cohort_mentor_is_coach')
ORDER BY pr.proname;

\echo ''
\echo '-- 4b. Known-marker checks: each row is a property the FINAL repo'
\echo '--     definition must have. FAIL means the live body predates it.'
WITH markers(fn, args, marker, means) AS (VALUES
  ('programme_required_units', 'uuid, programme_module_type', 'greatest',
   'FAIL expected: live still takes GREATEST(programme, cohort row count)'),
  ('can_book_mentoring_session_reason', 'uuid, uuid, uuid', 'cohort_requirement_id is not null',
   'PASS expected: Mentoring capacity counts only requirement-attributed sessions'),
  ('can_book_session', 'uuid, uuid, uuid', 'cohort_requirement_id is not null',
   'PASS expected: Coaching budget counts only requirement-attributed sessions'),
  ('cohort_mentoring_mentor_pool', 'uuid, date', 'mentor_profiles',
   'FAIL expected: live still requires a mentor profile for eligibility'),
  ('sponsor_canonical_activity', 'uuid', 'canonical_peer_requirement_fulfilment',
   'PASS expected: Peer feeds progress through requirement fulfilment'),
  ('sync_cohort_requirement_dates', 'uuid', 'cohort_module_deadlines',
   'PASS expected: requirement dates project the cohort module deadline')
)
SELECT m.fn AS function,
       m.marker AS looked_for,
       CASE
         WHEN p.oid IS NULL THEN 'FUNCTION MISSING'
         WHEN lower(regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g'))
              LIKE '%' || m.marker || '%' THEN 'PRESENT'
         ELSE 'ABSENT'
       END AS result,
       m.means AS interpretation
FROM markers m
LEFT JOIN pg_proc p
  ON p.proname = m.fn AND p.prokind = 'f'
 AND p.pronamespace = 'public'::regnamespace
 AND pg_get_function_identity_arguments(p.oid) = m.args
ORDER BY m.fn;

\echo ''
\echo '=============================================================='
\echo '5. Current data state against the canonical invariant'
\echo '=============================================================='
\echo '-- Read-only. Shows whether live data would satisfy the quantity'
\echo '-- invariant, WITHOUT requiring the invariant migration to be applied.'

SELECT c.name AS cohort,
       pm.module,
       coalesce(nullif(pm.config->>'required_units','')::int, 0) AS required_units,
       count(d.id)                                  AS requirement_rows,
       coalesce(sum(d.units), 0)                    AS sum_units,
       count(*) FILTER (WHERE d.units <> 1)         AS weighted_rows,
       array_agg(d.ordinal ORDER BY d.ordinal) FILTER (WHERE d.id IS NOT NULL) AS ordinals,
       CASE
         WHEN count(d.id) = coalesce(nullif(pm.config->>'required_units','')::int, 0)
              AND count(*) FILTER (WHERE d.units <> 1) = 0 THEN 'OK'
         WHEN count(d.id) = 0 THEN 'NO REQUIREMENTS MATERIALISED'
         WHEN count(d.id) < coalesce(nullif(pm.config->>'required_units','')::int, 0) THEN 'SHORTFALL'
         WHEN count(d.id) > coalesce(nullif(pm.config->>'required_units','')::int, 0) THEN 'SURPLUS'
         ELSE 'WEIGHTED ROWS'
       END AS verdict
FROM public.cohorts c
JOIN public.programme_modules pm
  ON pm.programme_id = c.programme_id AND pm.enabled
 AND pm.module <> 'training'
 AND coalesce((pm.config->>'required')::boolean, false)
LEFT JOIN public.cohort_requirement_dates d
  ON d.cohort_id = c.id AND d.programme_id = pm.programme_id AND d.module = pm.module
GROUP BY c.name, pm.module, pm.config
ORDER BY verdict, c.name, pm.module;

\echo ''
\echo '-- 5b. Activity that fulfils nothing (needs the requirement columns to exist)'
SELECT 'sessions without requirement' AS metric,
       count(*) FILTER (WHERE s.cohort_requirement_id IS NULL
                          AND s.status IN ('pending_coach_approval','confirmed','completed')) AS live_or_completed
FROM public.sessions s
UNION ALL
SELECT 'mentoring_sessions without requirement',
       count(*) FILTER (WHERE m.cohort_requirement_id IS NULL
                          AND m.status IN ('pending_coach_approval','confirmed','completed'))
FROM public.mentoring_sessions m;

COMMIT;

\echo ''
\echo '=== END OF READ-ONLY AUDIT — nothing was written ==='
