-- Batch 1 enrollment-scoped activity ownership cutover.
-- Deterministic backfills use unambiguous parent links first, then a single
-- matching enrollment candidate. Ambiguous or orphaned records remain null and
-- are reported by enrollment_scope_backfill_audit for manual review.

CREATE OR REPLACE FUNCTION public.only_enrollment_candidate(p_user_id uuid, p_programme_id uuid DEFAULT NULL, p_on date DEFAULT NULL)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(pe.id))[1] ELSE NULL END
  FROM public.programme_enrollments pe
  WHERE pe.user_id = p_user_id
    AND (p_programme_id IS NULL OR pe.programme_id = p_programme_id)
    AND (p_on IS NULL OR (p_on >= pe.start_date AND (pe.end_date IS NULL OR p_on <= pe.end_date)));
$$;

UPDATE public.sessions s
SET enrollment_id = public.only_enrollment_candidate(s.coachee_id, NULL, s.start_time::date)
WHERE s.enrollment_id IS NULL
  AND public.only_enrollment_candidate(s.coachee_id, NULL, s.start_time::date) IS NOT NULL;

UPDATE public.peer_sessions s
SET enrollment_id = public.only_enrollment_candidate(s.peer_coachee_id, NULL, s.start_time::date)
WHERE s.enrollment_id IS NULL
  AND public.only_enrollment_candidate(s.peer_coachee_id, NULL, s.start_time::date) IS NOT NULL;

UPDATE public.coachee_peer_sessions s
SET enrollment_id = public.only_enrollment_candidate(s.peer_receiver_id, NULL, s.start_time::date)
WHERE s.enrollment_id IS NULL
  AND public.only_enrollment_candidate(s.peer_receiver_id, NULL, s.start_time::date) IS NOT NULL;

UPDATE public.mentoring_sessions s
SET enrollment_id = public.only_enrollment_candidate(s.mentee_id, NULL, s.start_time::date)
WHERE s.enrollment_id IS NULL
  AND public.only_enrollment_candidate(s.mentee_id, NULL, s.start_time::date) IS NOT NULL;

UPDATE public.training_progress tp
SET enrollment_id = public.only_enrollment_candidate(tp.user_id, tw.programme_id, NULL)
FROM public.training_weeks tw
WHERE tp.training_week_id = tw.id
  AND tp.enrollment_id IS NULL
  AND public.only_enrollment_candidate(tp.user_id, tw.programme_id, NULL) IS NOT NULL;

-- Quiz submissions are immutable after scoring, including through the client.
-- The new enrollment_id is ownership metadata, not quiz content, so allow this
-- one deterministic migration update while holding the table lock.  The
-- trigger is restored before the migration completes and remains enforced for
-- all later writes.
ALTER TABLE public.assignment_submissions
  DISABLE TRIGGER trg_prevent_quiz_resubmission;

UPDATE public.assignment_submissions sub
SET enrollment_id = public.only_enrollment_candidate(sub.user_id, tw.programme_id, NULL)
FROM public.assignments a
JOIN public.training_weeks tw ON tw.id = a.training_week_id
WHERE sub.assignment_id = a.id
  AND sub.enrollment_id IS NULL
  AND public.only_enrollment_candidate(sub.user_id, tw.programme_id, NULL) IS NOT NULL;

ALTER TABLE public.assignment_submissions
  ENABLE TRIGGER trg_prevent_quiz_resubmission;

UPDATE public.daily_prompt_responses r
SET enrollment_id = public.only_enrollment_candidate(r.user_id, tw.programme_id, NULL)
FROM public.daily_prompts p
JOIN public.training_weeks tw ON tw.id = p.training_week_id
WHERE r.daily_prompt_id = p.id
  AND r.enrollment_id IS NULL
  AND public.only_enrollment_candidate(r.user_id, tw.programme_id, NULL) IS NOT NULL;

UPDATE public.reflection_submissions sub
SET enrollment_id = public.only_enrollment_candidate(sub.user_id, pr.programme_id, NULL)
FROM public.programme_reflections pr
WHERE sub.reflection_id = pr.id
  AND sub.enrollment_id IS NULL
  AND public.only_enrollment_candidate(sub.user_id, pr.programme_id, NULL) IS NOT NULL;

UPDATE public.coachee_goals g
SET enrollment_id = public.only_enrollment_candidate(g.coachee_id, NULL, NULL)
WHERE g.enrollment_id IS NULL
  AND public.only_enrollment_candidate(g.coachee_id, NULL, NULL) IS NOT NULL;

UPDATE public.coachee_milestones m
SET enrollment_id = g.enrollment_id
FROM public.coachee_goals g
WHERE m.goal_id = g.id
  AND m.enrollment_id IS NULL
  AND g.enrollment_id IS NOT NULL;

UPDATE public.coachee_milestones m
SET enrollment_id = public.only_enrollment_candidate(m.coachee_id, NULL, NULL)
WHERE m.enrollment_id IS NULL
  AND public.only_enrollment_candidate(m.coachee_id, NULL, NULL) IS NOT NULL;

UPDATE public.coachee_goal_ratings r
SET enrollment_id = g.enrollment_id
FROM public.coachee_goals g
WHERE r.goal_id = g.id
  AND r.enrollment_id IS NULL
  AND g.enrollment_id IS NOT NULL;

UPDATE public.coachee_goal_ratings r
SET enrollment_id = public.only_enrollment_candidate(r.coachee_id, NULL, NULL)
WHERE r.enrollment_id IS NULL
  AND public.only_enrollment_candidate(r.coachee_id, NULL, NULL) IS NOT NULL;

UPDATE public.triad_groups g
SET enrollment_1_id = public.only_enrollment_candidate(g.member_1_id, g.programme_id, NULL),
    enrollment_2_id = public.only_enrollment_candidate(g.member_2_id, g.programme_id, NULL),
    enrollment_3_id = CASE WHEN g.member_3_id IS NULL THEN NULL ELSE public.only_enrollment_candidate(g.member_3_id, g.programme_id, NULL) END,
    cohort_id = coalesce(g.cohort_id, e1.cohort_id)
FROM public.programme_enrollments e1
WHERE e1.id = public.only_enrollment_candidate(g.member_1_id, g.programme_id, NULL)
  AND g.enrollment_1_id IS NULL
  AND public.only_enrollment_candidate(g.member_1_id, g.programme_id, NULL) IS NOT NULL
  AND public.only_enrollment_candidate(g.member_2_id, g.programme_id, NULL) IS NOT NULL
  AND (g.member_3_id IS NULL OR public.only_enrollment_candidate(g.member_3_id, g.programme_id, NULL) IS NOT NULL);

UPDATE public.triad_sessions s
SET coach_enrollment_id = g.enrollment_1_id,
    coachee_enrollment_id = g.enrollment_2_id,
    observer_enrollment_id = g.enrollment_3_id
FROM public.triad_groups g
WHERE s.triad_group_id = g.id
  AND s.coach_enrollment_id IS NULL
  AND g.enrollment_1_id IS NOT NULL
  AND g.enrollment_2_id IS NOT NULL;

UPDATE public.triad_reflections r
SET enrollment_id = CASE
  WHEN r.participant_id = g.member_1_id THEN g.enrollment_1_id
  WHEN r.participant_id = g.member_2_id THEN g.enrollment_2_id
  WHEN r.participant_id = g.member_3_id THEN g.enrollment_3_id
  ELSE NULL
END
FROM public.triad_sessions s
JOIN public.triad_groups g ON g.id = s.triad_group_id
WHERE r.triad_session_id = s.id
  AND r.enrollment_id IS NULL;

DROP VIEW IF EXISTS public.enrollment_scope_backfill_audit;
CREATE VIEW public.enrollment_scope_backfill_audit WITH (security_invoker=true) AS
WITH candidates AS (
  SELECT 'sessions'::text table_name, s.id record_id, s.coachee_id user_id, count(pe.id)::int candidate_enrollments
  FROM public.sessions s LEFT JOIN public.programme_enrollments pe ON pe.user_id=s.coachee_id AND s.start_time::date>=pe.start_date AND (pe.end_date IS NULL OR s.start_time::date<=pe.end_date)
  WHERE s.enrollment_id IS NULL GROUP BY s.id,s.coachee_id
  UNION ALL SELECT 'peer_sessions', s.id, s.peer_coachee_id, count(pe.id)::int FROM public.peer_sessions s LEFT JOIN public.programme_enrollments pe ON pe.user_id=s.peer_coachee_id AND s.start_time::date>=pe.start_date AND (pe.end_date IS NULL OR s.start_time::date<=pe.end_date) WHERE s.enrollment_id IS NULL GROUP BY s.id,s.peer_coachee_id
  UNION ALL SELECT 'coachee_peer_sessions', s.id, s.peer_receiver_id, count(pe.id)::int FROM public.coachee_peer_sessions s LEFT JOIN public.programme_enrollments pe ON pe.user_id=s.peer_receiver_id AND s.start_time::date>=pe.start_date AND (pe.end_date IS NULL OR s.start_time::date<=pe.end_date) WHERE s.enrollment_id IS NULL GROUP BY s.id,s.peer_receiver_id
  UNION ALL SELECT 'mentoring_sessions', s.id, s.mentee_id, count(pe.id)::int FROM public.mentoring_sessions s LEFT JOIN public.programme_enrollments pe ON pe.user_id=s.mentee_id AND s.start_time::date>=pe.start_date AND (pe.end_date IS NULL OR s.start_time::date<=pe.end_date) WHERE s.enrollment_id IS NULL GROUP BY s.id,s.mentee_id
  UNION ALL SELECT 'training_progress', tp.id, tp.user_id, count(pe.id)::int FROM public.training_progress tp JOIN public.training_weeks tw ON tw.id=tp.training_week_id LEFT JOIN public.programme_enrollments pe ON pe.user_id=tp.user_id AND pe.programme_id=tw.programme_id WHERE tp.enrollment_id IS NULL GROUP BY tp.id,tp.user_id
  UNION ALL SELECT 'assignment_submissions', sub.id, sub.user_id, count(pe.id)::int FROM public.assignment_submissions sub JOIN public.assignments a ON a.id=sub.assignment_id JOIN public.training_weeks tw ON tw.id=a.training_week_id LEFT JOIN public.programme_enrollments pe ON pe.user_id=sub.user_id AND pe.programme_id=tw.programme_id WHERE sub.enrollment_id IS NULL GROUP BY sub.id,sub.user_id
  UNION ALL SELECT 'daily_prompt_responses', r.id, r.user_id, count(pe.id)::int FROM public.daily_prompt_responses r JOIN public.daily_prompts p ON p.id=r.daily_prompt_id JOIN public.training_weeks tw ON tw.id=p.training_week_id LEFT JOIN public.programme_enrollments pe ON pe.user_id=r.user_id AND pe.programme_id=tw.programme_id WHERE r.enrollment_id IS NULL GROUP BY r.id,r.user_id
  UNION ALL SELECT 'reflection_submissions', sub.id, sub.user_id, count(pe.id)::int FROM public.reflection_submissions sub JOIN public.programme_reflections pr ON pr.id=sub.reflection_id LEFT JOIN public.programme_enrollments pe ON pe.user_id=sub.user_id AND pe.programme_id=pr.programme_id WHERE sub.enrollment_id IS NULL GROUP BY sub.id,sub.user_id
  UNION ALL SELECT 'coachee_goals', g.id, g.coachee_id, count(pe.id)::int FROM public.coachee_goals g LEFT JOIN public.programme_enrollments pe ON pe.user_id=g.coachee_id WHERE g.enrollment_id IS NULL GROUP BY g.id,g.coachee_id
  UNION ALL SELECT 'coachee_milestones', m.id, m.coachee_id, count(pe.id)::int FROM public.coachee_milestones m LEFT JOIN public.programme_enrollments pe ON pe.user_id=m.coachee_id WHERE m.enrollment_id IS NULL GROUP BY m.id,m.coachee_id
  UNION ALL SELECT 'coachee_goal_ratings', r.id, r.coachee_id, count(pe.id)::int FROM public.coachee_goal_ratings r LEFT JOIN public.programme_enrollments pe ON pe.user_id=r.coachee_id WHERE r.enrollment_id IS NULL GROUP BY r.id,r.coachee_id
  UNION ALL SELECT 'triad_groups', g.id, g.member_1_id,
    (SELECT count(*)::int FROM public.programme_enrollments pe WHERE pe.user_id = g.member_1_id AND pe.programme_id = g.programme_id)
    FROM public.triad_groups g WHERE g.enrollment_1_id IS NULL
  UNION ALL SELECT 'triad_sessions', s.id, NULL::uuid, 0
    FROM public.triad_sessions s WHERE s.coach_enrollment_id IS NULL OR s.coachee_enrollment_id IS NULL
  UNION ALL SELECT 'triad_reflections', r.id, r.participant_id, 0 FROM public.triad_reflections r WHERE r.enrollment_id IS NULL
)
SELECT table_name, record_id, user_id, candidate_enrollments,
       CASE WHEN candidate_enrollments = 0 THEN 'orphaned' ELSE 'ambiguous' END AS unresolved_reason
FROM candidates;

CREATE OR REPLACE FUNCTION public.validate_triad_group_enrollment_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  e1 public.programme_enrollments;
  e2 public.programme_enrollments;
  e3 public.programme_enrollments;
BEGIN
  IF new.enrollment_1_id IS NULL OR new.enrollment_2_id IS NULL OR (new.member_3_id IS NOT NULL AND new.enrollment_3_id IS NULL) THEN
    RAISE EXCEPTION 'Triad learner participants require enrollment ids' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO e1 FROM public.programme_enrollments WHERE id = new.enrollment_1_id;
  SELECT * INTO e2 FROM public.programme_enrollments WHERE id = new.enrollment_2_id;
  IF e1.id IS NULL OR e2.id IS NULL THEN
    RAISE EXCEPTION 'Triad participant enrollment not found' USING ERRCODE='P0001';
  END IF;
  IF e1.user_id <> new.member_1_id OR e2.user_id <> new.member_2_id THEN
    RAISE EXCEPTION 'Triad participant enrollment must match the learner' USING ERRCODE='42501';
  END IF;
  IF e1.programme_id <> new.programme_id OR e2.programme_id <> new.programme_id THEN
    RAISE EXCEPTION 'Triad participant enrollment must match the triad programme' USING ERRCODE='42501';
  END IF;
  IF e1.cohort_id IS DISTINCT FROM e2.cohort_id THEN
    RAISE EXCEPTION 'Triad participants must belong to the same cohort' USING ERRCODE='42501';
  END IF;
  IF new.member_3_id IS NOT NULL THEN
    SELECT * INTO e3 FROM public.programme_enrollments WHERE id = new.enrollment_3_id;
    IF NOT FOUND OR e3.user_id <> new.member_3_id THEN RAISE EXCEPTION 'Triad observer enrollment must match the learner' USING ERRCODE='42501'; END IF;
    IF e3.programme_id <> new.programme_id OR e3.cohort_id IS DISTINCT FROM e1.cohort_id THEN
      RAISE EXCEPTION 'Triad participants must belong to the same cohort' USING ERRCODE='42501';
    END IF;
  END IF;
  new.cohort_id := coalesce(new.cohort_id, e1.cohort_id);
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.validate_triad_session_enrollment_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g public.triad_groups;
BEGIN
  SELECT * INTO g FROM public.triad_groups WHERE id = new.triad_group_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Triad group not found' USING ERRCODE='P0001'; END IF;
  IF new.coach_enrollment_id IS NULL OR new.coachee_enrollment_id IS NULL THEN
    RAISE EXCEPTION 'Triad sessions require learner enrollment ids' USING ERRCODE='P0001';
  END IF;
  IF new.coach_enrollment_id NOT IN (g.enrollment_1_id, g.enrollment_2_id, g.enrollment_3_id)
     OR new.coachee_enrollment_id NOT IN (g.enrollment_1_id, g.enrollment_2_id, g.enrollment_3_id)
     OR (new.observer_enrollment_id IS NOT NULL AND new.observer_enrollment_id NOT IN (g.enrollment_1_id, g.enrollment_2_id, g.enrollment_3_id)) THEN
    RAISE EXCEPTION 'Triad session enrollments must belong to the triad group' USING ERRCODE='42501';
  END IF;
  IF (SELECT user_id FROM public.programme_enrollments WHERE id = new.coach_enrollment_id) <> g.member_1_id
     OR (SELECT user_id FROM public.programme_enrollments WHERE id = new.coachee_enrollment_id) <> g.member_2_id
     OR (g.member_3_id IS NULL AND new.observer_enrollment_id IS NOT NULL)
     OR (g.member_3_id IS NOT NULL AND (
       new.observer_enrollment_id IS NULL
       OR (SELECT user_id FROM public.programme_enrollments WHERE id = new.observer_enrollment_id) <> g.member_3_id
     )) THEN
    RAISE EXCEPTION 'Triad session enrollment must match its group member' USING ERRCODE='42501';
  END IF;
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS sessions_enrollment_activity_scope ON public.sessions;
CREATE TRIGGER sessions_enrollment_activity_scope BEFORE INSERT OR UPDATE OF enrollment_id, coachee_id ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.validate_enrollment_activity('coachee_id');
DROP TRIGGER IF EXISTS peer_sessions_enrollment_activity_scope ON public.peer_sessions;
CREATE TRIGGER peer_sessions_enrollment_activity_scope BEFORE INSERT OR UPDATE OF enrollment_id, peer_coachee_id ON public.peer_sessions FOR EACH ROW EXECUTE FUNCTION public.validate_enrollment_activity('peer_coachee_id');
DROP TRIGGER IF EXISTS coachee_peer_sessions_enrollment_activity_scope ON public.coachee_peer_sessions;
CREATE TRIGGER coachee_peer_sessions_enrollment_activity_scope BEFORE INSERT OR UPDATE OF enrollment_id, peer_receiver_id ON public.coachee_peer_sessions FOR EACH ROW EXECUTE FUNCTION public.validate_enrollment_activity('peer_receiver_id');
DROP TRIGGER IF EXISTS mentoring_sessions_enrollment_activity_scope ON public.mentoring_sessions;
CREATE TRIGGER mentoring_sessions_enrollment_activity_scope BEFORE INSERT OR UPDATE OF enrollment_id, mentee_id ON public.mentoring_sessions FOR EACH ROW EXECUTE FUNCTION public.validate_enrollment_activity('mentee_id');
DROP TRIGGER IF EXISTS training_progress_enrollment_activity_scope ON public.training_progress;
CREATE TRIGGER training_progress_enrollment_activity_scope BEFORE INSERT OR UPDATE OF enrollment_id, user_id ON public.training_progress FOR EACH ROW EXECUTE FUNCTION public.validate_enrollment_activity('user_id');
DROP TRIGGER IF EXISTS assignment_submissions_enrollment_activity_scope ON public.assignment_submissions;
CREATE TRIGGER assignment_submissions_enrollment_activity_scope BEFORE INSERT OR UPDATE OF enrollment_id, user_id ON public.assignment_submissions FOR EACH ROW EXECUTE FUNCTION public.validate_enrollment_activity('user_id');
DROP TRIGGER IF EXISTS daily_prompt_responses_enrollment_activity_scope ON public.daily_prompt_responses;
CREATE TRIGGER daily_prompt_responses_enrollment_activity_scope BEFORE INSERT OR UPDATE OF enrollment_id, user_id ON public.daily_prompt_responses FOR EACH ROW EXECUTE FUNCTION public.validate_enrollment_activity('user_id');
DROP TRIGGER IF EXISTS reflection_submissions_enrollment_activity_scope ON public.reflection_submissions;
CREATE TRIGGER reflection_submissions_enrollment_activity_scope BEFORE INSERT OR UPDATE OF enrollment_id, user_id ON public.reflection_submissions FOR EACH ROW EXECUTE FUNCTION public.validate_enrollment_activity('user_id');
DROP TRIGGER IF EXISTS triad_reflections_enrollment_activity_scope ON public.triad_reflections;
CREATE TRIGGER triad_reflections_enrollment_activity_scope BEFORE INSERT OR UPDATE OF enrollment_id, participant_id ON public.triad_reflections FOR EACH ROW EXECUTE FUNCTION public.validate_enrollment_activity('participant_id');
DROP TRIGGER IF EXISTS coachee_milestones_enrollment_activity_scope ON public.coachee_milestones;
CREATE TRIGGER coachee_milestones_enrollment_activity_scope BEFORE INSERT OR UPDATE OF enrollment_id, coachee_id ON public.coachee_milestones FOR EACH ROW EXECUTE FUNCTION public.validate_enrollment_activity('coachee_id');
DROP TRIGGER IF EXISTS coachee_goal_ratings_enrollment_activity_scope ON public.coachee_goal_ratings;
CREATE TRIGGER coachee_goal_ratings_enrollment_activity_scope BEFORE INSERT OR UPDATE OF enrollment_id, coachee_id ON public.coachee_goal_ratings FOR EACH ROW EXECUTE FUNCTION public.validate_enrollment_activity('coachee_id');
DROP TRIGGER IF EXISTS coachee_goals_enrollment_scope ON public.coachee_goals;
CREATE TRIGGER coachee_goals_enrollment_scope BEFORE INSERT OR UPDATE OF enrollment_id, coachee_id, target_date, status ON public.coachee_goals FOR EACH ROW EXECUTE FUNCTION public.validate_enrollment_goal();
DROP TRIGGER IF EXISTS triad_groups_enrollment_scope ON public.triad_groups;
CREATE TRIGGER triad_groups_enrollment_scope BEFORE INSERT OR UPDATE OF enrollment_1_id, enrollment_2_id, enrollment_3_id, member_1_id, member_2_id, member_3_id, programme_id ON public.triad_groups FOR EACH ROW EXECUTE FUNCTION public.validate_triad_group_enrollment_scope();
DROP TRIGGER IF EXISTS triad_sessions_enrollment_scope ON public.triad_sessions;
CREATE TRIGGER triad_sessions_enrollment_scope BEFORE INSERT OR UPDATE OF coach_enrollment_id, coachee_enrollment_id, observer_enrollment_id, triad_group_id ON public.triad_sessions FOR EACH ROW EXECUTE FUNCTION public.validate_triad_session_enrollment_scope();

-- Replace person-scoped uniqueness. Nullable enrollment_id keeps unresolved
-- historical rows insertable while the audit view is reviewed; populated rows
-- are unique per enrollment and activity, which matches PostgREST onConflict.
ALTER TABLE public.training_progress DROP CONSTRAINT IF EXISTS training_progress_user_id_training_week_id_key;
ALTER TABLE public.assignment_submissions DROP CONSTRAINT IF EXISTS assignment_submissions_assignment_id_user_id_key;
ALTER TABLE public.daily_prompt_responses DROP CONSTRAINT IF EXISTS daily_prompt_responses_daily_prompt_id_user_id_key;
ALTER TABLE public.reflection_submissions DROP CONSTRAINT IF EXISTS reflection_submissions_reflection_id_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS training_progress_enrollment_week_key ON public.training_progress(enrollment_id, training_week_id);
CREATE UNIQUE INDEX IF NOT EXISTS assignment_submissions_enrollment_assignment_key ON public.assignment_submissions(enrollment_id, assignment_id);
CREATE UNIQUE INDEX IF NOT EXISTS daily_prompt_responses_enrollment_prompt_key ON public.daily_prompt_responses(enrollment_id, daily_prompt_id);
CREATE UNIQUE INDEX IF NOT EXISTS reflection_submissions_enrollment_reflection_key ON public.reflection_submissions(enrollment_id, reflection_id);
CREATE UNIQUE INDEX IF NOT EXISTS coachee_goal_ratings_enrollment_goal_key ON public.coachee_goal_ratings(enrollment_id, goal_id);

REVOKE EXECUTE ON FUNCTION public.only_enrollment_candidate(uuid,uuid,date) FROM public, anon, authenticated;
