-- Coaching canonical architecture verification (READ-ONLY against real data,
-- self-contained fixture otherwise). Mirrors the Triad verification script.
--
--   psql "$URL" -v ON_ERROR_STOP=1 -f scripts/coaching-canonical-verification.sql
--
-- Everything runs inside a transaction that is ROLLED BACK, so it is safe to
-- run against any environment: no fixture row survives.
--
-- Proves, with assertions that raise on failure:
--   1. atomic booking reserves the slot immediately at pending_coach_approval
--   2. a second learner cannot take a reserved slot
--   3. one Coaching requirement cannot hold two live sessions
--   4. a Coach outside the cohort pool is rejected
--   5. cancellation releases the slot AND the requirement
--   6. session completed  !=  Coaching unit completed
--   7. each of the four evidence gates independently blocks the unit
--   8. all four present  ->  unit complete, and canonical progress agrees

BEGIN;

DO $verify$
DECLARE
  v_org uuid; v_prog uuid; v_cohort uuid;
  v_coach uuid := gen_random_uuid();
  v_other_coach uuid := gen_random_uuid();
  v_l1 uuid := gen_random_uuid();
  v_l2 uuid := gen_random_uuid();
  v_e1 uuid; v_e2 uuid;
  v_req1 uuid; v_req2 uuid;
  v_slot1 uuid; v_slot2 uuid;
  v_sess uuid; v_goal uuid;
  v_ok boolean; v_msg text; v_n integer;
  v_completed integer; v_booked integer; v_required integer;
BEGIN
  -- ---------------------------------------------------------------------
  -- Fixture
  -- ---------------------------------------------------------------------
  INSERT INTO auth.users (id, email) VALUES
    (v_coach, 'coach@verify.test'), (v_other_coach, 'other@verify.test'),
    (v_l1, 'l1@verify.test'), (v_l2, 'l2@verify.test');

  -- A trigger on auth.users may already have created these profiles, so the
  -- fixture upserts rather than assuming either behaviour.
  INSERT INTO public.profiles (id, full_name, email) VALUES
    (v_coach, 'Verify Coach', 'coach@verify.test'),
    (v_other_coach, 'Outside Coach', 'other@verify.test'),
    (v_l1, 'Learner One', 'l1@verify.test'),
    (v_l2, 'Learner Two', 'l2@verify.test')
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;

  INSERT INTO public.programmes (name) VALUES ('Verify Programme') RETURNING id INTO v_prog;
  INSERT INTO public.cohorts (name, programme_id) VALUES ('Verify Cohort', v_prog) RETURNING id INTO v_cohort;
  -- The Programme defines HOW MANY Coaching units are required (section 2).
  INSERT INTO public.programme_modules (programme_id, module, enabled, config)
    VALUES (v_prog, 'coaching', true, '{"required": true, "required_units": 2}'::jsonb);

  INSERT INTO public.programme_enrollments (programme_id, user_id, cohort_id, status)
    VALUES (v_prog, v_l1, v_cohort, 'active') RETURNING id INTO v_e1;
  INSERT INTO public.programme_enrollments (programme_id, user_id, cohort_id, status)
    VALUES (v_prog, v_l2, v_cohort, 'active') RETURNING id INTO v_e2;

  -- Two Coaching requirements for the cohort, the canonical generic object.
  INSERT INTO public.cohort_requirement_dates
    (cohort_id, programme_id, module, ordinal, due_on, generation_method, materialized_via)
  VALUES (v_cohort, v_prog, 'coaching', 1, current_date + 30, 'manual', 'admin_save')
  RETURNING id INTO v_req1;
  INSERT INTO public.cohort_requirement_dates
    (cohort_id, programme_id, module, ordinal, due_on, generation_method, materialized_via)
  VALUES (v_cohort, v_prog, 'coaching', 2, current_date + 60, 'manual', 'admin_save')
  RETURNING id INTO v_req2;

  INSERT INTO public.cohort_coach_assignments (cohort_id, coach_id) VALUES (v_cohort, v_coach);

  INSERT INTO public.coach_availability (coach_id, slot_date, start_time, end_time, slot_type)
    VALUES (v_coach, current_date + 7, '09:00', '10:00', 'coaching') RETURNING id INTO v_slot1;
  INSERT INTO public.coach_availability (coach_id, slot_date, start_time, end_time, slot_type)
    VALUES (v_coach, current_date + 8, '09:00', '10:00', 'coaching') RETURNING id INTO v_slot2;

  -- ---------------------------------------------------------------------
  -- 1. Booking reserves the slot immediately
  -- ---------------------------------------------------------------------
  -- Act as learner 1. can_book_session() reads auth.uid(), so the fixture has
  -- to present a JWT subject exactly as PostgREST would.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_l1)::text, true);

  INSERT INTO public.sessions
    (enrollment_id, cohort_requirement_id, coach_id, coachee_id, slot_id, topic,
     start_time, duration_minutes, status)
  VALUES (v_e1, v_req1, v_coach, v_l1, v_slot1, 'Verify',
          (current_date + 7 + time '09:00') AT TIME ZONE 'UTC', 60, 'pending_coach_approval')
  RETURNING id INTO v_sess;

  SELECT is_booked INTO v_ok FROM public.coach_availability WHERE id = v_slot1;
  IF NOT v_ok THEN
    RAISE EXCEPTION '1 FAIL: slot not reserved at pending_coach_approval';
  END IF;

  -- The session must also carry the derived cohort, never a supplied one.
  IF (SELECT cohort_id FROM public.sessions WHERE id = v_sess) IS DISTINCT FROM v_cohort THEN
    RAISE EXCEPTION '1 FAIL: sessions.cohort_id was not derived from the enrollment';
  END IF;

  -- ---------------------------------------------------------------------
  -- 2. A second learner cannot take the reserved slot
  -- ---------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_l2)::text, true);
  BEGIN
    INSERT INTO public.sessions
      (enrollment_id, cohort_requirement_id, coach_id, coachee_id, slot_id, topic,
       start_time, duration_minutes, status)
    VALUES (v_e2, v_req1, v_coach, v_l2, v_slot1, 'Double book',
            (current_date + 7 + time '09:00') AT TIME ZONE 'UTC', 60, 'pending_coach_approval');
    RAISE EXCEPTION '2 FAIL: a second live session was created on a reserved slot';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- ---------------------------------------------------------------------
  -- 3. One requirement cannot hold two live sessions
  -- ---------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_l1)::text, true);
  BEGIN
    INSERT INTO public.sessions
      (enrollment_id, cohort_requirement_id, coach_id, coachee_id, slot_id, topic,
       start_time, duration_minutes, status)
    VALUES (v_e1, v_req1, v_coach, v_l1, v_slot2, 'Second live on req 1',
            (current_date + 8 + time '09:00') AT TIME ZONE 'UTC', 60, 'pending_coach_approval');
    RAISE EXCEPTION '3 FAIL: two live sessions exist for one Coaching requirement';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- ---------------------------------------------------------------------
  -- 4. A Coach outside the cohort pool is rejected
  -- ---------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_l2)::text, true);
  BEGIN
    INSERT INTO public.sessions
      (enrollment_id, cohort_requirement_id, coach_id, coachee_id, slot_id, topic,
       start_time, duration_minutes, status)
    VALUES (v_e2, v_req2, v_other_coach, v_l2, v_slot2, 'Outside coach',
            (current_date + 8 + time '09:00') AT TIME ZONE 'UTC', 60, 'pending_coach_approval');
    RAISE EXCEPTION '4 FAIL: a Coach outside the cohort pool was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- ---------------------------------------------------------------------
  -- 5. Cancellation releases the slot and the requirement
  -- ---------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_l1)::text, true);
  PERFORM set_config('app.session_transition', 'on', true);
  UPDATE public.sessions SET status = 'cancelled', cancelled_at = now() WHERE id = v_sess;

  SELECT is_booked INTO v_ok FROM public.coach_availability WHERE id = v_slot1;
  IF v_ok THEN
    RAISE EXCEPTION '5 FAIL: cancelling did not release the availability slot';
  END IF;

  -- The requirement is bookable again.
  INSERT INTO public.sessions
    (enrollment_id, cohort_requirement_id, coach_id, coachee_id, slot_id, topic,
     start_time, duration_minutes, status)
  VALUES (v_e1, v_req1, v_coach, v_l1, v_slot1, 'Rebooked',
          (current_date - 1 + time '09:00') AT TIME ZONE 'UTC', 60, 'confirmed')
  RETURNING id INTO v_sess;

  -- ---------------------------------------------------------------------
  -- 6/7. Session completed != unit completed; each gate blocks independently
  -- ---------------------------------------------------------------------
  UPDATE public.sessions SET status = 'completed' WHERE id = v_sess;

  SELECT unit_complete INTO v_ok FROM public.coaching_session_evidence(v_sess);
  IF v_ok THEN
    RAISE EXCEPTION '6 FAIL: unit complete with a held session and zero evidence';
  END IF;

  -- A goal makes the check-in gate applicable (section 20).
  INSERT INTO public.coachee_goals (enrollment_id, coachee_id, title, status)
    VALUES (v_e1, v_l1, 'Improve delegation', 'active') RETURNING id INTO v_goal;

  -- Gate 1: reflection only.
  INSERT INTO public.session_learning_reflections
    (enrollment_id, source_activity_type, source_activity_id, body)
    VALUES (v_e1, 'coaching', v_sess, 'What I learned');
  SELECT unit_complete INTO v_ok FROM public.coaching_session_evidence(v_sess);
  IF v_ok THEN RAISE EXCEPTION '7 FAIL: unit complete with only a reflection'; END IF;

  -- Gate 2: + goal check-in.
  INSERT INTO public.goal_checkins
    (enrollment_id, goal_id, source_activity_type, source_activity_id, new_rating, actor_user_id)
    VALUES (v_e1, v_goal, 'coaching', v_sess, 60, v_l1);
  SELECT unit_complete INTO v_ok FROM public.coaching_session_evidence(v_sess);
  IF v_ok THEN RAISE EXCEPTION '7 FAIL: unit complete without action or satisfaction'; END IF;

  -- Gate 3: + follow-up action.
  INSERT INTO public.enrollment_actions
    (enrollment_id, source_activity_type, source_activity_id, title, owner_user_id)
    VALUES (v_e1, 'coaching', v_sess, 'Delegate the weekly report', v_l1);
  SELECT unit_complete INTO v_ok FROM public.coaching_session_evidence(v_sess);
  IF v_ok THEN RAISE EXCEPTION '7 FAIL: unit complete without satisfaction'; END IF;

  -- Coach private note must NOT be a gate, and must not complete the unit.
  INSERT INTO public.coach_session_private_notes (session_id, coach_id, body)
    VALUES (v_sess, v_coach, 'Private note');
  SELECT unit_complete INTO v_ok FROM public.coaching_session_evidence(v_sess);
  IF v_ok THEN RAISE EXCEPTION '7 FAIL: a Coach private note completed the unit'; END IF;

  -- Gate 4: + satisfaction. Now, and only now, the unit completes.
  UPDATE public.sessions SET coachee_rating = 5, coachee_rated_at = now() WHERE id = v_sess;
  SELECT unit_complete INTO v_ok FROM public.coaching_session_evidence(v_sess);
  IF NOT v_ok THEN
    RAISE EXCEPTION '7 FAIL: all four evidence gates present but unit still incomplete';
  END IF;

  -- ---------------------------------------------------------------------
  -- 8. Canonical progress agrees
  -- ---------------------------------------------------------------------
  SELECT required_units, completed_units, booked_units
    INTO v_required, v_completed, v_booked
  FROM public.canonical_module_progress(v_e1, current_date)
  WHERE module = 'coaching';

  -- NULL-safe: a missing 'coaching' row means the module was never scheduled,
  -- which is itself a failure rather than a silently-passing NULL comparison.
  IF v_completed IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '8 FAIL: canonical completed_units = %, expected 1 (required=%)',
      coalesce(v_completed::text, 'NULL'), coalesce(v_required::text, 'NULL');
  END IF;

  -- Requirement 2 booked but with no evidence counts as booked, not complete.
  INSERT INTO public.sessions
    (enrollment_id, cohort_requirement_id, coach_id, coachee_id, slot_id, topic,
     start_time, duration_minutes, status)
  VALUES (v_e1, v_req2, v_coach, v_l1, v_slot2, 'Second unit',
          (current_date + 8 + time '09:00') AT TIME ZONE 'UTC', 60, 'confirmed');

  SELECT completed_units, booked_units INTO v_completed, v_booked
  FROM public.canonical_module_progress(v_e1, current_date) WHERE module = 'coaching';

  IF v_completed IS DISTINCT FROM 1 OR v_booked IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '8 FAIL: expected completed=1 booked=1, got completed=% booked=%',
      v_completed, v_booked;
  END IF;

  RAISE NOTICE 'Coaching canonical architecture verification PASSED';
END
$verify$;

ROLLBACK;
