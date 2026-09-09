-- Clariva enrollment-scoped architecture, phase 1.
-- This migration is deliberately additive: legacy person-scoped columns remain
-- readable while writes move to enrollment_id.  The audit view is the gate for
-- a later NOT NULL migration.

CREATE OR REPLACE VIEW public.enrollment_ongoing_conflicts WITH (security_invoker=true) AS
  SELECT user_id, array_agg(id ORDER BY start_date, created_at) AS enrollment_ids,
         array_agg(status ORDER BY start_date, created_at) AS statuses
  FROM public.programme_enrollments
  WHERE status IN ('active', 'at_risk', 'paused')
  GROUP BY user_id
  HAVING count(*) > 1;

DO $$
DECLARE conflict_count integer;
BEGIN
  SELECT count(*) INTO conflict_count FROM public.enrollment_ongoing_conflicts;
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot enforce one ongoing enrollment: % user(s) have active, at-risk, or paused enrollments. Review public.enrollment_ongoing_conflicts and resolve them before rerunning this migration.', conflict_count USING ERRCODE = 'P0001';
  END IF;
END $$;

DROP INDEX IF EXISTS public.ux_programme_enrollments_one_active;
CREATE UNIQUE INDEX ux_programme_enrollments_one_ongoing
  ON public.programme_enrollments (user_id)
  WHERE status IN ('active', 'at_risk', 'paused');

ALTER TABLE public.programme_enrollments
  ADD CONSTRAINT programme_enrollment_dates_valid
  CHECK (end_date IS NULL OR end_date >= start_date) NOT VALID;

CREATE OR REPLACE FUNCTION public.validate_programme_enrollment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
begin
  if new.cohort_id is null then raise exception 'A programme enrollment requires a cohort' using errcode='P0001'; end if;
  if not exists(select 1 from public.cohorts c where c.id=new.cohort_id and c.programme_id=new.programme_id) then raise exception 'The selected cohort does not belong to the selected programme' using errcode='P0001'; end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.assert_enrollment_scope(
  p_enrollment_id uuid,
  p_user_id uuid,
  p_cohort_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare e public.programme_enrollments;
begin
  select * into e from public.programme_enrollments where id = p_enrollment_id;
  if not found then raise exception 'Enrollment not found' using errcode = 'P0001'; end if;
  if e.user_id <> p_user_id then
    raise exception 'Enrollment does not belong to the activity participant' using errcode = '42501';
  end if;
  if p_cohort_id is not null and e.cohort_id is distinct from p_cohort_id then
    raise exception 'Enrollment is not in the required cohort' using errcode = '42501';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.create_programme_enrollment(
  p_user_id uuid, p_programme_id uuid, p_cohort_id uuid, p_organization_id uuid,
  p_start_date date DEFAULT current_date, p_end_date date DEFAULT NULL
) RETURNS public.programme_enrollments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  existing public.programme_enrollments;
  result public.programme_enrollments;
  selected_cohort public.cohorts;
  effective_end_date date;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only an administrator can create enrolments' using errcode = '42501';
  end if;
  select * into selected_cohort from public.cohorts where id=p_cohort_id and programme_id=p_programme_id;
  if not found then
    raise exception 'The selected cohort does not belong to the selected programme' using errcode = 'P0001';
  end if;
  if selected_cohort.organization_id is distinct from p_organization_id then
    raise exception 'The selected organisation does not own the selected cohort' using errcode = '42501';
  end if;
  effective_end_date := coalesce(p_end_date, selected_cohort.end_date);
  if effective_end_date is null then
    raise exception 'An enrollment end date is required to create its schedule snapshot' using errcode = 'P0001';
  end if;
  if (selected_cohort.start_date is not null and p_start_date < selected_cohort.start_date)
     or (selected_cohort.end_date is not null and effective_end_date > selected_cohort.end_date)
     or effective_end_date < p_start_date then
    raise exception 'Enrollment dates must fall within the cohort dates' using errcode = 'P0001';
  end if;
  -- Serialize enrollment attempts for one identity. The partial unique index
  -- remains the final race-safe guard even for callers that bypass this RPC.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select pe.* into existing from public.programme_enrollments pe
   where pe.user_id=p_user_id and pe.status in ('active','at_risk','paused') for update;
  if found then
    raise exception '%', jsonb_build_object(
      'code','ongoing_enrollment_exists','enrollment_id',existing.id,
      'programme_id',existing.programme_id,'cohort_id',existing.cohort_id,
      'status',existing.status,'start_date',existing.start_date,'end_date',existing.end_date
    )::text using errcode = 'P0001';
  end if;
  insert into public.programme_enrollments(user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
  values(p_user_id,p_programme_id,p_cohort_id,p_organization_id,p_start_date,effective_end_date,'active') returning * into result;
  perform public.generate_enrollment_schedule(result.id);
  return result;
end $$;

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;
ALTER TABLE public.peer_sessions ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;
ALTER TABLE public.coachee_peer_sessions ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;
ALTER TABLE public.mentoring_sessions ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;
ALTER TABLE public.training_progress ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;
ALTER TABLE public.assignment_submissions ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;
ALTER TABLE public.daily_prompt_responses ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;
ALTER TABLE public.reflection_submissions ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;
ALTER TABLE public.triad_groups ADD COLUMN IF NOT EXISTS enrollment_1_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;
ALTER TABLE public.triad_groups ADD COLUMN IF NOT EXISTS enrollment_2_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;
ALTER TABLE public.triad_groups ADD COLUMN IF NOT EXISTS enrollment_3_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;
ALTER TABLE public.triad_sessions ADD COLUMN IF NOT EXISTS coach_enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;
ALTER TABLE public.triad_sessions ADD COLUMN IF NOT EXISTS coachee_enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;
ALTER TABLE public.triad_sessions ADD COLUMN IF NOT EXISTS observer_enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;
ALTER TABLE public.triad_reflections ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;

ALTER TABLE public.coachee_goals ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;
ALTER TABLE public.coachee_milestones ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;
ALTER TABLE public.coachee_goal_ratings ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;

CREATE TABLE public.enrollment_actions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.programme_enrollments(id) on delete restrict,
  goal_id uuid references public.coachee_goals(id) on delete set null,
  milestone_id uuid references public.coachee_milestones(id) on delete set null,
  source_activity_type text, source_activity_id uuid,
  title text not null, description text, owner_user_id uuid not null references public.profiles(id),
  due_date date, status text not null default 'open' check (status in ('open','in_progress','completed','cancelled')),
  completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
CREATE INDEX enrollment_actions_enrollment_idx ON public.enrollment_actions(enrollment_id, status, due_date);
ALTER TABLE public.enrollment_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enrollment actions: learner manage own" ON public.enrollment_actions FOR ALL TO authenticated
 USING (exists(select 1 from public.programme_enrollments e where e.id=enrollment_id and e.user_id=auth.uid()))
 WITH CHECK (exists(select 1 from public.programme_enrollments e where e.id=enrollment_id and e.user_id=auth.uid() and owner_user_id=auth.uid()));
CREATE POLICY "Enrollment actions: admin manage" ON public.enrollment_actions FOR ALL TO authenticated
 USING (public.has_role(auth.uid(),'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE OR REPLACE FUNCTION public.validate_enrollment_action() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_enrollment_scope(new.enrollment_id, new.owner_user_id);
  IF new.goal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.coachee_goals g WHERE g.id = new.goal_id AND g.enrollment_id = new.enrollment_id) THEN
    RAISE EXCEPTION 'Action goal must belong to the action enrollment' USING ERRCODE = '42501';
  END IF;
  IF new.milestone_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.coachee_milestones m WHERE m.id = new.milestone_id AND m.enrollment_id = new.enrollment_id) THEN
    RAISE EXCEPTION 'Action milestone must belong to the action enrollment' USING ERRCODE = '42501';
  END IF;
  IF (new.source_activity_type IS NULL) <> (new.source_activity_id IS NULL) THEN
    RAISE EXCEPTION 'Action source activity type and ID must be provided together' USING ERRCODE = 'P0001';
  END IF;
  RETURN new;
END $$;
CREATE TRIGGER enrollment_actions_validate_scope BEFORE INSERT OR UPDATE ON public.enrollment_actions FOR EACH ROW EXECUTE FUNCTION public.validate_enrollment_action();
CREATE TRIGGER enrollment_actions_updated before update on public.enrollment_actions for each row execute function public.set_updated_at();

CREATE TABLE public.enrollment_module_snapshots (
 id uuid primary key default gen_random_uuid(), enrollment_id uuid not null references public.programme_enrollments(id) on delete cascade,
 programme_module_id uuid not null references public.programme_modules(id) on delete restrict,
 module public.programme_module_type not null, required boolean not null default false,
 required_units integer not null default 0 check(required_units >= 0), distribution_mode text not null default 'flexible'
   check(distribution_mode in ('evenly_distributed','monthly_frequency','training_linked','custom','flexible')),
 distribution_settings jsonb not null default '{}'::jsonb, weight numeric,
 starts_on date not null, ends_on date not null, created_at timestamptz not null default now(),
 unique(enrollment_id,module), check(ends_on >= starts_on)
);
CREATE TABLE public.enrollment_module_milestones (
 id uuid primary key default gen_random_uuid(), enrollment_module_snapshot_id uuid not null references public.enrollment_module_snapshots(id) on delete cascade,
 sequence integer not null, due_on date not null, window_end_on date, training_week_id uuid references public.training_weeks(id) on delete set null,
 required_units integer not null default 1 check(required_units > 0), created_at timestamptz not null default now(), unique(enrollment_module_snapshot_id,sequence)
);
CREATE INDEX enrollment_milestones_due_idx ON public.enrollment_module_milestones(enrollment_module_snapshot_id,due_on);
ALTER TABLE public.enrollment_module_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollment_module_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enrollment snapshots: learner view own" ON public.enrollment_module_snapshots FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.id=enrollment_id AND e.user_id=auth.uid()));
CREATE POLICY "Enrollment snapshots: admin view" ON public.enrollment_module_snapshots FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Enrollment milestones: learner view own" ON public.enrollment_module_milestones FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.enrollment_module_snapshots s JOIN public.programme_enrollments e ON e.id=s.enrollment_id WHERE s.id=enrollment_module_snapshot_id AND e.user_id=auth.uid()));
CREATE POLICY "Enrollment milestones: admin view" ON public.enrollment_module_milestones FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Snapshot only enabled programme modules. Config keys are deliberately
-- explicit and backwards compatible: required_units, required, distribution_mode,
-- distribution_settings, weight.
CREATE OR REPLACE FUNCTION public.generate_enrollment_schedule(p_enrollment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare e public.programme_enrollments; m record; snapshot_id uuid; unit_count int; n int; due date; entry jsonb; linked_week record; sequence_no int;
begin
 select * into e from public.programme_enrollments where id=p_enrollment_id;
 if not found then raise exception 'Enrollment not found'; end if;
 if e.cohort_id is null or e.end_date is null then raise exception 'Enrollment requires cohort and end date before schedule generation'; end if;
 delete from public.enrollment_module_snapshots where enrollment_id=p_enrollment_id;
 for m in select * from public.programme_modules where programme_id=e.programme_id and enabled loop
   unit_count := greatest(0, coalesce((m.config->>'required_units')::int,0));
   insert into public.enrollment_module_snapshots(enrollment_id,programme_module_id,module,required,required_units,distribution_mode,distribution_settings,weight,starts_on,ends_on)
   values(p_enrollment_id,m.id,m.module,coalesce((m.config->>'required')::boolean,false),unit_count,
     coalesce(m.config->>'distribution_mode','flexible'),coalesce(m.config->'distribution_settings','{}'::jsonb),
     (m.config->>'weight')::numeric,e.start_date,e.end_date) returning id into snapshot_id;
   if unit_count > 0 and coalesce(m.config->>'distribution_mode','flexible') = 'custom' then
     if jsonb_typeof(m.config->'distribution_settings'->'milestones') <> 'array' then
       raise exception 'Custom module schedules require distribution_settings.milestones' using errcode = 'P0001';
     end if;
     sequence_no := 0;
     for entry in select value from jsonb_array_elements(m.config->'distribution_settings'->'milestones') loop
       sequence_no := sequence_no + 1;
       due := (entry->>'due_on')::date;
       if due < e.start_date or due > e.end_date then
         raise exception 'Custom milestone dates must fall within the enrollment dates' using errcode = 'P0001';
       end if;
       insert into public.enrollment_module_milestones(enrollment_module_snapshot_id,sequence,due_on,window_end_on,required_units)
       values(snapshot_id,sequence_no,due,nullif(entry->>'window_end_on','')::date,coalesce((entry->>'required_units')::int,1));
     end loop;
   elsif unit_count > 0 and coalesce(m.config->>'distribution_mode','flexible') = 'training_linked' then
     sequence_no := 0;
     for linked_week in select id, coalesce(unlock_date, e.start_date + ((week_number - 1) * 7)) as due_on
       from public.training_weeks
       where programme_id=e.programme_id
         and (coalesce(m.config->'distribution_settings'->'training_week_ids', '[]'::jsonb) = '[]'::jsonb
              or id::text in (select jsonb_array_elements_text(m.config->'distribution_settings'->'training_week_ids')))
       order by week_number limit unit_count loop
       sequence_no := sequence_no + 1;
       insert into public.enrollment_module_milestones(enrollment_module_snapshot_id,sequence,due_on,training_week_id)
       values(snapshot_id,sequence_no,least(e.end_date, linked_week.due_on),linked_week.id);
     end loop;
     if sequence_no < unit_count then
       raise exception 'Training-linked module requires at least % selected training weeks', unit_count using errcode = 'P0001';
     end if;
   elsif unit_count > 0 and coalesce(m.config->>'distribution_mode','flexible') <> 'flexible' then
     for n in 1..unit_count loop
       due := case coalesce(m.config->>'distribution_mode','flexible')
         when 'evenly_distributed' then e.start_date + ((e.end_date-e.start_date)*n/unit_count)
         when 'monthly_frequency' then least(e.end_date, (e.start_date + ((n-1) * coalesce((m.config->'distribution_settings'->>'interval_months')::int, 1) * interval '1 month'))::date)
         else e.end_date end;
       insert into public.enrollment_module_milestones(enrollment_module_snapshot_id,sequence,due_on) values(snapshot_id,n,due);
     end loop;
   end if;
 end loop;
end $$;

CREATE OR REPLACE FUNCTION public.validate_enrollment_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare participant uuid := (to_jsonb(new)->>tg_argv[0])::uuid;
begin
 if new.enrollment_id is null then raise exception 'enrollment_id is required for new programme activity' using errcode='P0001'; end if;
 perform public.assert_enrollment_scope(new.enrollment_id, participant);
 return new;
end $$;

CREATE OR REPLACE FUNCTION public.validate_enrollment_goal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
declare e public.programme_enrollments; active_count int;
begin
 select * into e from public.programme_enrollments where id=new.enrollment_id;
 if not found or e.user_id <> new.coachee_id then raise exception 'Goal must belong to its enrollment learner' using errcode='42501'; end if;
 if new.target_date is null then new.target_date:=e.end_date; end if;
 if new.target_date < e.start_date or (e.end_date is not null and new.target_date > e.end_date) then raise exception 'Goal target date must fall within enrollment dates' using errcode='P0001'; end if;
 if new.status='active' and (tg_op='INSERT' or old.status is distinct from 'active') then
   select count(*) into active_count from public.coachee_goals where enrollment_id=new.enrollment_id and status='active';
   if active_count >= 3 then raise exception 'This enrollment already has the maximum of 3 active goals' using errcode='P0001'; end if;
 end if; return new;
end $$;

CREATE TABLE public.goal_checkins (
 id uuid primary key default gen_random_uuid(), enrollment_id uuid not null references public.programme_enrollments(id) on delete restrict,
 goal_id uuid not null references public.coachee_goals(id) on delete restrict, source_activity_type text not null check(source_activity_type in ('coaching','mentoring','peer_coaching','triad')),
 source_activity_id uuid not null, previous_rating smallint check (previous_rating between 0 and 100), new_rating smallint check (new_rating between 0 and 100), note text, actor_user_id uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 unique(goal_id,source_activity_type,source_activity_id)
);
ALTER TABLE public.goal_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Goal checkins: learner view own" ON public.goal_checkins FOR SELECT TO authenticated USING(exists(select 1 from public.programme_enrollments e where e.id=enrollment_id and e.user_id=auth.uid()));

CREATE OR REPLACE FUNCTION public.record_goal_checkin(p_enrollment_id uuid,p_goal_id uuid,p_source_activity_type text,p_source_activity_id uuid,p_new_rating smallint,p_note text default null)
RETURNS public.goal_checkins LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
declare g public.coachee_goals; r public.coachee_goal_ratings; result public.goal_checkins;
begin
 select * into g from public.coachee_goals where id=p_goal_id and enrollment_id=p_enrollment_id and status='active' for update;
 if not found then raise exception 'Selected goal is not active for this enrollment' using errcode='P0001'; end if;
 perform public.assert_enrollment_scope(p_enrollment_id,g.coachee_id);
 if auth.uid() <> g.coachee_id then raise exception 'Only the learner can record a goal check-in' using errcode='42501'; end if;
 if p_source_activity_type = 'coaching' and not exists (select 1 from public.sessions s where s.id=p_source_activity_id and s.enrollment_id=p_enrollment_id) then
   raise exception 'Coaching session is not in this enrollment' using errcode='42501';
 elsif p_source_activity_type = 'mentoring' and not exists (select 1 from public.mentoring_sessions s where s.id=p_source_activity_id and s.enrollment_id=p_enrollment_id) then
   raise exception 'Mentoring session is not in this enrollment' using errcode='42501';
 elsif p_source_activity_type = 'peer_coaching' and not exists (select 1 from public.peer_sessions s where s.id=p_source_activity_id and s.enrollment_id=p_enrollment_id union all select 1 from public.coachee_peer_sessions s where s.id=p_source_activity_id and s.enrollment_id=p_enrollment_id) then
   raise exception 'Peer-coaching session is not in this enrollment' using errcode='42501';
 elsif p_source_activity_type = 'triad' and not exists (select 1 from public.triad_sessions s where s.id=p_source_activity_id and p_enrollment_id in (s.coach_enrollment_id, s.coachee_enrollment_id, s.observer_enrollment_id)) then
   raise exception 'Triad session is not in this enrollment' using errcode='42501';
 end if;
 select * into r from public.coachee_goal_ratings where goal_id=p_goal_id and coachee_id=g.coachee_id for update;
 if p_new_rating is not null and not found then raise exception 'Goal rating baseline must be created before the first check-in' using errcode='P0001'; end if;
 insert into public.goal_checkins(enrollment_id,goal_id,source_activity_type,source_activity_id,previous_rating,new_rating,note,actor_user_id)
 values(p_enrollment_id,p_goal_id,p_source_activity_type,p_source_activity_id,r.current_rating,p_new_rating,p_note,auth.uid()) returning * into result;
 if p_new_rating is not null then
   update public.coachee_goal_ratings set current_rating=p_new_rating, current_updated_at=now(), enrollment_id=p_enrollment_id where goal_id=p_goal_id and coachee_id=g.coachee_id;
 end if;
 return result;
end $$;

CREATE OR REPLACE VIEW public.enrollment_scope_backfill_audit WITH (security_invoker=true) AS
select 'sessions'::text table_name,s.id record_id,s.coachee_id user_id,count(pe.id)::int candidate_enrollments
from public.sessions s left join public.programme_enrollments pe on pe.user_id=s.coachee_id and s.start_time::date>=pe.start_date and (pe.end_date is null or s.start_time::date<=pe.end_date) where s.enrollment_id is null group by s.id,s.coachee_id
union all select 'training_progress',tp.id,tp.user_id,count(pe.id)::int from public.training_progress tp join public.training_weeks tw on tw.id=tp.training_week_id left join public.programme_enrollments pe on pe.user_id=tp.user_id and pe.programme_id=tw.programme_id where tp.enrollment_id is null group by tp.id,tp.user_id
union all select 'coachee_goals',g.id,g.coachee_id,count(pe.id)::int from public.coachee_goals g left join public.programme_enrollments pe on pe.user_id=g.coachee_id where g.enrollment_id is null group by g.id,g.coachee_id;

CREATE INDEX IF NOT EXISTS sessions_enrollment_idx ON public.sessions(enrollment_id,start_time);
CREATE INDEX IF NOT EXISTS mentoring_sessions_enrollment_idx ON public.mentoring_sessions(enrollment_id,start_time);
CREATE INDEX IF NOT EXISTS peer_sessions_enrollment_idx ON public.peer_sessions(enrollment_id,start_time);
CREATE INDEX IF NOT EXISTS training_progress_enrollment_idx ON public.training_progress(enrollment_id,training_week_id);

REVOKE EXECUTE ON FUNCTION public.create_programme_enrollment(uuid,uuid,uuid,uuid,date,date) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.create_programme_enrollment(uuid,uuid,uuid,uuid,date,date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_enrollment_schedule(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_goal_checkin(uuid,uuid,text,uuid,smallint,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.record_goal_checkin(uuid,uuid,text,uuid,smallint,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_enrollment_progress(p_enrollment_id uuid, p_as_of date default current_date)
RETURNS TABLE(module public.programme_module_type, full_completion_pct numeric, due_adherence_pct numeric, pace_status text, completed_units integer, due_units integer, required_units integer, booked_units integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  with authorized as (
    select 1 from public.programme_enrollments e where e.id=p_enrollment_id and (e.user_id=auth.uid() or public.has_role(auth.uid(), 'admin'::public.app_role) or public.coach_has_client(auth.uid(), e.user_id))
  ), snapshots as (
    select s.* from public.enrollment_module_snapshots s join authorized on true where s.enrollment_id=p_enrollment_id
  ),
  activity as (
    select 'coaching'::public.programme_module_type module, enrollment_id, status, start_time::date occurred_on from public.sessions
    union all select 'peer_coaching'::public.programme_module_type,enrollment_id,status,start_time::date from public.peer_sessions
    union all select 'peer_coaching'::public.programme_module_type,enrollment_id,status,start_time::date from public.coachee_peer_sessions
    union all select 'mentoring'::public.programme_module_type,enrollment_id,status,start_time::date from public.mentoring_sessions
    union all select 'triads'::public.programme_module_type,coach_enrollment_id,status,start_time::date from public.triad_sessions where coach_enrollment_id is not null
    union all select 'triads'::public.programme_module_type,coachee_enrollment_id,status,start_time::date from public.triad_sessions where coachee_enrollment_id is not null
    union all select 'triads'::public.programme_module_type,observer_enrollment_id,status,start_time::date from public.triad_sessions where observer_enrollment_id is not null
    union all select 'training'::public.programme_module_type,enrollment_id,case when completed_at is null then 'confirmed'::public.session_status else 'completed'::public.session_status end,coalesce(completed_at,created_at)::date from public.training_progress
  ), counts as (
    select s.id,count(a.*) filter(where a.status='completed')::int completed,count(a.*) filter(where a.status in ('pending_coach_approval','confirmed') and a.occurred_on>=p_as_of)::int booked from snapshots s left join activity a on a.enrollment_id=s.enrollment_id and a.module=s.module group by s.id
  ), due as (
    select s.id,coalesce(sum(m.required_units) filter(where m.due_on<=p_as_of),0)::int units_due from snapshots s left join public.enrollment_module_milestones m on m.enrollment_module_snapshot_id=s.id group by s.id
  )
  select s.module,case when s.required_units=0 then null else round(least(c.completed,s.required_units)*100.0/s.required_units,1) end,
    case when d.units_due=0 then null else round(least(c.completed,d.units_due)*100.0/d.units_due,1) end,
    case when s.required_units=0 or c.completed>=s.required_units then 'completed' when d.units_due=0 then 'not_yet_due' when c.completed>=d.units_due then case when c.completed>d.units_due then 'ahead' else 'on_track' end when c.completed+c.booked>=d.units_due then 'scheduled' else 'behind' end,
    c.completed,d.units_due,s.required_units,c.booked from snapshots s join counts c on c.id=s.id join due d on d.id=s.id;
$$;


REVOKE EXECUTE ON FUNCTION public.get_enrollment_progress(uuid,date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_progress(uuid,date) TO authenticated;

COMMENT ON COLUMN public.sessions.enrollment_id IS 'Nullable during the deterministic backfill and consumer cutover; a later migration will require it.';
COMMENT ON COLUMN public.coachee_goals.enrollment_id IS 'Nullable during the deterministic backfill and consumer cutover; a later migration will require it.';
