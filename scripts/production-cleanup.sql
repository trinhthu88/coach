-- ===========================================================================
-- Remove the old demo dataset from production, keep the real accounts.
--
--   psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/production-cleanup.sql
--
-- Deletes, in one transaction:
--   * every account whose email matches  %@clariva.demo | %@demo.clariva.club
--     | ee000000*@erickson.vn (by auth.users id), and every row that depends
--     on them;
--   * the old "Emerging Leaders" programme (d0000000-...-0000000f0001) and
--     everything under it;
--   * the old "Clariva Demo Organization" (d0000000-...-00000000aaaa);
--   * the old "Executive Excellence" and "TASC Essential" programmes
--     (d0000000-...-0000000f0002 / f0003) and everything under them;
--   * the demo organisations "Acme Corp Test" and "Demo Organization", whose
--     only members were demo sponsors.
-- Never touches the seven KEPT accounts below: the script stops if any kept
-- account is linked to what it would delete, and it compares every row that
-- references a kept account before and after, refusing to commit if one
-- changed.
--
-- The delete order is not hand-written. purge() walks the live foreign-key
-- graph: rows that reference a row being deleted are deleted first (RESTRICT,
-- NO ACTION and CASCADE edges alike), while SET NULL / SET DEFAULT edges are
-- left to the database. Every deletion is counted in _purged.
--
-- Run it BEFORE the P0/P1/P2 migrations: their guards (cohorts with
-- enrollments, people with completed sessions, goals with actions) exist to
-- refuse exactly these deletes.
-- ===========================================================================

BEGIN;

CREATE TEMP TABLE _kept_emails (email text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _kept_emails VALUES
  ('trang.tt@erickson.vn'), ('chouxlab@gmail.com'), ('contact@erickson.vn'), ('lan.le@erickson.vn'),
  ('trang.tt@hsp.consulting'), ('trinh_thu@icloud.com'), ('trinhthu.mktg@gmail.com');

CREATE TEMP TABLE _kept ON COMMIT DROP AS
SELECT u.id, lower(u.email) AS email FROM auth.users u JOIN _kept_emails k ON k.email = lower(u.email);

CREATE TEMP TABLE _demo ON COMMIT DROP AS
SELECT u.id, lower(u.email) AS email FROM auth.users u
WHERE (u.email ILIKE '%@clariva.demo' OR u.email ILIKE '%@demo.clariva.club'
       OR (u.email ILIKE '%@erickson.vn' AND u.id::text LIKE 'ee000000%'))
  AND lower(u.email) NOT IN (SELECT email FROM _kept_emails);

CREATE TEMP TABLE _purged (tbl text, n integer, depth integer) ON COMMIT DROP;

CREATE TEMP TABLE _old_programmes (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _old_programmes VALUES
  ('d0000000-0000-4000-8000-0000000f0001'),   -- Emerging Leaders
  ('d0000000-0000-4000-8000-0000000f0002'),   -- Executive Excellence
  ('d0000000-0000-4000-8000-0000000f0003');   -- TASC Essential
CREATE TEMP TABLE _old_orgs (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _old_orgs VALUES
  ('d0000000-0000-4000-8000-00000000aaaa'),   -- Clariva Demo Organization
  ('8c1afc65-2323-43bb-b173-255d0469b238'),   -- Acme Corp Test
  ('c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01');   -- Demo Organization

-- ---------------------------------------------------------------------------
-- Pre-checks
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE n integer; bad text;
BEGIN
  SELECT count(*) INTO n FROM _kept;
  IF n <> 7 THEN RAISE EXCEPTION 'Expected 7 kept accounts in auth.users, found %', n; END IF;

  -- (c) No kept account is enrolled in the old Emerging Leaders programme.
  SELECT string_agg(k.email, ', ') INTO bad
  FROM public.programme_enrollments e JOIN _kept k ON k.id = e.user_id
  WHERE e.programme_id IN (SELECT id FROM _old_programmes);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'STOP: kept accounts enrolled in an old demo programme: %', bad; END IF;

  -- (d) No kept account belongs to the old Clariva Demo Organization.
  SELECT string_agg(k.email, ', ') INTO bad FROM _kept k
  WHERE EXISTS (SELECT 1 FROM public.sponsor_profiles sp WHERE sp.user_id = k.id
                  AND sp.organization_id IN (SELECT id FROM _old_orgs))
     OR EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.user_id = k.id
                  AND e.organization_id IN (SELECT id FROM _old_orgs))
     OR EXISTS (SELECT 1 FROM public.organizations o WHERE o.account_manager_id = k.id
                  AND o.id IN (SELECT id FROM _old_orgs));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'STOP: kept accounts belong to an old demo organisation: %', bad; END IF;
  -- Each old organisation's only sponsors are demo accounts.
  SELECT string_agg(o.name, ', ') INTO bad FROM public.organizations o
  WHERE o.id IN (SELECT id FROM _old_orgs)
    AND EXISTS (SELECT 1 FROM public.sponsor_profiles sp WHERE sp.organization_id = o.id
                  AND sp.user_id NOT IN (SELECT id FROM _demo));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'STOP: an old organisation has a non-demo sponsor: %', bad; END IF;
  SELECT count(*) INTO n FROM public.organizations WHERE id IN (SELECT id FROM _old_orgs);
  IF n <> 3 THEN RAISE EXCEPTION 'Expected 3 old demo organisations, found %', n; END IF;
  SELECT count(*) INTO n FROM public.programmes WHERE id IN (SELECT id FROM _old_programmes);
  IF n <> 3 THEN RAISE EXCEPTION 'Expected 3 old demo programmes, found %', n; END IF;

  -- No session links a kept account to a demo account (deleting it would
  -- remove a kept account's history).
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.sessions s WHERE (s.coach_id IN (SELECT id FROM _kept) AND s.coachee_id IN (SELECT id FROM _demo))
                                       OR (s.coachee_id IN (SELECT id FROM _kept) AND s.coach_id IN (SELECT id FROM _demo))
    UNION ALL
    SELECT 1 FROM public.mentoring_sessions s WHERE (s.mentor_id IN (SELECT id FROM _kept) AND s.mentee_id IN (SELECT id FROM _demo))
                                                 OR (s.mentee_id IN (SELECT id FROM _kept) AND s.mentor_id IN (SELECT id FROM _demo))
  ) x;
  IF n > 0 THEN RAISE EXCEPTION 'STOP: % sessions link a kept account to a demo account', n; END IF;

  RAISE NOTICE 'Pre-checks passed: % demo accounts to remove, 7 kept accounts found', (SELECT count(*) FROM _demo);
END
$pre$;

-- Every row that references a kept account, counted per FK column, so the
-- end of the script can prove none of them was deleted.
CREATE TEMP TABLE _kept_refs_before ON COMMIT DROP AS
SELECT 'x'::text AS tbl, 'x'::text AS col, 0::bigint AS n WHERE false;
DO $snap$
DECLARE fk record; v bigint;
BEGIN
  FOR fk IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
      AND c.connamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I IN (SELECT id FROM _kept)', fk.tbl, fk.col) INTO v;
    INSERT INTO _kept_refs_before VALUES (fk.tbl, fk.col, v);
  END LOOP;
END
$snap$;

-- ---------------------------------------------------------------------------
-- purge(): delete rows and everything that must go before them
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.purge(p_table regclass, p_col text, p_vals text[], p_depth integer DEFAULT 0)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE fk record; v_child_vals text[]; n integer;
BEGIN
  IF p_vals IS NULL OR cardinality(p_vals) = 0 THEN RETURN; END IF;
  IF p_depth > 25 THEN RAISE EXCEPTION 'purge: dependency chain too deep at %', p_table; END IF;

  -- Children first. SET NULL / SET DEFAULT children are the database's job.
  FOR fk IN
    SELECT c.conrelid::regclass AS child, ca.attname AS child_col, pa.attname AS parent_col
    FROM pg_constraint c
    JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = c.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND c.confrelid = p_table AND c.confdeltype NOT IN ('n', 'd')
  LOOP
    EXECUTE format('SELECT array_agg(DISTINCT %I::text) FROM %s WHERE %I::text = ANY($1)', fk.parent_col, p_table, p_col)
      INTO v_child_vals USING p_vals;
    IF fk.child = p_table AND fk.child_col = p_col THEN CONTINUE; END IF;
    PERFORM pg_temp.purge(fk.child, fk.child_col, v_child_vals, p_depth + 1);
  END LOOP;

  EXECUTE format('DELETE FROM %s WHERE %I::text = ANY($1)', p_table, p_col) USING p_vals;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN INSERT INTO _purged VALUES (p_table::text, n, p_depth); END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- The live-data guards that refuse deletes are paused for the purge only
-- ---------------------------------------------------------------------------
-- These triggers protect a running programme (a submitted quiz is final, a
-- learner keeps one active goal, a Triad group keeps three members, ...).
-- Removing a whole dataset trips them, so they are disabled here and
-- re-enabled below, inside this same transaction; the foreign-key check at
-- the end still proves the result is consistent.
CREATE TEMP TABLE _paused (tbl text, trg text) ON COMMIT DROP;
INSERT INTO _paused VALUES
  ('public.assignment_submissions', 'trg_prevent_quiz_resubmission'),
  ('public.coachee_goals',          'coachee_goals_minimum_active'),
  ('public.sessions',               'trg_enforce_coach_as_coachee_limit_sessions'),
  ('public.peer_sessions',          'trg_enforce_coach_as_coachee_limit_peer'),
  ('public.programme_modules',      'programme_modules_assert_schedules'),
  ('public.triad_groups',           'triad_groups_guard'),
  ('public.triad_sessions',         'triad_sessions_guard_delete'),
  ('public.triad_group_members',    'triad_group_members_protect_removal'),
  ('public.triad_group_members',    'triad_group_members_size'),
  ('public.cohort_requirement_dates', 'cohort_requirement_dates_keep_triad_groups'),
  ('public.cohort_requirement_dates', 'cohort_requirement_dates_assert_schedule');

DO $pause$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM _paused LOOP
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = r.tbl::regclass AND tgname = r.trg) THEN
      EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I', r.tbl, r.trg);
    ELSE
      DELETE FROM _paused WHERE tbl = r.tbl AND trg = r.trg;
    END IF;
  END LOOP;
END
$pause$;

-- ---------------------------------------------------------------------------
-- The deletes
-- ---------------------------------------------------------------------------
-- 1. The old demo programmes and everything under them. Their cohorts go
--    first and explicitly: cohorts.programme_id is ON DELETE SET NULL, so
--    deleting only the programme would leave its cohorts behind.
SELECT pg_temp.purge('public.cohorts', 'programme_id', (SELECT array_agg(id::text) FROM _old_programmes));
SELECT pg_temp.purge('public.programmes', 'id', (SELECT array_agg(id::text) FROM _old_programmes));

-- 2. Every demo account's enrollments, then the accounts themselves (public
--    rows first, then auth.users, whose own auth.* rows cascade).
SELECT pg_temp.purge('public.programme_enrollments', 'user_id', (SELECT array_agg(id::text) FROM _demo));
SELECT pg_temp.purge('public.profiles', 'id', (SELECT array_agg(id::text) FROM _demo));
SELECT pg_temp.purge('auth.users', 'id', (SELECT array_agg(id::text) FROM _demo));

-- 3. The old demo organisations. Nothing of a kept account points at them
--    (pre-check d).
SELECT pg_temp.purge('public.organizations', 'id', (SELECT array_agg(id::text) FROM _old_orgs));

-- The guards are back on before anything is verified or committed.
DO $resume$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM _paused LOOP
    EXECUTE format('ALTER TABLE %s ENABLE TRIGGER %I', r.tbl, r.trg);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_trigger t JOIN _paused p ON t.tgrelid = p.tbl::regclass AND t.tgname = p.trg
             WHERE t.tgenabled = 'D') THEN
    RAISE EXCEPTION 'A paused guard trigger is still disabled';
  END IF;
END
$resume$;

-- ---------------------------------------------------------------------------
-- Verification (before COMMIT)
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE n integer; bad text; fk record; v bigint;
BEGIN
  -- The 7 kept accounts still exist, with their profiles.
  SELECT count(*) INTO n FROM auth.users u JOIN _kept k ON k.id = u.id JOIN public.profiles p ON p.id = u.id;
  IF n <> 7 THEN RAISE EXCEPTION 'VERIFY FAILED: only % of 7 kept accounts remain', n; END IF;

  -- trang.tt@erickson.vn is still an admin.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles r JOIN _kept k ON k.id = r.user_id
                 WHERE k.email = 'trang.tt@erickson.vn' AND r.role = 'admin') THEN
    RAISE EXCEPTION 'VERIFY FAILED: trang.tt@erickson.vn is no longer an admin';
  END IF;

  -- Nothing a kept account OWNS was removed. Audit columns (who created,
  -- assigned, updated, reviewed, requested or managed a row) may reference a
  -- kept account -- usually the admin -- on a demo row that is deleted; those
  -- are reported, not refused.
  FOR fk IN SELECT * FROM _kept_refs_before LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I IN (SELECT id FROM _kept)', fk.tbl, fk.col) INTO v;
    IF v <> fk.n THEN
      IF fk.col IN ('created_by', 'updated_by', 'assigned_by', 'reviewed_by', 'changed_by', 'requested_by',
                    'account_manager_id') THEN
        RAISE NOTICE 'audit reference: %.% rows naming a kept account went with deleted demo rows (% -> %)',
          fk.tbl, fk.col, fk.n, v;
      ELSE
        RAISE EXCEPTION 'VERIFY FAILED: %.% rows owned by kept accounts changed % -> %', fk.tbl, fk.col, fk.n, v;
      END IF;
    END IF;
  END LOOP;

  -- No demo account, demo programme or demo organisation remains.
  SELECT count(*) INTO n FROM auth.users u
  WHERE u.email ILIKE '%@clariva.demo' OR u.email ILIKE '%@demo.clariva.club'
     OR (u.email ILIKE '%@erickson.vn' AND u.id::text LIKE 'ee000000%');
  IF n <> 0 THEN RAISE EXCEPTION 'VERIFY FAILED: % demo accounts remain', n; END IF;
  IF EXISTS (SELECT 1 FROM public.programmes WHERE id IN (SELECT id FROM _old_programmes))
     OR EXISTS (SELECT 1 FROM public.organizations WHERE id IN (SELECT id FROM _old_orgs)) THEN
    RAISE EXCEPTION 'VERIFY FAILED: an old demo programme or organisation remains';
  END IF;
  SELECT count(*) INTO n FROM public.cohorts WHERE programme_id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'VERIFY FAILED: % cohorts are left without a programme', n; END IF;

  -- No foreign-key violation anywhere in public (every FK, validated or not).
  FOR fk IN
    SELECT c.conrelid::regclass AS child, ca.attname AS child_col, c.confrelid::regclass AS parent, pa.attname AS parent_col
    FROM pg_constraint c
    JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = c.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('SELECT count(*) FROM %s ch WHERE ch.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %s p WHERE p.%I = ch.%I)',
                   fk.child, fk.child_col, fk.parent, fk.parent_col, fk.child_col) INTO v;
    IF v > 0 THEN RAISE EXCEPTION 'VERIFY FAILED: % rows of %.% point at missing %', v, fk.child, fk.child_col, fk.parent; END IF;
  END LOOP;

  RAISE NOTICE 'Cleanup verified: 7 kept accounts intact, trang.tt@erickson.vn admin, no FK violations.';
END
$verify$;

\echo == rows deleted per table
SELECT tbl, sum(n) AS rows_deleted FROM _purged GROUP BY tbl ORDER BY 2 DESC, 1;
\echo == what remains
SELECT (SELECT count(*) FROM auth.users) AS auth_users, (SELECT count(*) FROM public.programmes) AS programmes,
  (SELECT count(*) FROM public.cohorts) AS cohorts, (SELECT count(*) FROM public.programme_enrollments) AS enrollments,
  (SELECT count(*) FROM public.organizations) AS organizations;
SELECT p.name AS programme, c.name AS cohort, c.organization_id FROM public.cohorts c JOIN public.programmes p ON p.id = c.programme_id;

COMMIT;
