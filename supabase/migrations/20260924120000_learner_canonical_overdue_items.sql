-- "Needs your attention" reads the same overdue source as the dashboard.
--
-- The dashboard's Overdue KPI is canonical_enrollment_progress.overdue_units:
-- the sum over EVERY module (coaching, peer coaching, mentoring, triads,
-- training) of canonical_module_progress.overdue_units. The attention list was
-- instead assembled client-side from the first overdue journey checkpoint plus
-- training learning items whose LAST due date had passed, and was capped at
-- five -- so a learner could see "11 overdue" next to three attention items.
--
-- This RPC returns the overdue units per module straight from
-- canonical_module_progress, so sum(overdue_units) here is, by construction,
-- the dashboard number. oldest_due_on is the earliest requirement deadline
-- still unmet (completed units satisfy the earliest requirements first, the
-- same FIFO the unit counts imply); it orders the list and is shown as the
-- date the item became overdue.

CREATE OR REPLACE FUNCTION public.canonical_overdue_items(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(module public.programme_module_type, overdue_units integer, due_units integer, oldest_due_on date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH progress AS (
    SELECT g.module, g.overdue_units, g.due_units
    FROM public.canonical_module_progress(p_enrollment_id, p_as_of) g
    WHERE g.overdue_units > 0
  ), milestones AS (
    SELECT s.module, s.due_on,
      sum(s.milestone_units) OVER (PARTITION BY s.module ORDER BY s.due_on
                                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative_units
    FROM public.sponsor_canonical_module_schedule(p_enrollment_id) s
    WHERE s.due_on IS NOT NULL AND s.due_on <= p_as_of AND s.milestone_units > 0
  )
  SELECT p.module, p.overdue_units, p.due_units,
    -- The first due milestone not covered by the completed-and-due units.
    (SELECT min(m.due_on) FROM milestones m
      WHERE m.module = p.module
        AND m.cumulative_units > greatest(p.due_units - p.overdue_units, 0))
  FROM progress p
  ORDER BY 4 NULLS LAST, p.module;
$$;

REVOKE ALL ON FUNCTION public.canonical_overdue_items(uuid, date) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.canonical_overdue_items(uuid, date) IS
  'Overdue required units per module for one enrollment. sum(overdue_units) = canonical_enrollment_progress.overdue_units. Internal.';

CREATE OR REPLACE FUNCTION public.learner_canonical_overdue_items(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(module public.programme_module_type, overdue_units integer, due_units integer, oldest_due_on date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Learner self-view: own enrollment only.
  SELECT o.*
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_overdue_items(e.id, p_as_of) o
  WHERE e.id = p_enrollment_id
    AND e.user_id = auth.uid()
    AND auth.uid() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.learner_canonical_overdue_items(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_canonical_overdue_items(uuid, date) TO authenticated;
