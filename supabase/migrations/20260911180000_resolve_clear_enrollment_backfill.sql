-- Resolve only the historical goal trees whose programme ownership is clear
-- from their programme-specific records and dates.  Do not assign the
-- orphaned sessions or triad reflections: they have no safe enrollment
-- candidate and remain visible in the backfill audit.

WITH approved_goal_mapping(goal_id, enrollment_id) AS (
  VALUES
    -- TASC Essential demo goals for the first learner.
    ('d0000000-0000-0000-0000-000000000001'::uuid, '68426342-289a-4b04-aa61-e8ce12fd6f31'::uuid),
    ('d0000000-0000-0000-0000-000000000002'::uuid, '68426342-289a-4b04-aa61-e8ce12fd6f31'::uuid),
    ('d0000000-0000-0000-0000-000000000003'::uuid, '68426342-289a-4b04-aa61-e8ce12fd6f31'::uuid),
    -- Historical Growth goals for the second learner.
    ('e1d5e90d-79cf-4f0b-9d0e-6776704672a8'::uuid, 'afef271d-62c2-43ca-9f48-fb8dfd7e38e3'::uuid),
    ('aa9af4d6-6c25-4616-bf64-0d053a9b37af'::uuid, 'afef271d-62c2-43ca-9f48-fb8dfd7e38e3'::uuid),
    ('169f6d79-ef83-4fa7-9834-a2cee7899580'::uuid, 'afef271d-62c2-43ca-9f48-fb8dfd7e38e3'::uuid)
)
UPDATE public.coachee_goals g
SET enrollment_id = m.enrollment_id
FROM approved_goal_mapping m
WHERE g.id = m.goal_id
  AND g.enrollment_id IS NULL;

-- Child milestones and ratings inherit the approved goal ownership.  These
-- updates are intentionally limited to goals resolved above.
UPDATE public.coachee_milestones m
SET enrollment_id = g.enrollment_id
FROM public.coachee_goals g
WHERE m.goal_id = g.id
  AND g.enrollment_id IS NOT NULL
  AND m.enrollment_id IS NULL;

UPDATE public.coachee_goal_ratings r
SET enrollment_id = g.enrollment_id
FROM public.coachee_goals g
WHERE r.goal_id = g.id
  AND g.enrollment_id IS NOT NULL
  AND r.enrollment_id IS NULL;

-- Retry action import after the approved milestone ownership is available.
-- Orphaned source activities continue to be recorded in the audit table.
SELECT public.backfill_enrollment_actions();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.coachee_goals
    WHERE id IN (
      'd0000000-0000-0000-0000-000000000001'::uuid,
      'd0000000-0000-0000-0000-000000000002'::uuid,
      'd0000000-0000-0000-0000-000000000003'::uuid,
      'e1d5e90d-79cf-4f0b-9d0e-6776704672a8'::uuid,
      'aa9af4d6-6c25-4616-bf64-0d053a9b37af'::uuid,
      '169f6d79-ef83-4fa7-9834-a2cee7899580'::uuid
    )
      AND enrollment_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Approved enrollment goal mapping is incomplete';
  END IF;
END;
$$;