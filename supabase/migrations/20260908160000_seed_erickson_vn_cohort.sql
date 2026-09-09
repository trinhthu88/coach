-- Seed: Erickson VN organization, sponsor (contact@erickson.vn),
-- and three participant coachees (Claire Dubois, daniel.okafor@erickson.vn,
-- Yuki Tanaka) with rich training, session, peer, mentoring, triad,
-- and feedback data so sponsor_* RPC functions return compelling report data.
--
-- Strategy:
--   • Creates auth users directly (pgcrypto bcrypt hash, password "Clariva2026!")
--   • The on_auth_user_created trigger auto-creates profiles + coachee user_role
--   • Org + sponsor_profiles + new cohort link to the same programme as TASC cohort 1
--   • All three coachees enrolled with organization_id = Erickson org
--   • Varied engagement: Yuki=high, Claire=medium, Daniel=at_risk for interesting KPIs
-- Idempotent: all INSERTs use ON CONFLICT DO UPDATE / DO NOTHING.

DO $erickson_seed$
DECLARE
  v_org_id        UUID := 'ee000000-0000-0000-0000-000000000001'::uuid;
  v_sponsor_id    UUID := 'ee000000-0000-0000-0000-000000000002'::uuid;
  v_claire_id     UUID := 'ee000000-0000-0000-0000-000000000010'::uuid;
  v_daniel_id     UUID := 'ee000000-0000-0000-0000-000000000020'::uuid;
  v_yuki_id       UUID := 'ee000000-0000-0000-0000-000000000030'::uuid;
  v_programme_id  UUID;
  v_cohort_id     UUID := 'ee000000-0000-0000-0000-000000000050'::uuid;
  v_week1_id      UUID;
  v_week2_id      UUID;
  v_week3_id      UUID;
  v_week4_id      UUID;
  v_quiz1_id      UUID;
  v_quiz2_id      UUID;
  v_quiz3_id      UUID;
  v_quiz4_id      UUID;
  v_refl1_id      UUID;
  v_coach1_id     UUID;
  v_coach2_id     UUID;
  v_mentor_id     UUID;
  v_triad_group_id UUID := 'ee000000-0000-0000-0000-000000000060'::uuid;
  v_triad_s1_id   UUID := 'ee000000-0000-0000-0000-000000000061'::uuid;
  v_triad_s2_id   UUID := 'ee000000-0000-0000-0000-000000000062'::uuid;
  v_pw_hash       TEXT;
BEGIN

  -- ──────────────────────────────────────────────────────────────
  -- 0. Password hash (pgcrypto)
  -- ──────────────────────────────────────────────────────────────
  v_pw_hash := extensions.crypt('Clariva2026!', extensions.gen_salt('bf', 10));

  -- ──────────────────────────────────────────────────────────────
  -- 1. Resolve programme (TASC - Essential Course)
  -- ──────────────────────────────────────────────────────────────
  SELECT id INTO v_programme_id FROM public.programmes WHERE name = 'TASC - Essential Course' LIMIT 1;
  IF v_programme_id IS NULL THEN
    RAISE NOTICE 'TASC programme not found — skipping Erickson cohort seed';
    RETURN;
  END IF;

  -- Training week IDs from the existing seed
  SELECT id INTO v_week1_id FROM public.training_weeks WHERE programme_id = v_programme_id AND week_number = 1 LIMIT 1;
  SELECT id INTO v_week2_id FROM public.training_weeks WHERE programme_id = v_programme_id AND week_number = 2 LIMIT 1;
  SELECT id INTO v_week3_id FROM public.training_weeks WHERE programme_id = v_programme_id AND week_number = 3 LIMIT 1;
  SELECT id INTO v_week4_id FROM public.training_weeks WHERE programme_id = v_programme_id AND week_number = 4 LIMIT 1;

  -- Quiz assignment IDs
  SELECT a.id INTO v_quiz1_id FROM public.assignments a
    JOIN public.training_weeks tw ON tw.id = a.training_week_id
    WHERE tw.programme_id = v_programme_id AND tw.week_number = 1 AND a.assignment_type = 'quiz' LIMIT 1;
  SELECT a.id INTO v_quiz2_id FROM public.assignments a
    JOIN public.training_weeks tw ON tw.id = a.training_week_id
    WHERE tw.programme_id = v_programme_id AND tw.week_number = 2 AND a.assignment_type = 'quiz' LIMIT 1;
  SELECT a.id INTO v_quiz3_id FROM public.assignments a
    JOIN public.training_weeks tw ON tw.id = a.training_week_id
    WHERE tw.programme_id = v_programme_id AND tw.week_number = 3 AND a.assignment_type = 'quiz' LIMIT 1;
  SELECT a.id INTO v_quiz4_id FROM public.assignments a
    JOIN public.training_weeks tw ON tw.id = a.training_week_id
    WHERE tw.programme_id = v_programme_id AND tw.week_number = 4 AND a.assignment_type = 'quiz' LIMIT 1;

  -- Programme reflection
  SELECT id INTO v_refl1_id FROM public.programme_reflections
    WHERE programme_id = v_programme_id AND reflection_number = 1 LIMIT 1;

  -- Coaches (pick first two available)
  SELECT p.id INTO v_coach1_id FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.id WHERE r.role = 'coach' ORDER BY p.created_at LIMIT 1;
  SELECT p.id INTO v_coach2_id FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.id
    WHERE r.role = 'coach' AND p.id <> COALESCE(v_coach1_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY p.created_at LIMIT 1;
  v_coach2_id := COALESCE(v_coach2_id, v_coach1_id);
  v_mentor_id := COALESCE(v_coach1_id, v_coach2_id);

  IF v_coach1_id IS NULL THEN
    RAISE NOTICE 'No coaches found — skipping Erickson cohort seed';
    RETURN;
  END IF;

  -- ──────────────────────────────────────────────────────────────
  -- 2. Organization
  -- ──────────────────────────────────────────────────────────────
  INSERT INTO public.organizations (id, name, industry, subscription_tier, contract_start, contract_end, coaching_budget, hq_country)
  VALUES (v_org_id, 'Erickson Coaching Vietnam', 'Education & Professional Development', 'enterprise', '2026-09-01', '2027-02-28', 48000, 'Vietnam')
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, industry = EXCLUDED.industry,
    subscription_tier = EXCLUDED.subscription_tier,
    contract_start = EXCLUDED.contract_start, contract_end = EXCLUDED.contract_end,
    coaching_budget = EXCLUDED.coaching_budget;

  -- ──────────────────────────────────────────────────────────────
  -- 3. Auth users (trigger auto-creates profiles + coachee roles)
  -- ──────────────────────────────────────────────────────────────

  -- Each user below resolves by email first, falling back to inserting
  -- with the fixed id only when no row exists yet. This is necessary (not
  -- just defensive): auth.users' real uniqueness constraint that matters
  -- here is on email (a partial unique index, "users_email_partial_key"),
  -- not id — an ON CONFLICT (id) DO NOTHING insert still errors on a
  -- stray pre-existing row for the same email under a different id, and
  -- every downstream table below (sponsor_profiles, coachee_profiles,
  -- programme_enrollments, ...) is keyed off these v_*_id variables, so
  -- reusing whatever id the email already resolves to — rather than
  -- assuming our fixed constant — is what keeps this migration idempotent
  -- against that case instead of just failing on retry.

  -- Sponsor: contact@erickson.vn
  SELECT id INTO v_sponsor_id FROM auth.users WHERE email = 'contact@erickson.vn' LIMIT 1;
  IF v_sponsor_id IS NULL THEN
    v_sponsor_id := 'ee000000-0000-0000-0000-000000000002'::uuid;
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change_token_new, recovery_token)
    VALUES (v_sponsor_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'contact@erickson.vn', v_pw_hash, now(),
      '{"full_name":"Erickson VN Sponsor","role":"coachee"}'::jsonb,
      now(), now(), '', '', '')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Claire Dubois
  SELECT id INTO v_claire_id FROM auth.users WHERE email = 'claire.dubois@erickson.vn' LIMIT 1;
  IF v_claire_id IS NULL THEN
    v_claire_id := 'ee000000-0000-0000-0000-000000000010'::uuid;
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change_token_new, recovery_token)
    VALUES (v_claire_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'claire.dubois@erickson.vn', v_pw_hash, now(),
      '{"full_name":"Claire Dubois","role":"coachee"}'::jsonb,
      now(), now(), '', '', '')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Daniel Okafor
  SELECT id INTO v_daniel_id FROM auth.users WHERE email = 'daniel.okafor@erickson.vn' LIMIT 1;
  IF v_daniel_id IS NULL THEN
    v_daniel_id := 'ee000000-0000-0000-0000-000000000020'::uuid;
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change_token_new, recovery_token)
    VALUES (v_daniel_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'daniel.okafor@erickson.vn', v_pw_hash, now(),
      '{"full_name":"Daniel Okafor","role":"coachee"}'::jsonb,
      now(), now(), '', '', '')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Yuki Tanaka
  SELECT id INTO v_yuki_id FROM auth.users WHERE email = 'yuki.tanaka@erickson.vn' LIMIT 1;
  IF v_yuki_id IS NULL THEN
    v_yuki_id := 'ee000000-0000-0000-0000-000000000030'::uuid;
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change_token_new, recovery_token)
    VALUES (v_yuki_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'yuki.tanaka@erickson.vn', v_pw_hash, now(),
      '{"full_name":"Yuki Tanaka","role":"coachee"}'::jsonb,
      now(), now(), '', '', '')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- ──────────────────────────────────────────────────────────────
  -- 4. Enrich profiles (bio, language, onboarding)
  -- ──────────────────────────────────────────────────────────────
  UPDATE public.profiles SET
    full_name = 'Claire Dubois',
    bio = 'HR Director at Erickson VN. Passionate about building coaching culture across teams.',
    onboarding_completed_at = '2026-09-02T09:00:00Z',
    preferred_language = 'en'
  WHERE id = v_claire_id;

  UPDATE public.profiles SET
    full_name = 'Daniel Okafor',
    bio = 'Learning & Development Manager. Exploring coaching as a leadership tool.',
    onboarding_completed_at = '2026-09-02T10:30:00Z',
    preferred_language = 'en'
  WHERE id = v_daniel_id;

  UPDATE public.profiles SET
    full_name = 'Yuki Tanaka',
    bio = 'Senior Programme Manager at Erickson VN. Committed to applying coaching skills daily.',
    onboarding_completed_at = '2026-09-02T08:00:00Z',
    preferred_language = 'en'
  WHERE id = v_yuki_id;

  UPDATE public.profiles SET full_name = 'Erickson VN Sponsor'
  WHERE id = v_sponsor_id;

  -- ──────────────────────────────────────────────────────────────
  -- 5. Coachee profiles
  -- ──────────────────────────────────────────────────────────────
  INSERT INTO public.coachee_profiles (id, job_title, industry, location, timezone, goals, approval_status)
  VALUES (v_claire_id, 'HR Director', 'Professional Development', 'Ho Chi Minh City, Vietnam', 'Asia/Ho_Chi_Minh',
    'Develop coaching presence; build a culture of feedback in my team.', 'active')
  ON CONFLICT (id) DO UPDATE SET job_title = EXCLUDED.job_title, goals = EXCLUDED.goals, approval_status = EXCLUDED.approval_status;

  INSERT INTO public.coachee_profiles (id, job_title, industry, location, timezone, goals, approval_status)
  VALUES (v_daniel_id, 'L&D Manager', 'Professional Development', 'Hanoi, Vietnam', 'Asia/Ho_Chi_Minh',
    'Apply coaching frameworks in 1-on-1s; reduce over-advising.', 'active')
  ON CONFLICT (id) DO UPDATE SET job_title = EXCLUDED.job_title, goals = EXCLUDED.goals, approval_status = EXCLUDED.approval_status;

  INSERT INTO public.coachee_profiles (id, job_title, industry, location, timezone, goals, approval_status)
  VALUES (v_yuki_id, 'Senior Programme Manager', 'Professional Development', 'Ho Chi Minh City, Vietnam', 'Asia/Ho_Chi_Minh',
    'Master the SHIFT model; become a credible internal coach.', 'active')
  ON CONFLICT (id) DO UPDATE SET job_title = EXCLUDED.job_title, goals = EXCLUDED.goals, approval_status = EXCLUDED.approval_status;

  -- ──────────────────────────────────────────────────────────────
  -- 6. Sponsor: add sponsor role + sponsor_profiles
  -- ──────────────────────────────────────────────────────────────
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_sponsor_id, 'sponsor'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Remove default coachee role that trigger created for sponsor
  DELETE FROM public.user_roles WHERE user_id = v_sponsor_id AND role = 'coachee';

  INSERT INTO public.sponsor_profiles (user_id, organization_id, title, department)
  VALUES (v_sponsor_id, v_org_id, 'Programme Director', 'Executive Education')
  ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id, title = EXCLUDED.title;

  -- ──────────────────────────────────────────────────────────────
  -- 7. Cohort (Erickson VN, linked to org)
  -- ──────────────────────────────────────────────────────────────
  INSERT INTO public.cohorts (id, name, programme_id, organization_id, start_date, end_date, description)
  VALUES (v_cohort_id, 'TASC Essential — Erickson VN (Sep 2026)', v_programme_id, v_org_id,
    '2026-09-08', '2026-10-06',
    'In-house TASC cohort for Erickson Coaching Vietnam staff. Sponsored by contact@erickson.vn.')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, organization_id = EXCLUDED.organization_id,
    start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date;

  -- ──────────────────────────────────────────────────────────────
  -- 8. Programme enrollments (linked to org so sponsor sees them)
  -- Varied statuses: Yuki=active, Claire=active, Daniel=at_risk
  -- ──────────────────────────────────────────────────────────────
  INSERT INTO public.programme_enrollments (id, user_id, programme_id, cohort_id, organization_id,
    start_date, end_date, status, progress_pct)
  VALUES
    ('ee000000-0000-0000-0000-000000000051', v_claire_id, v_programme_id, v_cohort_id, v_org_id,
      '2026-09-08', '2026-10-06', 'active', 72),
    ('ee000000-0000-0000-0000-000000000052', v_daniel_id, v_programme_id, v_cohort_id, v_org_id,
      '2026-09-08', '2026-10-06', 'at_risk', 38),
    ('ee000000-0000-0000-0000-000000000053', v_yuki_id, v_programme_id, v_cohort_id, v_org_id,
      '2026-09-08', '2026-10-06', 'active', 94)
  ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, progress_pct = EXCLUDED.progress_pct,
    organization_id = EXCLUDED.organization_id, cohort_id = EXCLUDED.cohort_id;

  -- ──────────────────────────────────────────────────────────────
  -- 9. Coachee allowlist (so they can book the coaches)
  -- ──────────────────────────────────────────────────────────────
  INSERT INTO public.coachee_coach_allowlist (coachee_id, coach_id, source)
  VALUES (v_claire_id, v_coach1_id, 'admin_added'), (v_claire_id, v_coach2_id, 'admin_added'),
         (v_daniel_id, v_coach1_id, 'admin_added'), (v_daniel_id, v_coach2_id, 'admin_added'),
         (v_yuki_id,   v_coach1_id, 'admin_added'), (v_yuki_id,   v_coach2_id, 'admin_added')
  ON CONFLICT (coachee_id, coach_id) DO NOTHING;

  -- ──────────────────────────────────────────────────────────────
  -- 10. Goals + ratings (shared_with_sponsor = true for sponsor view)
  -- ──────────────────────────────────────────────────────────────

  -- Claire goals
  INSERT INTO public.coachee_goals (id, coachee_id, title, description, status, sort_order, shared_with_sponsor, target_date)
  VALUES
    ('ee010001-0000-0000-0000-000000000001', v_claire_id, 'Listen first, advise second',
      'Shift from expert-advice mode to coaching presence in 1-on-1s.', 'active', 1, true, '2026-10-06'),
    ('ee010001-0000-0000-0000-000000000002', v_claire_id, 'Use open questions in team meetings',
      'Replace closed/leading questions with open ones to surface team ideas.', 'active', 2, true, '2026-10-06')
  ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description,
    shared_with_sponsor=EXCLUDED.shared_with_sponsor, status=EXCLUDED.status;

  INSERT INTO public.coachee_goal_ratings (goal_id, coachee_id, start_rating, current_rating, target_rating)
  VALUES
    ('ee010001-0000-0000-0000-000000000001', v_claire_id, 3, 6, 9),
    ('ee010001-0000-0000-0000-000000000002', v_claire_id, 2, 5, 8)
  ON CONFLICT (goal_id) DO UPDATE SET current_rating=EXCLUDED.current_rating, start_rating=EXCLUDED.start_rating, target_rating=EXCLUDED.target_rating;

  -- Daniel goals (lower progress → interesting for sponsor chart)
  INSERT INTO public.coachee_goals (id, coachee_id, title, description, status, sort_order, shared_with_sponsor, target_date)
  VALUES
    ('ee020001-0000-0000-0000-000000000001', v_daniel_id, 'Apply SHIFT model in 1-on-1s',
      'Run at least one full SHIFT conversation per week.', 'active', 1, true, '2026-10-06'),
    ('ee020001-0000-0000-0000-000000000002', v_daniel_id, 'Reduce advice-giving in meetings',
      'Catch myself giving unsolicited advice and pivot to a question.', 'active', 2, true, '2026-10-06')
  ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description,
    shared_with_sponsor=EXCLUDED.shared_with_sponsor;

  INSERT INTO public.coachee_goal_ratings (goal_id, coachee_id, start_rating, current_rating, target_rating)
  VALUES
    ('ee020001-0000-0000-0000-000000000001', v_daniel_id, 2, 4, 8),
    ('ee020001-0000-0000-0000-000000000002', v_daniel_id, 3, 4, 7)
  ON CONFLICT (goal_id) DO UPDATE SET current_rating=EXCLUDED.current_rating, start_rating=EXCLUDED.start_rating, target_rating=EXCLUDED.target_rating;

  -- Yuki goals (high progress)
  INSERT INTO public.coachee_goals (id, coachee_id, title, description, status, sort_order, shared_with_sponsor, target_date)
  VALUES
    ('ee030001-0000-0000-0000-000000000001', v_yuki_id, 'Master SHIFT and hold comfortable silence',
      'Complete 4 peer sessions using full SHIFT structure with silences ≥5s.', 'active', 1, true, '2026-10-06'),
    ('ee030001-0000-0000-0000-000000000002', v_yuki_id, 'Coach without advising for a full month',
      'Track daily: zero unsolicited advice across all work conversations.', 'active', 2, true, '2026-10-06'),
    ('ee030001-0000-0000-0000-000000000003', v_yuki_id, 'Share coaching insights with my team',
      'Introduce one coaching concept per week in team retrospectives.', 'active', 3, false, '2026-10-06')
  ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description,
    shared_with_sponsor=EXCLUDED.shared_with_sponsor;

  INSERT INTO public.coachee_goal_ratings (goal_id, coachee_id, start_rating, current_rating, target_rating)
  VALUES
    ('ee030001-0000-0000-0000-000000000001', v_yuki_id, 2, 8, 9),
    ('ee030001-0000-0000-0000-000000000002', v_yuki_id, 2, 7, 8),
    ('ee030001-0000-0000-0000-000000000003', v_yuki_id, 3, 7, 8)
  ON CONFLICT (goal_id) DO UPDATE SET current_rating=EXCLUDED.current_rating, start_rating=EXCLUDED.start_rating, target_rating=EXCLUDED.target_rating;

  -- ──────────────────────────────────────────────────────────────
  -- 11. Coaching sessions
  -- ──────────────────────────────────────────────────────────────

  -- Claire: 3 completed sessions (coach1)
  INSERT INTO public.sessions (id, coach_id, coachee_id, topic, start_time, duration_minutes, status,
    coach_notes, coachee_notes, action_items, coachee_rating, coachee_rating_comment, confirmed_at)
  VALUES
    ('ee010100-0000-0000-0000-000000000001', v_coach1_id, v_claire_id,
      'Coaching mindset: shifting from expert to partner',
      '2026-09-10T09:00:00+07:00', 60, 'completed',
      'Claire is self-aware and articulate. Strong empathy. Key edge: breaks silence too quickly — jumps to solutions before client has finished thinking.',
      'I noticed how often I complete people''s sentences. This session helped me see that silence is not my responsibility to fill.',
      '[{"text":"Practice 5-second silence rule in next 3 conversations","done":true},{"text":"Journal one coaching moment per day","done":true}]'::jsonb,
      4, 'Very reflective session. My coach helped me see patterns I couldn''t see alone.', '2026-09-09T16:00:00Z'),
    ('ee010100-0000-0000-0000-000000000002', v_coach1_id, v_claire_id,
      'SHIFT model: navigating the H and I stages',
      '2026-09-17T09:00:00+07:00', 60, 'completed',
      'Claire''s H stage is strong — very good listening. She struggles to pivot from H to I; keeps returning to the problem. Assigned her to practice the pivot question: "What would you like to have happen here?"',
      'The H→I transition is where I get stuck. My coach''s pivot question is simple but I keep forgetting it in the moment.',
      '[{"text":"Use H→I pivot question in at least 2 team 1-on-1s","done":true},{"text":"Time yourself: no more than 12 minutes in H stage","done":false}]'::jsonb,
      5, 'Best session yet. The timing exercise changed how I think about structure.', '2026-09-16T17:00:00Z'),
    ('ee010100-0000-0000-0000-000000000003', v_coach1_id, v_claire_id,
      'Finding the client''s resources: the F stage in practice',
      '2026-09-24T09:00:00+07:00', 60, 'completed',
      'Significant growth from session 1. Claire used the F-stage question naturally. Recommended she focus on "What has worked before?" as her anchor question.',
      'I am finally starting to trust that my clients have their own answers. The F stage used to feel artificial to me — now it feels like the most honest part of the conversation.',
      '[{"text":"Run a full SHIFT conversation with peer partner","done":true},{"text":"Note one resource the client discovered themselves per session","done":true}]'::jsonb,
      5, 'Claire is building real coaching confidence. Can see the shift.', '2026-09-23T15:00:00Z')
  ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, coach_notes=EXCLUDED.coach_notes,
    coachee_notes=EXCLUDED.coachee_notes, action_items=EXCLUDED.action_items,
    coachee_rating=EXCLUDED.coachee_rating;

  -- Daniel: 2 completed + 1 upcoming (lower engagement)
  INSERT INTO public.sessions (id, coach_id, coachee_id, topic, start_time, duration_minutes, status,
    coach_notes, coachee_notes, action_items, coachee_rating, confirmed_at)
  VALUES
    ('ee020100-0000-0000-0000-000000000001', v_coach2_id, v_daniel_id,
      'Introduction to coaching presence',
      '2026-09-11T14:00:00+07:00', 60, 'completed',
      'Daniel is intellectually engaged but has a strong advice-giving reflex. Needs practice shifting from "telling" mode. Solid rapport-builder though.',
      'I thought I was already a good listener — this session showed me how much I still advise even when I think I''m coaching.',
      '[{"text":"Try 3 open questions before giving any opinion","done":true},{"text":"Notice how often you give advice in a day","done":false}]'::jsonb,
      4, '2026-09-10T17:00:00Z'),
    ('ee020100-0000-0000-0000-000000000002', v_coach2_id, v_daniel_id,
      'Powerful questions and active listening',
      '2026-09-25T14:00:00+07:00', 60, 'completed',
      'Daniel has not been practicing between sessions. Still defaulting to advice quickly. Encouraged him to use the "What do YOU think?" redirection as a bridge habit.',
      'Honest feedback from my coach: I am not practicing enough. I need to make this a daily habit, not a once-a-week exercise.',
      '[{"text":"Set a daily reminder to reflect on one conversation","done":false},{"text":"Use ''What do YOU think?'' as redirect in meetings","done":true}]'::jsonb,
      3, '2026-09-24T15:00:00Z')
  ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, coach_notes=EXCLUDED.coach_notes,
    coachee_notes=EXCLUDED.coachee_notes, action_items=EXCLUDED.action_items,
    coachee_rating=EXCLUDED.coachee_rating;

  -- Yuki: 4 completed sessions (full programme)
  INSERT INTO public.sessions (id, coach_id, coachee_id, topic, start_time, duration_minutes, status,
    coach_notes, coachee_notes, action_items, coachee_rating, coachee_rating_comment, confirmed_at)
  VALUES
    ('ee030100-0000-0000-0000-000000000001', v_coach1_id, v_yuki_id,
      'Foundations: coaching vs. managing',
      '2026-09-09T10:00:00+07:00', 60, 'completed',
      'Yuki is exceptional. High curiosity, already sits with silence naturally. Very open to feedback. Main edge: tends to over-structure; needs to trust the emergent direction.',
      'I came in thinking coaching was structured facilitation. Now I understand it is more like tuning in to what the client needs rather than running a script.',
      '[{"text":"Let one meeting unfold without an agenda","done":true},{"text":"Practice unstructured listening for 15 min with a colleague","done":true}]'::jsonb,
      5, 'Revelatory first session.', '2026-09-08T15:00:00Z'),
    ('ee030100-0000-0000-0000-000000000002', v_coach1_id, v_yuki_id,
      'Deep listening and the power of silence',
      '2026-09-16T10:00:00+07:00', 60, 'completed',
      'Yuki is already holding 6-8 second silences naturally. Focused on Level 3 listening — tracking energy, pace, and what is NOT being said.',
      'My coach introduced me to the idea that silence has texture. A 5-second silence in the middle of an insight feels different from a 5-second silence at the end of a question. I had never noticed that.',
      '[{"text":"Track pauses in next 3 peer sessions — note what follows each","done":true},{"text":"Introduce Level 3 listening practice in team meeting","done":true}]'::jsonb,
      5, 'Yuki grows visibly between sessions — this is rare.', '2026-09-15T16:00:00Z'),
    ('ee030100-0000-0000-0000-000000000003', v_coach1_id, v_yuki_id,
      'SHIFT model: full structure with a real team challenge',
      '2026-09-23T10:00:00+07:00', 60, 'completed',
      'Yuki ran a near-perfect SHIFT session in role-play. I gave the real challenge: stop "performing SHIFT" and let the model become invisible. The structure should serve the client, not the coach''s confidence.',
      'My coach challenged me to forget the stages and just be curious. When I stopped thinking "which stage am I in?" the conversation deepened immediately. I want to keep practising that.',
      '[{"text":"Run one SHIFT session without checking stages","done":true},{"text":"Write reflection on how coaching is changing your management style","done":true}]'::jsonb,
      5, 'A masterclass in coaching coaching.', '2026-09-22T17:00:00Z'),
    ('ee030100-0000-0000-0000-000000000004', v_coach1_id, v_yuki_id,
      'Sustainable coaching habits: closing the programme',
      '2026-09-30T10:00:00+07:00', 60, 'completed',
      'Yuki is ready to coach independently. Strong across all 8 ICF competencies. Outstanding growth in evokes_awareness and facilitates_growth. Recommend for a peer coaching leadership role.',
      'Four weeks ago I thought coaching was a technique. Now I understand it is a way of being. The difference shows up in how I handled a difficult stakeholder conversation yesterday — I asked two questions and said almost nothing else. She left with a clear plan she made herself.',
      '[{"text":"Identify one team member to offer regular coaching conversations","done":true},{"text":"Write a coaching philosophy statement by end of October","done":false}]'::jsonb,
      5, 'Best coaching investment I have made.', '2026-09-29T16:00:00Z')
  ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, coach_notes=EXCLUDED.coach_notes,
    coachee_notes=EXCLUDED.coachee_notes, action_items=EXCLUDED.action_items,
    coachee_rating=EXCLUDED.coachee_rating, coachee_rating_comment=EXCLUDED.coachee_rating_comment;

  -- Coach session feedback
  INSERT INTO public.coach_session_feedback (id, session_id, coach_id, quality_rating, engagement_level, flag_for_admin)
  VALUES
    ('ef010001-0000-0000-0000-000000000001', 'ee010100-0000-0000-0000-000000000001', v_coach1_id, 4, 'high', false),
    ('ef010001-0000-0000-0000-000000000002', 'ee010100-0000-0000-0000-000000000002', v_coach1_id, 5, 'high', false),
    ('ef010001-0000-0000-0000-000000000003', 'ee010100-0000-0000-0000-000000000003', v_coach1_id, 5, 'high', false),
    ('ef020001-0000-0000-0000-000000000001', 'ee020100-0000-0000-0000-000000000001', v_coach2_id, 4, 'moderate', false),
    ('ef020001-0000-0000-0000-000000000002', 'ee020100-0000-0000-0000-000000000002', v_coach2_id, 3, 'low', false),
    ('ef030001-0000-0000-0000-000000000001', 'ee030100-0000-0000-0000-000000000001', v_coach1_id, 5, 'high', false),
    ('ef030001-0000-0000-0000-000000000002', 'ee030100-0000-0000-0000-000000000002', v_coach1_id, 5, 'high', false),
    ('ef030001-0000-0000-0000-000000000003', 'ee030100-0000-0000-0000-000000000003', v_coach1_id, 5, 'high', false),
    ('ef030001-0000-0000-0000-000000000004', 'ee030100-0000-0000-0000-000000000004', v_coach1_id, 5, 'high', false)
  ON CONFLICT (session_id, coach_id) DO UPDATE SET quality_rating=EXCLUDED.quality_rating, engagement_level=EXCLUDED.engagement_level;

  -- Session goal ratings (Claire)
  INSERT INTO public.session_goal_ratings (id, session_id, coachee_id, goal_id, rating, note)
  VALUES
    ('ea010001-0000-0000-0000-000000000001', 'ee010100-0000-0000-0000-000000000001', v_claire_id, 'ee010001-0000-0000-0000-000000000001', 4, 'Starting to pause before advising'),
    ('ea010001-0000-0000-0000-000000000002', 'ee010100-0000-0000-0000-000000000002', v_claire_id, 'ee010001-0000-0000-0000-000000000001', 5, 'H→I pivot landing consistently'),
    ('ea010001-0000-0000-0000-000000000003', 'ee010100-0000-0000-0000-000000000003', v_claire_id, 'ee010001-0000-0000-0000-000000000001', 7, 'Confidently asking before advising now'),
    ('ea030001-0000-0000-0000-000000000001', 'ee030100-0000-0000-0000-000000000001', v_yuki_id, 'ee030001-0000-0000-0000-000000000001', 5, 'SHIFT becoming intuitive'),
    ('ea030001-0000-0000-0000-000000000002', 'ee030100-0000-0000-0000-000000000002', v_yuki_id, 'ee030001-0000-0000-0000-000000000001', 7, 'Silence natural and generative'),
    ('ea030001-0000-0000-0000-000000000003', 'ee030100-0000-0000-0000-000000000003', v_yuki_id, 'ee030001-0000-0000-0000-000000000001', 8, 'Running full SHIFT without notes')
  ON CONFLICT (session_id, goal_id) DO UPDATE SET rating=EXCLUDED.rating, note=EXCLUDED.note;

  -- ──────────────────────────────────────────────────────────────
  -- 12. Peer sessions
  -- ──────────────────────────────────────────────────────────────

  -- Claire coaches Daniel
  INSERT INTO public.peer_sessions (id, peer_coach_id, peer_coachee_id, topic, start_time, duration_minutes,
    status, coach_notes, coachee_notes, action_items, coachee_rating)
  VALUES
    ('ee010200-0000-0000-0000-000000000001', v_claire_id, v_daniel_id,
      'Peer practice: exploring a difficult stakeholder relationship',
      '2026-09-18T15:00:00+07:00', 45, 'completed',
      'I focused on open questions. I noticed Daniel tends to answer his own questions when I ask them — a useful mirror for me. I resisted giving advice even when he seemed stuck. Proud of that.',
      'Claire created a very safe space. She asked me what I actually wanted out of the stakeholder relationship and I realised I hadn''t thought about it clearly until she asked.',
      '[{"text":"Map out what a good stakeholder relationship looks like for you","done":true}]'::jsonb, 4),
    ('ee010200-0000-0000-0000-000000000002', v_yuki_id, v_claire_id,
      'Peer practice: Yuki coaches Claire on delegation challenge',
      '2026-09-25T15:00:00+07:00', 45, 'completed',
      'Claire brought a real team problem — a team member not performing. I used full SHIFT. The breakthrough came when I asked "What would success look like in 3 months?" and she paused for 10 seconds.',
      'Yuki is the most advanced peer coach in our triad. The 3-month success question broke something open for me. I realised I hadn''t defined success clearly to my team member.',
      '[{"text":"Schedule a goal-setting conversation with the underperforming team member","done":true}]'::jsonb, 5)
  ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, coach_notes=EXCLUDED.coach_notes,
    coachee_rating=EXCLUDED.coachee_rating;

  -- Daniel coaches Yuki
  INSERT INTO public.peer_sessions (id, peer_coach_id, peer_coachee_id, topic, start_time, duration_minutes,
    status, coach_notes, coachee_notes, action_items, coachee_rating)
  VALUES
    ('ee020200-0000-0000-0000-000000000001', v_daniel_id, v_yuki_id,
      'Peer practice: working through a team communication issue',
      '2026-09-18T16:00:00+07:00', 45, 'completed',
      'I found it hard to stay curious — kept wanting to tell Yuki what I would do. Managed to stop myself once and ask "What options do you already see?" That landed well.',
      'Daniel is still working on his coaching reflex but there were genuine moments of connection. His question about "what I already see" was the best one he''s asked.',
      '[{"text":"Try a team retro using only questions","done":false}]'::jsonb, 3)
  ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, coach_notes=EXCLUDED.coach_notes,
    coachee_rating=EXCLUDED.coachee_rating;

  -- Peer competency feedback
  INSERT INTO public.peer_session_competency_feedback
    (id, peer_session_id, peer_coach_id, peer_coachee_id, ethical_practice, coaching_mindset,
     maintains_agreements, trust_safety, maintains_presence, listens_actively,
     evokes_awareness, facilitates_growth, feedback_note, created_at)
  VALUES
    ('ef010201-0000-0000-0000-000000000001', 'ee010200-0000-0000-0000-000000000001',
      v_claire_id, v_daniel_id,
      72, 68, 65, 80, 60, 72, 65, 60,
      'Claire created a very safe and open atmosphere. Her questions were mostly open. Growth area: maintaining presence — she occasionally glanced at notes. Strongest dimension: trust and safety.',
      '2026-09-18T16:00:00Z'),
    ('ef010202-0000-0000-0000-000000000001', 'ee010200-0000-0000-0000-000000000002',
      v_yuki_id, v_claire_id,
      88, 85, 82, 90, 80, 88, 84, 78,
      'Yuki''s coaching is excellent. The SHIFT model is invisible — she just coaches. Her 10-second silence before the breakthrough was remarkable. Best peer coaching session I have experienced.',
      '2026-09-25T16:00:00Z'),
    ('ef020201-0000-0000-0000-000000000001', 'ee020200-0000-0000-0000-000000000001',
      v_daniel_id, v_yuki_id,
      62, 55, 58, 70, 48, 60, 52, 50,
      'Daniel is genuinely improving but still shows the advice-giving reflex. He self-corrected at least twice which shows growing awareness. Growth edge: evokes_awareness and maintains_presence.',
      '2026-09-18T17:00:00Z')
  ON CONFLICT (peer_session_id) DO UPDATE SET ethical_practice=EXCLUDED.ethical_practice,
    coaching_mindset=EXCLUDED.coaching_mindset, trust_safety=EXCLUDED.trust_safety,
    listens_actively=EXCLUDED.listens_actively, feedback_note=EXCLUDED.feedback_note;

  -- ──────────────────────────────────────────────────────────────
  -- 13. Mentoring sessions
  -- ──────────────────────────────────────────────────────────────
  INSERT INTO public.mentoring_sessions (id, mentor_id, mentee_id, topic, start_time, duration_minutes,
    status, mentor_notes, mentee_notes, action_items, confirmed_at, feedback_submitted_at)
  VALUES
    ('ee010300-0000-0000-0000-000000000001', v_mentor_id, v_claire_id,
      'Career path into professional coaching: credentialing and practice',
      '2026-09-14T11:00:00+07:00', 60, 'completed',
      'Claire is considering ICF ACC path post-programme. Walked through logged hours requirements, mentor coaching, and portfolio. She is ready for this — solid foundation already.',
      'This conversation made the ICF ACC path feel achievable, not just aspirational. I now have a concrete 12-month roadmap.',
      '[{"text":"Research ICF ACC mentor coaching providers","done":true},{"text":"Start logging coaching hours in a formal log","done":true}]'::jsonb,
      '2026-09-13T15:00:00Z', '2026-09-14T12:30:00Z'),
    ('ee030300-0000-0000-0000-000000000001', v_mentor_id, v_yuki_id,
      'Building an internal coaching culture at Erickson VN',
      '2026-09-21T11:00:00+07:00', 60, 'completed',
      'Yuki has a real vision for embedding coaching into their performance management cycle. Shared how I built a similar programme at a previous organisation. She asks great questions.',
      'Huge insight: coaching culture does not require everyone to be a coach. It requires enough people to be curious listeners. Yuki used that exact phrase — "curious listeners" — and I wrote it down.',
      '[{"text":"Draft a 3-month internal coaching rollout plan","done":true},{"text":"Identify 3 managers to train as coaching champions","done":false}]'::jsonb,
      '2026-09-20T16:00:00Z', '2026-09-21T12:30:00Z')
  ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, mentor_notes=EXCLUDED.mentor_notes,
    mentee_notes=EXCLUDED.mentee_notes, action_items=EXCLUDED.action_items;

  -- Mentoring feedback (ICF competency-based)
  INSERT INTO public.mentoring_feedback
    (id, mentoring_session_id, mentor_id, mentee_id, submitted_by,
     coaching_mindset, maintains_agreements, trust_safety, maintains_presence,
     listens_actively, evokes_awareness, facilitates_growth, ethical_practice, overall_notes)
  VALUES
    ('ef010301-0000-0000-0000-000000000001', 'ee010300-0000-0000-0000-000000000001',
      v_mentor_id, v_claire_id, v_claire_id,
      'very_strong', 'strong', 'very_strong', 'strong',
      'very_strong', 'strong', 'strong', 'very_strong',
      'My mentor modelled everything I am trying to learn. The session itself was a coaching conversation — they asked as much as they told. I want to mentor like this one day.'),
    ('ef030301-0000-0000-0000-000000000001', 'ee030300-0000-0000-0000-000000000001',
      v_mentor_id, v_yuki_id, v_yuki_id,
      'very_strong', 'very_strong', 'very_strong', 'very_strong',
      'very_strong', 'very_strong', 'very_strong', 'very_strong',
      'Exceptional mentor session. The insight about "curious listeners" was the most useful thing I have heard in this programme. My mentor also challenged me to think bigger — not just my team, but the organisation.')
  ON CONFLICT (mentoring_session_id) DO UPDATE SET overall_notes=EXCLUDED.overall_notes,
    coaching_mindset=EXCLUDED.coaching_mindset;

  -- ──────────────────────────────────────────────────────────────
  -- 14. Triad group + sessions + reflections
  --     Claire (member_1), Daniel (member_2), Yuki (member_3)
  -- ──────────────────────────────────────────────────────────────
  INSERT INTO public.triad_groups (id, programme_id, cohort_id, member_1_id, member_2_id, member_3_id,
    group_language, name, is_active, assigned_by)
  VALUES (v_triad_group_id, v_programme_id, v_cohort_id, v_claire_id, v_daniel_id, v_yuki_id,
    'en', 'Erickson VN Triad — Alpha', true, 'admin')
  ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, is_active=EXCLUDED.is_active;

  -- Triad session 1 (Week 2) — completed
  INSERT INTO public.triad_sessions (id, triad_group_id, proposed_by, proposed_start_time, proposed_end_time,
    start_time, status, member_1_response, member_2_response, member_3_response, notes)
  VALUES
    (v_triad_s1_id, v_triad_group_id, v_yuki_id,
      '2026-09-20T15:00:00+07:00', '2026-09-20T16:30:00+07:00',
      '2026-09-20T15:00:00+07:00', 'completed',
      'accepted', 'accepted', 'accepted',
      'Roles: Claire=coach, Daniel=coachee, Yuki=observer. Topic: Daniel working through his tendency to over-advise. Powerful session — Claire held silence well. Observer feedback from Yuki was precise and generous.')
  ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, notes=EXCLUDED.notes;

  -- Triad session 2 (Week 3) — completed
  INSERT INTO public.triad_sessions (id, triad_group_id, proposed_by, proposed_start_time, proposed_end_time,
    start_time, status, member_1_response, member_2_response, member_3_response, notes)
  VALUES
    (v_triad_s2_id, v_triad_group_id, v_claire_id,
      '2026-09-27T15:00:00+07:00', '2026-09-27T16:30:00+07:00',
      '2026-09-27T15:00:00+07:00', 'completed',
      'accepted', 'accepted', 'accepted',
      'Roles: Yuki=coach, Claire=coachee, Daniel=observer. Topic: Claire''s challenge delegating to a struggling team member. Yuki''s coaching was outstanding — broke open the goal-setting gap in 12 minutes.')
  ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, notes=EXCLUDED.notes;

  -- Triad reflections — session 1
  INSERT INTO public.triad_reflections
    (id, triad_session_id, participant_id, learned_as_coach, will_use_as_coach,
     learned_as_coachee, will_use_as_coachee, learned_as_observer, will_use_as_observer,
     satisfaction_rating, submitted_at)
  VALUES
    ('ee010400-0000-0000-0000-000000000001', v_triad_s1_id, v_claire_id,
      'Holding silence for longer than feels comfortable is often what unlocks the client''s real answer.',
      'I will count 5 seconds silently after every open question before saying anything.',
      NULL, NULL,
      'As observer, I can see both the coach''s patterns and the coachee''s reactions at the same time. This dual view is invaluable.',
      'I will take observer notes more systematically: one column for coach behaviour, one for coachee response.',
      5, '2026-09-20T17:00:00Z'),
    ('ee020400-0000-0000-0000-000000000001', v_triad_s1_id, v_daniel_id,
      NULL, NULL,
      'When Claire held silence and just looked at me with curiosity, I felt trusted to find my own answer. It worked.',
      'I want to be the kind of colleague who makes people feel trusted. I will try bringing that quality into my 1-on-1s.',
      NULL, NULL,
      4, '2026-09-20T17:30:00Z'),
    ('ee030400-0000-0000-0000-000000000001', v_triad_s1_id, v_yuki_id,
      NULL, NULL, NULL, NULL,
      'Observing Claire coach Daniel: she naturally creates psychological safety by her body language and tone, before she even asks a question. That is the "presence" we talk about in theory.',
      'I want to be more deliberate about my pre-question presence — slow breathing, eye contact, forward lean. The technique matters less than the signal it sends.',
      5, '2026-09-20T17:15:00Z')
  ON CONFLICT (triad_session_id, participant_id) DO UPDATE SET
    learned_as_coach=EXCLUDED.learned_as_coach, learned_as_coachee=EXCLUDED.learned_as_coachee,
    learned_as_observer=EXCLUDED.learned_as_observer, satisfaction_rating=EXCLUDED.satisfaction_rating;

  -- Triad reflections — session 2
  INSERT INTO public.triad_reflections
    (id, triad_session_id, participant_id, learned_as_coach, will_use_as_coach,
     learned_as_coachee, will_use_as_coachee, learned_as_observer, will_use_as_observer,
     satisfaction_rating, submitted_at)
  VALUES
    ('ee010400-0000-0000-0000-000000000002', v_triad_s2_id, v_claire_id,
      NULL, NULL,
      'Yuki asked me to imagine success in 3 months. That question reframed everything. I stopped thinking about the problem and started thinking about the destination.',
      'I will open my next difficult 1-on-1 with a version of "What would success look like for both of us in 3 months?"',
      NULL, NULL,
      5, '2026-09-27T17:00:00Z'),
    ('ee020400-0000-0000-0000-000000000002', v_triad_s2_id, v_daniel_id,
      NULL, NULL, NULL, NULL,
      'I noticed that Yuki never once looked like she was "doing" coaching. She was just present and curious. That naturalness is what I am aiming for.',
      'I will try to drop the internal SHIFT checklist and just ask "what is this person actually needing right now?"',
      4, '2026-09-27T17:45:00Z'),
    ('ee030400-0000-0000-0000-000000000002', v_triad_s2_id, v_yuki_id,
      'The 3-month vision question works precisely because it bypasses the problem and lands the client in the future they want. It is a solution-focused shortcut.',
      'I will use the 3-month vision as my default I-stage opener instead of "what would you like to have happen?"',
      NULL, NULL, NULL, NULL,
      5, '2026-09-27T17:10:00Z')
  ON CONFLICT (triad_session_id, participant_id) DO UPDATE SET
    learned_as_coach=EXCLUDED.learned_as_coach, learned_as_coachee=EXCLUDED.learned_as_coachee,
    learned_as_observer=EXCLUDED.learned_as_observer, satisfaction_rating=EXCLUDED.satisfaction_rating;

  -- ──────────────────────────────────────────────────────────────
  -- 15. Training progress (skill cards)
  -- ──────────────────────────────────────────────────────────────
  IF v_week1_id IS NOT NULL THEN
    -- Yuki: all 4 weeks completed
    INSERT INTO public.training_progress (user_id, training_week_id, viewed_at, completed_at, pdf_downloaded_at)
    VALUES
      (v_yuki_id, v_week1_id, '2026-09-08T08:00:00Z', '2026-09-10T18:00:00Z', '2026-09-08T08:10:00Z'),
      (v_yuki_id, v_week2_id, '2026-09-15T08:00:00Z', '2026-09-17T17:00:00Z', '2026-09-15T08:20:00Z'),
      (v_yuki_id, v_week3_id, '2026-09-22T08:00:00Z', '2026-09-24T16:00:00Z', '2026-09-22T08:15:00Z'),
      (v_yuki_id, v_week4_id, '2026-09-29T08:00:00Z', '2026-10-01T16:00:00Z', '2026-09-29T08:20:00Z')
    ON CONFLICT (user_id, training_week_id) DO UPDATE SET
      completed_at=EXCLUDED.completed_at, viewed_at=EXCLUDED.viewed_at;

    -- Claire: 3 weeks completed, week 4 in progress
    INSERT INTO public.training_progress (user_id, training_week_id, viewed_at, completed_at, pdf_downloaded_at)
    VALUES
      (v_claire_id, v_week1_id, '2026-09-08T09:00:00Z', '2026-09-11T19:00:00Z', '2026-09-08T09:30:00Z'),
      (v_claire_id, v_week2_id, '2026-09-15T09:00:00Z', '2026-09-18T18:00:00Z', '2026-09-15T09:30:00Z'),
      (v_claire_id, v_week3_id, '2026-09-22T09:00:00Z', '2026-09-25T17:00:00Z', '2026-09-22T09:30:00Z'),
      (v_claire_id, v_week4_id, '2026-09-29T09:30:00Z', NULL, NULL)
    ON CONFLICT (user_id, training_week_id) DO UPDATE SET
      completed_at=EXCLUDED.completed_at, viewed_at=EXCLUDED.viewed_at;

    -- Daniel: only weeks 1 and 2 viewed, not completed for week 2
    INSERT INTO public.training_progress (user_id, training_week_id, viewed_at, completed_at)
    VALUES
      (v_daniel_id, v_week1_id, '2026-09-09T10:00:00Z', '2026-09-13T20:00:00Z'),
      (v_daniel_id, v_week2_id, '2026-09-16T11:00:00Z', NULL)
    ON CONFLICT (user_id, training_week_id) DO UPDATE SET
      completed_at=EXCLUDED.completed_at, viewed_at=EXCLUDED.viewed_at;
  END IF;

  -- ──────────────────────────────────────────────────────────────
  -- 16. Quiz submissions
  -- ──────────────────────────────────────────────────────────────
  IF v_quiz1_id IS NOT NULL THEN
    -- Yuki: 4/4 quizzes, high scores
    INSERT INTO public.assignment_submissions (assignment_id, user_id, answers, score_pct, correct_count, total_count, reflection_text, submitted_at)
    VALUES
      (v_quiz1_id, v_yuki_id, '{}'::jsonb, 100, 4, 4, 'All four questions confirmed what I already believed. The "client owns outcomes" principle is the one that most changed how I show up as a manager.', '2026-09-12T16:00:00Z'),
      (v_quiz2_id, v_yuki_id, '{}'::jsonb, 75,  3, 4, 'Missed the question about closed vs. leading questions — I conflated them. Important distinction.', '2026-09-19T15:00:00Z'),
      (v_quiz3_id, v_yuki_id, '{}'::jsonb, 100, 4, 4, 'Perfect score. SHIFT is now muscle memory.', '2026-09-26T14:00:00Z'),
      (v_quiz4_id, v_yuki_id, '{}'::jsonb, 100, 4, 4, 'Ethics and sustainable coaching: these are the principles I will carry into my work indefinitely.', '2026-10-02T14:00:00Z')
    ON CONFLICT (assignment_id, user_id) DO NOTHING;

    -- Claire: 3/4 quizzes
    INSERT INTO public.assignment_submissions (assignment_id, user_id, answers, score_pct, correct_count, total_count, reflection_text, submitted_at)
    VALUES
      (v_quiz1_id, v_claire_id, '{}'::jsonb, 75, 3, 4, 'Got the Erickson principle wrong — I thought the coach and client share responsibility for outcomes. Now I understand the client fully owns them.', '2026-09-12T17:30:00Z'),
      (v_quiz2_id, v_claire_id, '{}'::jsonb, 100, 4, 4, 'The questioning framework clicked fully this week. 100% feels good.', '2026-09-19T16:30:00Z'),
      (v_quiz3_id, v_claire_id, '{}'::jsonb, 75, 3, 4, 'Tripped on the F-stage question again. I need to remember: it is about EXISTING resources, not NEW ones.', '2026-09-26T16:00:00Z')
    ON CONFLICT (assignment_id, user_id) DO NOTHING;

    -- Daniel: only week 1 quiz
    INSERT INTO public.assignment_submissions (assignment_id, user_id, answers, score_pct, correct_count, total_count, reflection_text, submitted_at)
    VALUES
      (v_quiz1_id, v_daniel_id, '{}'::jsonb, 50, 2, 4, 'I struggled with the coaching principles. Need to re-read the Week 1 skill card more carefully.', '2026-09-14T18:00:00Z')
    ON CONFLICT (assignment_id, user_id) DO NOTHING;
  END IF;

  -- ──────────────────────────────────────────────────────────────
  -- 17. Daily prompt responses (sample — weeks 1-2 for all,
  --     weeks 3-4 only for Yuki and Claire)
  -- ──────────────────────────────────────────────────────────────
  -- We insert responses for the first prompt of each week (if it exists)
  -- to demonstrate engagement data without duplicating every prompt.
  DO $dp$
  DECLARE
    v_dp_id UUID;
    v_yuki UUID := 'ee000000-0000-0000-0000-000000000030'::uuid;
    v_claire UUID := 'ee000000-0000-0000-0000-000000000010'::uuid;
    v_daniel UUID := 'ee000000-0000-0000-0000-000000000020'::uuid;
    v_prog UUID;
    v_wk UUID;
    wk INT;
  BEGIN
    SELECT id INTO v_prog FROM public.programmes WHERE name = 'TASC - Essential Course' LIMIT 1;
    IF v_prog IS NULL THEN RETURN; END IF;

    FOR wk IN 1..4 LOOP
      SELECT tw.id INTO v_wk FROM public.training_weeks tw WHERE tw.programme_id = v_prog AND tw.week_number = wk LIMIT 1;
      IF v_wk IS NULL THEN CONTINUE; END IF;

      SELECT id INTO v_dp_id FROM public.daily_prompts WHERE training_week_id = v_wk ORDER BY sort_order LIMIT 1;
      IF v_dp_id IS NULL THEN CONTINUE; END IF;

      -- Yuki responds every week
      INSERT INTO public.daily_prompt_responses (daily_prompt_id, user_id, opened_at, response_text, responded_at)
      VALUES (v_dp_id, v_yuki,
        (TIMESTAMP '2026-09-08' + (wk-1) * INTERVAL '7 days' + INTERVAL '8 hours')::timestamptz,
        CASE wk
          WHEN 1 THEN 'The coaching mindset shift: I used to believe I added value by having answers. Now I see that asking the right question at the right moment is the harder and more valuable skill.'
          WHEN 2 THEN 'Level 2 listening in practice: I tried it in a team planning session. Within 10 minutes someone said something they had never said before. The space I held made the difference.'
          WHEN 3 THEN 'SHIFT in action: I ran my first complete SHIFT conversation with a junior colleague about a project scope problem. She left with three concrete next steps — all her own ideas.'
          WHEN 4 THEN 'Sustainable coaching: the key insight for me is that I do not need to be in a formal coaching session to coach. Every conversation is an opportunity to ask rather than tell.'
        END,
        (TIMESTAMP '2026-09-08' + (wk-1) * INTERVAL '7 days' + INTERVAL '12 hours')::timestamptz)
      ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET
        response_text=EXCLUDED.response_text, responded_at=EXCLUDED.responded_at;

      -- Claire responds weeks 1-3
      IF wk <= 3 THEN
        INSERT INTO public.daily_prompt_responses (daily_prompt_id, user_id, opened_at, response_text, responded_at)
        VALUES (v_dp_id, v_claire,
          (TIMESTAMP '2026-09-08' + (wk-1) * INTERVAL '7 days' + INTERVAL '9 hours')::timestamptz,
          CASE wk
            WHEN 1 THEN 'I realised today that I have been mentoring when I thought I was coaching. The difference is enormous: mentoring transfers my knowledge, coaching surfaces theirs.'
            WHEN 2 THEN 'Practiced open questions in a team retrospective. The team generated four times as many ideas as usual. I said almost nothing and the room was alive.'
            WHEN 3 THEN 'Ran the F-stage question for the first time: "What strengths do you already have that could help here?" My colleague paused for 8 seconds and then named three things that completely reframed the problem.'
          END,
          (TIMESTAMP '2026-09-08' + (wk-1) * INTERVAL '7 days' + INTERVAL '13 hours')::timestamptz)
        ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET
          response_text=EXCLUDED.response_text, responded_at=EXCLUDED.responded_at;
      END IF;

      -- Daniel responds weeks 1-2 only
      IF wk <= 2 THEN
        INSERT INTO public.daily_prompt_responses (daily_prompt_id, user_id, opened_at, response_text, responded_at)
        VALUES (v_dp_id, v_daniel,
          (TIMESTAMP '2026-09-08' + (wk-1) * INTERVAL '7 days' + INTERVAL '10 hours')::timestamptz,
          CASE wk
            WHEN 1 THEN 'Coaching principle I keep forgetting: the client is resourceful. I intellectually agree but my instinct is still to help by giving information. Working on it.'
            WHEN 2 THEN 'Tried Level 2 listening with my manager. I focused on her energy and pace rather than planning my reply. First time I actually heard what she was not saying.'
          END,
          (TIMESTAMP '2026-09-08' + (wk-1) * INTERVAL '7 days' + INTERVAL '14 hours')::timestamptz)
        ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET
          response_text=EXCLUDED.response_text, responded_at=EXCLUDED.responded_at;
      END IF;

    END LOOP;
  END;
  $dp$;

  -- ──────────────────────────────────────────────────────────────
  -- 18. Programme reflection submissions (mid-programme, week 2)
  -- ──────────────────────────────────────────────────────────────
  IF v_refl1_id IS NOT NULL THEN
    -- Yuki
    INSERT INTO public.reflection_submissions (id, reflection_id, user_id, confidence_score, submitted_at)
    VALUES ('ee030500-0000-0000-0000-000000000001', v_refl1_id, v_yuki_id, 8, '2026-09-20T18:00:00Z')
    ON CONFLICT (reflection_id, user_id) DO UPDATE SET confidence_score=EXCLUDED.confidence_score;

    -- Claire
    INSERT INTO public.reflection_submissions (id, reflection_id, user_id, confidence_score, submitted_at)
    VALUES ('ee010500-0000-0000-0000-000000000001', v_refl1_id, v_claire_id, 6, '2026-09-20T19:00:00Z')
    ON CONFLICT (reflection_id, user_id) DO UPDATE SET confidence_score=EXCLUDED.confidence_score;

    -- Daniel (lower confidence)
    INSERT INTO public.reflection_submissions (id, reflection_id, user_id, confidence_score, submitted_at)
    VALUES ('ee020500-0000-0000-0000-000000000001', v_refl1_id, v_daniel_id, 4, '2026-09-20T21:00:00Z')
    ON CONFLICT (reflection_id, user_id) DO UPDATE SET confidence_score=EXCLUDED.confidence_score;

    -- Answers for Yuki (first 2 questions if they exist)
    DO $ra$
    DECLARE
      v_q1 UUID; v_q2 UUID;
      v_refl UUID := 'ee030500-0000-0000-0000-000000000001'::uuid;
      v_r UUID := NULL;
    BEGIN
      SELECT programme_reflections.id INTO v_r FROM public.programme_reflections
        JOIN public.reflection_submissions rs ON rs.id = v_refl AND rs.reflection_id = programme_reflections.id
        LIMIT 1;
      IF v_r IS NULL THEN RETURN; END IF;
      -- find the reflection_id for this submission
      SELECT reflection_id INTO v_r FROM public.reflection_submissions WHERE id = v_refl LIMIT 1;
      SELECT id INTO v_q1 FROM public.reflection_questions WHERE reflection_id = v_r ORDER BY sort_order LIMIT 1;
      SELECT id INTO v_q2 FROM public.reflection_questions WHERE reflection_id = v_r AND id <> COALESCE(v_q1, '00000000-0000-0000-0000-000000000000'::uuid) ORDER BY sort_order LIMIT 1;

      IF v_q1 IS NOT NULL THEN
        INSERT INTO public.reflection_answers (submission_id, question_id, answer_text, answer_value)
        VALUES ('ee030500-0000-0000-0000-000000000001', v_q1,
          'My biggest insight is that coaching is not a technique — it is a way of being. The moment I stopped trying to "do coaching" and just became genuinely curious, the conversation depth doubled.',
          NULL)
        ON CONFLICT (submission_id, question_id) DO UPDATE SET answer_text=EXCLUDED.answer_text;
      END IF;
      IF v_q2 IS NOT NULL THEN
        INSERT INTO public.reflection_answers (submission_id, question_id, answer_text, answer_value)
        VALUES ('ee030500-0000-0000-0000-000000000001', v_q2, NULL, 8)
        ON CONFLICT (submission_id, question_id) DO UPDATE SET answer_value=EXCLUDED.answer_value;
      END IF;
    END;
    $ra$;
  END IF;

  -- ──────────────────────────────────────────────────────────────
  -- 19. Coachee journal reflections
  -- ──────────────────────────────────────────────────────────────
  INSERT INTO public.coachee_reflections (id, coachee_id, body, mood, created_at)
  VALUES
    ('ee010600-0000-0000-0000-000000000001', v_claire_id,
      'Week 1: I arrived at this programme thinking I was already a good listener. Within 3 days I had evidence I was not. My team member came to me with a budget problem and I solved it for her before she finished her sentence. Coaching is revealing uncomfortable truths about my "helpful" habits.',
      'curious', '2026-09-12T21:00:00Z'),
    ('ee010600-0000-0000-0000-000000000002', v_claire_id,
      'Week 3: The SHIFT model is getting easier but I still rush through F (finding resources). I assume people don''t have resources so I give them mine. But in this week''s triad, my peer said the one question about their existing strengths unlocked more than 20 minutes of me talking. Evidence, not theory.',
      'reflective', '2026-09-26T21:00:00Z'),
    ('ee020600-0000-0000-0000-000000000001', v_daniel_id,
      'Week 1: Coaching feels unnatural. My instinct when someone has a problem is to help. "Help" means information. This programme is asking me to help by NOT giving information. That is almost physically uncomfortable.',
      'frustrated', '2026-09-13T20:00:00Z'),
    ('ee020600-0000-0000-0000-000000000002', v_daniel_id,
      'Week 2: Had a real coaching moment with a junior team member today — almost by accident. She was stuck on a decision and instead of telling her what to do, I just asked "What would you do if this were entirely your call?" She made the decision herself in 3 minutes. That felt good.',
      'energized', '2026-09-20T22:00:00Z'),
    ('ee030600-0000-0000-0000-000000000001', v_yuki_id,
      'Week 1: This programme is showing me the gap between managing and leading. Managing is about outputs. Coaching is about the person behind the outputs. I have spent 10 years focused on outputs. This week I started focusing on the person — and the outputs are better.',
      'energized', '2026-09-11T22:00:00Z'),
    ('ee030600-0000-0000-0000-000000000002', v_yuki_id,
      'Week 3: I ran a full SHIFT session without notes, for the first time. I let the model become invisible. My colleague said it felt like a real conversation, not a coaching exercise. That is exactly what I was aiming for. The invisible structure is the mature version of the visible one.',
      'proud', '2026-09-26T22:00:00Z'),
    ('ee030600-0000-0000-0000-000000000003', v_yuki_id,
      'Week 4: The programme is ending but the practice is just beginning. I have identified two managers in my team who I want to coach regularly. I also want to propose an internal peer coaching circle for Q4. The investment Erickson VN made in this programme will multiply through every person I coach.',
      'determined', '2026-10-03T21:00:00Z')
  ON CONFLICT (id) DO UPDATE SET body=EXCLUDED.body, mood=EXCLUDED.mood;

  RAISE NOTICE 'Erickson VN cohort seed complete. org_id=%, cohort_id=%, claire=%, daniel=%, yuki=%',
    v_org_id, v_cohort_id, v_claire_id, v_daniel_id, v_yuki_id;

END;
$erickson_seed$;
