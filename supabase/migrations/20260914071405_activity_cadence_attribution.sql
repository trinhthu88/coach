-- P1: activity is attributed to an immutable enrollment snapshot at write time.
-- Historical rows are intentionally not backfilled: an absent attribution is
-- an unresolved ownership decision and must not affect cadence or reporting.
CREATE TABLE public.session_activity_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT,
  module public.programme_module_type NOT NULL,
  source_activity_type text NOT NULL,
  source_activity_id uuid NOT NULL,
  occurred_on date NOT NULL,
  milestone_id uuid REFERENCES public.enrollment_module_milestones(id) ON DELETE RESTRICT,
  attributed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_activity_type, source_activity_id, enrollment_id),
  UNIQUE (enrollment_id, milestone_id)
);
CREATE INDEX session_activity_attributions_enrollment_idx
  ON public.session_activity_attributions(enrollment_id, module, occurred_on);
ALTER TABLE public.session_activity_attributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Activity attributions: own enrollment read"
  ON public.session_activity_attributions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.programme_enrollments e
                 WHERE e.id=enrollment_id AND e.user_id=auth.uid())
         OR public.has_role(auth.uid(),'admin'::public.app_role));
REVOKE ALL ON public.session_activity_attributions FROM public, anon, authenticated;
GRANT SELECT ON public.session_activity_attributions TO authenticated;

CREATE OR REPLACE FUNCTION public.attribute_activity_to_cadence_milestone(
  p_enrollment_id uuid, p_module text, p_activity_id uuid, p_occurred_on date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  milestone uuid;
  source_type text;
  source_enrollment uuid;
  source_date date;
  source_count integer;
BEGIN
  IF p_enrollment_id IS NULL OR p_module IS NULL OR p_activity_id IS NULL
     OR p_occurred_on IS NULL THEN
    RAISE EXCEPTION 'Activity attribution requires enrollment, module, activity, and date'
      USING ERRCODE='P0001';
  END IF;
  -- Resolve the source without inferring ownership from a person's history.
  IF p_module='coaching' THEN
    source_type := 'coaching';
    SELECT count(*), (array_agg(enrollment_id))[1], max(start_time::date) INTO source_count,source_enrollment,source_date
      FROM public.sessions WHERE id=p_activity_id;
  ELSIF p_module='peer_coaching' THEN
    SELECT count(*), (array_agg(enrollment_id))[1], max(start_time::date) INTO source_count,source_enrollment,source_date
      FROM (SELECT enrollment_id,start_time FROM public.peer_sessions WHERE id=p_activity_id
            UNION ALL SELECT enrollment_id,start_time FROM public.coachee_peer_sessions WHERE id=p_activity_id) s;
    source_type := 'peer_coaching';
  ELSIF p_module='mentoring' THEN
    source_type := 'mentoring';
    SELECT count(*), (array_agg(enrollment_id))[1], max(start_time::date) INTO source_count,source_enrollment,source_date
      FROM public.mentoring_sessions WHERE id=p_activity_id;
  ELSIF p_module='triads' THEN
    source_type := 'triad';
    SELECT count(*), count(*) FILTER (WHERE p_enrollment_id IN (coach_enrollment_id,coachee_enrollment_id,observer_enrollment_id)),
           max(coalesce(start_time,proposed_start_time)::date)
      INTO source_count, source_count, source_date FROM public.triad_sessions WHERE id=p_activity_id;
    IF source_count <> 1 THEN
      RAISE EXCEPTION 'Triad activity has unresolved or ambiguous enrollment ownership' USING ERRCODE='P0001';
    END IF;
    source_enrollment := p_enrollment_id;
  ELSIF p_module='training' THEN
    source_type := 'training';
    SELECT count(*), (array_agg(enrollment_id))[1], max(completed_at::date) INTO source_count,source_enrollment,source_date
      FROM public.training_progress WHERE id=p_activity_id AND completed_at IS NOT NULL;
  ELSIF p_module='quiz' THEN
    source_type := 'quiz';
    SELECT count(*), (array_agg(sub.enrollment_id))[1], max(sub.submitted_at::date) INTO source_count,source_enrollment,source_date
      FROM public.assignment_submissions sub JOIN public.assignments a ON a.id=sub.assignment_id
      WHERE sub.id=p_activity_id AND a.assignment_type='quiz'::public.assignment_type;
  ELSIF p_module='daily_prompt' THEN
    source_type := 'daily_prompt';
    SELECT count(*), (array_agg(enrollment_id))[1], max(responded_at::date) INTO source_count,source_enrollment,source_date
      FROM public.daily_prompt_responses WHERE id=p_activity_id;
  ELSE
    RAISE EXCEPTION 'Unsupported cadence activity module: %', p_module USING ERRCODE='P0001';
  END IF;
  IF public.is_historical_ownership_retired(source_type, p_activity_id)
     OR (source_type='peer_coaching' AND (
       public.is_historical_ownership_retired('peer_sessions',p_activity_id)
       OR public.is_historical_ownership_retired('coachee_peer_sessions',p_activity_id))) THEN
    RAISE EXCEPTION 'Retired activity cannot be attributed' USING ERRCODE='P0001';
  END IF;
  IF source_count <> 1 OR source_enrollment IS NULL OR source_enrollment <> p_enrollment_id
     OR source_date IS NULL OR source_date IS DISTINCT FROM p_occurred_on THEN
    RAISE EXCEPTION 'Activity source is missing, ambiguous, or not owned by enrollment'
      USING ERRCODE='P0001';
  END IF;

  SELECT m.id INTO milestone
  FROM public.enrollment_module_milestones m
  JOIN public.enrollment_module_snapshots s ON s.id=m.enrollment_module_snapshot_id
  WHERE s.enrollment_id=p_enrollment_id AND s.module=p_module::public.programme_module_type
    AND m.due_on <= p_occurred_on
    AND NOT EXISTS (SELECT 1 FROM public.session_activity_attributions a WHERE a.enrollment_id=p_enrollment_id AND a.milestone_id=m.id)
  ORDER BY m.due_on,m.id LIMIT 1;

  INSERT INTO public.session_activity_attributions
    (enrollment_id,module,source_activity_type,source_activity_id,occurred_on,milestone_id)
  VALUES (p_enrollment_id,p_module::public.programme_module_type,source_type,p_activity_id,p_occurred_on,milestone)
  ON CONFLICT (source_activity_type,source_activity_id,enrollment_id) DO NOTHING;
  RETURN milestone;
END $$;
REVOKE ALL ON FUNCTION public.attribute_activity_to_cadence_milestone(uuid,text,uuid,date) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attribute_activity_to_cadence_milestone(uuid,text,uuid,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.attribute_new_activity_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_TABLE_NAME='sessions' AND NEW.enrollment_id IS NOT NULL THEN
    PERFORM public.attribute_activity_to_cadence_milestone(NEW.enrollment_id,'coaching',NEW.id,NEW.start_time::date);
  ELSIF TG_TABLE_NAME IN ('peer_sessions','coachee_peer_sessions') AND NEW.enrollment_id IS NOT NULL THEN
    PERFORM public.attribute_activity_to_cadence_milestone(NEW.enrollment_id,'peer_coaching',NEW.id,NEW.start_time::date);
  ELSIF TG_TABLE_NAME='mentoring_sessions' AND NEW.enrollment_id IS NOT NULL THEN
    PERFORM public.attribute_activity_to_cadence_milestone(NEW.enrollment_id,'mentoring',NEW.id,NEW.start_time::date);
  ELSIF TG_TABLE_NAME='training_progress' AND NEW.enrollment_id IS NOT NULL AND NEW.completed_at IS NOT NULL THEN
    PERFORM public.attribute_activity_to_cadence_milestone(NEW.enrollment_id,'training',NEW.id,NEW.completed_at::date);
  ELSIF TG_TABLE_NAME='assignment_submissions' AND NEW.enrollment_id IS NOT NULL AND NEW.submitted_at IS NOT NULL THEN
    PERFORM public.attribute_activity_to_cadence_milestone(NEW.enrollment_id,'quiz',NEW.id,NEW.submitted_at::date);
  ELSIF TG_TABLE_NAME='daily_prompt_responses' AND NEW.enrollment_id IS NOT NULL AND NEW.responded_at IS NOT NULL THEN
    PERFORM public.attribute_activity_to_cadence_milestone(NEW.enrollment_id,'daily_prompt',NEW.id,NEW.responded_at::date);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sessions_attribute_activity AFTER INSERT ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.attribute_new_activity_trigger();
CREATE TRIGGER peer_sessions_attribute_activity AFTER INSERT ON public.peer_sessions FOR EACH ROW EXECUTE FUNCTION public.attribute_new_activity_trigger();
CREATE TRIGGER coachee_peer_sessions_attribute_activity AFTER INSERT ON public.coachee_peer_sessions FOR EACH ROW EXECUTE FUNCTION public.attribute_new_activity_trigger();
CREATE TRIGGER mentoring_sessions_attribute_activity AFTER INSERT ON public.mentoring_sessions FOR EACH ROW EXECUTE FUNCTION public.attribute_new_activity_trigger();
CREATE TRIGGER training_progress_attribute_activity AFTER INSERT ON public.training_progress FOR EACH ROW EXECUTE FUNCTION public.attribute_new_activity_trigger();
CREATE TRIGGER assignment_submissions_attribute_activity AFTER INSERT ON public.assignment_submissions FOR EACH ROW EXECUTE FUNCTION public.attribute_new_activity_trigger();
CREATE TRIGGER daily_prompt_responses_attribute_activity AFTER INSERT ON public.daily_prompt_responses FOR EACH ROW EXECUTE FUNCTION public.attribute_new_activity_trigger();
CREATE TRIGGER training_progress_attribute_activity_update AFTER UPDATE OF completed_at ON public.training_progress
  FOR EACH ROW WHEN (NEW.completed_at IS NOT NULL AND (OLD.completed_at IS NULL OR OLD.completed_at IS DISTINCT FROM NEW.completed_at))
  EXECUTE FUNCTION public.attribute_new_activity_trigger();

CREATE OR REPLACE FUNCTION public.attribute_new_triad_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.coach_enrollment_id IS NOT NULL THEN
    PERFORM public.attribute_activity_to_cadence_milestone(NEW.coach_enrollment_id,'triads',NEW.id,coalesce(NEW.start_time,NEW.proposed_start_time)::date);
  END IF;
  IF NEW.coachee_enrollment_id IS NOT NULL THEN
    PERFORM public.attribute_activity_to_cadence_milestone(NEW.coachee_enrollment_id,'triads',NEW.id,coalesce(NEW.start_time,NEW.proposed_start_time)::date);
  END IF;
  IF NEW.observer_enrollment_id IS NOT NULL THEN
    PERFORM public.attribute_activity_to_cadence_milestone(NEW.observer_enrollment_id,'triads',NEW.id,coalesce(NEW.start_time,NEW.proposed_start_time)::date);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER triad_sessions_attribute_activity AFTER INSERT ON public.triad_sessions
  FOR EACH ROW EXECUTE FUNCTION public.attribute_new_triad_activity();

-- Progress only consumes attributed activity. This preserves retirement evidence
-- and excludes every unresolved legacy row, regardless of its nullable FK.
CREATE OR REPLACE FUNCTION public.get_enrollment_progress(p_enrollment_id uuid,p_as_of date DEFAULT current_date)
RETURNS TABLE(module public.programme_module_type,full_completion_pct numeric,due_adherence_pct numeric,pace_status text,completed_units integer,due_units integer,required_units integer,booked_units integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
WITH enrollment AS (
  SELECT e.*, c.organization_id AS cohort_organization_id
  FROM public.programme_enrollments e
  LEFT JOIN public.cohorts c ON c.id=e.cohort_id
  WHERE e.id=p_enrollment_id
), authorized AS (
  SELECT 1
  FROM enrollment e
  WHERE e.user_id=auth.uid()
     OR public.has_role(auth.uid(),'admin'::public.app_role)
     OR public.coach_has_client(auth.uid(),e.user_id)
     OR EXISTS (
       SELECT 1
       FROM public.sponsor_profiles sp
       WHERE sp.user_id=auth.uid()
         AND sp.organization_id=e.cohort_organization_id
         AND (
           SELECT count(*)
           FROM public.programme_enrollments ec
           LEFT JOIN public.cohorts ec_c ON ec_c.id=ec.cohort_id
           WHERE ec.cohort_id=e.cohort_id
             AND ec_c.organization_id=sp.organization_id
         ) >= public.sponsor_min_leaders_for_distribution()
     )
), snapshots AS (SELECT s.* FROM public.enrollment_module_snapshots s JOIN authorized ON true WHERE s.enrollment_id=p_enrollment_id),
activity AS (SELECT a.module,a.enrollment_id,coalesce(s.status::text,'completed') status,a.occurred_on FROM public.session_activity_attributions a
 LEFT JOIN public.sessions s ON a.source_activity_type='coaching' AND s.id=a.source_activity_id
 WHERE a.enrollment_id=p_enrollment_id
 UNION ALL SELECT a.module,a.enrollment_id,coalesce(s.status::text,'completed'),a.occurred_on FROM public.session_activity_attributions a LEFT JOIN public.peer_sessions s ON a.source_activity_type='peer_coaching' AND s.id=a.source_activity_id WHERE a.enrollment_id=p_enrollment_id
 UNION ALL SELECT a.module,a.enrollment_id,coalesce(s.status::text,'completed'),a.occurred_on FROM public.session_activity_attributions a LEFT JOIN public.coachee_peer_sessions s ON a.source_activity_type='peer_coaching' AND s.id=a.source_activity_id WHERE a.enrollment_id=p_enrollment_id
 UNION ALL SELECT a.module,a.enrollment_id,coalesce(s.status::text,'completed'),a.occurred_on FROM public.session_activity_attributions a LEFT JOIN public.mentoring_sessions s ON a.source_activity_type='mentoring' AND s.id=a.source_activity_id WHERE a.enrollment_id=p_enrollment_id
 UNION ALL SELECT a.module,a.enrollment_id,coalesce(s.status::text,'completed'),a.occurred_on FROM public.session_activity_attributions a LEFT JOIN public.triad_sessions s ON a.source_activity_type='triad' AND s.id=a.source_activity_id WHERE a.enrollment_id=p_enrollment_id
 UNION ALL SELECT a.module,a.enrollment_id,'completed',a.occurred_on FROM public.session_activity_attributions a WHERE a.source_activity_type IN ('training','quiz','daily_prompt') AND a.enrollment_id=p_enrollment_id),
counts AS (SELECT s.id,count(a.*) FILTER(WHERE a.status='completed' AND a.occurred_on<=p_as_of)::int completed,count(a.*) FILTER(WHERE a.status IN ('pending_coach_approval','confirmed') AND a.occurred_on>=p_as_of)::int booked FROM snapshots s LEFT JOIN activity a ON a.enrollment_id=s.enrollment_id AND a.module=s.module GROUP BY s.id),
due AS (SELECT s.id,coalesce(sum(m.required_units) FILTER(WHERE m.due_on<=p_as_of),0)::int units_due FROM snapshots s LEFT JOIN public.enrollment_module_milestones m ON m.enrollment_module_snapshot_id=s.id GROUP BY s.id)
SELECT s.module,CASE WHEN s.required_units=0 THEN NULL ELSE round(least(c.completed,s.required_units)*100.0/s.required_units,1) END,CASE WHEN d.units_due=0 THEN NULL ELSE round(least(c.completed,d.units_due)*100.0/d.units_due,1) END,CASE WHEN s.required_units=0 OR c.completed>=s.required_units THEN 'completed' WHEN d.units_due=0 THEN 'not_yet_due' WHEN c.completed>=d.units_due THEN CASE WHEN c.completed>d.units_due THEN 'ahead' ELSE 'on_track' END WHEN c.completed+c.booked>=d.units_due THEN 'scheduled' ELSE 'behind' END,c.completed,d.units_due,s.required_units,c.booked FROM snapshots s JOIN counts c ON c.id=s.id JOIN due d ON d.id=s.id;
$$;