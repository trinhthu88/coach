-- Enrollment-owned actions. Legacy JSON is migrated separately after its links
-- have been validated; this API never changes another source's action set.
CREATE OR REPLACE FUNCTION public.enrollment_activity_participants(
 p_enrollment_id uuid, p_source_activity_type text, p_source_activity_id uuid
) RETURNS TABLE(learner_id uuid, provider_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT s.coachee_id,s.coach_id FROM public.sessions s
 WHERE p_source_activity_type='coaching' AND s.id=p_source_activity_id AND s.enrollment_id=p_enrollment_id
 UNION ALL SELECT s.peer_coachee_id,s.peer_coach_id FROM public.peer_sessions s
 WHERE p_source_activity_type='peer_coaching' AND s.id=p_source_activity_id AND s.enrollment_id=p_enrollment_id
 UNION ALL SELECT s.peer_receiver_id,s.peer_provider_id FROM public.coachee_peer_sessions s
 WHERE p_source_activity_type='coachee_peer_coaching' AND s.id=p_source_activity_id AND s.enrollment_id=p_enrollment_id
 UNION ALL SELECT s.mentee_id,s.mentor_id FROM public.mentoring_sessions s
 WHERE p_source_activity_type='mentoring' AND s.id=p_source_activity_id AND s.enrollment_id=p_enrollment_id
$$;
REVOKE ALL ON FUNCTION public.enrollment_activity_participants(uuid,text,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.can_manage_enrollment_activity(
 p_enrollment_id uuid, p_source_activity_type text, p_source_activity_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.enrollment_activity_participants(p_enrollment_id,p_source_activity_type,p_source_activity_id) a
  WHERE auth.uid() IN (a.learner_id,a.provider_id) OR public.has_role(auth.uid(),'admin'::public.app_role)
 );
$$;
REVOKE ALL ON FUNCTION public.can_manage_enrollment_activity(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_enrollment_activity(uuid,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_enrollment_action() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE milestone public.coachee_milestones;
BEGIN
 IF TG_OP='UPDATE' AND (new.enrollment_id IS DISTINCT FROM old.enrollment_id
  OR new.owner_user_id IS DISTINCT FROM old.owner_user_id
  OR new.source_activity_type IS DISTINCT FROM old.source_activity_type
  OR new.source_activity_id IS DISTINCT FROM old.source_activity_id) THEN
  RAISE EXCEPTION 'Action enrollment, owner and source cannot be changed' USING ERRCODE='42501';
 END IF;
 PERFORM public.assert_enrollment_scope(new.enrollment_id,new.owner_user_id);
 IF new.goal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.coachee_goals g WHERE g.id=new.goal_id AND g.enrollment_id=new.enrollment_id) THEN
  RAISE EXCEPTION 'Action goal must belong to the action enrollment' USING ERRCODE='42501';
 END IF;
 IF new.milestone_id IS NOT NULL THEN
  SELECT * INTO milestone FROM public.coachee_milestones WHERE id=new.milestone_id AND enrollment_id=new.enrollment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Action milestone must belong to the action enrollment' USING ERRCODE='42501'; END IF;
  IF new.goal_id IS NULL THEN new.goal_id:=milestone.goal_id;
  ELSIF new.goal_id IS DISTINCT FROM milestone.goal_id THEN
   RAISE EXCEPTION 'Action milestone must belong to the action goal' USING ERRCODE='42501';
  END IF;
 END IF;
 IF (new.source_activity_type IS NULL) <> (new.source_activity_id IS NULL) THEN
  RAISE EXCEPTION 'Action source activity type and ID must be provided together' USING ERRCODE='P0001';
 END IF;
 IF new.source_activity_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.enrollment_activity_participants(new.enrollment_id,new.source_activity_type,new.source_activity_id) a WHERE a.learner_id=new.owner_user_id
 ) THEN RAISE EXCEPTION 'Action source must belong to the action enrollment' USING ERRCODE='42501'; END IF;
 IF nullif(btrim(new.title),'') IS NULL THEN RAISE EXCEPTION 'Action title is required' USING ERRCODE='P0001'; END IF;
 RETURN new;
END $$;

DROP POLICY IF EXISTS "Enrollment actions: activity participants manage" ON public.enrollment_actions;
CREATE POLICY "Enrollment actions: activity participants manage" ON public.enrollment_actions
FOR ALL TO authenticated
USING (public.can_manage_enrollment_activity(enrollment_id,source_activity_type,source_activity_id))
WITH CHECK (public.can_manage_enrollment_activity(enrollment_id,source_activity_type,source_activity_id));
CREATE INDEX IF NOT EXISTS enrollment_actions_source_idx ON public.enrollment_actions(enrollment_id,source_activity_type,source_activity_id);

CREATE OR REPLACE FUNCTION public.save_enrollment_activity_actions(
 p_enrollment_id uuid,p_source_activity_type text,p_source_activity_id uuid,p_actions jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item jsonb; action_id uuid; saved_ids uuid[]:='{}'; learner uuid; affected integer;
 action_goal uuid; action_milestone uuid; action_due date; action_status text; action_description text;
BEGIN
 IF NOT public.can_manage_enrollment_activity(p_enrollment_id,p_source_activity_type,p_source_activity_id) THEN
  RAISE EXCEPTION 'Not authorized to manage this activity' USING ERRCODE='42501';
 END IF;
 IF p_actions IS NULL OR jsonb_typeof(p_actions)<>'array' THEN
  RAISE EXCEPTION 'Actions must be an array' USING ERRCODE='P0001';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_enrollment_id::text||':'||p_source_activity_type||':'||p_source_activity_id::text,0));
 SELECT user_id INTO learner FROM public.programme_enrollments WHERE id=p_enrollment_id;
 FOR item IN SELECT value FROM jsonb_array_elements(p_actions) LOOP
  IF jsonb_typeof(item)<>'object' THEN RAISE EXCEPTION 'Action must be an object' USING ERRCODE='P0001'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(item) k
    WHERE k NOT IN ('id','title','description','status','due_date','goal_id','milestone_id')) THEN
   RAISE EXCEPTION 'Unknown action field' USING ERRCODE='P0001';
  END IF;
  IF jsonb_typeof(item->'title') <> 'string' OR nullif(btrim(item->>'title'),'') IS NULL
    OR length(item->>'title') > 500 THEN RAISE EXCEPTION 'Action title is invalid' USING ERRCODE='P0001'; END IF;
  IF item ? 'description' AND jsonb_typeof(item->'description') <> 'null' AND
    (jsonb_typeof(item->'description') <> 'string' OR length(item->>'description') > 2000) THEN
   RAISE EXCEPTION 'Action description is invalid' USING ERRCODE='P0001';
  END IF;
  IF item ? 'status' AND jsonb_typeof(item->'status') <> 'null' AND
    (jsonb_typeof(item->'status') <> 'string' OR item->>'status' NOT IN ('open','in_progress','completed','cancelled')) THEN
   RAISE EXCEPTION 'Action status is invalid' USING ERRCODE='P0001';
  END IF;
  IF item ? 'id' AND jsonb_typeof(item->'id') <> 'null' AND
    (jsonb_typeof(item->'id') <> 'string' OR item->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN
   RAISE EXCEPTION 'Action ID is invalid' USING ERRCODE='P0001';
  END IF;
  IF item ? 'goal_id' AND jsonb_typeof(item->'goal_id') <> 'null' AND
    (jsonb_typeof(item->'goal_id') <> 'string' OR item->>'goal_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN
   RAISE EXCEPTION 'Action goal ID is invalid' USING ERRCODE='P0001';
  END IF;
  IF item ? 'milestone_id' AND jsonb_typeof(item->'milestone_id') <> 'null' AND
    (jsonb_typeof(item->'milestone_id') <> 'string' OR item->>'milestone_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN
   RAISE EXCEPTION 'Action milestone ID is invalid' USING ERRCODE='P0001';
  END IF;
  IF item ? 'due_date' AND jsonb_typeof(item->'due_date') <> 'null' AND
    (jsonb_typeof(item->'due_date') <> 'string' OR item->>'due_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN
   RAISE EXCEPTION 'Action due date is invalid' USING ERRCODE='P0001';
  END IF;
  BEGIN
   action_id:=coalesce(nullif(item->>'id','')::uuid,gen_random_uuid());
   action_goal:=nullif(item->>'goal_id','')::uuid;
   action_milestone:=nullif(item->>'milestone_id','')::uuid;
   action_due:=nullif(item->>'due_date','')::date;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
   RAISE EXCEPTION 'Action UUID or date is invalid' USING ERRCODE='P0001';
  END;
  action_status:=coalesce(nullif(item->>'status',''),'open');
  action_description:=nullif(item->>'description','');
  IF action_id=ANY(saved_ids) THEN RAISE EXCEPTION 'Duplicate action ID' USING ERRCODE='P0001'; END IF;
  IF EXISTS(SELECT 1 FROM public.enrollment_actions a WHERE a.id=action_id AND
   (a.enrollment_id IS DISTINCT FROM p_enrollment_id OR a.source_activity_type IS DISTINCT FROM p_source_activity_type OR a.source_activity_id IS DISTINCT FROM p_source_activity_id)) THEN
   RAISE EXCEPTION 'Action ID belongs to another source or enrollment' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.enrollment_actions(id,enrollment_id,owner_user_id,source_activity_type,source_activity_id,title,description,status,due_date,goal_id,milestone_id,completed_at)
    VALUES(action_id,p_enrollment_id,learner,p_source_activity_type,p_source_activity_id,btrim(item->>'title'),action_description,
    action_status,action_due,action_goal,action_milestone,
   CASE WHEN action_status='completed' THEN now() END)
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,status=excluded.status,due_date=excluded.due_date,
   goal_id=excluded.goal_id,milestone_id=excluded.milestone_id,
   completed_at=CASE WHEN excluded.status='completed' THEN coalesce(enrollment_actions.completed_at,excluded.completed_at) ELSE NULL END
  WHERE enrollment_actions.enrollment_id=p_enrollment_id AND enrollment_actions.source_activity_type=p_source_activity_type AND enrollment_actions.source_activity_id=p_source_activity_id;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected=0 THEN RAISE EXCEPTION 'Action ID belongs to another source or enrollment' USING ERRCODE='42501'; END IF;
  saved_ids:=array_append(saved_ids,action_id);
 END LOOP;
 DELETE FROM public.enrollment_actions WHERE enrollment_id=p_enrollment_id AND source_activity_type=p_source_activity_type
 AND source_activity_id=p_source_activity_id AND NOT(id=ANY(saved_ids));
END $$;
REVOKE ALL ON FUNCTION public.save_enrollment_activity_actions(uuid,text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_enrollment_activity_actions(uuid,text,uuid,jsonb) TO authenticated;

-- Invalid dates or ownership links are reported without altering the original
-- JSON. Only explicit session enrollment ownership is used for this import.
CREATE TABLE IF NOT EXISTS public.enrollment_action_backfill_audit (
 source_activity_type text NOT NULL, source_activity_id uuid NOT NULL,
 item_ordinal integer NOT NULL, unresolved_reason text NOT NULL,
 PRIMARY KEY(source_activity_type,source_activity_id,item_ordinal)
);
ALTER TABLE public.enrollment_action_backfill_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Action backfill audit: admin read" ON public.enrollment_action_backfill_audit;
CREATE POLICY "Action backfill audit: admin read" ON public.enrollment_action_backfill_audit FOR SELECT TO authenticated
USING(public.has_role(auth.uid(),'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.backfill_enrollment_actions() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE activity record; entry record; item jsonb; action_id uuid; imported integer:=0; affected integer;
BEGIN
 FOR activity IN
  SELECT 'coaching'::text source_type,id,enrollment_id,coachee_id learner_id,action_items,created_at FROM public.sessions
  UNION ALL SELECT 'peer_coaching',id,enrollment_id,peer_coachee_id,action_items,created_at FROM public.peer_sessions
  UNION ALL SELECT 'coachee_peer_coaching',id,enrollment_id,peer_receiver_id,action_items,created_at FROM public.coachee_peer_sessions
  UNION ALL SELECT 'mentoring',id,enrollment_id,mentee_id,action_items,created_at FROM public.mentoring_sessions
 LOOP
  IF activity.action_items IS NULL OR activity.action_items='[]'::jsonb THEN CONTINUE; END IF;
  IF jsonb_typeof(activity.action_items)<>'array' THEN
   INSERT INTO public.enrollment_action_backfill_audit VALUES(activity.source_type,activity.id,0,'invalid action list')
   ON CONFLICT(source_activity_type,source_activity_id,item_ordinal) DO UPDATE SET unresolved_reason=excluded.unresolved_reason;
   CONTINUE;
  END IF;
  FOR entry IN SELECT value,ordinality FROM jsonb_array_elements(activity.action_items) WITH ORDINALITY LOOP
   BEGIN
    IF activity.enrollment_id IS NULL THEN RAISE EXCEPTION 'unresolved enrollment'; END IF;
    item:=CASE WHEN jsonb_typeof(entry.value)='string' THEN jsonb_build_object('text',entry.value#>>'{}') ELSE entry.value END;
    IF jsonb_typeof(item)<>'object' THEN RAISE EXCEPTION 'invalid action item'; END IF;
    action_id:=md5('enrollment-action:'||activity.source_type||':'||activity.id::text||':'||entry.ordinality::text)::uuid;
    INSERT INTO public.enrollment_actions(id,enrollment_id,owner_user_id,source_activity_type,source_activity_id,title,description,status,due_date,goal_id,milestone_id,created_at)
    VALUES(action_id,activity.enrollment_id,activity.learner_id,activity.source_type,activity.id,
     coalesce(item->>'text',item->>'title'),item->>'description',
     CASE WHEN coalesce((item->>'done')::boolean,false) THEN 'completed' ELSE 'open' END,
     nullif(item->>'due_date','')::date,nullif(item->>'goal_id','')::uuid,nullif(item->>'milestone_id','')::uuid,activity.created_at)
    ON CONFLICT(id) DO NOTHING;
    GET DIAGNOSTICS affected=ROW_COUNT;
    imported:=imported+affected;
    DELETE FROM public.enrollment_action_backfill_audit WHERE source_activity_type=activity.source_type AND source_activity_id=activity.id AND item_ordinal=entry.ordinality;
   EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.enrollment_action_backfill_audit VALUES(activity.source_type,activity.id,entry.ordinality,
      CASE WHEN activity.enrollment_id IS NULL THEN 'unresolved enrollment' ELSE 'invalid action fields or ownership ('||SQLSTATE||')' END)
    ON CONFLICT(source_activity_type,source_activity_id,item_ordinal) DO UPDATE SET unresolved_reason=excluded.unresolved_reason;
   END;
  END LOOP;
 END LOOP;
 RETURN imported;
END $$;
REVOKE ALL ON FUNCTION public.backfill_enrollment_actions() FROM PUBLIC,anon,authenticated;
SELECT public.backfill_enrollment_actions();
