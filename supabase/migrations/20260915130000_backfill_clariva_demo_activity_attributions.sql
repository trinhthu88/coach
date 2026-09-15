-- Demo-only data repair.
--
-- The Clariva demo activity predates the immutable attribution triggers. The
-- source sessions, training progress, quizzes, prompts, and triad activity are
-- already present, but cadence reporting cannot consume them until they are
-- attributed to the existing enrollment snapshots.
--
-- This migration is deliberately guarded by both the fixed demo organization
-- id and its name. It does not infer ownership, touch customer organizations,
-- or copy any private content into sponsor reporting.
DO $demo_backfill$
DECLARE
  target_org uuid := 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01';
  r record;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE id = target_org
      AND name = 'Clariva Demo Organization'
  ) THEN
    RAISE EXCEPTION 'Clariva demo attribution guard failed';
  END IF;

  FOR r IN
    SELECT s.id, s.enrollment_id, s.start_time::date AS occurred_on
    FROM public.sessions s
    JOIN public.programme_enrollments e ON e.id = s.enrollment_id
    WHERE e.organization_id = target_org
  LOOP
    PERFORM public.attribute_activity_to_cadence_milestone(
      r.enrollment_id, 'coaching', r.id, r.occurred_on
    );
  END LOOP;

  FOR r IN
    SELECT s.id, s.enrollment_id, s.start_time::date AS occurred_on
    FROM public.peer_sessions s
    JOIN public.programme_enrollments e ON e.id = s.enrollment_id
    WHERE e.organization_id = target_org
  LOOP
    PERFORM public.attribute_activity_to_cadence_milestone(
      r.enrollment_id, 'peer_coaching', r.id, r.occurred_on
    );
  END LOOP;

  FOR r IN
    SELECT s.id, s.enrollment_id, s.start_time::date AS occurred_on
    FROM public.coachee_peer_sessions s
    JOIN public.programme_enrollments e ON e.id = s.enrollment_id
    WHERE e.organization_id = target_org
  LOOP
    PERFORM public.attribute_activity_to_cadence_milestone(
      r.enrollment_id, 'peer_coaching', r.id, r.occurred_on
    );
  END LOOP;

  FOR r IN
    SELECT s.id, s.enrollment_id, s.start_time::date AS occurred_on
    FROM public.mentoring_sessions s
    JOIN public.programme_enrollments e ON e.id = s.enrollment_id
    WHERE e.organization_id = target_org
  LOOP
    PERFORM public.attribute_activity_to_cadence_milestone(
      r.enrollment_id, 'mentoring', r.id, r.occurred_on
    );
  END LOOP;

  FOR r IN
    SELECT p.id, p.enrollment_id, p.completed_at::date AS occurred_on
    FROM public.training_progress p
    JOIN public.programme_enrollments e ON e.id = p.enrollment_id
    WHERE e.organization_id = target_org
      AND p.completed_at IS NOT NULL
  LOOP
    PERFORM public.attribute_activity_to_cadence_milestone(
      r.enrollment_id, 'training', r.id, r.occurred_on
    );
  END LOOP;

  FOR r IN
    SELECT s.id, s.enrollment_id, s.submitted_at::date AS occurred_on
    FROM public.assignment_submissions s
    JOIN public.assignments a ON a.id = s.assignment_id
    JOIN public.programme_enrollments e ON e.id = s.enrollment_id
    WHERE e.organization_id = target_org
      AND a.assignment_type = 'quiz'
      AND s.submitted_at IS NOT NULL
  LOOP
    PERFORM public.attribute_activity_to_cadence_milestone(
      r.enrollment_id, 'quiz', r.id, r.occurred_on
    );
  END LOOP;

  FOR r IN
    SELECT p.id, p.enrollment_id, p.responded_at::date AS occurred_on
    FROM public.daily_prompt_responses p
    JOIN public.programme_enrollments e ON e.id = p.enrollment_id
    WHERE e.organization_id = target_org
      AND p.responded_at IS NOT NULL
  LOOP
    PERFORM public.attribute_activity_to_cadence_milestone(
      r.enrollment_id, 'daily_prompt', r.id, r.occurred_on
    );
  END LOOP;

  FOR r IN
    SELECT ts.id,
           x.enrollment_id,
           coalesce(ts.start_time, ts.proposed_start_time)::date AS occurred_on
    FROM public.triad_sessions ts
    CROSS JOIN LATERAL (
      VALUES
        (ts.coach_enrollment_id),
        (ts.coachee_enrollment_id),
        (ts.observer_enrollment_id)
    ) x(enrollment_id)
    JOIN public.programme_enrollments e ON e.id = x.enrollment_id
    WHERE e.organization_id = target_org
      AND x.enrollment_id IS NOT NULL
  LOOP
    PERFORM public.attribute_activity_to_cadence_milestone(
      r.enrollment_id, 'triads', r.id, r.occurred_on
    );
  END LOOP;
END
$demo_backfill$;