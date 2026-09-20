-- Legacy (pre-cutover) Triad fixture for the deployment-1 rehearsal.
-- Loaded into a database at 20260918180000 (the production state), inside
-- the rehearsal transaction; legacy triggers are bypassed so the fixture can
-- hold the inconsistent shapes production legacy data can have.
--
--   DEMO org cohort CD (programme P2, Triads required 2):
--     GD: s1 completed at T, s2 completed at the same T with no history
--         -> s2 is an accidental duplicate (DEMO/SEED) -> removed (case I)
--   REAL org cohort CR (programme P2):
--     GR_old (older, active, legacy round 1): r1 + r4, completed at today-80
--     GR (newer, active, legacy round 2):     r1 + r2 + r3, completed at
--         today-70 (with a reflection) + confirmed at today+10
--         -> r1 is in two active groups: the older one is closed; r1 keeps
--            both sessions (old group + new group = 2/2)
--     GH: r5 + r6, two completed sessions at the same time, the second with
--         a reflection -> genuine distinct records, both count (case H)
--   REAL org cohort CT (programme PT, no Triad requirement):
--     GT_seed (deterministic seed id): confirmed session with a reflection
--         submitted in the future -> DEMO/SEED conflict -> removed
--   (pass 2 adds GT_real, a REAL/UNKNOWN conflicting group -> the cleanup stops)

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change_token_new, recovery_token)
select ('a9000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  case when n <= 3 then 'demo-' || n || '@demo.clariva.club' else 'real-' || n || '@example.test' end,
  'test', now(), jsonb_build_object('full_name', 'Rehearsal ' || n), now(), now(), '', '', ''
from generate_series(1, 12) n;

insert into public.organizations (id, name) values
  ('b9000000-0000-0000-0000-0000000000d1', 'Clariva Demo Organization'),
  ('b9000000-0000-0000-0000-0000000000e1', 'Rehearsal client');
insert into public.programmes (id, name) values
  ('c9000000-0000-0000-0000-0000000000a2', 'Rehearsal P2'),
  ('c9000000-0000-0000-0000-0000000000a0', 'Rehearsal PT (no Triads)');
insert into public.programme_modules (programme_id, module, enabled, config) values
  ('c9000000-0000-0000-0000-0000000000a2', 'triads', true, jsonb_build_object(
    'required', true, 'required_units', 2, 'distribution_settings', jsonb_build_object('milestones', jsonb_build_array(
      jsonb_build_object('due_on', (current_date - 60)::text, 'required_units', 1),
      jsonb_build_object('due_on', (current_date + 60)::text, 'required_units', 1))))),
  ('c9000000-0000-0000-0000-0000000000a0', 'triads', true, '{"group_size":3}');
insert into public.cohorts (id, name, programme_id, organization_id, start_date, end_date) values
  ('d9000000-0000-0000-0000-0000000000cd', 'CD', 'c9000000-0000-0000-0000-0000000000a2', 'b9000000-0000-0000-0000-0000000000d1', current_date - 120, current_date + 120),
  ('d9000000-0000-0000-0000-0000000000c1', 'CR', 'c9000000-0000-0000-0000-0000000000a2', 'b9000000-0000-0000-0000-0000000000e1', current_date - 120, current_date + 120),
  ('d9000000-0000-0000-0000-0000000000c0', 'CT', 'c9000000-0000-0000-0000-0000000000a0', 'b9000000-0000-0000-0000-0000000000e1', current_date - 120, current_date + 120);
insert into public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status)
select ('e9000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, ('a9000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  case when n >= 10 then 'c9000000-0000-0000-0000-0000000000a0' else 'c9000000-0000-0000-0000-0000000000a2' end::uuid,
  case when n <= 3 then 'd9000000-0000-0000-0000-0000000000cd' when n >= 10 then 'd9000000-0000-0000-0000-0000000000c0'
       else 'd9000000-0000-0000-0000-0000000000c1' end::uuid,
  case when n <= 3 then 'b9000000-0000-0000-0000-0000000000d1' else 'b9000000-0000-0000-0000-0000000000e1' end::uuid,
  current_date - 120, current_date + 120, 'active'::public.enrollment_status
from generate_series(1, 12) n;

alter table public.triad_groups disable trigger user;
alter table public.triad_sessions disable trigger user;
alter table public.triad_reflections disable trigger user;

-- legacy groups: slot learners + slot enrollments (+ programme / round)
insert into public.triad_groups (id, cohort_id, programme_id, name, member_1_id, member_2_id, member_3_id,
  enrollment_1_id, enrollment_2_id, enrollment_3_id, is_active, assigned_by, group_language, round_number, created_at)
select g.id, g.cohort, g.programme, g.name,
  u1, u2, u3,
  replace(u1::text, 'a9000000', 'e9000000')::uuid, replace(u2::text, 'a9000000', 'e9000000')::uuid,
  replace(u3::text, 'a9000000', 'e9000000')::uuid,
  true, 'admin', 'en', g.round, g.created
from (values
  ('19000000-1111-4111-8111-0000000000d0'::uuid, 'd9000000-0000-0000-0000-0000000000cd'::uuid, 'c9000000-0000-0000-0000-0000000000a2'::uuid, 'GD', 'a9000000-0000-0000-0000-000000000001'::uuid, 'a9000000-0000-0000-0000-000000000002'::uuid, 'a9000000-0000-0000-0000-000000000003'::uuid, 1, now() - interval '100 days'),
  ('19000000-1111-4111-8111-0000000000a0'::uuid, 'd9000000-0000-0000-0000-0000000000c1'::uuid, 'c9000000-0000-0000-0000-0000000000a2'::uuid, 'GR_old', 'a9000000-0000-0000-0000-000000000004'::uuid, 'a9000000-0000-0000-0000-000000000007'::uuid, null::uuid, 1, now() - interval '100 days'),
  ('19000000-1111-4111-8111-0000000000a1'::uuid, 'd9000000-0000-0000-0000-0000000000c1'::uuid, 'c9000000-0000-0000-0000-0000000000a2'::uuid, 'GR', 'a9000000-0000-0000-0000-000000000004'::uuid, 'a9000000-0000-0000-0000-000000000005'::uuid, 'a9000000-0000-0000-0000-000000000006'::uuid, 2, now() - interval '90 days'),
  ('19000000-1111-4111-8111-0000000000b0'::uuid, 'd9000000-0000-0000-0000-0000000000c1'::uuid, 'c9000000-0000-0000-0000-0000000000a2'::uuid, 'GH', 'a9000000-0000-0000-0000-000000000008'::uuid, 'a9000000-0000-0000-0000-000000000009'::uuid, null::uuid, 1, now() - interval '90 days'),
  ('f9000000-0000-0000-0000-00000000a001'::uuid, 'd9000000-0000-0000-0000-0000000000c0'::uuid, 'c9000000-0000-0000-0000-0000000000a0'::uuid, 'GT_seed', 'a9000000-0000-0000-0000-000000000010'::uuid, 'a9000000-0000-0000-0000-000000000011'::uuid, null::uuid, 1, now() - interval '30 days')
) as g(id, cohort, programme, name, u1, u2, u3, round, created);

-- legacy sessions: role enrollments = the group's slot enrollments
insert into public.triad_sessions (id, triad_group_id, start_time, proposed_start_time, proposed_end_time, status,
  member_1_response, member_2_response, member_3_response, coach_enrollment_id, coachee_enrollment_id, observer_enrollment_id, created_at, updated_at)
select s.id, s.grp, s.t, s.t, s.t + interval '1 hour', s.status, 'accepted', 'accepted', case when g.enrollment_3_id is null then null else 'accepted' end,
  g.enrollment_1_id, g.enrollment_2_id, g.enrollment_3_id, s.t - interval '10 days', s.t - interval '10 days'
from (values
  ('29000000-2222-4222-8222-0000000000d1'::uuid, '19000000-1111-4111-8111-0000000000d0'::uuid, date_trunc('hour', now()) - interval '75 days', 'completed'),
  ('29000000-2222-4222-8222-0000000000d2'::uuid, '19000000-1111-4111-8111-0000000000d0'::uuid, date_trunc('hour', now()) - interval '75 days', 'completed'),
  ('29000000-2222-4222-8222-0000000000a0'::uuid, '19000000-1111-4111-8111-0000000000a0'::uuid, date_trunc('hour', now()) - interval '80 days', 'completed'),
  ('29000000-2222-4222-8222-0000000000a1'::uuid, '19000000-1111-4111-8111-0000000000a1'::uuid, date_trunc('hour', now()) - interval '70 days', 'completed'),
  ('29000000-2222-4222-8222-0000000000a2'::uuid, '19000000-1111-4111-8111-0000000000a1'::uuid, date_trunc('hour', now()) + interval '10 days', 'confirmed'),
  ('29000000-2222-4222-8222-0000000000b1'::uuid, '19000000-1111-4111-8111-0000000000b0'::uuid, date_trunc('hour', now()) - interval '50 days', 'completed'),
  ('29000000-2222-4222-8222-0000000000b2'::uuid, '19000000-1111-4111-8111-0000000000b0'::uuid, date_trunc('hour', now()) - interval '50 days', 'completed'),
  ('f9000000-0000-0000-0000-00000000a011'::uuid, 'f9000000-0000-0000-0000-00000000a001'::uuid, date_trunc('hour', now()) + interval '2 days', 'confirmed')
) as s(id, grp, t, status)
join public.triad_groups g on g.id = s.grp;

-- legacy reflections (answer columns + participant)
insert into public.triad_reflections (id, triad_session_id, participant_id, enrollment_id, learned_as_coach, will_use_as_observer, satisfaction_rating, submitted_at)
values
  ('39000000-3333-4333-8333-0000000000a1', '29000000-2222-4222-8222-0000000000a1', 'a9000000-0000-0000-0000-000000000005', 'e9000000-0000-0000-0000-000000000005', 'Silence helps', 'Name patterns', 4, now() - interval '69 days'),
  ('39000000-3333-4333-8333-0000000000b2', '29000000-2222-4222-8222-0000000000b2', 'a9000000-0000-0000-0000-000000000009', 'e9000000-0000-0000-0000-000000000009', 'Second practice', null, 5, now() - interval '49 days'),
  ('f9000000-0000-0000-0000-00000000a021', 'f9000000-0000-0000-0000-00000000a011', 'a9000000-0000-0000-0000-000000000010', 'e9000000-0000-0000-0000-000000000010', 'Seeded ahead of time', null, 3, now() + interval '3 days');

alter table public.triad_groups enable trigger user;
alter table public.triad_sessions enable trigger user;
alter table public.triad_reflections enable trigger user;

-- legacy evidence: one attribution per slot enrollment of each session with a time
insert into public.session_activity_attributions (enrollment_id, module, source_activity_type, source_activity_id, occurred_on)
select slot.e, 'triads', 'triad', s.id, coalesce(s.proposed_start_time, s.start_time)::date
from public.triad_sessions s join public.triad_groups g on g.id = s.triad_group_id
cross join lateral (values (g.enrollment_1_id), (g.enrollment_2_id), (g.enrollment_3_id)) slot(e)
where slot.e is not null and s.id::text like '29000000-%'
on conflict do nothing;
