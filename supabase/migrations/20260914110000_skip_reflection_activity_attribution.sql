-- Reflection submissions still use the historical assignment_submissions
-- table, but they are no longer quiz activity. Only quiz assignments should
-- create cadence attributions from this table.
CREATE OR REPLACE FUNCTION public.attribute_new_activity_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_TABLE_NAME='sessions' THEN
    IF NEW.enrollment_id IS NOT NULL THEN
      PERFORM public.attribute_activity_to_cadence_milestone(
        NEW.enrollment_id,'coaching',NEW.id,NEW.start_time::date
      );
    END IF;
  ELSIF TG_TABLE_NAME IN ('peer_sessions','coachee_peer_sessions') THEN
    IF NEW.enrollment_id IS NOT NULL THEN
      PERFORM public.attribute_activity_to_cadence_milestone(
        NEW.enrollment_id,'peer_coaching',NEW.id,NEW.start_time::date
      );
    END IF;
  ELSIF TG_TABLE_NAME='mentoring_sessions' THEN
    IF NEW.enrollment_id IS NOT NULL THEN
      PERFORM public.attribute_activity_to_cadence_milestone(
        NEW.enrollment_id,'mentoring',NEW.id,NEW.start_time::date
      );
    END IF;
  ELSIF TG_TABLE_NAME='training_progress' THEN
    IF NEW.enrollment_id IS NOT NULL AND NEW.completed_at IS NOT NULL THEN
      PERFORM public.attribute_activity_to_cadence_milestone(
        NEW.enrollment_id,'training',NEW.id,NEW.completed_at::date
      );
    END IF;
  ELSIF TG_TABLE_NAME='assignment_submissions'
    AND NEW.enrollment_id IS NOT NULL
    AND NEW.submitted_at IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.assignments a
      WHERE a.id = NEW.assignment_id
        AND a.assignment_type = 'quiz'
    )
  THEN
    PERFORM public.attribute_activity_to_cadence_milestone(
      NEW.enrollment_id,
      'quiz',
      NEW.id,
      NEW.submitted_at::date
    );
  ELSIF TG_TABLE_NAME='daily_prompt_responses' THEN
    IF NEW.enrollment_id IS NOT NULL AND NEW.responded_at IS NOT NULL THEN
      PERFORM public.attribute_activity_to_cadence_milestone(
        NEW.enrollment_id,'daily_prompt',NEW.id,NEW.responded_at::date
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;