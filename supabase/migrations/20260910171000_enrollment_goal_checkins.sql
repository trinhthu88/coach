-- Unentered ratings remain unknown; preserve all existing recorded values.
ALTER TABLE public.coachee_goal_ratings
  ALTER COLUMN start_rating DROP NOT NULL,
  ALTER COLUMN start_rating DROP DEFAULT,
  ALTER COLUMN current_rating DROP NOT NULL,
  ALTER COLUMN current_rating DROP DEFAULT,
  ALTER COLUMN target_rating DROP NOT NULL,
  ALTER COLUMN target_rating DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.validate_enrollment_goal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
declare e public.programme_enrollments; active_count int;
begin
 select * into e from public.programme_enrollments where id=new.enrollment_id for update;
 if not found or e.user_id <> new.coachee_id then raise exception 'Goal must belong to its enrollment learner' using errcode='42501'; end if;
 if new.target_date is null then new.target_date:=e.end_date; end if;
 if new.target_date < e.start_date or (e.end_date is not null and new.target_date > e.end_date) then raise exception 'Goal target date must fall within enrollment dates' using errcode='P0001'; end if;
 if new.status='active' then
   select count(*) into active_count from public.coachee_goals where enrollment_id=new.enrollment_id and status='active' and id is distinct from new.id;
   if active_count >= 3 then raise exception 'This enrollment already has the maximum of 3 active goals' using errcode='P0001'; end if;
 end if; return new;
end $$;

-- Each save is an immutable event, including later corrections for the same activity.
ALTER TABLE public.goal_checkins DROP CONSTRAINT IF EXISTS goal_checkins_goal_id_source_activity_type_source_activity_id_key;
ALTER TABLE public.goal_checkins ADD COLUMN IF NOT EXISTS submission_id uuid;
-- A client keeps one submission_id across retries.  This makes a retry return
-- the original event, while a later save gets a new id and remains history.
CREATE UNIQUE INDEX IF NOT EXISTS goal_checkins_submission_unique
  ON public.goal_checkins(enrollment_id, source_activity_type, source_activity_id, goal_id, submission_id)
  WHERE submission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS goal_checkins_activity_history ON public.goal_checkins(enrollment_id, source_activity_type, source_activity_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.goal_checkin_submissions (
  submission_id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES public.profiles(id),
  enrollment_id uuid NOT NULL REFERENCES public.programme_enrollments(id),
  source_activity_type text NOT NULL,
  source_activity_id uuid NOT NULL,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.goal_checkin_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.goal_checkin_submissions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_goal_checkins(
  p_enrollment_id uuid, p_source_activity_type text, p_source_activity_id uuid,
  p_checkins jsonb, p_submission_id uuid DEFAULT gen_random_uuid()
)
RETURNS SETOF public.goal_checkins LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, pg_temp AS $$
declare item jsonb; g public.coachee_goals; r public.coachee_goal_ratings; result public.goal_checkins; submission uuid := coalesce(p_submission_id, gen_random_uuid()); existing_hash text; existing_actor uuid; existing_enrollment uuid; existing_source_type text; existing_source_id uuid; existing_payload jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.programme_enrollments e where e.id=p_enrollment_id and e.user_id=auth.uid()) then
    raise exception 'Only the learner can record a goal check-in' using errcode='42501';
  end if;
  if p_source_activity_type is null or p_source_activity_type not in ('coaching','mentoring','peer_coaching','triad') then
   raise exception 'Unsupported goal check-in source' using errcode='22023';
 end if;
  if p_source_activity_type = 'coaching' and not exists (select 1 from public.sessions s where s.id=p_source_activity_id and s.enrollment_id=p_enrollment_id and s.status='completed') then
    raise exception 'Coaching session is not a completed session in this enrollment' using errcode='42501';
  elsif p_source_activity_type = 'mentoring' and not exists (select 1 from public.mentoring_sessions s where s.id=p_source_activity_id and s.enrollment_id=p_enrollment_id and s.status='completed') then
    raise exception 'Mentoring session is not a completed session in this enrollment' using errcode='42501';
  elsif p_source_activity_type = 'peer_coaching' and not exists (select 1 from public.peer_sessions s where s.id=p_source_activity_id and s.enrollment_id=p_enrollment_id and s.status='completed' union all select 1 from public.coachee_peer_sessions s where s.id=p_source_activity_id and s.enrollment_id=p_enrollment_id and s.status='completed') then
    raise exception 'Peer-coaching session is not a completed session in this enrollment' using errcode='42501';
  elsif p_source_activity_type = 'triad' and not exists (select 1 from public.triad_sessions s where s.id=p_source_activity_id and p_enrollment_id in (s.coach_enrollment_id, s.coachee_enrollment_id, s.observer_enrollment_id) and s.status='completed') then
    raise exception 'Triad session is not a completed session in this enrollment' using errcode='42501';
 end if;
  if jsonb_typeof(p_checkins) <> 'array' then raise exception 'Check-ins must be a JSON array' using errcode='22023'; end if;
  if jsonb_array_length(p_checkins) = 0 then raise exception 'Check-ins must not be empty' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_checkins) x where jsonb_typeof(x) <> 'object' or not (x ? 'goal_id') or not (x ? 'new_rating')) then
    raise exception 'Each check-in must be an object with goal_id and new_rating' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_checkins) x where (x->>'goal_id') !~ '^[0-9a-fA-F-]{36}$') then raise exception 'goal_id must be a UUID' using errcode='22023'; end if;
  if exists (select 1 from (select (x->>'goal_id') goal_id, count(*) n from jsonb_array_elements(p_checkins) x group by 1 having count(*) > 1) d) then raise exception 'A goal may appear only once per submission' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_checkins) x where jsonb_typeof(x->'new_rating') <> 'null' and (jsonb_typeof(x->'new_rating') <> 'number' or (x->>'new_rating') !~ '^[0-9]+$' or (x->>'new_rating')::integer not between 0 and 100)) then raise exception 'new_rating must be null or an integer from 0 to 100' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_checkins) x where jsonb_typeof(x->'note') not in ('null','string') or length(x->>'note') > 5000) then raise exception 'note must be null or a string of at most 5000 characters' using errcode='22023'; end if;
  select payload_hash, actor_user_id, enrollment_id, source_activity_type, source_activity_id, payload
    into existing_hash, existing_actor, existing_enrollment, existing_source_type, existing_source_id, existing_payload
    from public.goal_checkin_submissions where submission_id=submission for update;
  if found then
    if existing_actor is distinct from auth.uid() or existing_enrollment is distinct from p_enrollment_id
      or existing_source_type is distinct from p_source_activity_type or existing_source_id is distinct from p_source_activity_id
      or existing_payload is distinct from p_checkins then
      raise exception 'Submission ID was already used with a different request' using errcode='22023';
    end if;
    for result in select gc.* from public.goal_checkins gc where gc.submission_id=submission order by gc.created_at loop return next result; end loop;
    return;
  end if;
  insert into public.goal_checkin_submissions(submission_id,actor_user_id,enrollment_id,source_activity_type,source_activity_id,payload_hash,payload)
  values(submission,auth.uid(),p_enrollment_id,p_source_activity_type,p_source_activity_id,md5(p_checkins::text),p_checkins)
  on conflict (submission_id) do nothing;
  select payload_hash, actor_user_id, enrollment_id, source_activity_type, source_activity_id, payload
    into existing_hash, existing_actor, existing_enrollment, existing_source_type, existing_source_id, existing_payload
    from public.goal_checkin_submissions where submission_id=submission;
  if existing_actor is distinct from auth.uid() or existing_enrollment is distinct from p_enrollment_id
    or existing_source_type is distinct from p_source_activity_type or existing_source_id is distinct from p_source_activity_id
    or existing_payload is distinct from p_checkins then
    raise exception 'Submission ID was already used with a different request' using errcode='22023';
  end if;
  if exists (select 1 from public.goal_checkins where submission_id=submission) then
    for result in select gc.* from public.goal_checkins gc where gc.submission_id=submission order by gc.created_at loop return next result; end loop;
    return;
  end if;
  for item in select value from jsonb_array_elements(p_checkins) loop
    select * into g from public.coachee_goals where id=(item->>'goal_id')::uuid and enrollment_id=p_enrollment_id and status='active' for update;
    if not found then raise exception 'Selected goal is not active for this enrollment' using errcode='P0001'; end if;
    select * into r from public.coachee_goal_ratings where goal_id=g.id and enrollment_id=p_enrollment_id for update;
    insert into public.goal_checkins(enrollment_id,goal_id,source_activity_type,source_activity_id,previous_rating,new_rating,note,actor_user_id,submission_id)
    values(p_enrollment_id,g.id,p_source_activity_type,p_source_activity_id,r.current_rating,
      (item->>'new_rating')::smallint,nullif(item->>'note',''),auth.uid(),submission)
    on conflict (enrollment_id,source_activity_type,source_activity_id,goal_id,submission_id)
      where submission_id is not null do nothing
    returning * into result;
    if not found then
      select * into result from public.goal_checkins where enrollment_id=p_enrollment_id and source_activity_type=p_source_activity_type and source_activity_id=p_source_activity_id and goal_id=g.id and submission_id=submission;
    elsif result.new_rating is not null then
      insert into public.coachee_goal_ratings(goal_id,coachee_id,enrollment_id,current_rating,current_updated_at)
      values(g.id,g.coachee_id,p_enrollment_id,result.new_rating,now())
      on conflict (enrollment_id,goal_id) do update set current_rating=excluded.current_rating,current_updated_at=excluded.current_updated_at;
    end if;
    return next result;
  end loop;
end $$;

CREATE OR REPLACE FUNCTION public.record_goal_checkin(p_enrollment_id uuid,p_goal_id uuid,p_source_activity_type text,p_source_activity_id uuid,p_new_rating smallint,p_note text default null)
RETURNS public.goal_checkins LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, pg_temp AS $$
declare result public.goal_checkins;
begin
  select * into result from public.record_goal_checkins(p_enrollment_id,p_source_activity_type,p_source_activity_id,
    jsonb_build_array(jsonb_build_object('goal_id',p_goal_id,'new_rating',p_new_rating,'note',p_note)));
  return result;
end $$;

DROP POLICY IF EXISTS "Goal checkins: assigned coaching provider view" ON public.goal_checkins;
CREATE POLICY "Goal checkins: assigned coaching provider view" ON public.goal_checkins FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sessions s WHERE s.id=source_activity_id AND source_activity_type='coaching' AND s.enrollment_id=goal_checkins.enrollment_id AND s.coach_id=auth.uid()));
DROP POLICY IF EXISTS "Goal checkins: assigned mentoring provider view" ON public.goal_checkins;
CREATE POLICY "Goal checkins: assigned mentoring provider view" ON public.goal_checkins FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mentoring_sessions s WHERE s.id=source_activity_id AND source_activity_type='mentoring' AND s.enrollment_id=goal_checkins.enrollment_id AND s.mentor_id=auth.uid()));
DROP POLICY IF EXISTS "Goal checkins: admin view" ON public.goal_checkins;
CREATE POLICY "Goal checkins: admin view" ON public.goal_checkins FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role));
REVOKE EXECUTE ON FUNCTION public.record_goal_checkins(uuid,text,uuid,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_goal_checkins(uuid,text,uuid,jsonb,uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.record_goal_checkin(uuid,uuid,text,uuid,smallint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_goal_checkin(uuid,uuid,text,uuid,smallint,text) TO authenticated;

