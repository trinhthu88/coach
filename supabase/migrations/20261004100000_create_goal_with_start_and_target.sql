-- A goal is created WITH its Start and Target ratings (0-100), in one
-- transaction. Current stays empty until a session rates it.
--
-- The app used to insert the goal and then, in a second request, its
-- ratings row: a failure in between left a goal showing "—" for Start and
-- Target, which is exactly what learners saw. Both goal-creation screens
-- (My Journey, the post-session goal ratings) now call this function.
--
-- Deliberately NOT a NOT NULL constraint on coachee_goal_ratings.start_rating
-- / target_rating: record_goal_checkins creates the ratings row of a goal
-- that has none with only its current rating, so a constraint would make
-- post-session check-ins fail for any existing goal set without a baseline.
-- SECURITY INVOKER: the learner's own RLS and the enrollment-scope triggers
-- on both tables apply exactly as they did to the direct inserts.

CREATE OR REPLACE FUNCTION public.create_goal_with_ratings(
  p_enrollment_id uuid,
  p_title text,
  p_description text,
  p_target_date date,
  p_start_rating integer,
  p_target_rating integer
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_goal uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to add a goal' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_title), '') IS NULL THEN
    RAISE EXCEPTION 'A goal needs a title' USING ERRCODE = '22023';
  END IF;
  IF p_start_rating IS NULL OR p_target_rating IS NULL
     OR p_start_rating NOT BETWEEN 0 AND 100 OR p_target_rating NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'A goal needs a Start and a Target rating from 0 to 100' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.coachee_goals (coachee_id, enrollment_id, title, description, target_date)
  VALUES (auth.uid(), p_enrollment_id, btrim(p_title), nullif(btrim(p_description), ''), p_target_date)
  RETURNING id INTO v_goal;

  INSERT INTO public.coachee_goal_ratings (goal_id, coachee_id, enrollment_id, start_rating, current_rating,
    target_rating, current_updated_at)
  VALUES (v_goal, auth.uid(), p_enrollment_id, p_start_rating, NULL, p_target_rating, now());

  RETURN v_goal;
END
$function$;

REVOKE ALL ON FUNCTION public.create_goal_with_ratings(uuid, text, text, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_goal_with_ratings(uuid, text, text, date, integer, integer) TO authenticated;
