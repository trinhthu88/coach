-- ===========================================================================
-- Clariva demo seed -- patch of 2026-09-23 for a database that ALREADY holds
-- the demo dataset (supabase/seed-demo.sql as of commit e9bdf5b).
--
-- Brings that database to exactly what the current seed-demo.sql produces,
-- touching only the rows that changed. Same deterministic ids, same text
-- choices, same admin/learner functions as the seed:
--   A1  Emerging Leaders gets 2 required Triads; Cohort 3's checkpoints move
--       to the 16-week layout (Coaching 1 wk 3, Triad 1 wk 4, Triad 2 wk 10,
--       Coaching 2 wk 12, Mentoring 2 wk 14, Coaching 3 wk 16); Ngoc and Dat
--       hold Coaching 1 in its window; one group (Ngoc, Dat, Yen) per Triad.
--   A2  Yen's two goals get a baseline and a target (25 -> 75, 30 -> 70).
--   A3  Duc's slots start on 2026-09-24 and run to 2027-01-05, plus Wednesday
--       Mentoring slots; every learner of an ongoing cohort is allowlisted
--       with Duc so the booking page can read his profile and slots.
--   A4  Portrait / people-focused Skill Card images are replaced.
--
-- USAGE
--   PGOPTIONS='-c app.seed_environment=demo' psql "$DEMO_DB_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/seed-demo-patch-2026-09-23.sql
-- One transaction: any failed rule or verification rolls it all back. It
-- refuses to run twice (it checks for the Emerging Leaders Triad module).
-- ===========================================================================

BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('app.seed_environment', true), '') NOT IN
     ('local', 'development', 'preview', 'test', 'demo') THEN
    RAISE EXCEPTION 'Refusing to patch: set app.seed_environment (local|development|preview|test|demo)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = 'de000000-0000-4000-8000-000000000001')
     OR NOT EXISTS (SELECT 1 FROM public.cohorts WHERE id = 'de300000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'The demo dataset is not present; run supabase/seed-demo.sql instead';
  END IF;
  IF EXISTS (SELECT 1 FROM public.programme_modules
             WHERE programme_id = 'de100000-0000-4000-8000-000000000003' AND module = 'triads') THEN
    RAISE EXCEPTION 'This patch is already applied (Emerging Leaders has a Triad module)';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.act_as_service() RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '', true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.uid(p_key text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT md5('clariva-demo-2026:' || p_key)::uuid;
$$;
CREATE OR REPLACE FUNCTION pg_temp.ict(p_day date, p_time time) RETURNS timestamptz
LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_day + p_time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
$$;

CREATE TEMP TABLE _admin ON COMMIT DROP AS
SELECT u.id FROM auth.users u WHERE lower(u.email) = 'trang.tt@erickson.vn';

-- The demo learners of the ongoing cohorts (ids as seed-demo.sql derives them).
CREATE TEMP TABLE _enr ON COMMIT DROP AS
SELECT v.slug, v.user_id::uuid AS user_id, ('de400000' || substr(v.user_id, 9))::uuid AS id, v.cohort
FROM (VALUES
  ('huy',  'de000000-0000-4000-8000-000000000014', 2), ('mai',  'de000000-0000-4000-8000-000000000015', 2),
  ('khoa', 'de000000-0000-4000-8000-000000000021', 2), ('tam',  'de000000-0000-4000-8000-000000000022', 2),
  ('ngoc', 'de000000-0000-4000-8000-000000000018', 3), ('dat',  'de000000-0000-4000-8000-000000000026', 3),
  ('yen',  'de000000-0000-4000-8000-000000000027', 3),
  ('anh',  'de000000-0000-4000-8000-000000000016', 4), ('tung', 'de000000-0000-4000-8000-000000000017', 4)
) AS v(slug, user_id, cohort);

-- ---------------------------------------------------------------------------
-- A1. Emerging Leaders: two Triads
-- ---------------------------------------------------------------------------
UPDATE public.programmes
SET description = 'A 16-week programme for first-time people leaders: four Training weeks on the leadership basics, '
                  || 'three coaching sessions, two triad practice sessions and two mentoring conversations.'
WHERE id = 'de100000-0000-4000-8000-000000000003';

INSERT INTO public.programme_modules (programme_id, module, enabled, config)
VALUES ('de100000-0000-4000-8000-000000000003', 'triads', true, '{"required": true, "required_units": 2}');

-- Cohort 3's checkpoints, due at the end of their programme week.
CREATE TEMP TABLE _dates (module public.programme_module_type, ordinal integer, week_number integer, due_on date) ON COMMIT DROP;
INSERT INTO _dates VALUES
  ('training', 1, 1, '2026-09-22'), ('training', 2, 2, '2026-09-29'), ('coaching', 1, NULL, '2026-10-06'),
  ('triads', 1, NULL, '2026-10-13'), ('training', 3, 3, '2026-10-20'), ('mentoring', 1, NULL, '2026-10-27'),
  ('training', 4, 4, '2026-11-10'), ('triads', 2, NULL, '2026-11-24'), ('coaching', 2, NULL, '2026-12-08'),
  ('mentoring', 2, NULL, '2026-12-22'), ('coaching', 3, NULL, '2027-01-05');

DO $requirement_dates$
DECLARE v_cohort constant uuid := 'de300000-0000-4000-8000-000000000003';
        v_programme constant uuid := 'de100000-0000-4000-8000-000000000003';
        n integer;
BEGIN
  PERFORM pg_temp.act_as((SELECT id FROM _admin));
  PERFORM public.admin_set_cohort_module_deadlines(v_cohort, (
    SELECT jsonb_agg(jsonb_build_object('programme_id', v_programme, 'module', d.module, 'completion_deadline', max_due))
    FROM (SELECT d.module, max(d.due_on) AS max_due FROM _dates d WHERE d.module <> 'training' GROUP BY d.module) d));
  PERFORM public.admin_set_cohort_requirement_dates(v_cohort, (
    SELECT jsonb_agg(jsonb_build_object('requirement_id', r.id, 'due_on', d.due_on))
    FROM _dates d
    JOIN public.cohort_requirement_dates r
      ON r.cohort_id = v_cohort AND r.module = d.module
     AND ((d.module = 'training' AND r.training_week_id = pg_temp.uid('week:3:' || d.week_number))
          OR (d.module <> 'training' AND r.ordinal = d.ordinal))));
  PERFORM pg_temp.act_as_service();

  SELECT count(*) INTO n FROM public.cohort_requirement_dates r
  JOIN _dates d ON d.module = r.module AND d.due_on = r.due_on
   AND ((d.module = 'training' AND r.training_week_id = pg_temp.uid('week:3:' || d.week_number))
        OR (d.module <> 'training' AND r.ordinal = d.ordinal))
  WHERE r.cohort_id = v_cohort;
  IF n <> 11 OR (SELECT count(*) FROM public.cohort_requirement_dates WHERE cohort_id = v_cohort) <> 11 THEN
    RAISE EXCEPTION 'Cohort 3: % of 11 requirement dates set (% rows exist)', n,
      (SELECT count(*) FROM public.cohort_requirement_dates WHERE cohort_id = v_cohort);
  END IF;
END
$requirement_dates$;

-- One group of Ngoc, Dat and Yen for each Triad, created as the Admin does it.
DO $triad_groups$
DECLARE r record;
BEGIN
  PERFORM pg_temp.act_as((SELECT id FROM _admin));
  FOR r IN
    SELECT d.id FROM public.cohort_requirement_dates d
    WHERE d.cohort_id = 'de300000-0000-4000-8000-000000000003' AND d.module = 'triads'
    ORDER BY d.ordinal
  LOOP
    PERFORM public.admin_triad_create_group(r.id,
      ARRAY[(SELECT id FROM _enr WHERE slug = 'ngoc'), (SELECT id FROM _enr WHERE slug = 'dat'),
            (SELECT id FROM _enr WHERE slug = 'yen')], 'en');
  END LOOP;
  PERFORM pg_temp.act_as_service();
END
$triad_groups$;

-- Ngoc's and Dat's Coaching 1 (due 2026-10-06, opens 09-22), with the
-- learner's reflection and the coach's notes, chosen as seed-demo.sql does.
CREATE TEMP TABLE _sess (key text, slug text, day date, at time, topic text) ON COMMIT DROP;
INSERT INTO _sess VALUES
  ('c3:ngoc:1', 'ngoc', '2026-09-22', '14:00', 'Leading the team I used to be part of'),
  ('c3:dat:1',  'dat',  '2026-09-23', '08:00', 'From running the line to running the shift');

CREATE TEMP TABLE _session_reflections (module public.programme_module_type, variant integer, body text) ON COMMIT DROP;
INSERT INTO _session_reflections VALUES
  ('coaching', 1, 'The most useful moment was when Duc asked what I was protecting by not delegating. The honest answer is my reputation for never being wrong. My experiment for the next two weeks: hand one decision to my team each week and resist checking it before it goes out.'),
  ('coaching', 2, 'I came in wanting advice about a difficult stakeholder and left with a better question: what does he need to be true before he can say yes? I will ask him that directly this week instead of preparing another presentation.'),
  ('coaching', 3, 'We looked at my calendar together. Almost nothing in it serves the goal I say matters most. I have blocked two mornings a week and told my team why, so they can hold me to it.'),
  ('coaching', 4, 'I realised I have been treating every disagreement as a threat to my authority. Next week I will ask one person in each meeting to argue the other side before we decide.');


CREATE TEMP TABLE _coach_notes (variant integer PRIMARY KEY, body text) ON COMMIT DROP;
INSERT INTO _coach_notes VALUES
  (1, 'Explored the pattern of taking decisions back from the team under pressure. Client identified the trigger (senior scrutiny) and chose one experiment: delegate one decision a week with clear guardrails. Energy high; follow up on what happened when the first decision went differently than expected.'),
  (2, 'Worked on stakeholder influence. Shifted from preparing more data to understanding what the stakeholder needs to say yes. Client will test a direct conversation this week. Watch for over-preparation as avoidance.'),
  (3, 'Reviewed goal progress against the baseline ratings. Clear movement on the primary goal; the secondary goal is stalling because it has no weekly practice attached. Agreed a small daily practice and a check-in point.'),
  (4, 'Client arrived frustrated after a difficult committee meeting. Used pause-label-choose to separate the emotion from the decision. Client reframed the meeting as useful data and planned the next conversation.'),
  (5, 'Integration session: client articulated two behaviours to keep practising and named a feed-forward circle. Strong self-awareness compared with the first session; relapse risk is quarter-end, and a plan is in place for it.');


SELECT set_config('app.session_transition', 'on', true);
INSERT INTO public.sessions (id, coach_id, coachee_id, topic, start_time, duration_minutes, status,
  meeting_url, enrollment_id, cohort_requirement_id, confirmed_at, created_at, updated_at)
SELECT pg_temp.uid('session:' || s.key), 'de000000-0000-4000-8000-000000000001', e.user_id, s.topic,
  pg_temp.ict(s.day, s.at), 60, 'completed', 'https://meet.google.com/cla-riva-' || substr(md5(s.key), 1, 3),
  e.id, r.id, pg_temp.ict(s.day - 5, '11:00'), pg_temp.ict(s.day - 6, '20:00'), pg_temp.ict(s.day, s.at) + interval '1 hour'
FROM _sess s
JOIN _enr e ON e.slug = s.slug
JOIN public.cohort_requirement_dates r
  ON r.cohort_id = 'de300000-0000-4000-8000-000000000003' AND r.module = 'coaching' AND r.ordinal = 1;
SELECT set_config('app.session_transition', 'off', true);

INSERT INTO public.session_learning_reflections (id, enrollment_id, source_activity_type, source_activity_id,
  body, submitted_at, created_at, updated_at)
SELECT pg_temp.uid('slr:' || s.key || ':' || s.slug), e.id, t.reflection_type, pg_temp.uid('session:' || s.key),
  (SELECT r.body FROM _session_reflections r
   WHERE r.module = 'coaching'
     AND r.variant = 1 + abs(hashtext(s.key || s.slug)) %
                         (SELECT count(*) FROM _session_reflections x WHERE x.module = 'coaching')),
  pg_temp.ict(s.day, '20:30'), pg_temp.ict(s.day, '20:30'), pg_temp.ict(s.day, '20:30')
FROM _sess s
JOIN _enr e ON e.slug = s.slug
CROSS JOIN LATERAL public.session_deliverable_source_types('sessions') t;

INSERT INTO public.coach_session_private_notes (session_id, coach_id, body, created_at, updated_at)
SELECT pg_temp.uid('session:' || s.key), 'de000000-0000-4000-8000-000000000001',
  (SELECT n.body FROM _coach_notes n WHERE n.variant = 1 + abs(hashtext(s.key)) % (SELECT count(*) FROM _coach_notes)),
  pg_temp.ict(s.day, s.at) + interval '90 minutes', pg_temp.ict(s.day, s.at) + interval '90 minutes'
FROM _sess s;

-- ---------------------------------------------------------------------------
-- A2. Yen's goals: baseline and target (0-100 scale)
-- ---------------------------------------------------------------------------
INSERT INTO public.coachee_goal_ratings (goal_id, coachee_id, enrollment_id, start_rating, current_rating,
  target_rating, current_updated_at, created_at, updated_at)
SELECT pg_temp.uid('goal:yen:' || v.n), e.user_id, e.id, v.start_rating, v.start_rating, v.target_rating,
  pg_temp.ict(DATE '2026-09-17', '19:00'), pg_temp.ict(DATE '2026-09-17', '19:00'), pg_temp.ict(DATE '2026-09-17', '19:00')
FROM (VALUES (1, 25, 75), (2, 30, 70)) AS v(n, start_rating, target_rating)
JOIN _enr e ON e.slug = 'yen';

-- ---------------------------------------------------------------------------
-- A3. Duc's availability, and learners' visibility of it
-- ---------------------------------------------------------------------------
-- Slots already booked (by anyone) keep their row: ON CONFLICT DO NOTHING.
INSERT INTO public.coach_availability (id, coach_id, slot_date, start_time, end_time, is_booked, slot_type,
  created_at, updated_at)
SELECT pg_temp.uid('slot:' || d::date || ':' || h), 'de000000-0000-4000-8000-000000000001', d::date,
  make_time(h, 0, 0), make_time(h + 1, 0, 0), false, 'coaching'::public.availability_slot_type,
  TIMESTAMPTZ '2026-09-21 09:00+07', TIMESTAMPTZ '2026-09-21 09:00+07'
FROM generate_series(DATE '2026-09-24', DATE '2027-01-05', interval '1 day') d
CROSS JOIN unnest(ARRAY[9, 10, 11, 14, 15, 16]) h
WHERE extract(isodow FROM d) IN (2, 4)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.coach_availability (id, coach_id, slot_date, start_time, end_time, is_booked, slot_type,
  created_at, updated_at)
SELECT pg_temp.uid('mslot:' || d::date), 'de000000-0000-4000-8000-000000000001', d::date,
  TIME '16:00', TIME '17:00', false, 'mentoring'::public.availability_slot_type,
  TIMESTAMPTZ '2026-09-21 09:00+07', TIMESTAMPTZ '2026-09-21 09:00+07'
FROM generate_series(DATE '2026-09-30', DATE '2026-12-30', interval '1 day') d
WHERE extract(isodow FROM d) = 3
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.coachee_coach_allowlist (coachee_id, coach_id, created_at, created_by, source)
SELECT e.user_id, 'de000000-0000-4000-8000-000000000001', pg_temp.ict(c.start_date - 7, '10:00'),
  (SELECT id FROM _admin), 'admin_added'
FROM _enr e
JOIN public.cohorts c ON c.id = ('de300000-0000-4000-8000-00000000000' || e.cohort)::uuid
ON CONFLICT (coachee_id, coach_id) DO UPDATE SET removed_at = NULL;

-- ---------------------------------------------------------------------------
-- A4. Skill Card images: no portraits or people-focused close-ups
-- ---------------------------------------------------------------------------
UPDATE public.training_weeks w
SET skill_card_html = replace(replace(replace(replace(replace(replace(replace(replace(replace(w.skill_card_html,
  'photo-1531545514256-b1400bc00f31?w=800" alt="Two colleagues in a coaching conversation"',
  'photo-1542744095-fcf48d80b0fd?w=800" alt="A leadership team meeting in a glass-walled meeting room"'),
  'photo-1543269865-cbf427effbad?w=800" alt="Colleagues listening to each other in conversation"',
  'photo-1568992687947-868a62a9f521?w=800" alt="A team in discussion around a meeting table"'),
  'photo-1573497019940-1c28c88b4f3e?w=800" alt="A leader listening attentively"',
  'photo-1431540015161-0bf868a2d407?w=800" alt="A boardroom set up for the next conversation"'),
  'photo-1551836022-d5d88e9218df?w=800" alt="A leader reflecting before a conversation"',
  'photo-1432888498266-38ffec3eaf0a?w=800" alt="Sketching out a plan on paper before a key conversation"'),
  'photo-1600880292203-757bb62b4baf?w=800" alt="Two colleagues in a candid one-to-one conversation"',
  'photo-1556761175-b413da4baf72?w=800" alt="A team at work in an open-plan office"'),
  'photo-1560250097-0b93528c311a?w=800" alt="A confident new leader"',
  'photo-1611224923853-80b023f02d71?w=800" alt="A task board: to do, doing, done"'),
  'photo-1515187029135-18ee286d815b?w=800" alt="A team leader and colleagues in discussion"',
  'photo-1512758017271-d7b84c2113f1?w=800" alt="A team planning wall covered in sticky notes"'),
  'photo-1529156069898-49953e39b3ac?w=800" alt="A team in lively discussion"',
  'photo-1557804506-669a67965ba0?w=800" alt="A team working through ideas at a whiteboard"'),
  'photo-1507679799987-c73779587ccf?w=800" alt="A leader planning the week ahead"',
  'photo-1434626881859-194d67b2b86f?w=800" alt="Charts and notes for planning the week ahead"')
WHERE w.programme_id IN ('de100000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000003');

-- ---------------------------------------------------------------------------
-- VERIFICATION -- the patch commits only if every rule holds
-- ---------------------------------------------------------------------------
-- The invariants are checked as of the story date (2026-10-07) and today.
-- The Cohort 3 story is only REPORTED: a live demo may hold smoke-test
-- activity that legitimately moves it.
DO $verify$
DECLARE
  story constant date := DATE '2026-10-07';
  bad text; n integer; rec record;
BEGIN
  PERFORM pg_temp.act_as((SELECT id FROM _admin));
  SELECT count(*), string_agg(x.enrollment_id || ' ' || x.module || ' ' || x.reason, '; ') INTO n, bad
  FROM public.admin_ineligible_programme_activity() x;
  PERFORM pg_temp.act_as_service();
  IF n <> 0 THEN RAISE EXCEPTION 'VERIFY FAILED: % ineligible activities: %', n, bad; END IF;

  SELECT string_agg(format('%s@%s', e.slug, d.as_of), '; ') INTO bad
  FROM _enr e
  CROSS JOIN (VALUES (story), (current_date)) d(as_of)
  CROSS JOIN LATERAL public.canonical_enrollment_progress(e.id, d.as_of) cp
  CROSS JOIN LATERAL (
    SELECT count(*) AS required, count(*) FILTER (WHERE k.is_completed) AS completed,
      count(*) FILTER (WHERE k.is_due_as_of) AS due, count(*) FILTER (WHERE k.is_overdue) AS overdue
    FROM public.canonical_enrollment_requirement_calendar(e.id, d.as_of) k) cal
  WHERE (cp.required_units, cp.completed_units, cp.due_units, cp.overdue_units)
        IS DISTINCT FROM (cal.required::int, cal.completed::int, cal.due::int, cal.overdue::int);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY FAILED: progress differs from the calendar: %', bad; END IF;

  SELECT string_agg(i.issue || ' ' || coalesce(i.detail, ''), '; ') INTO bad
  FROM public.requirement_integrity_issues() i
  WHERE i.cohort_id IN (SELECT id FROM public.cohorts WHERE id::text LIKE 'de300000-%');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY FAILED: integrity: %', bad; END IF;

  -- Triads: two required, one active group of three for each, 11 checkpoints.
  SELECT string_agg(format('%s triads %s groups %s required %s', e.slug, t.n, m.n, p.required_units), '; ') INTO bad
  FROM _enr e
  CROSS JOIN LATERAL (SELECT count(*) AS n FROM public.canonical_triad_requirement_fulfilment(e.id) f) t
  CROSS JOIN LATERAL (SELECT count(*) AS n FROM public.triad_group_members gm
                      JOIN public.triad_groups g ON g.id = gm.triad_group_id AND g.is_active
                      WHERE gm.enrollment_id = e.id
                        AND (SELECT count(*) FROM public.triad_group_members x WHERE x.triad_group_id = g.id) = 3) m
  CROSS JOIN LATERAL public.canonical_enrollment_progress(e.id, story) p
  WHERE e.cohort = 3 AND (t.n, m.n, p.required_units) IS DISTINCT FROM (2::bigint, 2::bigint, 11);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY FAILED: triads: %', bad; END IF;

  -- Yen's goals show a start and a target.
  SELECT count(*) INTO n FROM public.coachee_goal_ratings r
  WHERE (r.goal_id, r.start_rating, r.target_rating) IN
        ((pg_temp.uid('goal:yen:1'), 25::smallint, 75::smallint), (pg_temp.uid('goal:yen:2'), 30::smallint, 70::smallint));
  IF n <> 2 THEN RAISE EXCEPTION 'VERIFY FAILED: Yen''s goals have % of 2 start/target pairs', n; END IF;

  -- Every learner of an ongoing cohort sees Duc's Coaching slots, under RLS.
  bad := NULL;
  FOR rec IN SELECT e.slug, e.user_id FROM _enr e ORDER BY e.slug LOOP
    PERFORM pg_temp.act_as(rec.user_id);
    PERFORM set_config('role', 'authenticated', true);
    SELECT count(*) INTO n FROM public.coach_availability a
    WHERE a.coach_id = 'de000000-0000-4000-8000-000000000001' AND a.slot_type = 'coaching'
      AND NOT a.is_booked AND a.slot_date >= current_date;
    PERFORM set_config('role', 'none', true);
    PERFORM pg_temp.act_as_service();
    IF n = 0 THEN bad := concat_ws(', ', bad, rec.slug); END IF;
  END LOOP;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY FAILED: no upcoming slots visible to %', bad; END IF;

  -- No replaced image is left in a demo Skill Card.
  SELECT count(*) INTO n FROM public.training_weeks w
  WHERE w.programme_id IN ('de100000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000003')
    AND w.skill_card_html ~ '(1531545514256|1543269865|1573497019940|1551836022|1600880292203|1560250097|1515187029135|1529156069898|1507679799987)';
  IF n <> 0 THEN RAISE EXCEPTION 'VERIFY FAILED: % Skill Cards still hold a replaced image', n; END IF;

  -- The Cohort 3 story (expected on a fresh seed: Ngoc 3/3/0 and Dat 3/3/0
  -- on track, Yen 1/3/2 behind).
  FOR rec IN
    SELECT e.slug, p.completed_units, p.due_units, p.overdue_units, p.pace_status
    FROM _enr e CROSS JOIN LATERAL public.canonical_enrollment_progress(e.id, story) p
    WHERE e.cohort = 3 ORDER BY e.slug
  LOOP
    RAISE NOTICE 'Cohort 3 as of %: % done %/11 due % overdue % %', story, rec.slug, rec.completed_units,
      rec.due_units, rec.overdue_units, rec.pace_status;
  END LOOP;
  RAISE NOTICE 'Demo patch 2026-09-23: all verification checks passed.';
END
$verify$;

COMMIT;
