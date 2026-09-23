-- ===========================================================================
-- Clariva demo seed -- ADMIN ONLY.
--
-- The previous demo dataset (organisations, sponsors, coaches, learners,
-- programmes, cohorts, enrollments, sessions, goals, ratings, follow-up
-- actions and the Training content in scripts/seed-training-content.sql) was
-- removed on 2026-09-23. It dated everything relative to the day it ran
-- (current_date +/- N), so two databases seeded on different days disagreed,
-- and several learners' records contradicted the fulfilment rules of
-- 20260930100000_journey_current_fulfilment.
--
-- A replacement will be written as a separate task: fixed calendar dates, an
-- explicit due_on for every requirement (cohort_requirement_dates), and full
-- validation against the fulfilment rules before insertion. The removed file
-- is in git history (commit 4ae79b0 and earlier) for reference.
--
-- What this file does now: ensure trang.tt@erickson.vn exists with the admin
-- role. An existing account is adopted and left untouched (password, profile
-- and roles are not modified); only a missing account is created.
--
-- This file is NOT applied by `supabase db reset`; only supabase/seed.sql is
-- (the pgTAP fixture baseline, local only).
--
-- USAGE
--   psql "$DEMO_DB_URL" -v ON_ERROR_STOP=1 \
--        -c "SET app.seed_environment='demo'" -f supabase/seed-demo.sql
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
-- The Admin
-- ---------------------------------------------------------------------------
DO $admin$
DECLARE v_id uuid;
BEGIN
  SELECT u.id INTO v_id FROM auth.users u WHERE lower(u.email) = 'trang.tt@erickson.vn';
  IF v_id IS NOT NULL THEN
    RAISE NOTICE 'Admin: existing trang.tt@erickson.vn left untouched';
    RETURN;
  END IF;

  v_id := 'd0000000-0000-4000-8000-0000000000a1';
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change_token_new, recovery_token,
    email_change, phone_change, phone_change_token,
    email_change_token_current, reauthentication_token)
  VALUES (v_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
    'trang.tt@erickson.vn', extensions.crypt('Clariva2026!', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Trang Trinh"}'::jsonb, now(), now(), '', '', '',
    '', '', '', '', '');

  INSERT INTO public.profiles (id, full_name, email, status)
  VALUES (v_id, 'Trang Trinh', 'trang.tt@erickson.vn', 'active'::public.user_status)
  ON CONFLICT (id) DO UPDATE SET status = 'active'::public.user_status;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_id, 'admin'::public.app_role)
  ON CONFLICT DO NOTHING;

  -- handle_new_user() gives every new account a default `coachee` role; the
  -- Admin is not a learner.
  DELETE FROM public.user_roles WHERE user_id = v_id AND role = 'coachee'::public.app_role;
  DELETE FROM public.coachee_profiles WHERE id = v_id;

  RAISE NOTICE 'Admin: created trang.tt@erickson.vn with the demo password';
END
$admin$;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
    JOIN public.user_roles r ON r.user_id = u.id AND r.role = 'admin'::public.app_role
    WHERE lower(u.email) = 'trang.tt@erickson.vn'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: trang.tt@erickson.vn is missing or not an admin';
  END IF;
  RAISE NOTICE 'Demo seed (admin only) applied.';
END
$verify$;

COMMIT;
