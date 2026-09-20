-- ===========================================================================
-- Clariva canonical demo seed.
--
-- This file is BOTH a demo fixture AND a functional test of the canonical
-- source-of-truth chain. It creates no progress directly. Every number a
-- dashboard shows is produced by canonical_module_progress reading activity
-- that was booked through the canonical RPCs and attributed by the database.
--
--   programme_modules.required_units = N        (the only quantity authority)
--        -> cohort_module_deadlines             (the cohort answers BY WHEN)
--        -> sync_cohort_requirement_dates fires -> N cohort_requirement_dates
--        -> programme_enrollments               (ownership)
--        -> book_* RPC                          (eligibility + attribution)
--        -> session carrying cohort_requirement_id
--        -> lifecycle RPC -> 'completed'        (operational completion)
--        -> canonical_*_requirement_fulfilment
--        -> canonical_module_progress
--        -> Admin / Sponsor / Learner read the SAME numbers
--
-- If any link in that chain is broken this file RAISES. It must never fall
-- back to inserting a session, setting a status, or writing a progress number.
--
-- HOW ACTIVITY IS CREATED, AND THE ONE COMPROMISE
--
-- Sessions are booked with book_coaching_session / book_mentoring_session /
-- book_coachee_peer_session / learner_triad_schedule_session, acting as the
-- real learner (auth.uid() is set per call), and moved with
-- complete_coaching_session / transition_mentoring_session_status /
-- transition_peer_session_status / learner_triad_complete_session, acting as
-- the real provider. Requirement attribution is never supplied by hand: the
-- booking RPC resolves it.
--
-- The one thing the RPCs cannot do is create HISTORY:
--
--   book_coaching_session_internal:  IF v_start < now()  -> 'slot is in the past'
--   complete_coaching_session:       IF start_time > now() -> 'cannot complete before it starts'
--
-- A session can therefore only be booked in the future and only completed in
-- the past. To produce a cohort that finished in June, each session is booked
-- through the RPC at a future slot, then its start_time (and its slot) is moved
-- to the intended historical date, then it is completed through the lifecycle
-- RPC. The backdate touches start_time only -- never status, never
-- cohort_requirement_id, never enrollment_id. Those three remain entirely the
-- database's own work, which is what this seed exists to prove.
--
-- USAGE
--
-- This file is NOT applied by `supabase db reset`; only supabase/seed.sql is.
-- That separation is deliberate. Nine pgTAP suites -- demo_seed_contract,
-- peer_surface_agreement, sponsor_cohort_c_reconciliation,
-- sponsor_leader_detail_contract, sponsor_canonical_admin_activity_spine,
-- sponsor_canonical_cohort_progress_performance, p0_p1_database_contract,
-- enrollment_snapshot_projection and enrollment_schedule_backfill -- assert
-- against seed.sql's exact fixture on purpose ("a fixture proves the functions
-- compose, the seed proves the product does"). Replacing seed.sql with this
-- richer one turns all nine red, so seed.sql stays the test baseline and this
-- file is applied on demand instead.
--
-- Apply it to a database that has every migration and NO programme data:
--
--   psql "$DEMO_DB_URL" -v ON_ERROR_STOP=1 \
--        -c "SET app.seed_environment='demo'" -f supabase/seed-demo.sql
--
-- Locally, on top of a reset that has already run seed.sql, first clear the
-- programme data seed.sql created -- the two fixtures are not designed to
-- coexist, and this file makes no attempt to merge with another.
--
-- The guard below refuses to run unless app.seed_environment is set
-- deliberately, so it cannot be applied to production by accident.
-- ===========================================================================

BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('app.seed_environment', true), '') NOT IN
     ('local', 'development', 'preview', 'test', 'demo') THEN
    RAISE EXCEPTION
      'Refusing to seed: set app.seed_environment (local|development|preview|test|demo)'
      USING HINT = 'PGOPTIONS=''-c app.seed_environment=local'' supabase db reset';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------

-- Act as a given user for the following statements: the canonical RPCs all
-- read auth.uid(), so the seed must authenticate rather than bypass them.
CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
$$;

CREATE OR REPLACE FUNCTION pg_temp.act_as_service() RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '', true);
$$;

-- A published availability slot for a provider, always in the future so the
-- booking RPC accepts it. Returns the slot id.
CREATE OR REPLACE FUNCTION pg_temp.slot(
  p_provider uuid, p_type public.availability_slot_type, p_offset_minutes integer
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_start timestamptz := now() + make_interval(mins => p_offset_minutes); v_id uuid;
BEGIN
  INSERT INTO public.coach_availability (coach_id, slot_date, start_time, end_time, slot_type)
  VALUES (p_provider, (v_start AT TIME ZONE 'UTC')::date,
          (v_start AT TIME ZONE 'UTC')::time, ((v_start + interval '90 minutes') AT TIME ZONE 'UTC')::time,
          p_type)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Move a session (and its slot) to the date the demo story needs. Touches
-- start_time only; status and cohort_requirement_id are the database's.
CREATE OR REPLACE FUNCTION pg_temp.backdate(p_table text, p_session uuid, p_when timestamptz)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.session_transition', 'on', true);
  EXECUTE format('UPDATE public.%I SET start_time = $1 WHERE id = $2', p_table)
    USING p_when, p_session;
  PERFORM set_config('app.session_transition', 'off', true);
END $$;

-- Book one Coaching unit and carry it to 'completed' on a given date.
CREATE OR REPLACE FUNCTION pg_temp.coaching_unit(
  p_enrollment uuid, p_coach uuid, p_ordinal integer, p_when timestamptz, p_complete boolean
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_learner uuid; v_req uuid; v_slot uuid; v_session uuid;
BEGIN
  SELECT e.user_id INTO v_learner FROM public.programme_enrollments e WHERE e.id = p_enrollment;
  SELECT d.id INTO v_req
  FROM public.cohort_requirement_dates d
  JOIN public.programme_enrollments e ON e.cohort_id = d.cohort_id AND e.programme_id = d.programme_id
  WHERE e.id = p_enrollment AND d.module = 'coaching' AND d.ordinal = p_ordinal;
  IF v_req IS NULL THEN
    RAISE EXCEPTION 'No Coaching requirement % for enrollment %', p_ordinal, p_enrollment;
  END IF;

  v_slot := pg_temp.slot(p_coach, 'coaching', 60);
  PERFORM pg_temp.act_as(v_learner);
  v_session := public.book_coaching_session(
    p_enrollment, p_coach, v_slot, v_req, 'Coaching unit ' || p_ordinal, NULL, 60);

  PERFORM pg_temp.act_as_service();
  PERFORM pg_temp.backdate('sessions', v_session, p_when);

  -- The Coach confirms, then marks it held. Both through the lifecycle.
  PERFORM pg_temp.act_as(p_coach);
  PERFORM public.transition_session_status(v_session, 'coaching', 'confirm');
  IF p_complete THEN
    PERFORM public.complete_coaching_session(v_session);
  END IF;
  PERFORM pg_temp.act_as_service();
  RETURN v_session;
END $$;

-- Book one Mentoring unit and carry it to 'completed'.
CREATE OR REPLACE FUNCTION pg_temp.mentoring_unit(
  p_enrollment uuid, p_mentor uuid, p_ordinal integer, p_when timestamptz, p_complete boolean
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_learner uuid; v_req uuid; v_slot uuid; v_session uuid;
BEGIN
  SELECT e.user_id INTO v_learner FROM public.programme_enrollments e WHERE e.id = p_enrollment;
  SELECT d.id INTO v_req
  FROM public.cohort_requirement_dates d
  JOIN public.programme_enrollments e ON e.cohort_id = d.cohort_id AND e.programme_id = d.programme_id
  WHERE e.id = p_enrollment AND d.module = 'mentoring' AND d.ordinal = p_ordinal;
  IF v_req IS NULL THEN
    RAISE EXCEPTION 'No Mentoring requirement % for enrollment %', p_ordinal, p_enrollment;
  END IF;

  v_slot := pg_temp.slot(p_mentor, 'mentoring', 60);
  PERFORM pg_temp.act_as(v_learner);
  v_session := public.book_mentoring_session(
    p_enrollment, p_mentor, v_slot, 'Mentoring unit ' || p_ordinal, v_req, NULL, 60);

  PERFORM pg_temp.act_as_service();
  PERFORM pg_temp.backdate('mentoring_sessions', v_session, p_when);

  PERFORM pg_temp.act_as(p_mentor);
  PERFORM public.transition_mentoring_session_status(v_session, 'confirmed');
  IF p_complete THEN
    PERFORM public.transition_mentoring_session_status(v_session, 'completed');
  END IF;
  PERFORM pg_temp.act_as_service();
  RETURN v_session;
END $$;

-- Book one Peer unit. The RECEIVER books; the PROVIDER is another learner, and
-- the trigger gives each their own participation row against their own
-- requirement -- which is the Peer rule this seed is here to demonstrate.
CREATE OR REPLACE FUNCTION pg_temp.peer_unit(
  p_receiver_enrollment uuid, p_provider_user uuid, p_when timestamptz, p_complete boolean
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_learner uuid; v_session uuid;
BEGIN
  SELECT e.user_id INTO v_learner FROM public.programme_enrollments e WHERE e.id = p_receiver_enrollment;
  PERFORM pg_temp.act_as(v_learner);
  v_session := public.book_coachee_peer_session(
    p_provider_user, p_receiver_enrollment, 'Peer practice',
    now() + interval '60 minutes', 60, NULL);

  PERFORM pg_temp.act_as_service();
  PERFORM pg_temp.backdate('coachee_peer_sessions', v_session, p_when);

  PERFORM pg_temp.act_as(p_provider_user);
  PERFORM public.transition_peer_session_status('coachee_peer', v_session, 'confirmed');
  IF p_complete THEN
    PERFORM public.transition_peer_session_status('coachee_peer', v_session, 'completed');
  END IF;
  PERFORM pg_temp.act_as_service();
  RETURN v_session;
END $$;

-- One Triad unit: the admin forms the group for a specific requirement, a
-- member schedules, the others accept, a member completes.
CREATE OR REPLACE FUNCTION pg_temp.triad_unit(
  p_admin uuid, p_cohort uuid, p_ordinal integer, p_enrollments uuid[],
  p_when timestamptz, p_complete boolean
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_req uuid; v_group uuid; v_session uuid; v_enr uuid; v_user uuid;
BEGIN
  SELECT d.id INTO v_req FROM public.cohort_requirement_dates d
  WHERE d.cohort_id = p_cohort AND d.module = 'triads' AND d.ordinal = p_ordinal;
  IF v_req IS NULL THEN
    RAISE EXCEPTION 'No Triad requirement % for cohort %', p_ordinal, p_cohort;
  END IF;

  PERFORM pg_temp.act_as(p_admin);
  v_group := public.admin_triad_create_group(v_req, p_enrollments, 'en');

  -- The first member proposes the time; every other member accepts.
  SELECT e.user_id INTO v_user FROM public.programme_enrollments e WHERE e.id = p_enrollments[1];
  PERFORM pg_temp.act_as(v_user);
  v_session := public.learner_triad_schedule_session(
    v_group, now() + interval '60 minutes', now() + interval '150 minutes');

  FOREACH v_enr IN ARRAY p_enrollments[2:] LOOP
    SELECT e.user_id INTO v_user FROM public.programme_enrollments e WHERE e.id = v_enr;
    PERFORM pg_temp.act_as(v_user);
    PERFORM public.learner_triad_respond_session(v_session, 'accepted');
  END LOOP;

  PERFORM pg_temp.act_as_service();
  PERFORM set_config('app.session_transition', 'on', true);
  UPDATE public.triad_sessions
     SET scheduled_start_time = p_when, scheduled_end_time = p_when + interval '90 minutes'
   WHERE id = v_session;
  PERFORM set_config('app.session_transition', 'off', true);

  IF p_complete THEN
    SELECT e.user_id INTO v_user FROM public.programme_enrollments e WHERE e.id = p_enrollments[1];
    PERFORM pg_temp.act_as(v_user);
    PERFORM public.learner_triad_complete_session(v_session);
  END IF;
  PERFORM pg_temp.act_as_service();
  RETURN v_session;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Accounts
-- ---------------------------------------------------------------------------
-- profiles has no role or name columns: roles live in user_roles, the display
-- name is profiles.full_name. Passwords are bcrypt, as GoTrue expects.

CREATE TEMP TABLE _people (
  slug text PRIMARY KEY, id uuid, email text, full_name text, role public.app_role
) ON COMMIT DROP;

INSERT INTO _people (slug, id, email, full_name, role) VALUES
  ('sponsor',  'd0000000-0000-4000-8000-000000000001', 'sponsor@clariva.demo',  'Sam Sponsor',        'sponsor'),
  ('coach1',   'd0000000-0000-4000-8000-000000000011', 'coach1@clariva.demo',   'Paul Gossen',        'coach'),
  ('coach2',   'd0000000-0000-4000-8000-000000000012', 'coach2@clariva.demo',   'Dinh Lan Huong',     'coach'),
  ('coach3',   'd0000000-0000-4000-8000-000000000013', 'coach3@clariva.demo',   'Anna Fan',           'coach'),
  ('coach4',   'd0000000-0000-4000-8000-000000000014', 'coach4@clariva.demo',   'Marcus Bell',        'coach'),
  ('learner1', 'd0000000-0000-4000-8000-000000000021', 'learner1@clariva.demo', 'Linh Nguyen',        'coachee'),
  ('learner2', 'd0000000-0000-4000-8000-000000000022', 'learner2@clariva.demo', 'David Tran',         'coachee'),
  ('learner3', 'd0000000-0000-4000-8000-000000000023', 'learner3@clariva.demo', 'Priya Raman',        'coachee'),
  ('learner4', 'd0000000-0000-4000-8000-000000000024', 'learner4@clariva.demo', 'Tom Okafor',         'coachee'),
  ('learner5', 'd0000000-0000-4000-8000-000000000025', 'learner5@clariva.demo', 'Mai Pham',           'coachee'),
  ('learner6', 'd0000000-0000-4000-8000-000000000026', 'learner6@clariva.demo', 'Jonas Weber',        'coachee'),
  ('learner7', 'd0000000-0000-4000-8000-000000000027', 'learner7@clariva.demo', 'Sofia Rossi',        'coachee'),
  ('learner8', 'd0000000-0000-4000-8000-000000000028', 'learner8@clariva.demo', 'Kwame Mensah',       'coachee'),
  -- Cohort A's four finishers, and Cohort D's four learners.
  ('alum1',    'd0000000-0000-4000-8000-000000000031', 'alum1@clariva.demo',    'Grace Adeyemi',      'coachee'),
  ('alum2',    'd0000000-0000-4000-8000-000000000032', 'alum2@clariva.demo',    'Henrik Olsen',       'coachee'),
  ('alum3',    'd0000000-0000-4000-8000-000000000033', 'alum3@clariva.demo',    'Yuki Tanaka',        'coachee'),
  ('tasc1',    'd0000000-0000-4000-8000-000000000041', 'tasc1@clariva.demo',    'Elena Petrova',      'coachee'),
  ('tasc2',    'd0000000-0000-4000-8000-000000000042', 'tasc2@clariva.demo',    'Omar Haddad',        'coachee'),
  ('tasc3',    'd0000000-0000-4000-8000-000000000043', 'tasc3@clariva.demo',    'Chloe Martin',       'coachee'),
  ('tasc4',    'd0000000-0000-4000-8000-000000000044', 'tasc4@clariva.demo',    'Ravi Shankar',       'coachee'),
  -- A fifth learner in every cohort. sponsor_min_leaders_for_distribution() is
  -- 5: below that the Sponsor projection suppresses the cohort entirely, so a
  -- four-learner cohort would leave the Sponsor login staring at nothing and
  -- would make the cross-role check in section 12 compare no rows at all.
  ('alum4',    'd0000000-0000-4000-8000-000000000034', 'alum4@clariva.demo',    'Noor Farah',         'coachee'),
  ('learner9', 'd0000000-0000-4000-8000-000000000029', 'learner9@clariva.demo', 'Ana Silva',          'coachee'),
  ('learner10','d0000000-0000-4000-8000-00000000002a', 'learner10@clariva.demo','Peter Novak',        'coachee'),
  ('tasc5',    'd0000000-0000-4000-8000-000000000045', 'tasc5@clariva.demo',    'Leila Aziz',         'coachee');

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change_token_new, recovery_token)
SELECT p.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  p.email, extensions.crypt('Clariva2026!', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', p.full_name), now(), now(), '', '', ''
FROM _people p
ON CONFLICT (id) DO NOTHING;

-- The Admin. An existing trang.tt@erickson.vn is adopted, never recreated and
-- never re-passworded; only its role and profile are ensured.
CREATE TEMP TABLE _admin (id uuid, created boolean) ON COMMIT DROP;

DO $admin$
DECLARE v_id uuid;
BEGIN
  SELECT u.id INTO v_id FROM auth.users u WHERE lower(u.email) = 'trang.tt@erickson.vn';
  IF v_id IS NOT NULL THEN
    INSERT INTO _admin VALUES (v_id, false);
    RAISE NOTICE 'Admin: adopting existing trang.tt@erickson.vn (password untouched)';
  ELSE
    v_id := 'd0000000-0000-4000-8000-0000000000a1';
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change_token_new, recovery_token)
    VALUES (v_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
      'trang.tt@erickson.vn', extensions.crypt('Clariva2026!', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Trang Trinh"}'::jsonb, now(), now(), '', '', '');
    INSERT INTO _admin VALUES (v_id, true);
    RAISE NOTICE 'Admin: created trang.tt@erickson.vn with the demo password';
  END IF;
END
$admin$;

INSERT INTO public.profiles (id, full_name, email, status, must_change_password, peer_coaching_opt_in)
SELECT p.id, p.full_name, p.email, 'active'::public.user_status, false,
       p.role = 'coachee'   -- every learner is opted in, so Peer has a pool
FROM _people p
ON CONFLICT (id) DO UPDATE
  SET full_name = excluded.full_name, status = 'active'::public.user_status,
      peer_coaching_opt_in = excluded.peer_coaching_opt_in;

INSERT INTO public.profiles (id, full_name, email, status, must_change_password)
SELECT a.id, coalesce(u.raw_user_meta_data->>'full_name', 'Clariva Admin'), u.email,
       'active'::public.user_status, false
FROM _admin a JOIN auth.users u ON u.id = a.id
ON CONFLICT (id) DO UPDATE SET status = 'active'::public.user_status;

INSERT INTO public.user_roles (user_id, role)
SELECT p.id, p.role FROM _people p
UNION ALL SELECT a.id, 'admin'::public.app_role FROM _admin a
ON CONFLICT DO NOTHING;

-- Coach identity. A Mentor is a Coach with a cohort assignment, so the same
-- four people serve both roles; no mentor_profiles row is required.
INSERT INTO public.coach_profiles (id, title, specialties, approval_status, peer_coaching_opt_in)
SELECT p.id, 'Executive Coach', ARRAY['leadership','transition'], 'active'::public.user_status, true
FROM _people p WHERE p.role = 'coach'
ON CONFLICT (id) DO UPDATE SET approval_status = 'active'::public.user_status, peer_coaching_opt_in = true;

-- ---------------------------------------------------------------------------
-- 2. Organisation and sponsor
-- ---------------------------------------------------------------------------
INSERT INTO public.organizations (id, name)
VALUES ('d0000000-0000-4000-8000-00000000aaaa', 'Clariva Demo Organization')
ON CONFLICT (id) DO UPDATE SET name = excluded.name;

INSERT INTO public.sponsor_profiles (user_id, organization_id)
SELECT p.id, 'd0000000-0000-4000-8000-00000000aaaa' FROM _people p WHERE p.slug = 'sponsor'
ON CONFLICT (user_id) DO UPDATE SET organization_id = excluded.organization_id;

-- ---------------------------------------------------------------------------
-- 3. Programmes -- the only place quantity is stated
-- ---------------------------------------------------------------------------
INSERT INTO public.programmes (id, name, description, duration_months, is_active) VALUES
  ('d0000000-0000-4000-8000-0000000f0001', 'Emerging Leaders',
   'Blended leadership programme: Coaching, Mentoring, Peer practice and Triads.', 9, true),
  ('d0000000-0000-4000-8000-0000000f0002', 'Executive Excellence',
   'Senior programme with a deeper Coaching and Mentoring commitment.', 12, true),
  ('d0000000-0000-4000-8000-0000000f0003', 'TASC Essential',
   'Short programme: Mentoring and Triads only.', 6, true);

INSERT INTO public.programme_modules (programme_id, module, enabled, config) VALUES
  ('d0000000-0000-4000-8000-0000000f0001', 'coaching',      true, '{"required": true, "required_units": 4}'),
  ('d0000000-0000-4000-8000-0000000f0001', 'mentoring',     true, '{"required": true, "required_units": 2}'),
  ('d0000000-0000-4000-8000-0000000f0001', 'peer_coaching', true, '{"required": true, "required_units": 2}'),
  ('d0000000-0000-4000-8000-0000000f0001', 'triads',        true, '{"required": true, "required_units": 2}'),
  ('d0000000-0000-4000-8000-0000000f0002', 'coaching',      true, '{"required": true, "required_units": 6}'),
  ('d0000000-0000-4000-8000-0000000f0002', 'mentoring',     true, '{"required": true, "required_units": 3}'),
  ('d0000000-0000-4000-8000-0000000f0002', 'peer_coaching', true, '{"required": true, "required_units": 3}'),
  ('d0000000-0000-4000-8000-0000000f0002', 'triads',        true, '{"required": true, "required_units": 3}'),
  ('d0000000-0000-4000-8000-0000000f0003', 'mentoring',     true, '{"required": true, "required_units": 3}'),
  ('d0000000-0000-4000-8000-0000000f0003', 'triads',        true, '{"required": true, "required_units": 2}');

-- ---------------------------------------------------------------------------
-- 4. Cohorts -- the cohort answers BY WHEN, and the requirement rows
--    materialise themselves through sync_cohort_requirement_dates
-- ---------------------------------------------------------------------------
INSERT INTO public.cohorts (id, name, programme_id, organization_id, start_date, end_date) VALUES
  ('d0000000-0000-4000-8000-00000000c00a', 'Emerging Leaders - Cohort A (completed)',
   'd0000000-0000-4000-8000-0000000f0001', 'd0000000-0000-4000-8000-00000000aaaa',
   DATE '2026-01-06', DATE '2026-06-30'),
  ('d0000000-0000-4000-8000-00000000c00b', 'Emerging Leaders - Cohort B',
   'd0000000-0000-4000-8000-0000000f0001', 'd0000000-0000-4000-8000-00000000aaaa',
   current_date - 120, DATE '2027-03-31'),
  ('d0000000-0000-4000-8000-00000000c00c', 'Executive Excellence - Cohort C',
   'd0000000-0000-4000-8000-0000000f0002', 'd0000000-0000-4000-8000-00000000aaaa',
   current_date - 150, DATE '2027-06-30'),
  ('d0000000-0000-4000-8000-00000000c00d', 'TASC Essential - Cohort D',
   'd0000000-0000-4000-8000-0000000f0003', 'd0000000-0000-4000-8000-00000000aaaa',
   current_date - 90, DATE '2027-01-31');

-- Interim deadlines, set per module so "behind" is a real state rather than a
-- decoration: a requirement whose deadline has passed with nothing completed
-- is overdue, and the engine works that out for itself.
DO $deadlines$
DECLARE v_admin uuid;
BEGIN
  SELECT id INTO v_admin FROM _admin;
  PERFORM pg_temp.act_as(v_admin);

  -- Cohort A finished: everything was due before its end date.
  PERFORM public.admin_set_cohort_module_deadlines(
    'd0000000-0000-4000-8000-00000000c00a',
    jsonb_build_array(
      jsonb_build_object('programme_id','d0000000-0000-4000-8000-0000000f0001','module','coaching','completion_deadline','2026-06-30'),
      jsonb_build_object('programme_id','d0000000-0000-4000-8000-0000000f0001','module','mentoring','completion_deadline','2026-06-30'),
      jsonb_build_object('programme_id','d0000000-0000-4000-8000-0000000f0001','module','peer_coaching','completion_deadline','2026-06-30'),
      jsonb_build_object('programme_id','d0000000-0000-4000-8000-0000000f0001','module','triads','completion_deadline','2026-06-30')));

  -- Cohort B: Coaching and Mentoring were due a month ago (so "behind" bites),
  -- Peer and Triads are still ahead.
  PERFORM public.admin_set_cohort_module_deadlines(
    'd0000000-0000-4000-8000-00000000c00b',
    jsonb_build_array(
      jsonb_build_object('programme_id','d0000000-0000-4000-8000-0000000f0001','module','coaching','completion_deadline', (current_date - 30)::text),
      jsonb_build_object('programme_id','d0000000-0000-4000-8000-0000000f0001','module','mentoring','completion_deadline', (current_date - 15)::text),
      jsonb_build_object('programme_id','d0000000-0000-4000-8000-0000000f0001','module','peer_coaching','completion_deadline', (current_date + 120)::text),
      jsonb_build_object('programme_id','d0000000-0000-4000-8000-0000000f0001','module','triads','completion_deadline', (current_date + 150)::text)));

  PERFORM public.admin_set_cohort_module_deadlines(
    'd0000000-0000-4000-8000-00000000c00c',
    jsonb_build_array(
      jsonb_build_object('programme_id','d0000000-0000-4000-8000-0000000f0002','module','coaching','completion_deadline', (current_date - 20)::text),
      jsonb_build_object('programme_id','d0000000-0000-4000-8000-0000000f0002','module','mentoring','completion_deadline', (current_date - 10)::text),
      jsonb_build_object('programme_id','d0000000-0000-4000-8000-0000000f0002','module','peer_coaching','completion_deadline', (current_date + 180)::text),
      jsonb_build_object('programme_id','d0000000-0000-4000-8000-0000000f0002','module','triads','completion_deadline', (current_date + 200)::text)));

  PERFORM public.admin_set_cohort_module_deadlines(
    'd0000000-0000-4000-8000-00000000c00d',
    jsonb_build_array(
      jsonb_build_object('programme_id','d0000000-0000-4000-8000-0000000f0003','module','mentoring','completion_deadline', (current_date - 5)::text),
      jsonb_build_object('programme_id','d0000000-0000-4000-8000-0000000f0003','module','triads','completion_deadline', (current_date + 90)::text)));

  PERFORM pg_temp.act_as_service();
END
$deadlines$;

-- ---------------------------------------------------------------------------
-- 5. Provider pools -- who may deliver, per cohort
-- ---------------------------------------------------------------------------
-- Coaching and Mentoring assignments are independent: the same Coach identity,
-- two separate cohort decisions.
INSERT INTO public.cohort_coach_assignments (cohort_id, coach_id)
SELECT c.id, p.id
FROM public.cohorts c
JOIN _people p ON p.slug IN ('coach1','coach2','coach3')
WHERE c.id::text LIKE 'd0000000-0000-4000-8000-00000000c00%'
  AND EXISTS (SELECT 1 FROM public.programme_modules pm
              WHERE pm.programme_id = c.programme_id AND pm.module = 'coaching' AND pm.enabled)
ON CONFLICT DO NOTHING;

INSERT INTO public.cohort_mentors (cohort_id, mentor_user_id)
SELECT c.id, p.id
FROM public.cohorts c
JOIN _people p ON p.slug IN ('coach1','coach4')
WHERE c.id::text LIKE 'd0000000-0000-4000-8000-00000000c00%'
ON CONFLICT DO NOTHING;

-- Peer partners inside a learner's OWN cohort need no grant: peer_eligible_cohorts
-- always includes it (a self-grant is refused by peer_cohort_permissions_not_self).
-- The one grant here is a genuine cross-cohort one, A <-> B of the same
-- programme, so the Admin Peer panel has a real permission to show.
INSERT INTO public.peer_cohort_permissions (source_cohort_id, allowed_peer_cohort_id) VALUES
  ('d0000000-0000-4000-8000-00000000c00b', 'd0000000-0000-4000-8000-00000000c00a')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Enrollments
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _enr (slug text PRIMARY KEY, id uuid, person text, cohort uuid) ON COMMIT DROP;

INSERT INTO _enr (slug, id, person, cohort) VALUES
  -- Cohort A: four finishers. learner1 also appears here, then moves to B.
  ('a1', 'd0000000-0000-4000-8000-0000000e0a01', 'learner1', 'd0000000-0000-4000-8000-00000000c00a'),
  ('a2', 'd0000000-0000-4000-8000-0000000e0a02', 'alum1',    'd0000000-0000-4000-8000-00000000c00a'),
  ('a3', 'd0000000-0000-4000-8000-0000000e0a03', 'alum2',    'd0000000-0000-4000-8000-00000000c00a'),
  ('a4', 'd0000000-0000-4000-8000-0000000e0a04', 'alum3',    'd0000000-0000-4000-8000-00000000c00a'),
  ('b1', 'd0000000-0000-4000-8000-0000000e0b01', 'learner1', 'd0000000-0000-4000-8000-00000000c00b'),
  ('b2', 'd0000000-0000-4000-8000-0000000e0b02', 'learner2', 'd0000000-0000-4000-8000-00000000c00b'),
  ('b3', 'd0000000-0000-4000-8000-0000000e0b03', 'learner3', 'd0000000-0000-4000-8000-00000000c00b'),
  ('b4', 'd0000000-0000-4000-8000-0000000e0b04', 'learner4', 'd0000000-0000-4000-8000-00000000c00b'),
  ('c1', 'd0000000-0000-4000-8000-0000000e0c01', 'learner5', 'd0000000-0000-4000-8000-00000000c00c'),
  ('c2', 'd0000000-0000-4000-8000-0000000e0c02', 'learner6', 'd0000000-0000-4000-8000-00000000c00c'),
  ('c3', 'd0000000-0000-4000-8000-0000000e0c03', 'learner7', 'd0000000-0000-4000-8000-00000000c00c'),
  ('c4', 'd0000000-0000-4000-8000-0000000e0c04', 'learner8', 'd0000000-0000-4000-8000-00000000c00c'),
  ('d1', 'd0000000-0000-4000-8000-0000000e0d01', 'tasc1',    'd0000000-0000-4000-8000-00000000c00d'),
  ('d2', 'd0000000-0000-4000-8000-0000000e0d02', 'tasc2',    'd0000000-0000-4000-8000-00000000c00d'),
  ('d3', 'd0000000-0000-4000-8000-0000000e0d03', 'tasc3',    'd0000000-0000-4000-8000-00000000c00d'),
  ('d4', 'd0000000-0000-4000-8000-0000000e0d04', 'tasc4',    'd0000000-0000-4000-8000-00000000c00d'),
  ('a5', 'd0000000-0000-4000-8000-0000000e0a05', 'alum4',    'd0000000-0000-4000-8000-00000000c00a'),
  ('b5', 'd0000000-0000-4000-8000-0000000e0b05', 'learner9', 'd0000000-0000-4000-8000-00000000c00b'),
  ('c5', 'd0000000-0000-4000-8000-0000000e0c05', 'learner10','d0000000-0000-4000-8000-00000000c00c'),
  ('d5', 'd0000000-0000-4000-8000-0000000e0d05', 'tasc5',    'd0000000-0000-4000-8000-00000000c00d');

-- Cohort A first, and closed before B opens: only one ongoing enrollment per
-- learner is allowed, which is what makes learner1's history a real second
-- enrollment rather than a relabelled one.
INSERT INTO public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date, end_date)
SELECT e.id, c.programme_id, p.id, e.cohort, 'active'::public.enrollment_status, c.start_date, c.end_date
FROM _enr e JOIN _people p ON p.slug = e.person JOIN public.cohorts c ON c.id = e.cohort
WHERE e.slug LIKE 'a%';

-- ---------------------------------------------------------------------------
-- 7. Cohort A activity -- a finished programme
-- ---------------------------------------------------------------------------
-- Every unit of every module, completed between April and June 2026. Peer is
-- reciprocal: one physical session gives BOTH participants a unit against
-- their own requirement, which is the Peer rule made visible.
DO $cohort_a$
DECLARE
  c1 uuid; c2 uuid; c4 uuid; adm uuid;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid;
  u1 uuid; u2 uuid; u3 uuid; u4 uuid; u5 uuid;
  i integer;
BEGIN
  SELECT id INTO adm FROM _admin;
  SELECT id INTO c1 FROM _people WHERE slug = 'coach1';
  SELECT id INTO c2 FROM _people WHERE slug = 'coach2';
  SELECT id INTO c4 FROM _people WHERE slug = 'coach4';
  SELECT id INTO a1 FROM _enr WHERE slug = 'a1';
  SELECT id INTO a2 FROM _enr WHERE slug = 'a2';
  SELECT id INTO a3 FROM _enr WHERE slug = 'a3';
  SELECT id INTO a4 FROM _enr WHERE slug = 'a4';
  SELECT id INTO a5 FROM _enr WHERE slug = 'a5';
  SELECT user_id INTO u1 FROM public.programme_enrollments WHERE id = a1;
  SELECT user_id INTO u2 FROM public.programme_enrollments WHERE id = a2;
  SELECT user_id INTO u3 FROM public.programme_enrollments WHERE id = a3;
  SELECT user_id INTO u4 FROM public.programme_enrollments WHERE id = a4;
  SELECT user_id INTO u5 FROM public.programme_enrollments WHERE id = a5;

  -- Coaching 1..4 and Mentoring 1..2 for all four.
  FOR i IN 1..4 LOOP
    PERFORM pg_temp.coaching_unit(a1, c1, i, TIMESTAMPTZ '2026-02-10 09:00+00' + (i * interval '28 days'), true);
    PERFORM pg_temp.coaching_unit(a2, c2, i, TIMESTAMPTZ '2026-02-12 09:00+00' + (i * interval '28 days'), true);
    PERFORM pg_temp.coaching_unit(a3, c1, i, TIMESTAMPTZ '2026-02-14 09:00+00' + (i * interval '28 days'), true);
    PERFORM pg_temp.coaching_unit(a4, c2, i, TIMESTAMPTZ '2026-02-16 09:00+00' + (i * interval '28 days'), true);
    PERFORM pg_temp.coaching_unit(a5, c1, i, TIMESTAMPTZ '2026-02-18 09:00+00' + (i * interval '28 days'), true);
  END LOOP;
  FOR i IN 1..2 LOOP
    PERFORM pg_temp.mentoring_unit(a1, c1, i, TIMESTAMPTZ '2026-03-03 13:00+00' + (i * interval '45 days'), true);
    PERFORM pg_temp.mentoring_unit(a2, c4, i, TIMESTAMPTZ '2026-03-05 13:00+00' + (i * interval '45 days'), true);
    PERFORM pg_temp.mentoring_unit(a3, c4, i, TIMESTAMPTZ '2026-03-07 13:00+00' + (i * interval '45 days'), true);
    PERFORM pg_temp.mentoring_unit(a4, c1, i, TIMESTAMPTZ '2026-03-09 13:00+00' + (i * interval '45 days'), true);
    PERFORM pg_temp.mentoring_unit(a5, c4, i, TIMESTAMPTZ '2026-03-11 13:00+00' + (i * interval '45 days'), true);
  END LOOP;

  -- Peer as a five-cycle: every learner receives once and provides once, and
  -- a session credits BOTH sides against their own requirement -- so five
  -- sessions give five learners two units each, with nothing left over.
  PERFORM pg_temp.peer_unit(a1, u2, TIMESTAMPTZ '2026-04-08 10:00+00', true);
  PERFORM pg_temp.peer_unit(a2, u3, TIMESTAMPTZ '2026-04-15 10:00+00', true);
  PERFORM pg_temp.peer_unit(a3, u4, TIMESTAMPTZ '2026-04-22 10:00+00', true);
  PERFORM pg_temp.peer_unit(a4, u5, TIMESTAMPTZ '2026-04-29 10:00+00', true);
  PERFORM pg_temp.peer_unit(a5, u1, TIMESTAMPTZ '2026-05-02 10:00+00', true);

  -- Triads: two requirements, regrouped between them so no pair repeats.
  PERFORM pg_temp.triad_unit(adm, 'd0000000-0000-4000-8000-00000000c00a', 1, ARRAY[a1, a2, a3], TIMESTAMPTZ '2026-05-06 15:00+00', true);
  PERFORM pg_temp.triad_unit(adm, 'd0000000-0000-4000-8000-00000000c00a', 1, ARRAY[a4, a5], TIMESTAMPTZ '2026-05-07 15:00+00', true);
  PERFORM pg_temp.triad_unit(adm, 'd0000000-0000-4000-8000-00000000c00a', 2, ARRAY[a1, a4, a5], TIMESTAMPTZ '2026-06-10 15:00+00', true);
  PERFORM pg_temp.triad_unit(adm, 'd0000000-0000-4000-8000-00000000c00a', 2, ARRAY[a2, a3], TIMESTAMPTZ '2026-06-11 15:00+00', true);
END
$cohort_a$;

-- Cohort A is over. Closing it is also what frees learner1 to enrol in B:
-- only one ongoing enrollment per learner is permitted.
UPDATE public.programme_enrollments
   SET status = 'completed'::public.enrollment_status
 WHERE id IN (SELECT id FROM _enr WHERE slug LIKE 'a%');

-- ---------------------------------------------------------------------------
-- 8. Ongoing cohorts: enrollments
-- ---------------------------------------------------------------------------
INSERT INTO public.programme_enrollments (id, programme_id, user_id, cohort_id, status, start_date)
SELECT e.id, c.programme_id, p.id, e.cohort, 'active'::public.enrollment_status, c.start_date
FROM _enr e JOIN _people p ON p.slug = e.person JOIN public.cohorts c ON c.id = e.cohort
WHERE e.slug NOT LIKE 'a%';

-- ---------------------------------------------------------------------------
-- 9. Cohort B -- complete / on track / behind / just started
-- ---------------------------------------------------------------------------
DO $cohort_b$
DECLARE
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; adm uuid;
  b1 uuid; b2 uuid; b3 uuid; b4 uuid; ub1 uuid; ub2 uuid; ub3 uuid; ub4 uuid;
  i integer;
BEGIN
  SELECT id INTO adm FROM _admin;
  SELECT id INTO c1 FROM _people WHERE slug='coach1';  SELECT id INTO c2 FROM _people WHERE slug='coach2';
  SELECT id INTO c3 FROM _people WHERE slug='coach3';  SELECT id INTO c4 FROM _people WHERE slug='coach4';
  SELECT id INTO b1 FROM _enr WHERE slug='b1';  SELECT id INTO b2 FROM _enr WHERE slug='b2';
  SELECT id INTO b3 FROM _enr WHERE slug='b3';  SELECT id INTO b4 FROM _enr WHERE slug='b4';
  SELECT user_id INTO ub1 FROM public.programme_enrollments WHERE id=b1;
  SELECT user_id INTO ub2 FROM public.programme_enrollments WHERE id=b2;
  SELECT user_id INTO ub3 FROM public.programme_enrollments WHERE id=b3;
  SELECT user_id INTO ub4 FROM public.programme_enrollments WHERE id=b4;

  -- b1 FULLY COMPLETE.
  FOR i IN 1..4 LOOP PERFORM pg_temp.coaching_unit(b1, c1, i, now() - make_interval(days => 100 - i*15), true); END LOOP;
  FOR i IN 1..2 LOOP PERFORM pg_temp.mentoring_unit(b1, c4, i, now() - make_interval(days => 80 - i*20), true); END LOOP;

  -- b2 ON TRACK: everything already due is done; the rest is not due yet.
  FOR i IN 1..4 LOOP PERFORM pg_temp.coaching_unit(b2, c2, i, now() - make_interval(days => 95 - i*15), true); END LOOP;
  FOR i IN 1..2 LOOP PERFORM pg_temp.mentoring_unit(b2, c1, i, now() - make_interval(days => 70 - i*20), true); END LOOP;

  -- b3 BEHIND: the Coaching and Mentoring deadlines have passed with units
  -- outstanding. Nothing is fabricated -- the engine derives 'behind' itself.
  FOR i IN 1..2 LOOP PERFORM pg_temp.coaching_unit(b3, c3, i, now() - make_interval(days => 90 - i*20), true); END LOOP;

  -- b4 JUST STARTED: enrolled, nothing booked. Because the cohort's Coaching
  -- and Mentoring deadlines have already passed, b4 reads as overdue on those
  -- modules -- which is the honest canonical answer, not a display quirk.

  -- Peer (deadline still ahead). Each session gives BOTH sides a unit against
  -- their own requirement, so two sessions complete b1 and start b2 and b3.
  -- Booking a third for b1 would leave the extra participation unattributed --
  -- verification 6 exists to catch exactly that.
  PERFORM pg_temp.peer_unit(b1, ub2, now() - interval '40 days', true);
  PERFORM pg_temp.peer_unit(b1, ub3, now() - interval '26 days', true);

  -- Triads (deadline still ahead): b1 finishes both, b2 one, b3 one booked
  -- but not yet held.
  PERFORM pg_temp.triad_unit(adm, 'd0000000-0000-4000-8000-00000000c00b', 1, ARRAY[b1, b2], now() - interval '50 days', true);
  PERFORM pg_temp.triad_unit(adm, 'd0000000-0000-4000-8000-00000000c00b', 2, ARRAY[b1, b3], now() - interval '20 days', true);
END
$cohort_b$;

-- ---------------------------------------------------------------------------
-- 10. Cohort C -- the larger programme, same four shapes
-- ---------------------------------------------------------------------------
DO $cohort_c$
DECLARE
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; adm uuid;
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; u1 uuid; u2 uuid; u3 uuid;
  i integer;
BEGIN
  SELECT id INTO adm FROM _admin;
  SELECT id INTO c1 FROM _people WHERE slug='coach1';  SELECT id INTO c2 FROM _people WHERE slug='coach2';
  SELECT id INTO c3 FROM _people WHERE slug='coach3';  SELECT id INTO c4 FROM _people WHERE slug='coach4';
  SELECT id INTO e1 FROM _enr WHERE slug='c1';  SELECT id INTO e2 FROM _enr WHERE slug='c2';
  SELECT id INTO e3 FROM _enr WHERE slug='c3';  SELECT id INTO e4 FROM _enr WHERE slug='c4';
  SELECT user_id INTO u1 FROM public.programme_enrollments WHERE id=e1;
  SELECT user_id INTO u2 FROM public.programme_enrollments WHERE id=e2;
  SELECT user_id INTO u3 FROM public.programme_enrollments WHERE id=e3;

  -- c1 FULLY COMPLETE: 6 Coaching, 3 Mentoring, 3 Peer, 3 Triads.
  FOR i IN 1..6 LOOP PERFORM pg_temp.coaching_unit(e1, c1, i, now() - make_interval(days => 140 - i*18), true); END LOOP;
  FOR i IN 1..3 LOOP PERFORM pg_temp.mentoring_unit(e1, c4, i, now() - make_interval(days => 120 - i*25), true); END LOOP;

  -- c2 ON TRACK: the due modules are finished.
  FOR i IN 1..6 LOOP PERFORM pg_temp.coaching_unit(e2, c2, i, now() - make_interval(days => 135 - i*18), true); END LOOP;
  FOR i IN 1..3 LOOP PERFORM pg_temp.mentoring_unit(e2, c1, i, now() - make_interval(days => 115 - i*25), true); END LOOP;

  -- c3 BEHIND: 2 of 6 Coaching, 1 of 3 Mentoring, both deadlines passed.
  FOR i IN 1..2 LOOP PERFORM pg_temp.coaching_unit(e3, c3, i, now() - make_interval(days => 130 - i*20), true); END LOOP;
  PERFORM pg_temp.mentoring_unit(e3, c4, 1, now() - interval '95 days', true);

  -- c4 JUST STARTED.

  -- Peer and Triads are not due yet; c1 completes them, c2 makes a start.
  -- Three Peer units each. e1 receives twice and provides once, which fills
  -- its three requirements exactly; e2 and e3 are left part-way.
  PERFORM pg_temp.peer_unit(e1, u2, now() - interval '60 days', true);
  PERFORM pg_temp.peer_unit(e2, u1, now() - interval '53 days', true);
  PERFORM pg_temp.peer_unit(e1, u3, now() - interval '46 days', true);

  PERFORM pg_temp.triad_unit(adm, 'd0000000-0000-4000-8000-00000000c00c', 1, ARRAY[e1, e2], now() - interval '70 days', true);
  PERFORM pg_temp.triad_unit(adm, 'd0000000-0000-4000-8000-00000000c00c', 2, ARRAY[e1, e3], now() - interval '45 days', true);
  PERFORM pg_temp.triad_unit(adm, 'd0000000-0000-4000-8000-00000000c00c', 3, ARRAY[e1, e2, e3], now() - interval '18 days', true);
END
$cohort_c$;

-- ---------------------------------------------------------------------------
-- 11. Cohort D -- Mentoring and Triads only
-- ---------------------------------------------------------------------------
DO $cohort_d$
DECLARE
  c1 uuid; c4 uuid; adm uuid; d1 uuid; d2 uuid; d3 uuid; d4 uuid; i integer;
BEGIN
  SELECT id INTO adm FROM _admin;
  SELECT id INTO c1 FROM _people WHERE slug='coach1';  SELECT id INTO c4 FROM _people WHERE slug='coach4';
  SELECT id INTO d1 FROM _enr WHERE slug='d1';  SELECT id INTO d2 FROM _enr WHERE slug='d2';
  SELECT id INTO d3 FROM _enr WHERE slug='d3';  SELECT id INTO d4 FROM _enr WHERE slug='d4';

  FOR i IN 1..3 LOOP PERFORM pg_temp.mentoring_unit(d1, c4, i, now() - make_interval(days => 70 - i*15), true); END LOOP;
  FOR i IN 1..2 LOOP PERFORM pg_temp.mentoring_unit(d2, c1, i, now() - make_interval(days => 65 - i*15), true); END LOOP;
  PERFORM pg_temp.mentoring_unit(d3, c4, 1, now() - interval '50 days', true);
  -- d4: nothing.

  PERFORM pg_temp.triad_unit(adm, 'd0000000-0000-4000-8000-00000000c00d', 1, ARRAY[d1, d2, d3], now() - interval '40 days', true);
  PERFORM pg_temp.triad_unit(adm, 'd0000000-0000-4000-8000-00000000c00d', 2, ARRAY[d1, d2], now() - interval '12 days', true);
END
$cohort_d$;

-- ---------------------------------------------------------------------------
-- 12. VERIFICATION -- the seed is only valid if every one of these holds
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE bad text; n integer;
BEGIN
  -- 1. Every enabled required module of every enrollment has a quantity.
  SELECT string_agg(format('%s/%s', x.enrollment_id, x.module), '; ') INTO bad
  FROM (
    SELECT e.id AS enrollment_id, p.module
    FROM public.programme_enrollments e
    CROSS JOIN LATERAL public.canonical_module_progress(e.id, current_date) p
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id AND pm.module = p.module AND pm.enabled
     AND coalesce((pm.config->>'required')::boolean, false)
    WHERE p.required_units <= 0
  ) x;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY 1 FAILED: required_units is 0 for %', bad;
  END IF;

  -- 2. Fully complete learners: completed = required on every module.
  SELECT string_agg(format('%s/%s %s of %s', x.slug, x.module, x.completed_units, x.required_units), '; ')
    INTO bad
  FROM (
    SELECT en.slug, p.module, p.completed_units, p.required_units
    FROM _enr en
    CROSS JOIN LATERAL public.canonical_module_progress(en.id, current_date) p
    WHERE en.slug IN ('a1','a2','a3','a4','b1','c1')
      AND p.required_units > 0 AND p.completed_units <> p.required_units
  ) x;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY 2 FAILED: complete learners are not complete: %', bad;
  END IF;

  -- 3. Just-started learners: nothing completed anywhere.
  SELECT string_agg(format('%s/%s = %s', x.slug, x.module, x.completed_units), '; ') INTO bad
  FROM (
    SELECT en.slug, p.module, p.completed_units
    FROM _enr en
    CROSS JOIN LATERAL public.canonical_module_progress(en.id, current_date) p
    WHERE en.slug IN ('b4','c4','d4') AND p.completed_units <> 0
  ) x;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY 3 FAILED: a just-started learner has activity: %', bad;
  END IF;

  -- 4/5/6. Nothing unattributed anywhere.
  SELECT count(*) INTO n FROM public.coaching_sessions_without_requirement();
  IF n > 0 THEN RAISE EXCEPTION 'VERIFY 4 FAILED: % Coaching sessions hold no requirement', n; END IF;
  SELECT count(*) INTO n FROM public.mentoring_sessions_without_requirement();
  IF n > 0 THEN RAISE EXCEPTION 'VERIFY 5 FAILED: % Mentoring sessions hold no requirement', n; END IF;
  SELECT count(*) INTO n FROM public.peer_participants_without_requirement();
  IF n > 0 THEN RAISE EXCEPTION 'VERIFY 6 FAILED: % Peer participations hold no requirement', n; END IF;

  -- 7. Cross-role reconciliation, performed AS EACH ROLE.
  -- These projections are permission-aware, so calling them with no JWT
  -- returns nothing and any comparison would be vacuous. Acting as the real
  -- learner, the real admin and the real sponsor is also the only way this
  -- proves what it claims: that three different people, reaching progress by
  -- three different routes, are shown the same number.
  DECLARE
    r record; v_admin uuid; v_sponsor uuid;
    l_req integer; l_done integer;
    a_req integer; a_done integer;
    s_req integer; s_done integer;
  BEGIN
    SELECT id INTO v_admin FROM _admin;
    SELECT id INTO v_sponsor FROM _people WHERE slug = 'sponsor';

    FOR r IN
      SELECT en.slug, en.id AS enrollment_id, pe.user_id, pe.cohort_id
      FROM _enr en JOIN public.programme_enrollments pe ON pe.id = en.id
    LOOP
      PERFORM pg_temp.act_as(r.user_id);
      SELECT coaching_required_units, coaching_completed_units INTO l_req, l_done
      FROM public.learner_canonical_progress(r.enrollment_id);

      PERFORM pg_temp.act_as(v_admin);
      SELECT coaching_required_units, coaching_completed_units INTO a_req, a_done
      FROM public.admin_canonical_enrollment_progress(ARRAY[r.enrollment_id]);

      PERFORM pg_temp.act_as(v_sponsor);
      SELECT coaching_required_units, coaching_completed_units INTO s_req, s_done
      FROM public.sponsor_canonical_enrollment_progress(r.cohort_id)
      WHERE enrollment_id = r.enrollment_id;

      PERFORM pg_temp.act_as_service();

      -- A NULL means that role saw no row at all, which is a failure in its
      -- own right: it is how a vacuous "everything matches" would arise.
      IF l_req IS NULL THEN RAISE EXCEPTION 'VERIFY 7 FAILED: learner sees no progress for %', r.slug; END IF;
      IF a_req IS NULL THEN RAISE EXCEPTION 'VERIFY 7 FAILED: admin sees no progress for %', r.slug; END IF;
      IF s_req IS NULL THEN
        RAISE EXCEPTION 'VERIFY 7 FAILED: sponsor sees no progress for % (cohort below the distribution minimum?)', r.slug;
      END IF;
      IF row(l_req, l_done) IS DISTINCT FROM row(a_req, a_done)
         OR row(l_req, l_done) IS DISTINCT FROM row(s_req, s_done) THEN
        RAISE EXCEPTION 'VERIFY 7 FAILED: % learner=%/% admin=%/% sponsor=%/%',
          r.slug, l_req, l_done, a_req, a_done, s_req, s_done;
      END IF;
    END LOOP;
  END;

  -- 8. Every Peer session has exactly two owned, attributed participations.
  SELECT string_agg(x.peer_session_id::text, ', ') INTO bad FROM (
    SELECT p.peer_session_id
    FROM public.peer_session_participants p
    GROUP BY p.session_kind, p.peer_session_id
    HAVING count(*) <> 2
        OR count(*) FILTER (WHERE p.enrollment_id IS NULL) > 0
        OR count(*) FILTER (WHERE p.cohort_requirement_id IS NULL) > 0
  ) x;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY 8 FAILED: Peer sessions without two owned participations: %', bad;
  END IF;

  -- 9. No session anywhere lacks a requirement.
  SELECT count(*) INTO n FROM public.sessions WHERE cohort_requirement_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'VERIFY 9 FAILED: % sessions rows with NULL requirement', n; END IF;
  SELECT count(*) INTO n FROM public.mentoring_sessions WHERE cohort_requirement_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'VERIFY 9 FAILED: % mentoring_sessions with NULL requirement', n; END IF;
  SELECT count(*) INTO n FROM public.peer_session_participants WHERE cohort_requirement_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'VERIFY 9 FAILED: % peer participations with NULL requirement', n; END IF;

  -- 10. Cohort A is 100% complete for every learner in it.
  SELECT string_agg(format('%s = %s%%', en.slug, round(p.full_completion_pct)), '; ') INTO bad
  FROM _enr en
  CROSS JOIN LATERAL public.canonical_enrollment_progress(en.id, current_date) p
  WHERE en.slug LIKE 'a%' AND round(p.full_completion_pct) < 100;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY 10 FAILED: completed cohort A is not at 100%%: %', bad;
  END IF;

  -- The schedule invariant itself.
  SELECT count(*) INTO n FROM public.cohort_schedule_violations() WHERE violation <> 'missing_deadline';
  IF n > 0 THEN RAISE EXCEPTION 'VERIFY FAILED: % cohort modules violate the quantity invariant', n; END IF;

  RAISE NOTICE 'All verification checks passed.';
END
$verify$;

-- ---------------------------------------------------------------------------
-- 13. Summary -- every number below is read back from the canonical engine
-- ---------------------------------------------------------------------------
DO $summary$
DECLARE r record;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '== PROGRESS (canonical_module_progress) ==';
  RAISE NOTICE '%', rpad('cohort',18)||rpad('learner',16)||rpad('module',15)
               ||lpad('req',4)||lpad('done',6)||lpad('due',5)||lpad('over',6)||'  status';
  FOR r IN
    SELECT c.name AS cohort, pr.full_name AS learner, p.module::text AS module,
           p.required_units, p.completed_units, p.due_units, p.overdue_units, p.pace_status
    FROM _enr en
    JOIN public.programme_enrollments e ON e.id = en.id
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN public.profiles pr ON pr.id = e.user_id
    CROSS JOIN LATERAL public.canonical_module_progress(en.id, current_date) p
    WHERE p.required_units > 0
    ORDER BY c.name, pr.full_name, p.module::text
  LOOP
    RAISE NOTICE '%', rpad(substr(r.cohort,1,17),18)||rpad(substr(r.learner,1,15),16)
                 ||rpad(r.module,15)||lpad(r.required_units::text,4)
                 ||lpad(r.completed_units::text,6)||lpad(r.due_units::text,5)
                 ||lpad(r.overdue_units::text,6)||'  '||r.pace_status;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '== LOGIN CREDENTIALS (password for all: Clariva2026!) ==';
  RAISE NOTICE '%', rpad('email',26)||rpad('role',10)||'what you will see';
  RAISE NOTICE '%', rpad('trang.tt@erickson.vn',26)||rpad('admin',10)||'all cohorts, schedules, provider pools, alerts';
  RAISE NOTICE '%', rpad('sponsor@clariva.demo',26)||rpad('sponsor',10)||'Clariva Demo Organization rollups, no narrative';
  RAISE NOTICE '%', rpad('coach1@clariva.demo',26)||rpad('coach',10)||'Coaching + Mentoring delivery across all cohorts';
  RAISE NOTICE '%', rpad('coach2@clariva.demo',26)||rpad('coach',10)||'Coaching delivery (cohorts A/B/C)';
  RAISE NOTICE '%', rpad('coach3@clariva.demo',26)||rpad('coach',10)||'Coaching delivery, behind-schedule learners';
  RAISE NOTICE '%', rpad('coach4@clariva.demo',26)||rpad('coach',10)||'Mentoring delivery only (Mentor, not Coaching)';
  RAISE NOTICE '%', rpad('learner1@clariva.demo',26)||rpad('coachee',10)||'COMPLETE in B, plus a finished cohort A history';
  RAISE NOTICE '%', rpad('learner2@clariva.demo',26)||rpad('coachee',10)||'ON TRACK - due work done, rest not yet due';
  RAISE NOTICE '%', rpad('learner3@clariva.demo',26)||rpad('coachee',10)||'BEHIND - overdue Coaching and Mentoring';
  RAISE NOTICE '%', rpad('learner4@clariva.demo',26)||rpad('coachee',10)||'JUST STARTED - enrolled, nothing booked';
  RAISE NOTICE '%', rpad('learner5@clariva.demo',26)||rpad('coachee',10)||'COMPLETE - Executive Excellence (6/3/3/3)';
  RAISE NOTICE '%', rpad('learner6@clariva.demo',26)||rpad('coachee',10)||'ON TRACK - Executive Excellence';
  RAISE NOTICE '%', rpad('learner7@clariva.demo',26)||rpad('coachee',10)||'BEHIND - Executive Excellence';
  RAISE NOTICE '%', rpad('learner8@clariva.demo',26)||rpad('coachee',10)||'JUST STARTED - Executive Excellence';
  RAISE NOTICE '%', rpad('alum1..3@clariva.demo',26)||rpad('coachee',10)||'finished cohort A (100%% complete)';
  RAISE NOTICE '%', rpad('tasc1..4@clariva.demo',26)||rpad('coachee',10)||'TASC Essential - Mentoring and Triads only';
  RAISE NOTICE '';
  RAISE NOTICE 'NOTE: a cohort module deadline applies to the whole cohort. A learner who';
  RAISE NOTICE '      has done nothing in a cohort whose deadline has passed therefore reads';
  RAISE NOTICE '      as overdue - that is the canonical answer, not a display fault.';
END
$summary$;

COMMIT;
