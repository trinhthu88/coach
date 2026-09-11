-- Production-safe live demo registry and reset. This is deliberately separate
-- from supabase/seed.sql, whose local/test-only guard remains unchanged.

CREATE TABLE public.live_demo_organizations (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
  fixture_version integer NOT NULL,
  generation integer NOT NULL DEFAULT 0,
  anchor_date date,
  state text NOT NULL DEFAULT 'provisioning' CHECK (state IN ('provisioning','ready','resetting','failed')),
  last_reset_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.live_demo_identities (
  kind text PRIMARY KEY CHECK (kind IN ('learner_a','learner_c','coach','sponsor')),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  email text NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES public.live_demo_organizations(organization_id) ON DELETE RESTRICT
);
CREATE TABLE public.live_demo_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL,
  fixture_version integer NOT NULL,
  generation integer,
  anchor_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed')),
  affected_rows integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE TABLE public.live_demo_baseline_resources (
  resource_table text NOT NULL,
  resource_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.live_demo_organizations(organization_id) ON DELETE RESTRICT,
  PRIMARY KEY(resource_table,resource_id)
);
ALTER TABLE public.live_demo_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_demo_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_demo_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_demo_baseline_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Live demo registry: admin read" ON public.live_demo_organizations FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY "Live demo identities: admin read" ON public.live_demo_identities FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY "Live demo operations: admin read" ON public.live_demo_operations FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY "Live demo resources: admin read" ON public.live_demo_baseline_resources FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.is_real_clariva_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT public.has_role(auth.uid(),'admin'::public.app_role)
    AND NOT EXISTS (SELECT 1 FROM public.live_demo_identities WHERE user_id=auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_real_clariva_admin() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_real_clariva_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_live_demo_user(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.live_demo_identities WHERE user_id=p_user_id);
$$;
REVOKE ALL ON FUNCTION public.is_live_demo_user(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_live_demo_user(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_live_demo_member(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.live_demo_identities WHERE user_id=p_user_id)
    OR EXISTS (SELECT 1 FROM public.programme_enrollments
               WHERE user_id=p_user_id AND organization_id='d3000000-0000-4000-8000-000000000001');
$$;
REVOKE ALL ON FUNCTION public.is_live_demo_member(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_live_demo_member(uuid) TO authenticated;

-- Restrictive policies are ANDed with existing visibility policies. Demo
-- accounts and ordinary client accounts cannot discover one another.
CREATE POLICY "Profiles: live demo boundary" ON public.profiles AS RESTRICTIVE
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin'::public.app_role)
    OR public.is_live_demo_member(auth.uid())=public.is_live_demo_member(id)
  );
CREATE POLICY "Coach profiles: live demo boundary" ON public.coach_profiles AS RESTRICTIVE
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin'::public.app_role)
    OR public.is_live_demo_member(auth.uid())=public.is_live_demo_member(id)
  );

CREATE OR REPLACE FUNCTION public.protect_live_demo_identity_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_kind text;
BEGIN
  SELECT kind INTO actor_kind FROM public.live_demo_identities WHERE user_id=auth.uid();
  IF actor_kind='sponsor' THEN RAISE EXCEPTION 'Demo Sponsor is read-only' USING ERRCODE='42501'; END IF;
  IF actor_kind IS NOT NULL THEN RAISE EXCEPTION 'Shared demo account profile is protected' USING ERRCODE='42501'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN old ELSE new END;
END;
$$;
CREATE TRIGGER profiles_protect_live_demo BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_live_demo_identity_write();
CREATE TRIGGER sponsor_profiles_protect_live_demo BEFORE INSERT OR UPDATE OR DELETE ON public.sponsor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_live_demo_identity_write();
CREATE TRIGGER coachee_profiles_protect_live_demo BEFORE INSERT OR UPDATE OR DELETE ON public.coachee_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_live_demo_identity_write();
CREATE TRIGGER coach_profiles_protect_live_demo BEFORE INSERT OR UPDATE OR DELETE ON public.coach_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_live_demo_identity_write();
CREATE TRIGGER user_roles_protect_live_demo BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_live_demo_identity_write();

CREATE OR REPLACE FUNCTION public.protect_live_demo_baseline_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF public.is_live_demo_user(auth.uid()) AND TG_OP IN ('UPDATE','DELETE')
     AND EXISTS (SELECT 1 FROM public.live_demo_baseline_resources WHERE resource_table=TG_TABLE_NAME AND resource_id=old.id) THEN
    RAISE EXCEPTION 'Baseline demo activity is protected; create a new demo activity instead' USING ERRCODE='42501';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN old ELSE new END;
END;
$$;
CREATE TRIGGER sessions_protect_demo_baseline BEFORE UPDATE OR DELETE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.protect_live_demo_baseline_write();
CREATE TRIGGER mentoring_sessions_protect_demo_baseline BEFORE UPDATE OR DELETE ON public.mentoring_sessions FOR EACH ROW EXECUTE FUNCTION public.protect_live_demo_baseline_write();
CREATE TRIGGER coachee_peer_sessions_protect_demo_baseline BEFORE UPDATE OR DELETE ON public.coachee_peer_sessions FOR EACH ROW EXECUTE FUNCTION public.protect_live_demo_baseline_write();
CREATE TRIGGER triad_sessions_protect_demo_baseline BEFORE UPDATE OR DELETE ON public.triad_sessions FOR EACH ROW EXECUTE FUNCTION public.protect_live_demo_baseline_write();

CREATE OR REPLACE FUNCTION public.reset_live_demo_data(
  p_requester_id uuid, p_idempotency_key text, p_fixture_version integer,
  p_anchor_date date, p_identity_ids jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE
  demo_org constant uuid := 'd3000000-0000-4000-8000-000000000001';
  pids constant uuid[] := ARRAY['d3000000-0000-4000-8000-00000000000a'::uuid,'d3000000-0000-4000-8000-00000000000b'::uuid,'d3000000-0000-4000-8000-00000000000c'::uuid,'d3000000-0000-4000-8000-00000000000d'::uuid];
  cids constant uuid[] := ARRAY['d3000000-0000-4000-8000-00000000001a'::uuid,'d3000000-0000-4000-8000-00000000001b'::uuid,'d3000000-0000-4000-8000-00000000001c'::uuid,'d3000000-0000-4000-8000-00000000001d'::uuid];
  learner_a uuid := (p_identity_ids->>'learner_a')::uuid;
  learner_c uuid := (p_identity_ids->>'learner_c')::uuid;
  demo_coach uuid := (p_identity_ids->>'coach')::uuid;
  demo_sponsor uuid := (p_identity_ids->>'sponsor')::uuid;
  uid uuid; eid uuid; pid uuid; cid uuid; starts date; ends date; op public.live_demo_operations;
  i integer; j integer; leader_count integer; session_no integer; week_no integer;
BEGIN
  IF p_fixture_version <> 1 OR p_anchor_date IS NULL OR length(coalesce(p_idempotency_key,'')) < 8 THEN RAISE EXCEPTION 'Invalid demo reset request'; END IF;
  IF NOT public.has_role(p_requester_id,'admin'::public.app_role) OR p_requester_id=ANY(ARRAY[learner_a,learner_c,demo_coach,demo_sponsor]) THEN
    RAISE EXCEPTION 'Only a real Clariva administrator may reset demo data' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(ARRAY[learner_a,learner_c,demo_coach,demo_sponsor]) x) <> 4
     OR EXISTS (SELECT 1 FROM unnest(ARRAY[learner_a,learner_c,demo_coach,demo_sponsor]) x WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE id=x)) THEN
    RAISE EXCEPTION 'Demo identities are missing or duplicated';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(demo_org::text,0));
  SELECT * INTO op FROM public.live_demo_operations WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN RETURN jsonb_build_object('operation_id',op.id,'status',op.status,'generation',op.generation); END IF;
  INSERT INTO public.live_demo_operations(idempotency_key,requested_by,organization_id,fixture_version,anchor_date,status)
    VALUES(p_idempotency_key,p_requester_id,demo_org,p_fixture_version,p_anchor_date,'running') RETURNING * INTO op;
  IF EXISTS (SELECT 1 FROM public.programme_enrollments WHERE programme_id=ANY(pids) AND organization_id IS DISTINCT FROM demo_org) THEN
    RAISE EXCEPTION 'Cross-organization reference blocks demo reset' USING ERRCODE='42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.coachee_coach_allowlist a
    WHERE (a.coach_id=demo_coach AND a.coachee_id NOT IN (
      SELECT e.user_id FROM public.programme_enrollments e WHERE e.organization_id=demo_org
      UNION SELECT unnest(ARRAY[learner_a,learner_c])
    )) OR (a.coachee_id IN (
      SELECT e.user_id FROM public.programme_enrollments e WHERE e.organization_id=demo_org
      UNION SELECT unnest(ARRAY[learner_a,learner_c])
    ) AND a.coach_id<>demo_coach)
  ) OR EXISTS (
    SELECT 1 FROM public.mentoring_allowlist a
    WHERE (a.mentor_user_id=demo_coach AND a.mentee_user_id NOT IN (
      SELECT e.user_id FROM public.programme_enrollments e WHERE e.organization_id=demo_org
      UNION SELECT unnest(ARRAY[learner_a,learner_c])
    )) OR (a.mentee_user_id IN (
      SELECT e.user_id FROM public.programme_enrollments e WHERE e.organization_id=demo_org
      UNION SELECT unnest(ARRAY[learner_a,learner_c])
    ) AND a.mentor_user_id<>demo_coach)
  ) THEN
    RAISE EXCEPTION 'Cross-organization relationship blocks demo reset' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.organizations(id,name,industry,timezone,subscription_tier)
    VALUES(demo_org,'Clariva Demo Organization','Professional services','Asia/Ho_Chi_Minh','enterprise')
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,industry=excluded.industry,timezone=excluded.timezone,subscription_tier=excluded.subscription_tier;
  INSERT INTO public.live_demo_organizations(organization_id,fixture_version,state) VALUES(demo_org,1,'resetting')
    ON CONFLICT(organization_id) DO UPDATE SET fixture_version=1,state='resetting',updated_at=now();
  DELETE FROM public.live_demo_baseline_resources WHERE organization_id=demo_org;

  -- Every removal is enrollment- or programme-scoped to the registered demo.
  DELETE FROM public.goal_checkins WHERE enrollment_id IN (SELECT id FROM public.programme_enrollments WHERE organization_id=demo_org);
  DELETE FROM public.enrollment_actions WHERE enrollment_id IN (SELECT id FROM public.programme_enrollments WHERE organization_id=demo_org);
  DELETE FROM public.coachee_goal_ratings WHERE enrollment_id IN (SELECT id FROM public.programme_enrollments WHERE organization_id=demo_org);
  DELETE FROM public.coachee_goals WHERE enrollment_id IN (SELECT id FROM public.programme_enrollments WHERE organization_id=demo_org);
  DELETE FROM public.training_progress WHERE enrollment_id IN (SELECT id FROM public.programme_enrollments WHERE organization_id=demo_org);
  DELETE FROM public.assignment_submissions WHERE enrollment_id IN (SELECT id FROM public.programme_enrollments WHERE organization_id=demo_org);
  DELETE FROM public.daily_prompt_responses WHERE enrollment_id IN (SELECT id FROM public.programme_enrollments WHERE organization_id=demo_org);
  DELETE FROM public.reflection_submissions WHERE enrollment_id IN (SELECT id FROM public.programme_enrollments WHERE organization_id=demo_org);
  DELETE FROM public.sessions WHERE enrollment_id IN (SELECT id FROM public.programme_enrollments WHERE organization_id=demo_org);
  DELETE FROM public.mentoring_sessions WHERE enrollment_id IN (SELECT id FROM public.programme_enrollments WHERE organization_id=demo_org);
  DELETE FROM public.coachee_peer_sessions WHERE enrollment_id IN (SELECT id FROM public.programme_enrollments WHERE organization_id=demo_org);
  DELETE FROM public.triad_reflections WHERE enrollment_id IN (SELECT id FROM public.programme_enrollments WHERE organization_id=demo_org);
  DELETE FROM public.triad_sessions WHERE EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.organization_id=demo_org AND e.id IN (coach_enrollment_id,coachee_enrollment_id,observer_enrollment_id));
  DELETE FROM public.triad_groups WHERE cohort_id=ANY(cids);
  DELETE FROM public.coachee_coach_allowlist WHERE coach_id=demo_coach OR coachee_id IN (SELECT user_id FROM public.programme_enrollments WHERE organization_id=demo_org);
  DELETE FROM public.mentoring_allowlist WHERE mentor_user_id=demo_coach OR mentee_user_id IN (SELECT user_id FROM public.programme_enrollments WHERE organization_id=demo_org);
  DELETE FROM public.enrollment_module_snapshots WHERE enrollment_id IN (SELECT id FROM public.programme_enrollments WHERE organization_id=demo_org);
  DELETE FROM public.programme_enrollments WHERE organization_id=demo_org;
  DELETE FROM public.training_weeks WHERE programme_id=ANY(pids);
  DELETE FROM public.programme_reflections WHERE programme_id=ANY(pids);
  DELETE FROM public.programme_modules WHERE programme_id=ANY(pids);

  INSERT INTO public.live_demo_identities(kind,user_id,email,organization_id) VALUES
    ('learner_a',learner_a,'learner-a@demo.clariva.club',demo_org),('learner_c',learner_c,'learner-c@demo.clariva.club',demo_org),
    ('coach',demo_coach,'coach@demo.clariva.club',demo_org),('sponsor',demo_sponsor,'sponsor@demo.clariva.club',demo_org)
    ON CONFLICT(kind) DO UPDATE SET user_id=excluded.user_id,email=excluded.email,organization_id=excluded.organization_id;
  INSERT INTO public.profiles(id,email,full_name,status) VALUES
    (learner_a,'learner-a@demo.clariva.club','Demo Learner — Executive Coaching','active'),(learner_c,'learner-c@demo.clariva.club','Demo Learner — Emerging Leaders','active'),
    (demo_coach,'coach@demo.clariva.club','Demo Coach','active'),(demo_sponsor,'sponsor@demo.clariva.club','Demo Sponsor','active')
    ON CONFLICT(id) DO UPDATE SET email=excluded.email,full_name=excluded.full_name,status='active';
  DELETE FROM public.user_roles WHERE user_id=ANY(ARRAY[learner_a,learner_c,demo_coach,demo_sponsor]);
  INSERT INTO public.user_roles(user_id,role) VALUES (learner_a,'coachee'),(learner_c,'coachee'),(demo_coach,'coach'),(demo_sponsor,'sponsor');
  INSERT INTO public.coach_profiles(id,title,approval_status,peer_coaching_opt_in) VALUES(demo_coach,'Executive and Leadership Coach','active',true)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,approval_status='active',peer_coaching_opt_in=true;
  INSERT INTO public.mentor_profiles(coach_user_id,is_active,bio,expertise_tags) VALUES(demo_coach,true,'Fictional Clariva demo mentor','{leadership,coaching}')
    ON CONFLICT(coach_user_id) DO UPDATE SET is_active=true,bio=excluded.bio;
  INSERT INTO public.sponsor_profiles(user_id,organization_id,title,department) VALUES(demo_sponsor,demo_org,'Programme Sponsor','Leadership Development')
    ON CONFLICT(user_id) DO UPDATE SET organization_id=excluded.organization_id,title=excluded.title,department=excluded.department;

  INSERT INTO public.programmes(id,name,description,duration_months,is_active,coachee_session_limit,coach_session_limit,peer_session_limit,peer_given_limit) VALUES
    (pids[1],'Executive Coaching','Focused coaching demonstration',4,true,6,6,0,0),(pids[2],'Leadership Development','Blended leadership demonstration',6,true,6,6,0,0),
    (pids[3],'Emerging Leaders','Complete blended demonstration',6,true,6,6,4,4),(pids[4],'Leadership Excellence','Completed historical demonstration',6,true,6,6,4,4)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,duration_months=excluded.duration_months,is_active=true;
  INSERT INTO public.cohorts(id,name,programme_id,organization_id,start_date,end_date) VALUES
    (cids[1],'A — Executive Coaching',pids[1],demo_org,p_anchor_date-45,p_anchor_date+75),(cids[2],'B — Leadership Development',pids[2],demo_org,p_anchor_date-60,p_anchor_date+120),
    (cids[3],'C — Emerging Leaders',pids[3],demo_org,p_anchor_date-60,p_anchor_date+120),(cids[4],'D — Leadership Excellence',pids[4],demo_org,p_anchor_date-365,p_anchor_date-185)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,programme_id=excluded.programme_id,organization_id=demo_org,start_date=excluded.start_date,end_date=excluded.end_date;

  INSERT INTO public.programme_modules(programme_id,module,enabled,config)
  SELECT pids[1],m.module::public.programme_module_type,true,
    jsonb_build_object('required',true,'required_units',m.units,'distribution_mode','evenly_distributed','weight',m.weight,'receive',true)
  FROM (VALUES ('coaching',6,100)) m(module,units,weight)
  UNION ALL
  SELECT pids[2],m.module::public.programme_module_type,true,
    jsonb_build_object('required',true,'required_units',m.units,'distribution_mode','evenly_distributed','weight',m.weight,'receive',m.module IN ('coaching','mentoring'))
  FROM (VALUES ('coaching',6,30),('mentoring',2,15),('triads',2,15),('training',4,20),('quiz',4,10),('daily_prompt',8,10)) m(module,units,weight)
  UNION ALL
  SELECT pids[p.i],m.module::public.programme_module_type,true,
    jsonb_build_object('required',true,'required_units',m.units,'distribution_mode','evenly_distributed','weight',m.weight,'receive',m.module IN ('coaching','mentoring','peer_coaching'))
  FROM (VALUES (3),(4)) p(i)
  CROSS JOIN (VALUES ('coaching',6,25),('mentoring',2,15),('peer_coaching',2,15),('triads',2,15),('training',4,15),('quiz',4,10),('daily_prompt',8,5)) m(module,units,weight);

  -- Four weeks of real learning content for each blended programme.
  FOR i IN 2..4 LOOP
    FOR week_no IN 1..4 LOOP
      INSERT INTO public.training_weeks(id,programme_id,week_number,title,skill_card_html,is_visible,unlock_date,sort_order)
      VALUES(('d37'||i::text||'0000-0000-4000-8000-'||lpad(week_no::text,12,'0'))::uuid,pids[i],week_no,format('Leadership practice %s',week_no),
        '<p>Fictional Clariva demo learning content.</p>',true,(CASE WHEN i=4 THEN p_anchor_date-365 ELSE p_anchor_date-60 END)+((week_no-1)*21),week_no);
      INSERT INTO public.assignments(id,training_week_id,assignment_type,title,instructions,is_visible,due_offset_days,sort_order)
      VALUES(('d38'||i::text||'0000-0000-4000-8000-'||lpad(week_no::text,12,'0'))::uuid,('d37'||i::text||'0000-0000-4000-8000-'||lpad(week_no::text,12,'0'))::uuid,
        'reflection','Leadership reflection','Describe a fictional practice example.',true,14,1);
      INSERT INTO public.assignments(id,training_week_id,assignment_type,title,instructions,is_visible,due_offset_days,sort_order)
      VALUES(('d3f'||i::text||'0000-0000-4000-8000-'||lpad(week_no::text,12,'0'))::uuid,('d37'||i::text||'0000-0000-4000-8000-'||lpad(week_no::text,12,'0'))::uuid,
        'quiz','Leadership knowledge check','Choose the strongest leadership response.',true,14,2);
      INSERT INTO public.quiz_questions(id,assignment_id,question_text,options,explanation,sort_order)
      VALUES(('d4b'||i::text||'0000-0000-4000-8000-'||lpad(week_no::text,12,'0'))::uuid,('d3f'||i::text||'0000-0000-4000-8000-'||lpad(week_no::text,12,'0'))::uuid,
        'What is the best first step when giving developmental feedback?',
        jsonb_build_array(
          jsonb_build_object('id','a','text','Describe a specific observed behavior','is_correct',true),
          jsonb_build_object('id','b','text','Make a general judgment about the person','is_correct',false)
        ),'Specific observations make feedback clear and actionable.',1);
      INSERT INTO public.daily_prompts(id,training_week_id,day_offset,prompt_text)
      VALUES(('d39'||i::text||'0000-0000-4000-8000-'||lpad(week_no::text,12,'0'))::uuid,('d37'||i::text||'0000-0000-4000-8000-'||lpad(week_no::text,12,'0'))::uuid,1,'What leadership behavior will you practise?');
      INSERT INTO public.programme_reflections(id,programme_id,reflection_number,title,instructions,appears_at_week,is_visible)
      VALUES(('d3a'||i::text||'0000-0000-4000-8000-'||lpad(week_no::text,12,'0'))::uuid,pids[i],week_no,format('Programme reflection %s',week_no),'Fictional private reflection',week_no,true);
    END LOOP;
  END LOOP;

  FOR i IN 1..4 LOOP
    pid:=pids[i]; cid:=cids[i];
    leader_count:=CASE i WHEN 1 THEN 8 WHEN 2 THEN 10 WHEN 3 THEN 12 ELSE 10 END;
    starts:=CASE WHEN i=1 THEN p_anchor_date-45 WHEN i IN (2,3) THEN p_anchor_date-60 ELSE p_anchor_date-365 END;
    ends:=CASE WHEN i=1 THEN p_anchor_date+75 WHEN i IN (2,3) THEN p_anchor_date+120 ELSE p_anchor_date-185 END;
    FOR j IN 1..leader_count LOOP
      uid:=CASE WHEN i=1 AND j=1 THEN learner_a WHEN i=3 AND j=1 THEN learner_c ELSE ('d31'||i::text||'0000-0000-4000-8000-'||lpad(j::text,12,'0'))::uuid END;
      IF uid NOT IN (learner_a,learner_c) THEN
        INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
        VALUES(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',format('leader-%s-%s@demo.invalid',lower(chr(64+i)),j),now(),
          jsonb_build_object('full_name',format('Demo Leader %s%s',chr(64+i),j),'live_demo',true),now(),now()) ON CONFLICT(id) DO NOTHING;
      END IF;
      INSERT INTO public.profiles(id,email,full_name,status,peer_coaching_opt_in)
      VALUES(uid,CASE WHEN uid=learner_a THEN 'learner-a@demo.clariva.club' WHEN uid=learner_c THEN 'learner-c@demo.clariva.club' ELSE format('leader-%s-%s@demo.invalid',lower(chr(64+i)),j) END,
        format('Demo Leader %s%s',chr(64+i),j),'active',i IN (3,4)) ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name,status='active',peer_coaching_opt_in=excluded.peer_coaching_opt_in;
      INSERT INTO public.user_roles(user_id,role) VALUES(uid,'coachee') ON CONFLICT(user_id,role) DO NOTHING;
      INSERT INTO public.coachee_profiles(id,job_title,industry,location,timezone,goals,approval_status)
      VALUES(uid,'Demo Leader','Professional services','Ho Chi Minh City, Vietnam','Asia/Ho_Chi_Minh','Build practical leadership habits.','active')
      ON CONFLICT(id) DO UPDATE SET approval_status='active',goals=excluded.goals;
      eid:=('d32'||i::text||'0000-0000-4000-8000-'||lpad(j::text,12,'0'))::uuid;
      INSERT INTO public.programme_enrollments(id,user_id,coachee_id,programme_id,cohort_id,organization_id,start_date,end_date,status)
      VALUES(eid,uid,uid,pid,cid,demo_org,starts,ends,CASE WHEN i=4 THEN 'completed' WHEN j=leader_count THEN 'paused' WHEN j=leader_count-1 THEN 'at_risk' ELSE 'active' END);
      PERFORM public.generate_enrollment_schedule(eid);
      INSERT INTO public.coachee_goals(id,coachee_id,enrollment_id,title,description,status,target_date,sort_order)
      VALUES(('d33'||i::text||'0000-0000-4000-8000-'||lpad(j::text,12,'0'))::uuid,uid,eid,'Strengthen leadership impact','Fictional private goal detail','active',ends,1);
      INSERT INTO public.coachee_goal_ratings(id,goal_id,coachee_id,enrollment_id,start_rating,current_rating,target_rating)
      VALUES(('d34'||i::text||'0000-0000-4000-8000-'||lpad(j::text,12,'0'))::uuid,('d33'||i::text||'0000-0000-4000-8000-'||lpad(j::text,12,'0'))::uuid,uid,eid,20,30+((j*7)%50),85);
      INSERT INTO public.enrollment_actions(id,enrollment_id,goal_id,owner_user_id,title,description,status,due_date,completed_at)
      VALUES(('d35'||i::text||'0000-4000-8000-'||lpad(j::text,12,'0'))::uuid,eid,('d33'||i::text||'0000-0000-4000-8000-'||lpad(j::text,12,'0'))::uuid,uid,
        'Practise one leadership habit','Fictional private action detail',CASE WHEN j%3=0 THEN 'open' ELSE 'completed' END,starts+30,CASE WHEN j%3=0 THEN NULL ELSE starts+28 END);
      FOR session_no IN 1..CASE WHEN i=4 THEN 5 ELSE 1+(j%4) END LOOP
        INSERT INTO public.sessions(id,enrollment_id,coach_id,coachee_id,topic,start_time,duration_minutes,status,coachee_rating,coach_notes)
        VALUES(('d36'||i::text||lpad(j::text,2,'0')||'00-0000-4000-8000-'||lpad(session_no::text,12,'0'))::uuid,eid,demo_coach,uid,
          'Fictional coaching conversation',starts+(session_no*21)*interval '1 day',60,'completed',3+((j+session_no)%3),'Private fictional coaching note');
      END LOOP;
    END LOOP;
  END LOOP;

  INSERT INTO public.coachee_coach_allowlist(coachee_id,coach_id,created_by,removed_at,source)
    SELECT user_id,demo_coach,p_requester_id,NULL,'admin_added'
    FROM public.programme_enrollments WHERE organization_id=demo_org
    ON CONFLICT(coachee_id,coach_id) DO UPDATE SET removed_at=NULL,source='admin_added',created_by=excluded.created_by;
  INSERT INTO public.mentoring_allowlist(mentee_user_id,mentor_user_id,created_by)
    SELECT user_id,demo_coach,p_requester_id
    FROM public.programme_enrollments WHERE organization_id=demo_org AND programme_id=ANY(ARRAY[pids[2],pids[3],pids[4]])
    ON CONFLICT(mentee_user_id,mentor_user_id) DO UPDATE SET created_by=excluded.created_by;

  -- Interactive learner C has seeded evidence and valid partners for every enabled experience.
  INSERT INTO public.training_progress(id,user_id,enrollment_id,training_week_id,viewed_at,completed_at)
    SELECT ('d3b30000-0000-4000-8000-'||lpad(week_no::text,12,'0'))::uuid,learner_c,'d3230000-0000-4000-8000-000000000001',
      ('d3730000-0000-4000-8000-'||lpad(week_no::text,12,'0'))::uuid,p_anchor_date-20,p_anchor_date-19 FROM generate_series(1,2) week_no;
  INSERT INTO public.assignment_submissions(id,assignment_id,user_id,enrollment_id,reflection_text)
    VALUES('d3c30000-0000-4000-8000-000000000001','d3830000-0000-4000-8000-000000000001',learner_c,'d3230000-0000-4000-8000-000000000001','Fictional private assignment response');
  INSERT INTO public.daily_prompt_responses(id,daily_prompt_id,user_id,enrollment_id,opened_at,response_text,responded_at)
    VALUES('d3d30000-0000-4000-8000-000000000001','d3930000-0000-4000-8000-000000000001',learner_c,'d3230000-0000-4000-8000-000000000001',now(),'Fictional private prompt response',now());
  INSERT INTO public.mentoring_sessions(id,enrollment_id,mentor_id,mentee_id,topic,start_time,duration_minutes,status,prep_file_path,mentee_notes)
    VALUES('d3e30000-0000-4000-8000-000000000001','d3230000-0000-4000-8000-000000000001',demo_coach,learner_c,'Leadership mentoring',p_anchor_date-14,60,'completed','demo/static-preparation.txt','Fictional private mentoring note');
  INSERT INTO public.coachee_peer_sessions(id,enrollment_id,peer_provider_id,peer_receiver_id,topic,start_time,duration_minutes,status,receiver_rating)
    VALUES('d3e30000-0000-4000-8000-000000000002','d3230000-0000-4000-8000-000000000001','d3130000-0000-4000-8000-000000000002',learner_c,'Peer leadership practice',p_anchor_date-10,60,'completed',5);
  INSERT INTO public.triad_groups(id,cohort_id,programme_id,name,member_1_id,member_2_id,member_3_id,enrollment_1_id,enrollment_2_id,enrollment_3_id)
    VALUES('d3e30000-0000-4000-8000-000000000003',cids[3],pids[3],'Emerging Leaders Demo Triad',learner_c,'d3130000-0000-4000-8000-000000000002','d3130000-0000-4000-8000-000000000003',
      'd3230000-0000-4000-8000-000000000001','d3230000-0000-4000-8000-000000000002','d3230000-0000-4000-8000-000000000003');
  INSERT INTO public.triad_sessions(id,triad_group_id,proposed_start_time,proposed_end_time,proposed_by,member_1_response,member_2_response,member_3_response,coach_enrollment_id,coachee_enrollment_id,observer_enrollment_id,status,notes)
    VALUES('d3e30000-0000-4000-8000-000000000004','d3e30000-0000-4000-8000-000000000003',p_anchor_date-7,p_anchor_date-7+interval '1 hour','system','accepted','accepted','accepted',
      'd3230000-0000-4000-8000-000000000001','d3230000-0000-4000-8000-000000000002','d3230000-0000-4000-8000-000000000003','completed','Fictional private triad note');

  INSERT INTO public.live_demo_baseline_resources(resource_table,resource_id,organization_id)
    SELECT 'sessions',id,demo_org FROM public.sessions WHERE enrollment_id IN (SELECT id FROM public.programme_enrollments WHERE organization_id=demo_org)
    UNION ALL SELECT 'mentoring_sessions',id,demo_org FROM public.mentoring_sessions WHERE enrollment_id IN (SELECT id FROM public.programme_enrollments WHERE organization_id=demo_org)
    UNION ALL SELECT 'coachee_peer_sessions',id,demo_org FROM public.coachee_peer_sessions WHERE enrollment_id IN (SELECT id FROM public.programme_enrollments WHERE organization_id=demo_org)
    UNION ALL SELECT 'triad_sessions',ts.id,demo_org FROM public.triad_sessions ts WHERE EXISTS (
      SELECT 1 FROM public.programme_enrollments e WHERE e.organization_id=demo_org AND e.id IN (ts.coach_enrollment_id,ts.coachee_enrollment_id,ts.observer_enrollment_id)
    );

  UPDATE public.live_demo_organizations SET generation=generation+1,anchor_date=p_anchor_date,state='ready',last_reset_at=now(),updated_at=now() WHERE organization_id=demo_org;
  UPDATE public.live_demo_operations SET status='succeeded',generation=(SELECT generation FROM public.live_demo_organizations WHERE organization_id=demo_org),
    affected_rows=40,finished_at=now() WHERE id=op.id;
  RETURN jsonb_build_object('operation_id',op.id,'status','succeeded','organization_id',demo_org,
    'generation',(SELECT generation FROM public.live_demo_organizations WHERE organization_id=demo_org),'leaders',40,'accounts',4);
END;
$$;
REVOKE ALL ON FUNCTION public.reset_live_demo_data(uuid,text,integer,date,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reset_live_demo_data(uuid,text,integer,date,jsonb) TO service_role;
