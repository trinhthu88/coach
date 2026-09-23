-- ===========================================================================
-- Clariva demo seed -- patch of 2026-09-24: goal ratings for Ngoc, Dat, Anh
-- and Tung, for a database that already holds the demo dataset AND the
-- patch of 2026-09-23 (Ngoc's and Dat's Coaching 1 come from it).
--
-- Brings those rows to exactly what the current seed-demo.sql produces:
--   start / target set with each goal (0-100), current empty until a
--   session rates it; Ngoc and Dat rate after Coaching 1 through the
--   learner's own record_goal_checkins, as in the app.
--
--   Ngoc #1  20 -> 25 -> 70     Ngoc #2  35 ->  - -> 75
--   Dat  #1  25 -> 30 -> 75
--   Anh  #1  15 ->  - -> 70     Anh  #2  20 ->  - -> 65
--   Tung #1  25 ->  - -> 75     (Tung has one goal)
--
-- USAGE
--   PGOPTIONS='-c app.seed_environment=demo' psql "$DEMO_DB_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/seed-demo-patch-2026-09-24-goal-ratings.sql
-- One transaction; refuses to run twice, or over ratings someone already set.
-- ===========================================================================

BEGIN;

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

-- slug, goal, start, current after Coaching 1 (NULL: not rated), target
CREATE TEMP TABLE _r ON COMMIT DROP AS
SELECT v.slug, v.n, v.start_rating, v.current_rating, v.target_rating,
  v.user_id::uuid AS user_id, ('de400000' || substr(v.user_id, 9))::uuid AS enrollment_id,
  pg_temp.uid('goal:' || v.slug || ':' || v.n) AS goal_id, v.cohort_start
FROM (VALUES
  ('ngoc', 1, 20, 25,   70, 'de000000-0000-4000-8000-000000000018', DATE '2026-09-15'),
  ('ngoc', 2, 35, NULL, 75, 'de000000-0000-4000-8000-000000000018', DATE '2026-09-15'),
  ('dat',  1, 25, 30,   75, 'de000000-0000-4000-8000-000000000026', DATE '2026-09-15'),
  ('anh',  1, 15, NULL, 70, 'de000000-0000-4000-8000-000000000016', DATE '2026-10-06'),
  ('anh',  2, 20, NULL, 65, 'de000000-0000-4000-8000-000000000016', DATE '2026-10-06'),
  ('tung', 1, 25, NULL, 75, 'de000000-0000-4000-8000-000000000017', DATE '2026-10-06')
) AS v(slug, n, start_rating, current_rating, target_rating, user_id, cohort_start);

-- The Coaching 1 each rating follows.
CREATE TEMP TABLE _s ON COMMIT DROP AS
SELECT v.slug, v.key, v.day, pg_temp.uid('session:' || v.key) AS session_id
FROM (VALUES ('ngoc', 'c3:ngoc:1', DATE '2026-09-22'), ('dat', 'c3:dat:1', DATE '2026-09-23')) AS v(slug, key, day);

DO $guard$
DECLARE missing text; taken text;
BEGIN
  IF coalesce(current_setting('app.seed_environment', true), '') NOT IN
     ('local', 'development', 'preview', 'test', 'demo') THEN
    RAISE EXCEPTION 'Refusing to patch: set app.seed_environment (local|development|preview|test|demo)';
  END IF;
  SELECT string_agg(r.slug || '#' || r.n, ', ') INTO missing
  FROM _r r LEFT JOIN public.coachee_goals g ON g.id = r.goal_id AND g.enrollment_id = r.enrollment_id
  WHERE g.id IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Demo goals not found: % -- is the demo dataset present?', missing;
  END IF;
  SELECT string_agg(s.slug, ', ') INTO missing
  FROM _s s LEFT JOIN public.sessions x ON x.id = s.session_id AND x.status = 'completed'
  WHERE x.id IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Coaching 1 not found for %: apply supabase/seed-demo-patch-2026-09-23.sql first', missing;
  END IF;
  SELECT string_agg(format('%s#%s %s/%s/%s', r.slug, r.n, x.start_rating, x.current_rating, x.target_rating), '; ') INTO taken
  FROM _r r JOIN public.coachee_goal_ratings x ON x.goal_id = r.goal_id;
  IF taken IS NOT NULL OR EXISTS (SELECT 1 FROM public.goal_checkins c JOIN _s s ON s.session_id = c.source_activity_id) THEN
    RAISE EXCEPTION 'Ratings or check-ins already exist (%), not overwriting', coalesce(taken, 'check-ins');
  END IF;
END
$guard$;

-- Start and target, set with the goal. Current starts at the baseline where
-- Coaching 1 moves it below; otherwise it is empty.
INSERT INTO public.coachee_goal_ratings (goal_id, coachee_id, enrollment_id, start_rating, current_rating,
  target_rating, current_updated_at, created_at, updated_at)
SELECT r.goal_id, r.user_id, r.enrollment_id, r.start_rating,
  CASE WHEN r.current_rating IS NOT NULL THEN r.start_rating END, r.target_rating,
  pg_temp.ict(r.cohort_start + 2, '19:00'), pg_temp.ict(r.cohort_start + 2, '19:00'), pg_temp.ict(r.cohort_start + 2, '19:00')
FROM _r r;

-- Ngoc and Dat rate after Coaching 1, as the learner, pinned to that evening.
DO $checkins$
DECLARE s record; v_items jsonb; v_type text;
BEGIN
  SELECT t.checkin_type INTO v_type FROM public.session_deliverable_source_types('sessions') t;
  FOR s IN SELECT * FROM _s ORDER BY day LOOP
    SELECT jsonb_agg(jsonb_build_object(
             'goal_id', r.goal_id,
             'new_rating', coalesce(to_jsonb(r.current_rating), 'null'::jsonb),
             'note', 'Visible progress since the last session; the next experiment is agreed.')
           ORDER BY r.n)
      INTO v_items
    FROM _r r WHERE r.slug = s.slug;

    PERFORM pg_temp.act_as((SELECT DISTINCT user_id FROM _r WHERE slug = s.slug));
    PERFORM public.record_goal_checkins((SELECT DISTINCT enrollment_id FROM _r WHERE slug = s.slug), v_type,
      s.session_id, v_items, pg_temp.uid('checkin:' || s.key || ':' || s.slug));
    PERFORM pg_temp.act_as_service();

    UPDATE public.goal_checkins SET created_at = pg_temp.ict(s.day, '20:40')
    WHERE submission_id = pg_temp.uid('checkin:' || s.key || ':' || s.slug);
    UPDATE public.coachee_goal_ratings x SET current_updated_at = pg_temp.ict(s.day, '20:40')
    WHERE x.goal_id IN (SELECT goal_id FROM _r WHERE slug = s.slug AND current_rating IS NOT NULL);
  END LOOP;
END
$checkins$;

DO $verify$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s#%s %s/%s/%s', r.slug, r.n, x.start_rating, x.current_rating, x.target_rating), '; ') INTO bad
  FROM _r r LEFT JOIN public.coachee_goal_ratings x ON x.goal_id = r.goal_id
  WHERE (x.start_rating, x.current_rating, x.target_rating)
        IS DISTINCT FROM (r.start_rating::smallint, r.current_rating::smallint, r.target_rating::smallint);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY FAILED: start/current/target %', bad; END IF;
  IF (SELECT count(DISTINCT c.submission_id) FROM public.goal_checkins c JOIN _s s ON s.session_id = c.source_activity_id) <> 2 THEN
    RAISE EXCEPTION 'VERIFY FAILED: Ngoc''s and Dat''s Coaching 1 check-ins';
  END IF;
  RAISE NOTICE 'Demo goal ratings 2026-09-24: all verification checks passed.';
END
$verify$;

COMMIT;
