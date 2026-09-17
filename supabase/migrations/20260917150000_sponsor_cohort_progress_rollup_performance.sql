-- Keep the established per-cohort canonical calculation intact, but make the
-- all-cohort RPC fan out through it one cohort at a time. The previous
-- all-cohort path evaluated the enrollment progress source for the whole
-- organisation and then computed each cohort journey, which exceeded the
-- hosted authenticated statement timeout for the live demo organisation.

ALTER FUNCTION public.sponsor_canonical_cohort_progress(uuid, date)
  RENAME TO sponsor_canonical_cohort_progress_one;

CREATE OR REPLACE FUNCTION public.sponsor_canonical_cohort_progress(
  p_cohort_id uuid DEFAULT NULL,
  p_as_of date DEFAULT current_date
)
RETURNS TABLE (
  cohort_id uuid,
  cohort_label text,
  programme_label text,
  programme_start_date date,
  programme_end_date date,
  enrollment_count integer,
  suppressed boolean,
  required_units integer,
  completed_units integer,
  due_units integer,
  booked_units integer,
  overdue_units integer,
  full_completion_pct numeric,
  due_adherence_pct numeric,
  schedule_coverage_pct numeric,
  pace_status text,
  active_count integer,
  at_risk_count integer,
  paused_count integer,
  completed_count integer,
  not_yet_due_count integer,
  ahead_count integer,
  on_track_count integer,
  scheduled_count integer,
  behind_count integer,
  completed_pace_count integer,
  on_track_pct numeric,
  coaching_required_units integer,
  coaching_completed_units integer,
  coaching_due_units integer,
  coaching_booked_units integer,
  coaching_completed_leaders integer,
  training_required_units integer,
  training_completed_units integer,
  training_due_units integer,
  training_booked_units integer,
  training_completed_leaders integer,
  peer_required_units integer,
  peer_completed_units integer,
  peer_due_units integer,
  peer_booked_units integer,
  peer_completed_leaders integer,
  mentoring_required_units integer,
  mentoring_completed_units integer,
  mentoring_due_units integer,
  mentoring_booked_units integer,
  mentoring_completed_leaders integer,
  triad_required_units integer,
  triad_completed_units integer,
  triad_due_units integer,
  triad_booked_units integer,
  triad_completed_leaders integer,
  programme_journey jsonb,
  progress_source_complete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT progress.*
  FROM public.cohorts c
  JOIN public.programmes p
    ON p.id = c.programme_id
  JOIN public.sponsor_profiles sp
    ON sp.organization_id = c.organization_id
   AND sp.user_id = auth.uid()
  CROSS JOIN LATERAL public.sponsor_canonical_cohort_progress_one(c.id, p_as_of) progress
  WHERE auth.uid() IS NOT NULL
    AND (p_cohort_id IS NULL OR c.id = p_cohort_id)
  ORDER BY progress.cohort_label;
$$;

-- Organisation progress already rolls up this public RPC. After the rename,
-- that call now uses the bounded per-cohort path above rather than the old
-- global enrollment calculation, so it does not introduce a second global
-- computation.

REVOKE ALL ON FUNCTION public.sponsor_canonical_cohort_progress_one(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sponsor_canonical_cohort_progress(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sponsor_canonical_organisation_progress(date)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sponsor_canonical_cohort_progress(uuid, date)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_canonical_organisation_progress(date)
  TO authenticated;