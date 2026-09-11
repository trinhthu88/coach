-- Local-reset-only demo fixture. This file is not a migration and must never
-- be applied to a hosted/production database.
--
-- Required command:
--   PGOPTIONS='-c app.seed_environment=local' supabase db reset
-- Anchor: 2026-09-01. A runs 2026-09-01..2026-12-01; B runs
-- 2026-09-01..2027-03-01. Re-running the command is deterministic.
BEGIN;
DO $guard$
BEGIN
  IF coalesce(current_setting('app.seed_environment', true), '') NOT IN ('local','development','preview','test') THEN
    RAISE EXCEPTION 'Refusing demo seed: set PGOPTIONS=-c app.seed_environment=local for a local reset';
  END IF;
END $guard$;

DO $seed$
DECLARE
  org uuid := '11111111-1111-4111-8111-111111111111';
  pa uuid := '11111111-1111-4111-8111-111111111112';
  pb uuid := '11111111-1111-4111-8111-111111111113';
  ca uuid := '11111111-1111-4111-8111-111111111114';
  cb uuid := '11111111-1111-4111-8111-111111111115';
  sponsor uuid; uid uuid; eid uuid; coach uuid; mentor uuid; gid uuid; admin_id uuid;
  i int; fixture_email text; nm text; cohort uuid; programme uuid; start_date date; end_date date;
  coaches uuid[];
BEGIN
  INSERT INTO public.organizations(id,name) VALUES(org,'Clariva Erickson Demo Organisation')
    ON CONFLICT(id) DO UPDATE SET name=excluded.name;
  INSERT INTO public.programmes(id,name,description,duration_months,is_active,coachee_session_limit,coach_session_limit,peer_session_limit,peer_given_limit)
  VALUES
    (pa,'Executive Coaching Accelerator','Coaching-only demonstration',3,true,6,6,0,0),
    (pb,'Leadership Development Journey','Blended leadership demonstration',6,true,6,6,4,4)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,duration_months=excluded.duration_months;
  INSERT INTO public.cohorts(id,name,programme_id,organization_id,start_date,end_date)
  VALUES(ca,'Executive Coaching – Demo Cohort A',pa,org,'2026-09-01','2026-12-01'),
        (cb,'Leadership Development – Demo Cohort B',pb,org,'2026-09-01','2027-03-01')
  ON CONFLICT(id) DO UPDATE SET name=excluded.name,programme_id=excluded.programme_id,organization_id=excluded.organization_id,start_date=excluded.start_date,end_date=excluded.end_date;

  -- Training weeks are created before module configuration and enrollment
  -- snapshots. Their fixed IDs are referenced by training_linked schedules.
  FOR i IN 1..4 LOOP
    INSERT INTO training_weeks(id,programme_id,week_number,title,skill_card_html,is_visible,unlock_date,sort_order)
      VALUES(('66666666-6666-4666-8666-'||lpad(i::text,12,'0'))::uuid,pb,i,
        format('Leadership module %s',i),'<p>Demo training content.</p>',true,
        '2026-09-01'::date+((i-1)*30),i)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,unlock_date=excluded.unlock_date,is_visible=true;
  END LOOP;
  -- Modules precede enrollment creation: the RPC snapshots these exact weights.
  INSERT INTO public.programme_modules(programme_id,module,enabled,config)
  VALUES
    (pa,'coaching',true,'{"required":true,"required_units":6,"distribution_mode":"evenly_distributed","weight":100}'),
    (pb,'training',true,'{"required":true,"required_units":4,"distribution_mode":"training_linked","distribution_settings":{"training_week_ids":["66666666-6666-4666-8666-000000000001","66666666-6666-4666-8666-000000000002","66666666-6666-4666-8666-000000000003","66666666-6666-4666-8666-000000000004"]},"weight":30}'),
    (pb,'coaching',true,'{"required":true,"required_units":6,"distribution_mode":"evenly_distributed","weight":25}'),
    (pb,'mentoring',true,'{"required":true,"required_units":2,"distribution_mode":"evenly_distributed","weight":15}'),
    (pb,'peer_coaching',true,'{"required":true,"required_units":2,"distribution_mode":"evenly_distributed","weight":15}'),
    (pb,'triads',true,'{"required":true,"required_units":2,"distribution_mode":"evenly_distributed","weight":15}')
  ON CONFLICT(programme_id,module) DO UPDATE SET enabled=excluded.enabled,config=excluded.config;

  -- Passwordless identities: an existing email always wins and its credentials
  -- are untouched. New local identities have no password hash.
  SELECT id INTO sponsor FROM auth.users WHERE lower(email)=lower('contact@erickson.vn') LIMIT 1;
  IF sponsor IS NULL THEN
    sponsor := '11111111-1111-4111-8111-111111111116';
    INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
    VALUES(sponsor,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','contact@erickson.vn',now(),'{"full_name":"Erickson Demo Sponsor"}',now(),now())
    ON CONFLICT(id) DO NOTHING;
  END IF;
  INSERT INTO public.profiles(id,email,full_name,status) VALUES(sponsor,'contact@erickson.vn','Erickson Demo Sponsor','active')
    ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name,status='active';
  INSERT INTO public.user_roles(user_id,role) VALUES(sponsor,'sponsor') ON CONFLICT(user_id,role) DO NOTHING;
  INSERT INTO public.sponsor_profiles(user_id,organization_id,title,department) VALUES(sponsor,org,'Programme Sponsor','Leadership Development')
    ON CONFLICT(user_id) DO UPDATE SET organization_id=excluded.organization_id;

  -- Preserved local operator and providers are deterministic, passwordless
  -- fixtures. Existing email identities always win, preserving credentials.
  SELECT id INTO admin_id FROM auth.users WHERE lower(email)='admin@demo.clariva.club' LIMIT 1;
  IF admin_id IS NULL THEN admin_id:='11111111-1111-4111-8111-111111111117';
    INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
    VALUES(admin_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@demo.clariva.club',now(),'{"full_name":"Local Demo Admin"}',now(),now()) ON CONFLICT(id) DO NOTHING;
  END IF;
  INSERT INTO profiles(id,email,full_name,status) VALUES(admin_id,'admin@demo.clariva.club','Local Demo Admin','active') ON CONFLICT(id) DO NOTHING;
  INSERT INTO user_roles(user_id,role) VALUES(admin_id,'admin') ON CONFLICT(user_id,role) DO NOTHING;
  FOR i IN 1..2 LOOP
    fixture_email:=format('provider.%s@demo.clariva.club',i); nm:=format('Demo Provider %s',i);
    SELECT id INTO uid FROM auth.users WHERE lower(auth.users.email)=lower(fixture_email) LIMIT 1;
    IF uid IS NULL THEN uid:=('11111111-1111-4111-8111-'||lpad((120+i)::text,12,'0'))::uuid;
      INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
      VALUES(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',fixture_email,now(),jsonb_build_object('full_name',nm),now(),now()) ON CONFLICT(id) DO NOTHING;
    END IF;
    INSERT INTO profiles(id,email,full_name,status) VALUES(uid,fixture_email,nm,'active') ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name;
    INSERT INTO user_roles(user_id,role) VALUES(uid,'coach') ON CONFLICT(user_id,role) DO NOTHING;
    INSERT INTO coach_profiles(id,title,approval_status) VALUES(uid,CASE WHEN i=1 THEN 'Executive Coach' ELSE 'Leadership Mentor' END,'active') ON CONFLICT(id) DO UPDATE SET approval_status='active';
  END LOOP;
  SELECT array_agg(p.id ORDER BY p.id) INTO coaches FROM profiles p JOIN user_roles r ON r.user_id=p.id
    WHERE r.role='coach';
  IF coalesce(array_length(coaches,1),0)<2 THEN RAISE EXCEPTION 'Need two existing coach/mentor providers; seed creates none'; END IF;
  coach:=coaches[1]; mentor:=coaches[2];

  FOR i IN 1..10 LOOP
    fixture_email:=format('leader.%s@demo.clariva.club',CASE WHEN i<=5 THEN 'a'||i ELSE 'b'||(i-5) END);
    nm:=format('Leader %s%s',CASE WHEN i<=5 THEN 'A' ELSE 'B' END,CASE WHEN i<=5 THEN i ELSE i-5 END);
    SELECT id INTO uid FROM auth.users WHERE lower(auth.users.email)=lower(fixture_email) LIMIT 1;
    IF uid IS NULL THEN
      uid:=('11111111-1111-4111-8111-'||lpad(i::text,12,'0'))::uuid;
      INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
      VALUES(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',fixture_email,now(),jsonb_build_object('full_name',nm),now(),now())
      ON CONFLICT(id) DO NOTHING;
    END IF;
    INSERT INTO profiles(id,email,full_name,status) VALUES(uid,fixture_email,nm,'active') ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name;
    INSERT INTO user_roles(user_id,role) VALUES(uid,'coachee') ON CONFLICT(user_id,role) DO NOTHING;
    INSERT INTO coachee_profiles(id,job_title,industry,location,timezone,goals,approval_status)
      VALUES(uid,'Demo Leader','Professional services','Ho Chi Minh City, Vietnam','Asia/Ho_Chi_Minh',
        'Practise leadership habits in a realistic programme fixture.','active')
      ON CONFLICT(id) DO UPDATE SET approval_status='active',goals=excluded.goals;
    cohort:=CASE WHEN i<=5 THEN ca ELSE cb END; programme:=CASE WHEN i<=5 THEN pa ELSE pb END;
    start_date:=CASE WHEN i=6 THEN '2026-09-01' WHEN i=7 THEN '2026-09-15'
      WHEN i=8 THEN '2026-09-01' WHEN i=9 THEN '2026-09-01' ELSE '2026-11-15' END;
    end_date:=CASE WHEN i<=5 THEN '2026-12-01' ELSE '2027-03-01' END;
    -- Scope lookup to this seed's organisation.  A preserved unrelated row
    -- must never be mistaken for one of the deterministic demo enrollments.
    SELECT id INTO eid FROM programme_enrollments
      WHERE user_id=uid AND cohort_id=cohort AND organization_id=org;
    IF eid IS NULL THEN
      -- Seed-only deterministic IDs; the production authoritative writer is
      -- unchanged. Schedule generation remains the authoritative snapshot
      -- operation after this fixed-ID local insert.
      eid:=('12121212-1212-4121-8121-'||lpad(i::text,12,'0'))::uuid;
      INSERT INTO programme_enrollments(id,user_id,coachee_id,programme_id,cohort_id,organization_id,start_date,end_date,status)
        VALUES(eid,uid,uid,programme,cohort,org,start_date,end_date,'active')
        ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,cohort_id=excluded.cohort_id,status=excluded.status;
      PERFORM generate_enrollment_schedule(eid);
    END IF;
    IF i=5 THEN UPDATE programme_enrollments SET status='paused' WHERE id=eid; END IF;
    IF i <> 10 THEN
    INSERT INTO coachee_goals(id,coachee_id,enrollment_id,title,description,status,target_date,sort_order)
      VALUES(('22222222-2222-4222-8222-'||lpad(i::text,12,'0'))::uuid,uid,eid,format('Demo goal %s',i),'Private goal detail','active',end_date,1)
      ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id,status='active',target_date=excluded.target_date;
    SELECT id INTO gid FROM coachee_goals WHERE id=('22222222-2222-4222-8222-'||lpad(i::text,12,'0'))::uuid;
    INSERT INTO coachee_goal_ratings(id,goal_id,coachee_id,enrollment_id,start_rating,current_rating,target_rating)
      VALUES(('33333333-3333-4333-8333-'||lpad(i::text,12,'0'))::uuid,gid,uid,eid,20,CASE WHEN i=3 THEN 25 ELSE 65 END,85)
      ON CONFLICT(goal_id) DO UPDATE SET enrollment_id=excluded.enrollment_id,current_rating=excluded.current_rating;
    INSERT INTO enrollment_actions(id,enrollment_id,goal_id,owner_user_id,title,description,status,due_date)
      VALUES(('44444444-4444-4444-8444-'||lpad(i::text,12,'0'))::uuid,eid,gid,uid,'Demo action','Private action detail',CASE WHEN i=3 THEN 'open' ELSE 'completed' END,start_date+30)
      ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id,status=excluded.status;
    END IF;
    INSERT INTO sessions(id,enrollment_id,coach_id,coachee_id,topic,start_time,duration_minutes,status,coachee_rating)
      VALUES(('55555555-5555-4555-8555-'||lpad(i::text,12,'0'))::uuid,eid,coach,uid,'Demo coaching session',
        CASE WHEN i=4 THEN '2026-11-20'::date WHEN i=10 THEN '2027-02-01'::date ELSE '2026-09-20'::date END,60,
        CASE WHEN i IN (4,10) THEN 'confirmed'::session_status ELSE 'completed'::session_status END,
        CASE WHEN i=10 THEN NULL ELSE 4 END)
      ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id,status=excluded.status;
    IF i=4 THEN
      INSERT INTO sessions(id,enrollment_id,coach_id,coachee_id,topic,start_time,duration_minutes,status,coachee_rating)
        VALUES('55555555-5555-4555-8555-000000000041',eid,coach,uid,'A4 completed coverage','2026-09-20',60,'completed',4)
        ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id,status='completed';
    END IF;
    IF i <> 10 THEN
    INSERT INTO goal_checkins(id,enrollment_id,goal_id,source_activity_type,source_activity_id,previous_rating,new_rating,note,actor_user_id)
      VALUES(('66666666-6666-4666-8666-'||lpad((100+i)::text,12,'0'))::uuid,eid,gid,'coaching',
        (CASE WHEN i=4 THEN '55555555-5555-4555-8555-000000000041'
              ELSE '55555555-5555-4555-8555-'||lpad(i::text,12,'0') END)::uuid,20,
        CASE WHEN i IN (3,5) THEN 25 ELSE 65 END,'Private check-in note',uid)
      ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id,new_rating=excluded.new_rating;
    END IF;
    PERFORM generate_enrollment_schedule(eid);
  END LOOP;
END $seed$;

-- Additional fixed coaching coverage makes A1 ahead, A2 on-track, A3
-- behind, A4 completed plus future booking, and A5 historical/paused.
DO $coverage$
DECLARE e uuid; u uuid; coach uuid; i int; n int; sid int;
BEGIN
  SELECT p.id INTO coach FROM profiles p JOIN user_roles r ON r.user_id=p.id WHERE r.role='coach' ORDER BY p.id LIMIT 1;
  FOR i IN 1..5 LOOP
    SELECT pe.id,pe.user_id INTO e,u FROM programme_enrollments pe WHERE pe.cohort_id='11111111-1111-4111-8111-111111111114' ORDER BY pe.id OFFSET (i-1) LIMIT 1;
    n:=CASE WHEN i=1 THEN 4 WHEN i=2 THEN 3 WHEN i=3 THEN 2 WHEN i=4 THEN 3 ELSE 2 END;
    FOR sid IN 1..n LOOP
      INSERT INTO sessions(id,enrollment_id,coach_id,coachee_id,topic,start_time,duration_minutes,status,coachee_rating)
        VALUES(('56565656-5656-4565-8565-'||lpad(((i*10)+sid)::text,12,'0'))::uuid,e,coach,u,
          format('A%s coaching coverage',i),'2026-09-05'::date+((sid-1)*7),60,
          CASE WHEN i=4 AND sid=n THEN 'confirmed'::session_status
               WHEN i IN (3,5) AND sid=n THEN 'cancelled'::session_status
               ELSE 'completed'::session_status END,
          CASE WHEN sid<n THEN 4 ELSE NULL END)
        ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id,status=excluded.status;
    END LOOP;
  END LOOP;
END $coverage$;

-- Programme B content and activity matrix. IDs are fixed so a second local
-- reset produces the same rows rather than accumulating demonstrations.
DO $content$
DECLARE
  pb uuid := '11111111-1111-4111-8111-111111111113';
  cb uuid := '11111111-1111-4111-8111-111111111115';
  w uuid; a uuid; p uuid; r uuid; q uuid; sub uuid;
  u1 uuid; u2 uuid; u3 uuid; u4 uuid; u5 uuid;
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid;
  mentor_provider uuid;
  i int;
BEGIN
  SELECT p.id INTO mentor_provider FROM profiles p JOIN user_roles r ON r.user_id=p.id
    WHERE r.role='coach' ORDER BY p.id OFFSET 1 LIMIT 1;
  IF mentor_provider IS NULL THEN RAISE EXCEPTION 'Missing preserved mentor provider'; END IF;
  INSERT INTO mentor_profiles(coach_user_id,is_active,bio,expertise_tags)
    VALUES(mentor_provider,true,'Deterministic local mentor fixture','{leadership,coaching}')
    ON CONFLICT(coach_user_id) DO UPDATE SET is_active=true;
  SELECT e.id,e.user_id INTO e1,u1 FROM programme_enrollments e WHERE e.cohort_id=cb ORDER BY e.id OFFSET 0 LIMIT 1;
  SELECT e.id,e.user_id INTO e2,u2 FROM programme_enrollments e WHERE e.cohort_id=cb ORDER BY e.id OFFSET 1 LIMIT 1;
  SELECT e.id,e.user_id INTO e3,u3 FROM programme_enrollments e WHERE e.cohort_id=cb ORDER BY e.id OFFSET 2 LIMIT 1;
  SELECT e.id,e.user_id INTO e4,u4 FROM programme_enrollments e WHERE e.cohort_id=cb ORDER BY e.id OFFSET 3 LIMIT 1;
  SELECT e.id,e.user_id INTO e5,u5 FROM programme_enrollments e WHERE e.cohort_id=cb ORDER BY e.id OFFSET 4 LIMIT 1;
  FOR i IN 1..4 LOOP
    w:=('66666666-6666-4666-8666-'||lpad(i::text,12,'0'))::uuid;
    INSERT INTO training_weeks(id,programme_id,week_number,title,skill_card_html,is_visible,unlock_date,sort_order)
      VALUES(w,pb,i,format('Leadership module %s',i),'<p>Demo training content.</p>',true,'2026-09-01'::date+((i-1)*30),i)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,unlock_date=excluded.unlock_date,is_visible=true;
    INSERT INTO training_progress(id,user_id,enrollment_id,training_week_id,viewed_at,completed_at)
      VALUES(('77777777-7777-4777-8777-'||lpad(i::text,12,'0'))::uuid,u1,e1,w,'2026-10-01','2026-10-02')
      ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id,completed_at=excluded.completed_at;
    INSERT INTO assignments(id,training_week_id,assignment_type,title,instructions,is_visible,due_offset_days,sort_order)
      VALUES(('88888888-8888-4888-8888-'||lpad(i::text,12,'0'))::uuid,w,'reflection','Module reflection','Demo assignment',true,14,1)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,is_visible=true;
    INSERT INTO daily_prompts(id,training_week_id,day_offset,prompt_text)
      VALUES(('99999999-9999-4999-8999-'||lpad(i::text,12,'0'))::uuid,w,1,'What will you practise this week?')
      ON CONFLICT(id) DO UPDATE SET prompt_text=excluded.prompt_text;
    INSERT INTO programme_reflections(id,programme_id,reflection_number,title,instructions,appears_at_week,is_visible)
      VALUES(('aaaaaaaa-aaaa-4aaa-8aaa-'||lpad(i::text,12,'0'))::uuid,pb,i,format('Programme reflection %s',i),'Private reflection',i,true)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,is_visible=true;
    SELECT id INTO a FROM assignments WHERE training_week_id=w LIMIT 1;
    INSERT INTO assignment_submissions(id,assignment_id,user_id,enrollment_id,reflection_text)
      VALUES(('bbbbbbbb-bbbb-4bbb-8bbb-'||lpad(i::text,12,'0'))::uuid,a,u1,e1,'Private assignment response')
      ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id;
    IF i <= 2 THEN
      INSERT INTO assignment_submissions(id,assignment_id,user_id,enrollment_id,reflection_text)
        VALUES(('bbbbbbbb-bbbb-4bbb-8bbb-'||lpad((100+i)::text,12,'0'))::uuid,a,u2,e2,'B2 assignment response')
        ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id;
    END IF;
    IF i <= 4 THEN
      INSERT INTO assignment_submissions(id,assignment_id,user_id,enrollment_id,reflection_text)
        VALUES(('bbbbbbbb-bbbb-4bbb-8bbb-'||lpad((200+i)::text,12,'0'))::uuid,a,u3,e3,'B3 assignment response')
        ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id;
    END IF;
    IF i = 1 THEN
      INSERT INTO assignment_submissions(id,assignment_id,user_id,enrollment_id,reflection_text)
        VALUES('bbbbbbbb-bbbb-4bbb-8bbb-000000000301',a,u4,e4,'B4 assignment response')
        ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id;
    END IF;
    INSERT INTO daily_prompt_responses(id,daily_prompt_id,user_id,enrollment_id,opened_at,response_text,responded_at)
      VALUES(('cccccccc-cccc-4ccc-8ccc-'||lpad(i::text,12,'0'))::uuid,
        ('99999999-9999-4999-8999-'||lpad(i::text,12,'0'))::uuid,u1,e1,'2026-10-01','Private prompt response','2026-10-01')
      ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id,response_text=excluded.response_text;
    IF i <= 2 THEN
      INSERT INTO daily_prompt_responses(id,daily_prompt_id,user_id,enrollment_id,opened_at,response_text,responded_at)
        VALUES(('cccccccc-cccc-4ccc-8ccc-'||lpad((100+i)::text,12,'0'))::uuid,
          ('99999999-9999-4999-8999-'||lpad(i::text,12,'0'))::uuid,u2,e2,'2026-10-01','B2 prompt response','2026-10-01')
        ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id,response_text=excluded.response_text;
    END IF;
    IF i = 1 THEN
      INSERT INTO daily_prompt_responses(id,daily_prompt_id,user_id,enrollment_id,opened_at,response_text,responded_at)
        VALUES('cccccccc-cccc-4ccc-8ccc-000000000301',
          ('99999999-9999-4999-8999-'||lpad(i::text,12,'0'))::uuid,u4,e4,'2026-10-01','B4 prompt response','2026-10-01')
        ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id,response_text=excluded.response_text;
    END IF;
    SELECT id INTO r FROM programme_reflections WHERE programme_id=pb AND reflection_number=i;
    INSERT INTO reflection_submissions(id,reflection_id,user_id,enrollment_id,confidence_score)
      VALUES(('dddddddd-dddd-4ddd-8ddd-'||lpad(i::text,12,'0'))::uuid,r,u1,e1,7)
      ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id;
    IF i <= 4 THEN
      INSERT INTO reflection_submissions(id,reflection_id,user_id,enrollment_id,confidence_score)
        VALUES(('dddddddd-dddd-4ddd-8ddd-'||lpad((200+i)::text,12,'0'))::uuid,r,u3,e3,8)
        ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id;
    END IF;
  END LOOP;
  INSERT INTO triad_groups(id,cohort_id,programme_id,name,member_1_id,member_2_id,member_3_id,enrollment_1_id,enrollment_2_id,enrollment_3_id)
    VALUES('eeeeeeee-eeee-4eee-8eee-000000000001',cb,pb,'B Demo Triad',u1,u2,u3,e1,e2,e3)
    ON CONFLICT(id) DO UPDATE SET member_1_id=excluded.member_1_id,member_2_id=excluded.member_2_id,member_3_id=excluded.member_3_id,enrollment_1_id=excluded.enrollment_1_id,enrollment_2_id=excluded.enrollment_2_id,enrollment_3_id=excluded.enrollment_3_id;
  SELECT id INTO w FROM training_weeks WHERE programme_id=pb AND week_number=1;
  INSERT INTO triad_sessions(id,triad_group_id,proposed_start_time,proposed_end_time,proposed_by,member_1_response,member_2_response,member_3_response,coach_enrollment_id,coachee_enrollment_id,observer_enrollment_id,status,notes)
    VALUES('eeeeeeee-eeee-4eee-8eee-000000000002','eeeeeeee-eeee-4eee-8eee-000000000001','2026-10-10T10:00:00Z','2026-10-10T11:00:00Z','system','accepted','accepted','accepted',e1,e2,e3,'confirmed','Private triad notes')
    ON CONFLICT(id) DO UPDATE SET status=excluded.status,notes=excluded.notes;
  INSERT INTO peer_sessions(id,enrollment_id,peer_coach_id,peer_coachee_id,topic,start_time,duration_minutes,status,coachee_rating)
    VALUES('eeeeeeee-eeee-4eee-8eee-000000000003',e2,u1,u2,'B peer practice','2026-10-15',60,'completed',5),
          ('eeeeeeee-eeee-4eee-8eee-000000000004',e3,u2,u3,'B peer practice','2026-11-15',60,'confirmed',NULL)
    ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id,status=excluded.status;
  INSERT INTO mentoring_sessions(id,enrollment_id,mentor_id,mentee_id,topic,start_time,duration_minutes,status,prep_file_path,mentee_notes)
    VALUES('eeeeeeee-eeee-4eee-8eee-000000000005',e2,mentor_provider,u2,'B mentoring','2026-10-20',60,'completed','demo/prep.txt','Private mentoring note'),
          ('eeeeeeee-eeee-4eee-8eee-000000000006',e4,mentor_provider,u4,'B mentoring booked','2026-11-20',60,'confirmed','demo/prep.txt',NULL)
    ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id,status=excluded.status;
  INSERT INTO coach_session_private_notes(session_id,coach_id,body)
    SELECT id,coach_id,'Private coaching note for privacy assertions'
    FROM sessions WHERE id IN (
      '55555555-5555-4555-8555-000000000001'::uuid,'55555555-5555-4555-8555-000000000002'::uuid,
      '55555555-5555-4555-8555-000000000003'::uuid,'55555555-5555-4555-8555-000000000004'::uuid,
      '55555555-5555-4555-8555-000000000005'::uuid,'55555555-5555-4555-8555-000000000006'::uuid,
      '55555555-5555-4555-8555-000000000007'::uuid,'55555555-5555-4555-8555-000000000008'::uuid,
      '55555555-5555-4555-8555-000000000009'::uuid,'55555555-5555-4555-8555-000000000010'::uuid)
    ON CONFLICT(session_id) DO UPDATE SET body=excluded.body;
END $content$;

-- Fixed B progress matrix: B1 complete, B2 half-way/on-track, B3 training
-- complete but coaching remains behind, B4 has only its first module, and B5
-- has not reached a due milestone at the documented anchor.
DO $matrix$
DECLARE
  e uuid; u uuid; w uuid; i int; n int;
BEGIN
  SELECT id,user_id INTO e,u FROM programme_enrollments WHERE cohort_id='11111111-1111-4111-8111-111111111115' ORDER BY id OFFSET 1 LIMIT 1;
  FOR i IN 1..2 LOOP
    SELECT id INTO w FROM training_weeks WHERE programme_id='11111111-1111-4111-8111-111111111113' AND week_number=i;
    INSERT INTO training_progress(id,user_id,enrollment_id,training_week_id,viewed_at,completed_at)
      VALUES(('77777777-7777-4777-8777-'||lpad((100+i)::text,12,'0'))::uuid,u,e,w,'2026-10-01','2026-10-02')
      ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id,completed_at=excluded.completed_at;
  END LOOP;
  SELECT id,user_id INTO e,u FROM programme_enrollments WHERE cohort_id='11111111-1111-4111-8111-111111111115' ORDER BY id OFFSET 2 LIMIT 1;
  FOR i IN 1..4 LOOP
    SELECT id INTO w FROM training_weeks WHERE programme_id='11111111-1111-4111-8111-111111111113' AND week_number=i;
    INSERT INTO training_progress(id,user_id,enrollment_id,training_week_id,viewed_at,completed_at)
      VALUES(('77777777-7777-4777-8777-'||lpad((200+i)::text,12,'0'))::uuid,u,e,w,'2026-10-01','2026-10-02')
      ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id,completed_at=excluded.completed_at;
  END LOOP;
  SELECT id,user_id INTO e,u FROM programme_enrollments WHERE cohort_id='11111111-1111-4111-8111-111111111115' ORDER BY id OFFSET 3 LIMIT 1;
  SELECT id INTO w FROM training_weeks WHERE programme_id='11111111-1111-4111-8111-111111111113' AND week_number=1;
  INSERT INTO training_progress(id,user_id,enrollment_id,training_week_id,viewed_at,completed_at)
    VALUES('77777777-7777-4777-8777-000000000301',u,e,w,'2026-10-01','2026-10-02')
    ON CONFLICT(id) DO UPDATE SET enrollment_id=excluded.enrollment_id,completed_at=excluded.completed_at;
END $matrix$;
COMMIT;