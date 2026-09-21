-- Spec hardening: role priority, sponsor role on the visibility rule, and
-- journey checkpoint state derived from completion first.
--
-- 1. get_primary_role() ranked sponsor LAST (admin > coach > coachee > sponsor),
--    the opposite of the client (resolveAppRole: admin > sponsor > coach >
--    coachee). It now matches: Sponsor is an exclusive portal and outranks the
--    learner/coach workspaces.
--
-- 2. sponsor_visible_enrollments() keyed only on a sponsor_profiles row, so a
--    person whose sponsor ROLE was removed but whose profile row survived kept
--    seeing their organisation's learners. The rule now also requires the
--    sponsor role in user_roles (the one source of roles). Still exactly one
--    rule: enrollment.organization_id = the sponsor's organisation.
--
-- 3. Journey checkpoint state was decided by the date before completion
--    ('upcoming' whenever as_of < due_on), so a checkpoint whose activities
--    were already done still read 'upcoming'. Completion now comes first, in
--    the learner journey (canonical_enrollment_journey) and the sponsor cohort
--    journey (get_sponsor_programme_journey) alike. Signatures and every other
--    line are unchanged.

-- ---------------------------------------------------------------------------
-- 1. Role priority
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_primary_role(_user_id uuid)
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY CASE role
    WHEN 'admin' THEN 1
    WHEN 'sponsor' THEN 2
    WHEN 'coach' THEN 3
    WHEN 'coachee' THEN 4
  END
  LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- 2. THE sponsor visibility rule, gated on the sponsor role
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sponsor_visible_enrollments()
RETURNS TABLE (enrollment_id uuid, cohort_id uuid, organization_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- THE sponsor visibility rule: an enrollment is visible to the calling
  -- sponsor iff its organization_id equals the sponsor's organisation, and
  -- the caller currently holds the sponsor role. A NULL enrollment
  -- organisation matches no sponsor. The cohort's organisation is
  -- deliberately not consulted.
  SELECT e.id, e.cohort_id, e.organization_id
  FROM public.sponsor_profiles sp
  JOIN public.programme_enrollments e
    ON e.organization_id = sp.organization_id
  WHERE sp.user_id = auth.uid()
    AND auth.uid() IS NOT NULL
    AND public.has_role(auth.uid(), 'sponsor'::public.app_role);
$$;

COMMENT ON FUNCTION public.sponsor_visible_enrollments() IS
  'THE sponsor visibility rule: enrollments whose organization_id equals the calling sponsor''s organisation, for a caller holding the sponsor role (NULL organisation = visible to nobody). cohorts.organization_id is never an authorization boundary. Every sponsor surface reads through this set or sponsor_can_view_enrollment.';

-- ---------------------------------------------------------------------------
-- 3. Journey checkpoint state: completion first
-- ---------------------------------------------------------------------------
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
    -- Completion first: a checkpoint whose required activity is done is
    -- 'completed' whatever the date (it used to read 'upcoming' until its due
    -- date). Otherwise the date decides upcoming / current / overdue.
    'state', CASE
      WHEN required_units > 0 AND completed_units >= required_units THEN 'completed'
      WHEN p_as_of < due_on THEN 'upcoming'
      WHEN p_as_of = due_on THEN 'current'
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
  WITH eligible AS (
    -- The sponsor's visible enrollments in this cohort; other organisations'
    -- learners in the same cohort are not part of this sponsor's journey.
    SELECT v.enrollment_id AS id, v.cohort_id
    FROM public.sponsor_visible_enrollments() v
    WHERE v.cohort_id = p_cohort_id
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
    -- Completion first: a checkpoint whose required activity is done is
    -- 'completed' whatever the date (it used to read 'upcoming' until its due
    -- date). Otherwise the date decides upcoming / current / overdue.
    'state', CASE
      WHEN required_units > 0 AND completed_units >= required_units THEN 'completed'
      WHEN p_as_of < due_on THEN 'upcoming'
      WHEN p_as_of = due_on THEN 'current'
      ELSE 'overdue'
    END
  ) ORDER BY due_on), '[]'::jsonb)
  FROM numbered;
$function$;

