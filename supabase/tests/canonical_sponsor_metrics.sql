-- Run after the canonical Sponsor metrics migration against the demo-enabled
-- database.  This is intentionally database-level: it exercises the same
-- SECURITY DEFINER functions used by the Sponsor UI.

DO $$
DECLARE
  sponsor_user uuid;
  scenario record;
  organisation record;
  cohort_totals record;
  leader_totals record;
BEGIN
  SELECT sp.user_id
  INTO sponsor_user
  FROM public.sponsor_profiles sp
  WHERE sp.organization_id = 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01'
  LIMIT 1;

  IF sponsor_user IS NULL THEN
    RAISE EXCEPTION 'Demo Sponsor profile is missing';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', sponsor_user::text, true);

  -- Not started / nothing due.
  SELECT *
  INTO scenario
  FROM public.sponsor_metric_rows(NULL, DATE '2025-01-05')
  WHERE enrollment_id = 'c7f8e4b2-2f34-4a1d-8f6f-e00000000001';
  IF scenario.enrollment_status <> 'active'
     OR scenario.pace_status <> 'not_yet_due'
     OR scenario.health_status <> 'not_assessed'
     OR scenario.assessable
     OR scenario.on_track IS NOT NULL
     OR scenario.due_units <> 0
     OR scenario.due_adherence_pct IS NOT NULL
     OR scenario.schedule_coverage_pct IS NOT NULL THEN
    RAISE EXCEPTION 'Not-started fixture violated the canonical contract: %', row_to_json(scenario);
  END IF;

  -- Active and on track.
  SELECT *
  INTO scenario
  FROM public.sponsor_metric_rows(NULL, DATE '2026-02-15')
  WHERE enrollment_id = 'c7f8e4b2-2f34-4a1d-8f6f-e00000000004';
  IF scenario.enrollment_status <> 'active'
     OR scenario.pace_status <> 'on_track'
     OR scenario.health_status <> 'healthy'
     OR NOT scenario.assessable
     OR scenario.on_track IS NOT TRUE THEN
    RAISE EXCEPTION 'On-track fixture violated the canonical contract: %', row_to_json(scenario);
  END IF;

  -- Active, at risk, with overdue requirements.
  SELECT *
  INTO scenario
  FROM public.sponsor_metric_rows(NULL, DATE '2026-04-15')
  WHERE enrollment_id = 'c7f8e4b2-2f34-4a1d-8f6f-e00000000023';
  IF scenario.enrollment_status <> 'active'
     OR scenario.pace_status <> 'behind'
     OR scenario.health_status <> 'at_risk'
     OR NOT scenario.assessable
     OR scenario.on_track IS NOT FALSE
     OR scenario.overdue_units <= 0
     OR scenario.session_overdue_units <= 0 THEN
    RAISE EXCEPTION 'At-risk fixture violated the canonical contract: %', row_to_json(scenario);
  END IF;

  -- Completed. Completion is a separate dimension from current assessability.
  SELECT *
  INTO scenario
  FROM public.sponsor_metric_rows(NULL, DATE '2026-02-15')
  WHERE enrollment_id = 'c7f8e4b2-2f34-4a1d-8f6f-e00000000031';
  IF scenario.enrollment_status <> 'completed'
     OR scenario.pace_status <> 'completed'
     OR scenario.health_status <> 'completed'
     OR scenario.assessable
     OR scenario.on_track IS NOT NULL
     OR scenario.full_completion_pct <> 100 THEN
    RAISE EXCEPTION 'Completed fixture violated the canonical contract: %', row_to_json(scenario);
  END IF;

  -- Current organization, cohort, and leader totals must be one aggregation
  -- chain.  Percentages are compared from their raw unit numerators rather
  -- than averaging already-rounded percentages.
  SELECT * INTO organisation
  FROM public.sponsor_organisation_summary();

  SELECT
    coalesce(sum(c.required_units) FILTER (WHERE NOT c.suppressed), 0)::integer AS required_units,
    coalesce(sum(c.completed_units) FILTER (WHERE NOT c.suppressed), 0)::integer AS completed_units,
    coalesce(sum(c.due_units) FILTER (WHERE NOT c.suppressed), 0)::integer AS due_units,
    coalesce(sum(c.on_track_count) FILTER (WHERE NOT c.suppressed), 0)::integer AS on_track_count,
    coalesce(sum(c.assessable_count) FILTER (WHERE NOT c.suppressed), 0)::integer AS assessable_count,
    coalesce(sum(c.session_required_units) FILTER (WHERE NOT c.suppressed), 0)::integer AS session_required_units,
    coalesce(sum(c.session_completed_units) FILTER (WHERE NOT c.suppressed), 0)::integer AS session_completed_units
  INTO cohort_totals
  FROM public.sponsor_cohort_summaries() c;

  SELECT
    coalesce(sum(r.required_units), 0)::integer AS required_units,
    coalesce(sum(r.completed_units), 0)::integer AS completed_units,
    coalesce(sum(r.due_units), 0)::integer AS due_units,
    count(*) FILTER (WHERE r.on_track IS TRUE)::integer AS on_track_count,
    count(*) FILTER (WHERE r.assessable)::integer AS assessable_count,
    coalesce(sum(r.session_required_units), 0)::integer AS session_required_units,
    coalesce(sum(r.session_completed_units), 0)::integer AS session_completed_units
  INTO leader_totals
  FROM public.sponsor_metric_rows(NULL, current_date) r;

  IF organisation.suppressed
     OR organisation.required_units IS DISTINCT FROM cohort_totals.required_units
     OR organisation.completed_units IS DISTINCT FROM cohort_totals.completed_units
     OR organisation.due_units IS DISTINCT FROM cohort_totals.due_units
     OR organisation.on_track_count IS DISTINCT FROM cohort_totals.on_track_count
     OR organisation.assessable_count IS DISTINCT FROM cohort_totals.assessable_count
     OR organisation.session_required_units IS DISTINCT FROM cohort_totals.session_required_units
     OR organisation.session_completed_units IS DISTINCT FROM cohort_totals.session_completed_units
     OR cohort_totals.required_units IS DISTINCT FROM leader_totals.required_units
     OR cohort_totals.completed_units IS DISTINCT FROM leader_totals.completed_units
     OR cohort_totals.due_units IS DISTINCT FROM leader_totals.due_units
     OR cohort_totals.on_track_count IS DISTINCT FROM leader_totals.on_track_count
     OR cohort_totals.assessable_count IS DISTINCT FROM leader_totals.assessable_count
     OR cohort_totals.session_required_units IS DISTINCT FROM leader_totals.session_required_units
     OR cohort_totals.session_completed_units IS DISTINCT FROM leader_totals.session_completed_units THEN
    RAISE EXCEPTION 'Sponsor aggregation reconciliation failed: org=%, cohorts=%, leaders=%',
      row_to_json(organisation), row_to_json(cohort_totals), row_to_json(leader_totals);
  END IF;
END;
$$;