-- ============================================================================
-- TRIAD COMPLETION = REQUIREMENT FULFILMENT (follow-up to the Triad cutover).
--
-- Until now Triad completion was count-based: every completed, attributed
-- Triad session was one activity row, and canonical progress / journey
-- counted rows (capped at required units). Two completed sessions for the
-- SAME cohort Triad requirement therefore read as 2/2, and a unit fulfilled
-- out of order hid the overdue unit before it.
--
-- Rule from here on: a completed Triad session fulfils exactly the cohort
-- Triad requirement (cohort_requirement_dates row) of its group. A
-- requirement is fulfilled once, on the date of its first completed
-- session, and only for member enrollments with that session's evidence
-- (session_activity_attributions). Sessions of a group without a requirement
-- (reviewed historical groups) fulfil nothing.
--
-- One construction owns the rule (canonical_triad_requirement_fulfilment).
-- sponsor_canonical_activity emits one Triad row per requirement from it,
-- carrying the requirement's due date, so canonical progress, overdue, pace
-- and every journey checkpoint count requirements — never sessions. Admin,
-- Learner, reminders and Sponsor all read it through those functions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Before-state for the verification at the end.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _fulfilment_before ON COMMIT DROP AS
SELECT e.id AS enrollment_id, p.required_units, p.completed_activity_units, p.completed_units,
  p.due_units, p.booked_units, p.overdue_units, p.pace_status
FROM public.programme_enrollments e
CROSS JOIN LATERAL public.canonical_module_progress(e.id, current_date) p
WHERE p.module = 'triads'::public.programme_module_type;

-- ----------------------------------------------------------------------------
-- 1. THE rule: one row per cohort Triad requirement of the enrollment.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_triad_requirement_fulfilment(p_enrollment_id uuid)
RETURNS TABLE (cohort_requirement_date_id uuid, unit_number integer, due_on date,
  fulfilled_on date, booked_on date, proposed_on date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.id, d.ordinal, d.due_on,
    min(ev.occurred_on) FILTER (WHERE ev.status = 'completed'),
    min(ev.occurred_on) FILTER (WHERE ev.status = 'confirmed'),
    min(ev.occurred_on) FILTER (WHERE ev.status = 'proposed')
  FROM public.programme_enrollments e
  JOIN public.cohort_requirement_dates d
    ON d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
   AND d.module = 'triads'::public.programme_module_type
  LEFT JOIN LATERAL (
    -- Evidence of THIS enrollment on sessions of groups for THIS requirement.
    SELECT a.occurred_on, s.status
    FROM public.triad_groups g
    JOIN public.triad_group_members m ON m.triad_group_id = g.id AND m.enrollment_id = e.id
    JOIN public.triad_sessions s ON s.triad_group_id = g.id
    JOIN public.session_activity_attributions a
      ON a.source_activity_type = 'triad' AND a.source_activity_id = s.id AND a.enrollment_id = e.id
    WHERE g.cohort_requirement_date_id = d.id
  ) ev ON true
  WHERE e.id = p_enrollment_id
  GROUP BY d.id, d.ordinal, d.due_on;
$$;
COMMENT ON FUNCTION public.canonical_triad_requirement_fulfilment(uuid) IS
  'THE Triad completion rule: a completed Triad session fulfils the cohort Triad requirement of its group (once, on its first completed session date). Internal.';

-- ----------------------------------------------------------------------------
-- 2. Activity: Triads contribute one row per requirement (with its due date).
-- ----------------------------------------------------------------------------
DROP FUNCTION public.sponsor_canonical_activity(uuid);
CREATE FUNCTION public.sponsor_canonical_activity(p_enrollment_id uuid)
 RETURNS TABLE(module programme_module_type, occurred_on date, status text, requirement_due_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed'), NULL::date
  FROM public.session_activity_attributions a
  LEFT JOIN public.sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'coaching'

  UNION ALL
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed'), NULL::date
  FROM public.session_activity_attributions a
  LEFT JOIN public.peer_sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'peer_coaching'

  UNION ALL
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed'), NULL::date
  FROM public.session_activity_attributions a
  LEFT JOIN public.coachee_peer_sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'peer_coaching'
    AND NOT EXISTS (
      SELECT 1 FROM public.peer_sessions existing_peer
      WHERE existing_peer.id = a.source_activity_id
    )

  UNION ALL
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed'), NULL::date
  FROM public.session_activity_attributions a
  LEFT JOIN public.mentoring_sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'mentoring'

  UNION ALL
  -- Triads: one row per cohort Triad requirement (fulfilled, else booked,
  -- else proposed), never one per session.
  SELECT 'triads'::public.programme_module_type,
    coalesce(f.fulfilled_on, f.booked_on, f.proposed_on),
    CASE WHEN f.fulfilled_on IS NOT NULL THEN 'completed'
         WHEN f.booked_on IS NOT NULL THEN 'confirmed'
         ELSE 'proposed' END,
    f.due_on
  FROM public.canonical_triad_requirement_fulfilment(p_enrollment_id) f
  WHERE coalesce(f.fulfilled_on, f.booked_on, f.proposed_on) IS NOT NULL

  UNION ALL
  SELECT a.module, a.occurred_on, 'completed', NULL::date
  FROM public.session_activity_attributions a
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type IN ('quiz', 'daily_prompt')

  UNION ALL
  SELECT 'training'::public.programme_module_type,
    i.completed_on,
    'completed',
    NULL::date
  FROM public.canonical_training_learning_items(p_enrollment_id, current_date) i
  WHERE i.completed_units > 0
    AND i.completed_on IS NOT NULL;
$function$;

-- ----------------------------------------------------------------------------
-- 3. Progress: a requirement-bound unit counts toward "due" only once its own
--    requirement is due (an early unit 2 never hides an overdue unit 1).
--    Modules without requirement-bound activity are unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_module_progress(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS TABLE(module programme_module_type, required_units integer, completed_activity_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, pace_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH schedule AS (
    SELECT * FROM public.sponsor_canonical_module_schedule(p_enrollment_id)
  ), modules AS (
    SELECT s.module,
      max(s.required_units)::integer AS required_units,
      coalesce(sum(s.milestone_units)
        FILTER (WHERE s.due_on <= p_as_of), 0)::integer AS due_units
    FROM schedule s
    GROUP BY s.module
  ), learning AS (
    SELECT *
    FROM public.canonical_training_learning_summary(p_enrollment_id, p_as_of)
  ), activity AS (
    SELECT *
    FROM public.sponsor_canonical_activity(p_enrollment_id)
  ), counts AS (
    SELECT m.module,
      count(a.occurred_on) FILTER (
        WHERE a.status = 'completed'
          AND a.occurred_on <= p_as_of
      )::integer AS completed_activity_units,
      -- Completed units whose own requirement is already due.
      count(a.occurred_on) FILTER (
        WHERE a.status = 'completed'
          AND a.occurred_on <= p_as_of
          AND (a.requirement_due_on IS NULL OR a.requirement_due_on <= p_as_of)
      )::integer AS completed_due_units,
      count(a.occurred_on) FILTER (
        WHERE a.status IN ('pending_coach_approval', 'confirmed')
          AND a.occurred_on >= p_as_of
      )::integer AS raw_booked_units
    FROM modules m
    LEFT JOIN activity a ON a.module = m.module
    GROUP BY m.module
  ), values AS (
    SELECT m.module, m.required_units,
      CASE WHEN m.module = 'training'
        THEN coalesce(l.completed_units, 0)
        ELSE coalesce(c.completed_activity_units, 0)
      END::integer AS completed_activity_units,
      CASE WHEN m.module = 'training'
        THEN coalesce(l.completed_units, 0)
        ELSE least(coalesce(c.completed_activity_units, 0), m.required_units)
      END::integer AS completed_units,
      CASE WHEN m.module = 'training'
        THEN coalesce(l.completed_units, 0)
        ELSE least(coalesce(c.completed_due_units, 0), m.required_units)
      END::integer AS completed_due_units,
      CASE WHEN m.module = 'training'
        THEN coalesce(l.due_units, 0)
        ELSE m.due_units
      END::integer AS due_units,
      CASE WHEN m.module = 'training' THEN 0
        ELSE least(
          coalesce(c.raw_booked_units, 0),
          greatest(m.required_units - least(coalesce(c.completed_activity_units, 0), m.required_units), 0)
        )
      END::integer AS booked_units,
      CASE WHEN m.module = 'training'
        THEN coalesce(l.overdue_units, 0)
        ELSE greatest(0, m.due_units - least(coalesce(c.completed_due_units, 0), m.due_units))
      END::integer AS overdue_units
    FROM modules m
    LEFT JOIN counts c ON c.module = m.module
    LEFT JOIN learning l ON m.module = 'training'
  )
  SELECT v.module, v.required_units, v.completed_activity_units,
    least(v.completed_units, v.required_units)::integer,
    v.due_units, v.booked_units, v.overdue_units,
    CASE
      WHEN v.required_units = 0 OR v.completed_units >= v.required_units THEN 'completed'
      WHEN v.due_units = 0 THEN 'not_yet_due'
      WHEN v.completed_due_units >= v.due_units THEN
        CASE WHEN v.completed_units > v.due_units THEN 'ahead' ELSE 'on_track' END
      WHEN v.completed_due_units + v.booked_units >= v.due_units THEN 'scheduled'
      ELSE 'behind'
    END
  FROM values v
  ORDER BY v.module;
$function$;

-- ----------------------------------------------------------------------------
-- 4. Journeys: a requirement-bound unit counts only at checkpoints on or after
--    its own requirement's due date.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_enrollment_journey(p_enrollment_id uuid, p_as_of date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eligible AS (
    SELECT e.id, e.cohort_id
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
  ), schedule AS (
    SELECT e.id AS enrollment_id, s.module, s.required_units,
      s.due_on, s.milestone_units, s.training_week_id
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_module_schedule(e.id) s
    WHERE s.due_on IS NOT NULL
  ), activity AS (
    SELECT e.id AS enrollment_id, a.module, a.occurred_on, a.status, a.requirement_due_on
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_activity(e.id) a
  ), dates AS (
    SELECT s.due_on,
      string_agg(DISTINCT tw.title, ' · ' ORDER BY tw.title)
        FILTER (WHERE tw.title IS NOT NULL) AS training_label,
      to_jsonb(array_agg(DISTINCT s.module::text ORDER BY s.module::text)) AS module_scope
    FROM schedule s
    LEFT JOIN public.training_weeks tw ON tw.id = s.training_week_id
    GROUP BY s.due_on
  ), scoped_modules AS (
    SELECT d.due_on, e.id AS enrollment_id, s.module,
      least(max(s.required_units), sum(s.milestone_units))::integer AS required_units
    FROM dates d
    CROSS JOIN eligible e
    JOIN schedule s
      ON s.enrollment_id = e.id
     AND s.due_on <= d.due_on
    GROUP BY d.due_on, e.id, s.module
  ), leader_module_checkpoints AS (
    SELECT sm.due_on, sm.enrollment_id, sm.module, sm.required_units,
      count(a.occurred_on) FILTER (
        WHERE a.status = 'completed'
          AND a.occurred_on <= least(p_as_of, sm.due_on)
          AND (a.requirement_due_on IS NULL OR a.requirement_due_on <= sm.due_on)
      )::integer AS completed_units
    FROM scoped_modules sm
    LEFT JOIN activity a
      ON a.enrollment_id = sm.enrollment_id
     AND a.module = sm.module
    GROUP BY sm.due_on, sm.enrollment_id, sm.module, sm.required_units
  ), leader_checkpoints AS (
    SELECT d.due_on, e.id AS enrollment_id,
      coalesce(sum(l.required_units), 0)::integer AS required_units,
      coalesce(sum(least(l.completed_units, l.required_units)), 0)::integer AS completed_units
    FROM dates d
    CROSS JOIN eligible e
    LEFT JOIN leader_module_checkpoints l
      ON l.due_on = d.due_on
     AND l.enrollment_id = e.id
    GROUP BY d.due_on, e.id
  ), numbered AS (
    SELECT row_number() OVER (ORDER BY d.due_on)::integer AS checkpoint_number,
      d.due_on, d.training_label AS label, d.module_scope,
      lc.required_units, lc.completed_units
    FROM dates d
    JOIN leader_checkpoints lc ON lc.due_on = d.due_on
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'checkpoint_number', checkpoint_number,
    'due_on', due_on,
    'label', label,
    'module_scope', module_scope,
    'required_units', required_units,
    'completed_units', completed_units,
    'state', CASE
      WHEN p_as_of < due_on THEN 'upcoming'
      WHEN p_as_of = due_on THEN 'current'
      WHEN required_units > 0 AND completed_units >= required_units THEN 'completed'
      ELSE 'overdue'
    END
  ) ORDER BY due_on), '[]'::jsonb)
  FROM numbered;
$function$;

CREATE OR REPLACE FUNCTION public.get_sponsor_programme_journey(p_cohort_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH sponsor AS (
    SELECT sp.organization_id
    FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ), eligible AS (
    SELECT e.id, e.cohort_id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN sponsor s ON s.organization_id = c.organization_id
    WHERE e.cohort_id = p_cohort_id
      AND (
        SELECT count(*)
        FROM public.programme_enrollments same_cohort
        WHERE same_cohort.cohort_id = e.cohort_id
      ) >= public.sponsor_min_leaders_for_distribution()
  ), schedule AS (
    SELECT e.id AS enrollment_id, s.module, s.required_units,
      s.due_on, s.milestone_units, s.training_week_id
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_module_schedule(e.id) s
    WHERE s.due_on IS NOT NULL
  ), activity AS (
    SELECT e.id AS enrollment_id, a.module, a.occurred_on, a.status, a.requirement_due_on
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_activity(e.id) a
  ), dates AS (
    SELECT s.due_on,
      string_agg(DISTINCT tw.title, ' · ' ORDER BY tw.title)
        FILTER (WHERE tw.title IS NOT NULL) AS training_label,
      string_agg(DISTINCT s.module::text, ' · ' ORDER BY s.module::text) AS module_label,
      to_jsonb(array_agg(DISTINCT s.module::text ORDER BY s.module::text)) AS module_scope
    FROM schedule s
    LEFT JOIN public.training_weeks tw ON tw.id = s.training_week_id
    GROUP BY s.due_on
  ), scoped_modules AS (
    SELECT d.due_on, e.id AS enrollment_id, s.module,
      least(max(s.required_units), sum(s.milestone_units))::integer AS required_units
    FROM dates d
    CROSS JOIN eligible e
    JOIN schedule s
      ON s.enrollment_id = e.id
     AND s.due_on <= d.due_on
    GROUP BY d.due_on, e.id, s.module
  ), leader_module_checkpoints AS (
    SELECT sm.due_on, sm.enrollment_id, sm.module, sm.required_units,
      count(a.occurred_on) FILTER (
        WHERE a.status = 'completed'
          AND a.occurred_on <= least(p_as_of, sm.due_on)
          AND (a.requirement_due_on IS NULL OR a.requirement_due_on <= sm.due_on)
      )::integer AS completed_units
    FROM scoped_modules sm
    LEFT JOIN activity a
      ON a.enrollment_id = sm.enrollment_id
     AND a.module = sm.module
    GROUP BY sm.due_on, sm.enrollment_id, sm.module, sm.required_units
  ), leader_checkpoints AS (
    SELECT d.due_on, e.id AS enrollment_id,
      coalesce(sum(l.required_units), 0)::integer AS required_units,
      coalesce(sum(least(l.completed_units, l.required_units)), 0)::integer AS completed_units
    FROM dates d
    CROSS JOIN eligible e
    LEFT JOIN leader_module_checkpoints l
      ON l.due_on = d.due_on
     AND l.enrollment_id = e.id
    GROUP BY d.due_on, e.id
  ), totals AS (
    SELECT d.due_on,
      d.training_label AS label,
      d.module_scope,
      sum(l.required_units)::integer AS required_units,
      sum(l.completed_units)::integer AS completed_units,
      count(*)::integer AS total_leaders,
      count(*) FILTER (
        WHERE l.required_units > 0
          AND l.completed_units >= l.required_units
      )::integer AS completed_leaders
    FROM dates d
    JOIN leader_checkpoints l ON l.due_on = d.due_on
    GROUP BY d.due_on, d.training_label, d.module_label, d.module_scope
  ), numbered AS (
    SELECT row_number() OVER (ORDER BY due_on)::integer AS checkpoint_number, *
    FROM totals
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'checkpoint_number', checkpoint_number,
    'due_on', due_on,
    'label', label,
    'module_scope', module_scope,
    'required_units', required_units,
    'completed_units', completed_units,
    'completed_leaders', completed_leaders,
    'total_leaders', total_leaders,
    'state', CASE
      WHEN p_as_of < due_on THEN 'upcoming'
      WHEN p_as_of = due_on THEN 'current'
      WHEN required_units > 0 AND completed_units >= required_units THEN 'completed'
      ELSE 'overdue'
    END
  ) ORDER BY due_on), '[]'::jsonb)
  FROM numbered;
$function$;

-- ----------------------------------------------------------------------------
-- 5. Unit state (Admin, Learner, reminders) reads fulfilment directly.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.triad_unit_enrollment_status_internal(p_cohort_requirement_date_id uuid, p_as_of date DEFAULT current_date)
RETURNS TABLE (cohort_requirement_date_id uuid, unit_number integer, due_on date, enrollment_id uuid, user_id uuid,
  enrollment_status public.enrollment_status, is_eligible boolean, triad_group_id uuid, session_id uuid,
  session_status text, scheduled_start_time timestamptz, unit_completed boolean, unit_overdue boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH req AS (
    SELECT d.* FROM public.cohort_requirement_dates d
    WHERE d.id = p_cohort_requirement_date_id AND d.module = 'triads'::public.programme_module_type
  ), grp AS (
    SELECT DISTINCT ON (m.enrollment_id) m.enrollment_id, g.id AS triad_group_id
    FROM req
    JOIN public.triad_groups g ON g.cohort_requirement_date_id = req.id AND g.is_active
    JOIN public.triad_group_members m ON m.triad_group_id = g.id
    ORDER BY m.enrollment_id, g.created_at DESC
  ), pop AS (
    SELECT e.* FROM req
    JOIN public.programme_enrollments e ON e.cohort_id = req.cohort_id AND e.programme_id = req.programme_id
    WHERE e.status IN ('active', 'at_risk', 'paused') OR e.id IN (SELECT enrollment_id FROM grp)
  )
  SELECT req.id, req.ordinal, req.due_on, e.id, e.user_id, e.status,
    e.status IN ('active', 'at_risk', 'paused'),
    grp.triad_group_id, ses.id, ses.status, ses.scheduled_start_time,
    coalesce(f.fulfilled_on <= p_as_of, false),
    req.due_on <= p_as_of AND NOT coalesce(f.fulfilled_on <= p_as_of, false)
  FROM req
  CROSS JOIN pop e
  LEFT JOIN grp ON grp.enrollment_id = e.id
  LEFT JOIN LATERAL (
    SELECT s.id, s.status, s.scheduled_start_time FROM public.triad_sessions s
    WHERE s.triad_group_id = grp.triad_group_id ORDER BY s.created_at DESC LIMIT 1
  ) ses ON true
  LEFT JOIN LATERAL (
    SELECT x.fulfilled_on FROM public.canonical_triad_requirement_fulfilment(e.id) x
    WHERE x.cohort_requirement_date_id = req.id
  ) f ON true;
$$;

CREATE OR REPLACE FUNCTION public.learner_triad_overview(p_enrollment_id uuid DEFAULT NULL)
RETURNS TABLE (enrollment_id uuid, triad_group_id uuid, cohort_requirement_date_id uuid, unit_number integer,
  due_on date, training_week_number integer, training_week_title text, training_week_title_vi text,
  group_language text, is_active boolean, member_count integer, my_member_slot integer,
  unit_completed boolean, unit_overdue boolean, sessions jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.enrollment_id, g.id, g.cohort_requirement_date_id, d.ordinal, d.due_on,
    tw.week_number, tw.title, tw.title_vi, g.group_language, g.is_active,
    (SELECT count(*)::integer FROM public.triad_group_members x WHERE x.triad_group_id = g.id),
    m.member_order::integer,
    CASE WHEN d.id IS NOT NULL THEN coalesce(f.fulfilled_on <= current_date, false) END,
    CASE WHEN d.id IS NOT NULL THEN d.due_on <= current_date AND NOT coalesce(f.fulfilled_on <= current_date, false) END,
    public.triad_group_sessions_internal(g.id, m.enrollment_id)
  FROM public.programme_enrollments e
  JOIN public.triad_group_members m ON m.enrollment_id = e.id
  JOIN public.triad_groups g ON g.id = m.triad_group_id
  LEFT JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id
  LEFT JOIN public.training_weeks tw ON tw.id = d.training_week_id
  LEFT JOIN LATERAL (
    SELECT x.fulfilled_on FROM public.canonical_triad_requirement_fulfilment(e.id) x
    WHERE x.cohort_requirement_date_id = d.id
  ) f ON true
  WHERE e.user_id = auth.uid()
    AND auth.uid() IS NOT NULL
    AND (p_enrollment_id IS NULL OR e.id = p_enrollment_id)
  ORDER BY d.ordinal NULLS FIRST, g.created_at;
$$;

-- ----------------------------------------------------------------------------
-- 6. Access: both internal constructions stay internal.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.canonical_triad_requirement_fulfilment(uuid), public.sponsor_canonical_activity(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_triad_requirement_fulfilment(uuid), public.sponsor_canonical_activity(uuid)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 7. Verification. The rule may only remove double-counted or unlinked Triad
--    credit: no enrollment may gain completed units, and required / due units
--    never move. Every corrected enrollment is reported.
-- ----------------------------------------------------------------------------
DO $$
DECLARE bad text; changed text; n integer;
BEGIN
  SELECT string_agg(b.enrollment_id::text, ', ') INTO bad
  FROM _fulfilment_before b
  JOIN LATERAL (SELECT * FROM public.canonical_module_progress(b.enrollment_id, current_date) p
                WHERE p.module = 'triads'::public.programme_module_type) a ON true
  WHERE a.completed_units > b.completed_units
     OR a.required_units IS DISTINCT FROM b.required_units
     OR a.due_units IS DISTINCT FROM b.due_units;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad fulfilment: completion rose or requirements moved for enrollments %', bad;
  END IF;

  SELECT count(*), string_agg(format('%s: %s/%s -> %s/%s (overdue %s -> %s)', b.enrollment_id,
           b.completed_units, b.required_units, a.completed_units, a.required_units, b.overdue_units, a.overdue_units), '; ')
    INTO n, changed
  FROM _fulfilment_before b
  JOIN LATERAL (SELECT * FROM public.canonical_module_progress(b.enrollment_id, current_date) p
                WHERE p.module = 'triads'::public.programme_module_type) a ON true
  WHERE row(a.completed_units, a.overdue_units, a.booked_units, a.pace_status)
        IS DISTINCT FROM row(b.completed_units, b.overdue_units, b.booked_units, b.pace_status);
  IF n > 0 THEN
    RAISE NOTICE 'Triad fulfilment: % enrollment(s) corrected to requirement-based completion: %', n, changed;
  END IF;
END $$;
