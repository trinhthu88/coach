-- Retire only historical ownership records for which production evidence cannot
-- establish one valid enrollment. Original rows remain in their legacy tables;
-- this ledger makes the retirement explicit and auditable.

CREATE TABLE IF NOT EXISTS public.enrollment_ownership_retirements (
  domain text NOT NULL,
  record_id uuid NOT NULL,
  user_id uuid,
  parent_record_id uuid,
  source_activity_type text,
  source_activity_id uuid,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  retired_at timestamptz NOT NULL DEFAULT now(),
  migration_id text NOT NULL,
  PRIMARY KEY (domain, record_id)
);

COMMENT ON TABLE public.enrollment_ownership_retirements IS
  'Auditable retirement decisions for historical records without deterministic enrollment ownership.';

ALTER TABLE public.enrollment_ownership_retirements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.enrollment_ownership_retirements FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Ownership retirements: admin read"
  ON public.enrollment_ownership_retirements;
CREATE POLICY "Ownership retirements: admin read"
  ON public.enrollment_ownership_retirements
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.is_historical_ownership_retired(
  p_domain text,
  p_record_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.enrollment_ownership_retirements r
    WHERE r.domain = p_domain
      AND r.record_id = p_record_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_historical_ownership_retired(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_historical_ownership_retired(text, uuid)
  TO anon, authenticated;

DROP VIEW IF EXISTS public.enrollment_scope_backfill_audit;
CREATE VIEW public.enrollment_scope_backfill_audit WITH (security_invoker=true) AS
WITH candidates AS (
  SELECT 'sessions'::text table_name, s.id record_id, s.coachee_id user_id,
         count(pe.id)::int candidate_enrollments
  FROM public.sessions s
  LEFT JOIN public.programme_enrollments pe
    ON pe.user_id=s.coachee_id
   AND s.start_time::date>=pe.start_date
   AND (pe.end_date IS NULL OR s.start_time::date<=pe.end_date)
  WHERE s.enrollment_id IS NULL
    AND NOT public.is_historical_ownership_retired('sessions', s.id)
  GROUP BY s.id,s.coachee_id
  UNION ALL
  SELECT 'peer_sessions', s.id, s.peer_coachee_id, count(pe.id)::int
  FROM public.peer_sessions s
  LEFT JOIN public.programme_enrollments pe
    ON pe.user_id=s.peer_coachee_id
   AND s.start_time::date>=pe.start_date
   AND (pe.end_date IS NULL OR s.start_time::date<=pe.end_date)
  WHERE s.enrollment_id IS NULL
    AND NOT public.is_historical_ownership_retired('peer_sessions', s.id)
  GROUP BY s.id,s.peer_coachee_id
  UNION ALL
  SELECT 'coachee_peer_sessions', s.id, s.peer_receiver_id, count(pe.id)::int
  FROM public.coachee_peer_sessions s
  LEFT JOIN public.programme_enrollments pe
    ON pe.user_id=s.peer_receiver_id
   AND s.start_time::date>=pe.start_date
   AND (pe.end_date IS NULL OR s.start_time::date<=pe.end_date)
  WHERE s.enrollment_id IS NULL
    AND NOT public.is_historical_ownership_retired('coachee_peer_sessions', s.id)
  GROUP BY s.id,s.peer_receiver_id
  UNION ALL
  SELECT 'mentoring_sessions', s.id, s.mentee_id, count(pe.id)::int
  FROM public.mentoring_sessions s
  LEFT JOIN public.programme_enrollments pe
    ON pe.user_id=s.mentee_id
   AND s.start_time::date>=pe.start_date
   AND (pe.end_date IS NULL OR s.start_time::date<=pe.end_date)
  WHERE s.enrollment_id IS NULL
    AND NOT public.is_historical_ownership_retired('mentoring_sessions', s.id)
  GROUP BY s.id,s.mentee_id
  UNION ALL
  SELECT 'training_progress', tp.id, tp.user_id, count(pe.id)::int
  FROM public.training_progress tp
  JOIN public.training_weeks tw ON tw.id=tp.training_week_id
  LEFT JOIN public.programme_enrollments pe
    ON pe.user_id=tp.user_id AND pe.programme_id=tw.programme_id
  WHERE tp.enrollment_id IS NULL
    AND NOT public.is_historical_ownership_retired('training_progress', tp.id)
  GROUP BY tp.id,tp.user_id
  UNION ALL
  SELECT 'assignment_submissions', sub.id, sub.user_id, count(pe.id)::int
  FROM public.assignment_submissions sub
  JOIN public.assignments a ON a.id=sub.assignment_id
  JOIN public.training_weeks tw ON tw.id=a.training_week_id
  LEFT JOIN public.programme_enrollments pe
    ON pe.user_id=sub.user_id AND pe.programme_id=tw.programme_id
  WHERE sub.enrollment_id IS NULL
    AND NOT public.is_historical_ownership_retired('assignment_submissions', sub.id)
  GROUP BY sub.id,sub.user_id
  UNION ALL
  SELECT 'daily_prompt_responses', r.id, r.user_id, count(pe.id)::int
  FROM public.daily_prompt_responses r
  JOIN public.daily_prompts p ON p.id=r.daily_prompt_id
  JOIN public.training_weeks tw ON tw.id=p.training_week_id
  LEFT JOIN public.programme_enrollments pe
    ON pe.user_id=r.user_id AND pe.programme_id=tw.programme_id
  WHERE r.enrollment_id IS NULL
    AND NOT public.is_historical_ownership_retired('daily_prompt_responses', r.id)
  GROUP BY r.id,r.user_id
  UNION ALL
  SELECT 'reflection_submissions', sub.id, sub.user_id, count(pe.id)::int
  FROM public.reflection_submissions sub
  JOIN public.programme_reflections pr ON pr.id=sub.reflection_id
  LEFT JOIN public.programme_enrollments pe
    ON pe.user_id=sub.user_id AND pe.programme_id=pr.programme_id
  WHERE sub.enrollment_id IS NULL
    AND NOT public.is_historical_ownership_retired('reflection_submissions', sub.id)
  GROUP BY sub.id,sub.user_id
  UNION ALL
  SELECT 'coachee_goals', g.id, g.coachee_id, count(pe.id)::int
  FROM public.coachee_goals g
  LEFT JOIN public.programme_enrollments pe ON pe.user_id=g.coachee_id
  WHERE g.enrollment_id IS NULL
    AND NOT public.is_historical_ownership_retired('coachee_goals', g.id)
  GROUP BY g.id,g.coachee_id
  UNION ALL
  SELECT 'coachee_milestones', m.id, m.coachee_id, count(pe.id)::int
  FROM public.coachee_milestones m
  LEFT JOIN public.programme_enrollments pe ON pe.user_id=m.coachee_id
  WHERE m.enrollment_id IS NULL
    AND NOT public.is_historical_ownership_retired('coachee_milestones', m.id)
  GROUP BY m.id,m.coachee_id
  UNION ALL
  SELECT 'coachee_goal_ratings', r.id, r.coachee_id, count(pe.id)::int
  FROM public.coachee_goal_ratings r
  LEFT JOIN public.programme_enrollments pe ON pe.user_id=r.coachee_id
  WHERE r.enrollment_id IS NULL
    AND NOT public.is_historical_ownership_retired('coachee_goal_ratings', r.id)
  GROUP BY r.id,r.coachee_id
  UNION ALL
  SELECT 'triad_groups', g.id, g.member_1_id,
    (SELECT count(*)::int
     FROM public.programme_enrollments pe
     WHERE pe.user_id=g.member_1_id AND pe.programme_id=g.programme_id)
  FROM public.triad_groups g
  WHERE g.enrollment_1_id IS NULL
    AND NOT public.is_historical_ownership_retired('triad_groups', g.id)
  UNION ALL
  SELECT 'triad_sessions', s.id, NULL::uuid, 0
  FROM public.triad_sessions s
  WHERE (s.coach_enrollment_id IS NULL OR s.coachee_enrollment_id IS NULL)
    AND NOT public.is_historical_ownership_retired('triad_sessions', s.id)
  UNION ALL
  SELECT 'triad_reflections', r.id, r.participant_id, 0
  FROM public.triad_reflections r
  WHERE r.enrollment_id IS NULL
    AND NOT public.is_historical_ownership_retired('triad_reflections', r.id)
)
SELECT table_name, record_id, user_id, candidate_enrollments,
       CASE WHEN candidate_enrollments = 0 THEN 'orphaned' ELSE 'ambiguous' END AS unresolved_reason
FROM candidates;

CREATE OR REPLACE FUNCTION public.backfill_enrollment_actions() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE activity record; entry record; item jsonb; action_id uuid; imported integer:=0; affected integer;
BEGIN
  FOR activity IN
   SELECT 'coaching'::text source_type,id,enrollment_id,coachee_id learner_id,action_items,created_at
   FROM public.sessions
   WHERE NOT public.is_historical_ownership_retired('sessions', id)
   UNION ALL
   SELECT 'peer_coaching',id,enrollment_id,peer_coachee_id,action_items,created_at
   FROM public.peer_sessions
   WHERE NOT public.is_historical_ownership_retired('peer_sessions', id)
   UNION ALL
   SELECT 'coachee_peer_coaching',id,enrollment_id,peer_receiver_id,action_items,created_at
   FROM public.coachee_peer_sessions
   WHERE NOT public.is_historical_ownership_retired('coachee_peer_sessions', id)
   UNION ALL
   SELECT 'mentoring',id,enrollment_id,mentee_id,action_items,created_at
   FROM public.mentoring_sessions
   WHERE NOT public.is_historical_ownership_retired('mentoring_sessions', id)
  LOOP
   IF activity.action_items IS NULL OR activity.action_items='[]'::jsonb THEN CONTINUE; END IF;
   IF jsonb_typeof(activity.action_items)<>'array' THEN
    INSERT INTO public.enrollment_action_backfill_audit
      VALUES(activity.source_type,activity.id,0,'invalid action list')
    ON CONFLICT(source_activity_type,source_activity_id,item_ordinal)
    DO UPDATE SET unresolved_reason=excluded.unresolved_reason;
    CONTINUE;
   END IF;
   FOR entry IN
     SELECT value,ordinality
     FROM jsonb_array_elements(activity.action_items) WITH ORDINALITY
   LOOP
    BEGIN
     IF activity.enrollment_id IS NULL THEN RAISE EXCEPTION 'unresolved enrollment'; END IF;
     item:=CASE WHEN jsonb_typeof(entry.value)='string'
       THEN jsonb_build_object('text',entry.value#>>'{}') ELSE entry.value END;
     IF jsonb_typeof(item)<>'object' THEN RAISE EXCEPTION 'invalid action item'; END IF;
     action_id:=md5('enrollment-action:'||activity.source_type||':'||
       activity.id::text||':'||entry.ordinality::text)::uuid;
     INSERT INTO public.enrollment_actions(
       id,enrollment_id,owner_user_id,source_activity_type,source_activity_id,
       title,description,status,due_date,goal_id,milestone_id,created_at
     )
     VALUES(
       action_id,activity.enrollment_id,activity.learner_id,activity.source_type,
       activity.id,coalesce(item->>'text',item->>'title'),item->>'description',
       CASE WHEN coalesce((item->>'done')::boolean,false)
         THEN 'completed' ELSE 'open' END,
       nullif(item->>'due_date','')::date,nullif(item->>'goal_id','')::uuid,
       nullif(item->>'milestone_id','')::uuid,activity.created_at
     )
     ON CONFLICT(id) DO NOTHING;
     GET DIAGNOSTICS affected=ROW_COUNT;
     imported:=imported+affected;
     DELETE FROM public.enrollment_action_backfill_audit
      WHERE source_activity_type=activity.source_type
        AND source_activity_id=activity.id
        AND item_ordinal=entry.ordinality;
    EXCEPTION WHEN OTHERS THEN
     INSERT INTO public.enrollment_action_backfill_audit
       VALUES(
         activity.source_type,activity.id,entry.ordinality,
         CASE WHEN activity.enrollment_id IS NULL THEN 'unresolved enrollment'
           ELSE 'invalid action fields or ownership ('||SQLSTATE||')' END
       )
     ON CONFLICT(source_activity_type,source_activity_id,item_ordinal)
     DO UPDATE SET unresolved_reason=excluded.unresolved_reason;
    END;
   END LOOP;
  END LOOP;
  RETURN imported;
END $$;

REVOKE ALL ON FUNCTION public.backfill_enrollment_actions()
  FROM PUBLIC,anon,authenticated;

WITH approved_retirements(
  domain,record_id,user_id,parent_record_id,source_activity_type,
  source_activity_id,reason,evidence,migration_id
) AS (
  VALUES
  (
    'coachee_goals',
    'ea31acdd-c0d7-482a-bcf2-2824bb4c6d52'::uuid,
    '3a25993d-0dd1-4350-bea7-8b2c13e8413f'::uuid,
    NULL::uuid,NULL::text,NULL::uuid,
    'predates all provable enrollment history',
    jsonb_build_object(
      'title','goal 1','created_at','2026-04-30T16:07:55.235925Z',
      'target_date',NULL,
      'candidate_enrollments',jsonb_build_array(
        jsonb_build_object('id','dda90c8c-d640-43dd-b1c5-e754925fb466','programme','Growth','start_date','2026-08-07','end_date','2026-09-03'),
        jsonb_build_object('id','68426342-289a-4b04-aa61-e8ce12fd6f31','programme','TASC - Essential Course','start_date','2026-09-08','end_date','2026-10-06')
      )
    ),
    '20260911190000_retire_unresolved_historical_ownership'
  ),
  (
    'coachee_goals',
    'd8afd1c3-fc5b-47c1-a8e6-484ed373e180'::uuid,
    '3a25993d-0dd1-4350-bea7-8b2c13e8413f'::uuid,
    NULL::uuid,NULL::text,NULL::uuid,
    'predates all provable enrollment history',
    jsonb_build_object(
      'title','goal 2','created_at','2026-04-30T16:12:53.971219Z',
      'target_date','2026-05-24',
      'candidate_enrollments',jsonb_build_array(
        jsonb_build_object('id','dda90c8c-d640-43dd-b1c5-e754925fb466','programme','Growth','start_date','2026-08-07','end_date','2026-09-03'),
        jsonb_build_object('id','68426342-289a-4b04-aa61-e8ce12fd6f31','programme','TASC - Essential Course','start_date','2026-09-08','end_date','2026-10-06')
      )
    ),
    '20260911190000_retire_unresolved_historical_ownership'
  ),
  (
    'coachee_milestones',
    '09b1a839-7c3f-41a5-8406-842607d57f52'::uuid,
    '3a25993d-0dd1-4350-bea7-8b2c13e8413f'::uuid,
    'ea31acdd-c0d7-482a-bcf2-2824bb4c6d52'::uuid,NULL::text,NULL::uuid,
    'parent goal has no provable enrollment',
    jsonb_build_object('title','m2','goal_id','ea31acdd-c0d7-482a-bcf2-2824bb4c6d52','target_date',NULL),
    '20260911190000_retire_unresolved_historical_ownership'
  ),
  (
    'coachee_milestones',
    '8520cc10-4ff1-4be4-9055-5ae26a252f00'::uuid,
    '3a25993d-0dd1-4350-bea7-8b2c13e8413f'::uuid,
    'ea31acdd-c0d7-482a-bcf2-2824bb4c6d52'::uuid,
    'peer_coaching','56afd064-c162-440b-b66c-edaf317f605f'::uuid,
    'parent goal has no provable enrollment',
    jsonb_build_object('title','m 1','goal_id','ea31acdd-c0d7-482a-bcf2-2824bb4c6d52','is_done',true,'target_date',NULL),
    '20260911190000_retire_unresolved_historical_ownership'
  ),
  (
    'coachee_milestones',
    '9f8ff19a-0fc6-40e7-9a88-e50474c19289'::uuid,
    '3a25993d-0dd1-4350-bea7-8b2c13e8413f'::uuid,
    'ea31acdd-c0d7-482a-bcf2-2824bb4c6d52'::uuid,NULL::text,NULL::uuid,
    'parent goal has no provable enrollment',
    jsonb_build_object('title','m6','goal_id','ea31acdd-c0d7-482a-bcf2-2824bb4c6d52','target_date',NULL),
    '20260911190000_retire_unresolved_historical_ownership'
  ),
  (
    'coachee_milestones',
    '1f3540cf-5a01-4dd7-843a-254a3149afd3'::uuid,
    '3a25993d-0dd1-4350-bea7-8b2c13e8413f'::uuid,
    'd8afd1c3-fc5b-47c1-a8e6-484ed373e180'::uuid,NULL::text,NULL::uuid,
    'parent goal has no provable enrollment',
    jsonb_build_object('title','m 4','goal_id','d8afd1c3-fc5b-47c1-a8e6-484ed373e180','target_date','2026-05-10'),
    '20260911190000_retire_unresolved_historical_ownership'
  ),
  (
    'peer_sessions',
    '56afd064-c162-440b-b66c-edaf317f605f'::uuid,
    '3a25993d-0dd1-4350-bea7-8b2c13e8413f'::uuid,
    NULL::uuid,'peer_coaching','56afd064-c162-440b-b66c-edaf317f605f'::uuid,
    'activity predates all provable learner enrollment history',
    jsonb_build_object('provider_id','e4bb3ea4-62da-4c2f-b43a-43ed67b68edd','start_time','2026-04-30T03:15:00Z','status','completed','topic','test peer'),
    '20260911190000_retire_unresolved_historical_ownership'
  ),
  (
    'peer_sessions',
    '63b8334d-66dc-4e68-8ecf-d1229c042380'::uuid,
    '3a25993d-0dd1-4350-bea7-8b2c13e8413f'::uuid,
    NULL::uuid,'peer_coaching','63b8334d-66dc-4e68-8ecf-d1229c042380'::uuid,
    'activity predates all provable learner enrollment history',
    jsonb_build_object('provider_id','e4bb3ea4-62da-4c2f-b43a-43ed67b68edd','start_time','2026-05-17T02:15:00Z','status','confirmed','topic','peer test'),
    '20260911190000_retire_unresolved_historical_ownership'
  ),
  (
    'sessions',
    '246e2936-8774-4cdc-b967-bbcd2bf3a929'::uuid,
    '517cc37e-27a4-4fce-adbb-1857b98bcbd1'::uuid,
    NULL::uuid,'coaching','246e2936-8774-4cdc-b967-bbcd2bf3a929'::uuid,
    'activity predates all provable learner enrollment history',
    jsonb_build_object('provider_id','e4bb3ea4-62da-4c2f-b43a-43ed67b68edd','start_time','2026-04-30T02:15:00Z','status','completed','topic','leadership'),
    '20260911190000_retire_unresolved_historical_ownership'
  ),
  (
    'triad_reflections',
    '157da989-e0e7-4a40-9695-a482bbc44fa5'::uuid,
    '2301ff0d-2911-4e73-b14b-c9b91d75a047'::uuid,
    'e0000000-0000-0000-0000-000000000030'::uuid,'triad','e0000000-0000-0000-0000-000000000030'::uuid,
    'participant is not a stored triad role and has no enrollment in the triad programme/cohort',
    jsonb_build_object('triad_group_id','f0000000-0000-0000-0000-000000000001','programme_id','bf6631ae-59d5-40d6-aba2-c92a192b0b10','cohort_id','a0000000-0000-0000-0000-000000000002','participant_id','2301ff0d-2911-4e73-b14b-c9b91d75a047','member_ids',jsonb_build_array('3a25993d-0dd1-4350-bea7-8b2c13e8413f','8b64850f-b987-4e79-87c9-b13823a9d4f3','0c1a2a63-1d3f-49c0-b122-9b3ff0bf8c28')),
    '20260911190000_retire_unresolved_historical_ownership'
  ),
  (
    'triad_reflections',
    '80375f58-7a46-4ef9-bbea-9f0781e82a7a'::uuid,
    '770f4ce0-e3aa-44ac-a268-8516e683cdc8'::uuid,
    'e0000000-0000-0000-0000-000000000030'::uuid,'triad','e0000000-0000-0000-0000-000000000030'::uuid,
    'participant is not a stored triad role and has no enrollment in the triad programme/cohort',
    jsonb_build_object('triad_group_id','f0000000-0000-0000-0000-000000000001','programme_id','bf6631ae-59d5-40d6-aba2-c92a192b0b10','cohort_id','a0000000-0000-0000-0000-000000000002','participant_id','770f4ce0-e3aa-44ac-a268-8516e683cdc8','member_ids',jsonb_build_array('3a25993d-0dd1-4350-bea7-8b2c13e8413f','8b64850f-b987-4e79-87c9-b13823a9d4f3','0c1a2a63-1d3f-49c0-b122-9b3ff0bf8c28')),
    '20260911190000_retire_unresolved_historical_ownership'
  ),
  (
    'triad_reflections',
    'f2886392-4aa1-49d9-be5f-43d38f81c3fd'::uuid,
    '9626b57c-5aeb-406c-b520-b467588cd7c7'::uuid,
    'e0000000-0000-0000-0000-000000000030'::uuid,'triad','e0000000-0000-0000-0000-000000000030'::uuid,
    'participant is not a stored triad role and has no enrollment in the triad programme/cohort',
    jsonb_build_object('triad_group_id','f0000000-0000-0000-0000-000000000001','programme_id','bf6631ae-59d5-40d6-aba2-c92a192b0b10','cohort_id','a0000000-0000-0000-0000-000000000002','participant_id','9626b57c-5aeb-406c-b520-b467588cd7c7','member_ids',jsonb_build_array('3a25993d-0dd1-4350-bea7-8b2c13e8413f','8b64850f-b987-4e79-87c9-b13823a9d4f3','0c1a2a63-1d3f-49c0-b122-9b3ff0bf8c28')),
    '20260911190000_retire_unresolved_historical_ownership'
  ),
  (
    'actions/peer_coaching',
    '56afd064-c162-440b-b66c-edaf317f605f'::uuid,
    '3a25993d-0dd1-4350-bea7-8b2c13e8413f'::uuid,
    '8520cc10-4ff1-4be4-9055-5ae26a252f00'::uuid,'peer_coaching','56afd064-c162-440b-b66c-edaf317f605f'::uuid,
    'source peer session is retired and the action has no independent enrollment evidence',
    jsonb_build_object('item_ordinal',1,'text','action 1','done',true,'due_date','2026-05-10','milestone_id','8520cc10-4ff1-4be4-9055-5ae26a252f00'),
    '20260911190000_retire_unresolved_historical_ownership'
  )
)
INSERT INTO public.enrollment_ownership_retirements(
  domain,record_id,user_id,parent_record_id,source_activity_type,
  source_activity_id,reason,evidence,migration_id
)
SELECT domain,record_id,user_id,parent_record_id,source_activity_type,
       source_activity_id,reason,evidence,migration_id
FROM approved_retirements
ON CONFLICT (domain,record_id) DO UPDATE SET
  user_id=excluded.user_id,
  parent_record_id=excluded.parent_record_id,
  source_activity_type=excluded.source_activity_type,
  source_activity_id=excluded.source_activity_id,
  reason=excluded.reason,
  evidence=excluded.evidence,
  migration_id=excluded.migration_id;

DELETE FROM public.enrollment_action_backfill_audit a
WHERE a.source_activity_type='peer_coaching'
  AND a.source_activity_id='56afd064-c162-440b-b66c-edaf317f605f'::uuid
  AND public.is_historical_ownership_retired('actions/peer_coaching', a.source_activity_id);