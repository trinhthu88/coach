-- ===========================================================================
-- Organisation membership is enrollment-scoped; requirement integrity report.
-- ===========================================================================
--
-- ORGANISATION. Who belongs to an organisation is answered by
-- programme_enrollments.organization_id -- the same column Sponsor visibility
-- uses (sponsor_visible_enrollments). The Admin organisation page used to
-- count raw enrollment rows client-side (historical rows and a learner's
-- second enrollment included, no list), so its "enrolled leaders" number
-- matched neither the Sponsor view nor the roster. Both Admin reads below are
-- derived from enrollments only; cohorts.organization_id is never consulted
-- (a cohort may mix organisations).
--
-- INTEGRITY. admin_requirement_integrity_issues() lists every state that would
-- make the requirement calendar disagree with the programme, so a readiness
-- check (or an Admin) can find it instead of a dashboard compensating for it.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.admin_organization_leader_summary()
RETURNS TABLE (
  organization_id uuid, organization_name text,
  ongoing_enrollments integer, historical_enrollments integer,
  ongoing_leaders integer, total_leaders integer, cohort_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.id, o.name,
    count(e.id) FILTER (WHERE e.status IN ('active', 'at_risk', 'paused'))::integer,
    count(e.id) FILTER (WHERE e.status NOT IN ('active', 'at_risk', 'paused'))::integer,
    count(DISTINCT e.user_id) FILTER (WHERE e.status IN ('active', 'at_risk', 'paused'))::integer,
    count(DISTINCT e.user_id)::integer,
    count(DISTINCT e.cohort_id)::integer
  FROM public.organizations o
  LEFT JOIN public.programme_enrollments e ON e.organization_id = o.id
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  GROUP BY o.id, o.name
  ORDER BY o.name;
$$;

CREATE OR REPLACE FUNCTION public.admin_organization_enrollments(p_organization_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  enrollment_id uuid, user_id uuid, learner_name text, learner_email text,
  organization_id uuid, organization_name text,
  programme_id uuid, programme_name text, cohort_id uuid, cohort_name text,
  stored_enrollment_status public.enrollment_status, effective_enrollment_status public.enrollment_status,
  is_ongoing boolean, start_date date, end_date date,
  required_units integer, completed_units integer, due_units integer, overdue_units integer,
  full_completion_pct numeric, progress_available boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.user_id, pr.full_name, pr.email,
    e.organization_id, o.name,
    e.programme_id, p.name, e.cohort_id, c.name,
    e.status, cp.effective_enrollment_status,
    e.status IN ('active', 'at_risk', 'paused'),
    e.start_date, coalesce(e.end_date, c.end_date),
    cp.required_units, cp.completed_units, cp.due_units, cp.overdue_units,
    cp.full_completion_pct, coalesce(cp.progress_available, false)
  FROM public.programme_enrollments e
  JOIN public.organizations o ON o.id = e.organization_id
  LEFT JOIN public.profiles pr ON pr.id = e.user_id
  LEFT JOIN public.programmes p ON p.id = e.programme_id
  LEFT JOIN public.cohorts c ON c.id = e.cohort_id
  LEFT JOIN LATERAL public.canonical_enrollment_progress(e.id, p_as_of) cp ON true
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
    AND e.organization_id = p_organization_id
  ORDER BY (e.status IN ('active', 'at_risk', 'paused')) DESC, c.name, pr.full_name;
$$;

REVOKE ALL ON FUNCTION public.admin_organization_leader_summary() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_organization_enrollments(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_organization_leader_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_organization_enrollments(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- Integrity report
-- ---------------------------------------------------------------------------
-- issue values:
--   schedule:<violation>            cohort_schedule_violations() (count mismatch,
--                                   duplicate / gapped ordinal, unselected week,
--                                   missing deadline, out-of-scope rows)
--   training_units_mismatch         Training required_units <> selected weeks
--   training_week_missing           a selected week id that is not a week of the programme
--   training_week_unmapped          a selected week without its Training requirement
--   requirement_unresolvable        a requirement whose programme is not the cohort's
--                                   programme nor any of its enrollments'
--   enrollment_without_organization an ongoing enrollment with no organisation
--                                   (invisible to every Sponsor)
CREATE OR REPLACE FUNCTION public.requirement_integrity_issues()
RETURNS TABLE (issue text, cohort_id uuid, programme_id uuid, module public.programme_module_type,
  enrollment_id uuid, detail text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'schedule:' || v.violation, v.cohort_id, v.programme_id, v.module, NULL::uuid,
    format('required %s, requirement rows %s', coalesce(v.required_units::text, '-'), v.row_count)
  FROM public.cohort_schedule_violations() v

  UNION ALL
  SELECT 'training_units_mismatch', NULL::uuid, pm.programme_id, pm.module, NULL::uuid,
    format('required_units %s, selected weeks %s',
      coalesce(public.programme_config_integer(pm.config, 'required_units'), 0),
      CASE WHEN jsonb_typeof(pm.config->'distribution_settings'->'training_week_ids') = 'array'
        THEN jsonb_array_length(pm.config->'distribution_settings'->'training_week_ids') ELSE 0 END)
  FROM public.programme_modules pm
  WHERE pm.module = 'training' AND pm.enabled AND coalesce((pm.config->>'required')::boolean, false)
    AND coalesce(public.programme_config_integer(pm.config, 'required_units'), 0)
        <> CASE WHEN jsonb_typeof(pm.config->'distribution_settings'->'training_week_ids') = 'array'
             THEN jsonb_array_length(pm.config->'distribution_settings'->'training_week_ids') ELSE 0 END

  UNION ALL
  SELECT 'training_week_missing', NULL::uuid, pm.programme_id, pm.module, NULL::uuid,
    format('selected week %s does not exist in this programme', s.week_id)
  FROM public.programme_modules pm
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(pm.config->'distribution_settings'->'training_week_ids') = 'array'
      THEN pm.config->'distribution_settings'->'training_week_ids' ELSE '[]'::jsonb END) s(week_id)
  WHERE pm.module = 'training' AND pm.enabled
    AND NOT EXISTS (SELECT 1 FROM public.training_weeks tw
                    WHERE tw.id::text = s.week_id AND tw.programme_id = pm.programme_id)

  UNION ALL
  SELECT 'training_week_unmapped', c.id, w.programme_id, 'training'::public.programme_module_type, NULL::uuid,
    format('Week %s has no Training requirement%s', w.week_number,
      CASE WHEN w.default_due_on IS NULL THEN ' (no pacing date: set a cohort start date or a week date)' ELSE '' END)
  FROM public.cohorts c
  CROSS JOIN LATERAL public.cohort_training_requirement_weeks(c.id) w
  WHERE NOT EXISTS (SELECT 1 FROM public.cohort_requirement_dates d
                    WHERE d.cohort_id = c.id AND d.programme_id = w.programme_id
                      AND d.module = 'training' AND d.training_week_id = w.training_week_id)

  UNION ALL
  SELECT 'requirement_unresolvable', d.cohort_id, d.programme_id, d.module, NULL::uuid,
    format('%s %s belongs to a programme this cohort does not run', d.module, d.ordinal)
  FROM public.cohort_requirement_dates d
  WHERE NOT EXISTS (SELECT 1 FROM public.cohort_scheduled_programmes(d.cohort_id) sp
                    WHERE sp.programme_id = d.programme_id)

  UNION ALL
  SELECT 'enrollment_without_organization', e.cohort_id, e.programme_id, NULL::public.programme_module_type, e.id,
    'ongoing enrollment has no organisation, so no Sponsor can see it'
  FROM public.programme_enrollments e
  WHERE e.organization_id IS NULL AND e.status IN ('active', 'at_risk', 'paused');
$$;
REVOKE ALL ON FUNCTION public.requirement_integrity_issues() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_requirement_integrity_issues()
RETURNS TABLE (issue text, cohort_id uuid, cohort_name text, programme_id uuid, programme_name text,
  module public.programme_module_type, enrollment_id uuid, detail text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can review requirement integrity' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT i.issue, i.cohort_id, c.name, i.programme_id, p.name, i.module, i.enrollment_id, i.detail
  FROM public.requirement_integrity_issues() i
  LEFT JOIN public.cohorts c ON c.id = i.cohort_id
  LEFT JOIN public.programmes p ON p.id = i.programme_id
  ORDER BY i.issue, c.name, p.name;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_requirement_integrity_issues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_requirement_integrity_issues() TO authenticated;
