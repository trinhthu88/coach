-- ===========================================================================
-- Read-only reconciliation for 20260930100000_journey_current_fulfilment.
--
--   psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/journey-current-fulfilment-verification.sql
--
-- Runs in a READ ONLY transaction and rolls back. The sponsor checks set the
-- request's JWT subject per sponsor (transaction-local; nothing is written).
-- Each listing section should print no rows; the final block raises on the
-- first failed invariant and otherwise prints a pass notice.
--
--   1  every enrollment's final journey checkpoint = its canonical totals
--   2  nothing counts outside [available_on, effective as-of]
--   3  Training week complete = Skill Card + Quiz + Reflection (Daily Prompts never gate)
--   4  a checkpoint whose own requirements are all unavailable adds nothing to the numerator
--   5  Linh Nguyen (Emerging Leaders Cohort B): no unavailable Training week counts
--   6  per sponsor and cohort: cohort totals = sum of the leader rows, per module,
--      and the final cohort checkpoint = the cohort totals
-- ===========================================================================
BEGIN READ ONLY;

\echo == 1. enrollment final checkpoint vs canonical totals (expect 0 rows)
SELECT e.id AS enrollment_id, p.required_units, p.completed_units,
  (j->>'required_units')::integer AS journey_required,
  (j->>'completed_units')::integer AS journey_completed
FROM public.programme_enrollments e
CROSS JOIN LATERAL public.canonical_enrollment_progress(e.id, current_date) p
CROSS JOIN LATERAL (
  SELECT x AS j FROM jsonb_array_elements(public.canonical_enrollment_journey(e.id, current_date)) x
  ORDER BY (x->>'checkpoint_number')::integer DESC LIMIT 1
) last_checkpoint
WHERE (j->>'required_units')::integer IS DISTINCT FROM p.required_units
   OR (j->>'completed_units')::integer IS DISTINCT FROM p.completed_units;

\echo == 2. counted outside [available_on, effective as-of] (expect 0 rows)
SELECT s.enrollment_id, s.module, s.requirement_index, s.available_on, s.completed_on, s.effective_as_of
FROM public.programme_enrollments e
CROSS JOIN LATERAL public.canonical_enrollment_requirement_status(e.id, current_date) s
WHERE s.completed_on IS NOT NULL
  AND (s.available_on IS NULL OR s.completed_on < s.available_on OR s.completed_on > s.effective_as_of
       OR s.available_on > s.effective_as_of);

\echo == 3. week_complete vs Skill Card + Quiz + Reflection (expect 0 rows)
SELECT e.id AS enrollment_id, f.week_number, f.week_complete
FROM public.programme_enrollments e
CROSS JOIN LATERAL public.canonical_training_week_fulfilment(e.id, current_date) f
WHERE f.week_complete IS DISTINCT FROM (
  f.skill_card_required AND f.skill_card_completed
  AND (NOT f.quiz_required OR f.quiz_completed)
  AND (NOT f.reflection_required OR f.reflection_completed));

\echo == 4. unavailable-only checkpoint raised the numerator (expect 0 rows)
WITH cp AS (
  SELECT e.id AS enrollment_id, (x->>'checkpoint_number')::integer AS n, (x->>'due_on')::date AS due_on,
    (x->>'completed_units')::integer AS completed_units
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL jsonb_array_elements(public.canonical_enrollment_journey(e.id, current_date)) x
), own AS (
  SELECT e.id AS enrollment_id, s.due_on, bool_and(s.state = 'upcoming') AS all_unavailable
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_enrollment_requirement_status(e.id, current_date) s
  GROUP BY e.id, s.due_on
)
SELECT cur.enrollment_id, cur.n, cur.due_on, prev.completed_units AS previous_completed, cur.completed_units
FROM cp cur
JOIN cp prev ON prev.enrollment_id = cur.enrollment_id AND prev.n = cur.n - 1
JOIN own o ON o.enrollment_id = cur.enrollment_id AND o.due_on = cur.due_on
WHERE o.all_unavailable AND cur.completed_units <> prev.completed_units;

\echo == 5. Linh Nguyen, Cohort B: requirement status
SELECT s.module, s.requirement_index, s.available_on, s.due_on, s.completed_on, s.state
FROM public.programme_enrollments e
JOIN public.profiles p ON p.id = e.user_id
JOIN public.cohorts c ON c.id = e.cohort_id
CROSS JOIN LATERAL public.canonical_enrollment_requirement_status(e.id, current_date) s
WHERE p.full_name = 'Linh Nguyen' AND c.name ILIKE 'Emerging Leaders%Cohort B'
ORDER BY s.due_on, s.module, s.requirement_index;

\echo == 6. sponsor cohorts (raises on mismatch)
DO $verify$
DECLARE
  s record; c record; last jsonb; totals record; sums record;
  checked integer := 0; n integer;
BEGIN
  SELECT count(*) INTO n
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_enrollment_progress(e.id, current_date) p
  CROSS JOIN LATERAL (
    SELECT x AS j FROM jsonb_array_elements(public.canonical_enrollment_journey(e.id, current_date)) x
    ORDER BY (x->>'checkpoint_number')::integer DESC LIMIT 1
  ) last_checkpoint
  WHERE (j->>'required_units')::integer IS DISTINCT FROM p.required_units
     OR (j->>'completed_units')::integer IS DISTINCT FROM p.completed_units;
  IF n > 0 THEN RAISE EXCEPTION 'VERIFY 1 FAILED: % enrollment journeys do not reconcile', n; END IF;

  SELECT count(*) INTO n
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_enrollment_requirement_status(e.id, current_date) st
  WHERE st.completed_on IS NOT NULL
    AND (st.available_on IS NULL OR st.completed_on < st.available_on OR st.completed_on > st.effective_as_of
         OR st.available_on > st.effective_as_of);
  IF n > 0 THEN RAISE EXCEPTION 'VERIFY 2 FAILED: % requirements counted outside their window', n; END IF;

  SELECT count(*) INTO n
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_training_week_fulfilment(e.id, current_date) f
  WHERE f.week_complete IS DISTINCT FROM (
    f.skill_card_required AND f.skill_card_completed
    AND (NOT f.quiz_required OR f.quiz_completed)
    AND (NOT f.reflection_required OR f.reflection_completed));
  IF n > 0 THEN RAISE EXCEPTION 'VERIFY 3 FAILED: % Training weeks break the fulfilment rule', n; END IF;

  WITH cp AS (
    SELECT e.id AS enrollment_id, (x->>'checkpoint_number')::integer AS n, (x->>'due_on')::date AS due_on,
      (x->>'completed_units')::integer AS completed_units
    FROM public.programme_enrollments e
    CROSS JOIN LATERAL jsonb_array_elements(public.canonical_enrollment_journey(e.id, current_date)) x
  ), own AS (
    SELECT e.id AS enrollment_id, st.due_on, bool_and(st.state = 'upcoming') AS all_unavailable
    FROM public.programme_enrollments e
    CROSS JOIN LATERAL public.canonical_enrollment_requirement_status(e.id, current_date) st
    GROUP BY e.id, st.due_on
  )
  SELECT count(*) INTO n
  FROM cp cur
  JOIN cp prev ON prev.enrollment_id = cur.enrollment_id AND prev.n = cur.n - 1
  JOIN own o ON o.enrollment_id = cur.enrollment_id AND o.due_on = cur.due_on
  WHERE o.all_unavailable AND cur.completed_units <> prev.completed_units;
  IF n > 0 THEN RAISE EXCEPTION 'VERIFY 4 FAILED: % unavailable checkpoints raised the numerator', n; END IF;

  SELECT count(*) INTO n
  FROM public.programme_enrollments e
  JOIN public.profiles p ON p.id = e.user_id
  JOIN public.cohorts co ON co.id = e.cohort_id
  CROSS JOIN LATERAL public.canonical_enrollment_requirement_status(e.id, current_date) st
  WHERE p.full_name = 'Linh Nguyen' AND co.name ILIKE 'Emerging Leaders%Cohort B'
    AND st.module = 'training' AND st.state = 'upcoming' AND st.completed_on IS NOT NULL;
  IF n > 0 THEN RAISE EXCEPTION 'VERIFY 5 FAILED: % unavailable Training weeks count for Linh', n; END IF;

  FOR s IN SELECT sp.user_id FROM public.sponsor_profiles sp LOOP
    PERFORM set_config('request.jwt.claim.sub', s.user_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', s.user_id, 'role', 'authenticated')::text, true);
    FOR c IN SELECT DISTINCT v.cohort_id FROM public.sponsor_visible_enrollments() v LOOP
      checked := checked + 1;
      SELECT * INTO totals FROM public.sponsor_canonical_cohort_progress(c.cohort_id, current_date);
      SELECT sum(l.required_units)::integer AS required_units, sum(l.completed_units)::integer AS completed_units,
        sum(l.coaching_completed_units)::integer AS coaching, sum(l.training_completed_units)::integer AS training,
        sum(l.peer_completed_units)::integer AS peer, sum(l.mentoring_completed_units)::integer AS mentoring,
        sum(l.triad_completed_units)::integer AS triads
      INTO sums
      FROM public.sponsor_canonical_enrollment_progress(c.cohort_id, current_date) l;
      IF (totals.required_units, totals.completed_units, totals.coaching_completed_units, totals.training_completed_units,
          totals.peer_completed_units, totals.mentoring_completed_units, totals.triad_completed_units)
         IS DISTINCT FROM
         (sums.required_units, sums.completed_units, sums.coaching, sums.training, sums.peer, sums.mentoring, sums.triads) THEN
        RAISE EXCEPTION 'VERIFY 6 FAILED: sponsor % cohort %: cohort totals are not the sum of the leader rows', s.user_id, c.cohort_id;
      END IF;
      SELECT x INTO last
      FROM jsonb_array_elements(public.get_sponsor_programme_journey(c.cohort_id, current_date)) x
      ORDER BY (x->>'checkpoint_number')::integer DESC LIMIT 1;
      IF (last->>'required_units')::integer IS DISTINCT FROM totals.required_units
         OR (last->>'completed_units')::integer IS DISTINCT FROM totals.completed_units THEN
        RAISE EXCEPTION 'VERIFY 6 FAILED: sponsor % cohort %: totals %/% vs final checkpoint %/%', s.user_id, c.cohort_id,
          totals.required_units, totals.completed_units, last->>'required_units', last->>'completed_units';
      END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  RAISE NOTICE 'journey-current-fulfilment verification passed (% sponsor cohorts reconciled)', checked;
END
$verify$;

ROLLBACK;
