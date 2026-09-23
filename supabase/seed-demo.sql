-- ===========================================================================
-- Clariva demo seed -- a coherent dataset on the P0 + P1 + P2 rules.
--
--   2 organisations, 3 programmes, 4 cohorts, 15 leaders, 1 coach/mentor,
--   2 sponsors (plus the existing admin, trang.tt@erickson.vn, untouched).
--
-- EVERY DATE IS A FIXED CALENDAR DATE. Nothing is computed from now() or
-- current_date, so the data is identical on any day it runs (only generated
-- passwords' salts and a few bookkeeping created_at defaults differ).
--
-- THE STORY IS TOLD "AS OF" 2026-10-07:
--   Cohort 1  Leadership Foundations -- Cohort A    2026-03-02 .. 2026-06-08  completed
--   Cohort 2  Executive Coaching Sprint -- Cohort A 2026-09-01 .. 2026-11-30  active
--   Cohort 3  Emerging Leaders -- Cohort A          2026-09-15 .. 2027-01-05  active
--   Cohort 4  Leadership Foundations -- Cohort B    2026-10-06 .. 2027-01-12  just starting
-- The canonical engine evaluates against the real date. Viewed before
-- 2026-10-07 the ongoing cohorts read slightly differently (e.g. Huy's early
-- Coaching 3 on 2026-10-01 only counts from that day; Tam's and Mai's
-- Coaching 2 only turn overdue after 2026-09-29). The verification block at
-- the end checks the story as of 2026-10-07 and the invariants as of today.
--
-- HOW ROWS ARE WRITTEN
--   * Requirement dates go through the admin's own functions
--     (admin_set_cohort_module_deadlines / admin_set_cohort_requirement_dates),
--     acting as trang.tt@erickson.vn, so cohort_requirement_dates is exactly
--     what the admin UI would have produced.
--   * Goal check-ins and satisfaction go through the learner's functions
--     (record_goal_checkins / submit_session_satisfaction), acting as the
--     learner; their timestamps are then pinned to the session date.
--   * Historical sessions, training evidence and follow-up actions are
--     inserted directly (the booking RPCs only accept future slots and the
--     lifecycle RPCs refuse to complete a session before it starts). Every
--     trigger still runs: enrollment scope, requirement attribution (cohort
--     AND programme), peer participation, action validation, delete guards.
--   * Goal ratings use the product's 0-100 scale: "3 -> 8" is stored 30 -> 80.
--
-- USAGE (never applied by `supabase db reset`; only supabase/seed.sql is)
--   psql "$DEMO_DB_URL" -v ON_ERROR_STOP=1 \
--        -c "SET app.seed_environment='demo'" -f supabase/seed-demo.sql
--   or: PGOPTIONS='-c app.seed_environment=demo' psql "$DEMO_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed-demo.sql
--
-- Apply to a database with every migration and none of these demo rows. The
-- file is one transaction: any failed rule or verification rolls it all back.
-- ===========================================================================

BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('app.seed_environment', true), '') NOT IN
     ('local', 'development', 'preview', 'test', 'demo') THEN
    RAISE EXCEPTION
      'Refusing to seed: set app.seed_environment (local|development|preview|test|demo)'
      USING HINT = 'PGOPTIONS=''-c app.seed_environment=demo'' psql ... -f supabase/seed-demo.sql';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = 'duc.nm@erickson.vn') THEN
    RAISE EXCEPTION 'The demo dataset is already present (duc.nm@erickson.vn exists); remove it before re-seeding';
  END IF;
  -- Programme names are unique. supabase/seed.sql (the pgTAP fixture) and
  -- earlier demo datasets use some of the same names: this file is meant for
  -- a database without them.
  IF EXISTS (SELECT 1 FROM public.programmes
             WHERE name IN ('Leadership Foundations', 'Executive Coaching Sprint', 'Emerging Leaders')) THEN
    RAISE EXCEPTION 'Programme(s) already exist with a demo name: %',
      (SELECT string_agg(name || ' (' || id || ')', ', ') FROM public.programmes
       WHERE name IN ('Leadership Foundations', 'Executive Coaching Sprint', 'Emerging Leaders'))
      USING HINT = 'Remove the earlier demo / fixture programmes first; this seed does not merge with them.';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 0. The Admin -- an existing trang.tt@erickson.vn is left untouched
-- ---------------------------------------------------------------------------
DO $admin$
DECLARE v_id uuid;
BEGIN
  SELECT u.id INTO v_id FROM auth.users u WHERE lower(u.email) = 'trang.tt@erickson.vn';
  IF v_id IS NOT NULL THEN
    RAISE NOTICE 'Admin: existing trang.tt@erickson.vn left untouched';
    RETURN;
  END IF;

  v_id := 'd0000000-0000-4000-8000-0000000000a1';
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change_token_new, recovery_token,
    email_change, phone_change, phone_change_token,
    email_change_token_current, reauthentication_token)
  VALUES (v_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
    'trang.tt@erickson.vn', extensions.crypt('Clariva2026!', extensions.gen_salt('bf')),
    TIMESTAMPTZ '2026-02-02 09:00+07',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Trang Trinh"}'::jsonb, TIMESTAMPTZ '2026-02-02 09:00+07', TIMESTAMPTZ '2026-02-02 09:00+07',
    '', '', '', '', '', '', '', '');

  INSERT INTO public.profiles (id, full_name, email, status)
  VALUES (v_id, 'Trang Trinh', 'trang.tt@erickson.vn', 'active'::public.user_status)
  ON CONFLICT (id) DO UPDATE SET status = 'active'::public.user_status;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_id, 'admin'::public.app_role)
  ON CONFLICT DO NOTHING;

  -- handle_new_user() gives every new account a default `coachee` role; the
  -- Admin is not a learner.
  DELETE FROM public.user_roles WHERE user_id = v_id AND role = 'coachee'::public.app_role;
  DELETE FROM public.coachee_profiles WHERE id = v_id;

  RAISE NOTICE 'Admin: created trang.tt@erickson.vn with the password Clariva2026!';
END
$admin$;

-- ---------------------------------------------------------------------------
-- Helpers (session-local; dropped with the session)
-- ---------------------------------------------------------------------------
-- Act as a user: every canonical RPC reads auth.uid().
CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.act_as_service() RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '', true);
$$;
-- A deterministic uuid for a named demo row.
CREATE OR REPLACE FUNCTION pg_temp.uid(p_key text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT md5('clariva-demo-2026:' || p_key)::uuid;
$$;
-- A wall-clock time in Vietnam (ICT, UTC+7) on a given date.
CREATE OR REPLACE FUNCTION pg_temp.ict(p_day date, p_time time) RETURNS timestamptz
LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_day + p_time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
$$;

CREATE TEMP TABLE _admin ON COMMIT DROP AS
SELECT u.id FROM auth.users u WHERE lower(u.email) = 'trang.tt@erickson.vn';

-- ---------------------------------------------------------------------------
-- 1. People
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _people (
  slug text PRIMARY KEY, id uuid NOT NULL, email text NOT NULL, full_name text NOT NULL,
  role public.app_role NOT NULL, org text, job_title text
) ON COMMIT DROP;

INSERT INTO _people (slug, id, email, full_name, role, org, job_title) VALUES
  ('duc',    'de000000-0000-4000-8000-000000000001', 'duc.nm@erickson.vn',     'Nguyen Minh Duc',  'coach',   NULL, NULL),
  ('phuong', 'de000000-0000-4000-8000-000000000002', 'phuong.lt@demo-orgA.vn', 'Le Thi Phuong',    'sponsor', 'A',  'Head of Talent Development'),
  ('tuan',   'de000000-0000-4000-8000-000000000003', 'tuan.vt@demo-orgB.vn',   'Vo Thanh Tuan',    'sponsor', 'B',  'HR Business Partner Director'),
  -- Organisation A
  ('ha',     'de000000-0000-4000-8000-000000000011', 'ha.tt@demo-orgA.vn',     'Tran Thi Ha',      'coachee', 'A',  'Head of Retail Banking Operations'),
  ('binh',   'de000000-0000-4000-8000-000000000012', 'binh.nv@demo-orgA.vn',   'Nguyen Van Binh',  'coachee', 'A',  'Credit Risk Manager'),
  ('lan',    'de000000-0000-4000-8000-000000000013', 'lan.pt@demo-orgA.vn',    'Pham Thi Lan',     'coachee', 'A',  'Branch Network Manager'),
  ('huy',    'de000000-0000-4000-8000-000000000014', 'huy.dq@demo-orgA.vn',    'Dang Quoc Huy',    'coachee', 'A',  'Director of Digital Channels'),
  ('mai',    'de000000-0000-4000-8000-000000000015', 'mai.bt@demo-orgA.vn',    'Bui Thi Mai',      'coachee', 'A',  'Head of Compliance'),
  ('anh',    'de000000-0000-4000-8000-000000000016', 'anh.hd@demo-orgA.vn',    'Hoang Duc Anh',    'coachee', 'A',  'Treasury Team Lead'),
  ('tung',   'de000000-0000-4000-8000-000000000017', 'tung.lv@demo-orgA.vn',   'Le Van Tung',      'coachee', 'A',  'Product Manager, Cards'),
  ('ngoc',   'de000000-0000-4000-8000-000000000018', 'ngoc.vt@demo-orgA.vn',   'Vo Thi Ngoc',      'coachee', 'A',  'Customer Experience Lead'),
  -- Organisation B
  ('khoa',   'de000000-0000-4000-8000-000000000021', 'khoa.pd@demo-orgB.vn',   'Pham Duc Khoa',    'coachee', 'B',  'Chief Operating Officer'),
  ('tam',    'de000000-0000-4000-8000-000000000022', 'tam.tm@demo-orgB.vn',    'Tran Minh Tam',    'coachee', 'B',  'VP Sales, Southern Region'),
  ('thao',   'de000000-0000-4000-8000-000000000023', 'thao.nt@demo-orgB.vn',   'Nguyen Thi Thao',  'coachee', 'B',  'Finance Controller'),
  ('nam',    'de000000-0000-4000-8000-000000000024', 'nam.lh@demo-orgB.vn',    'Le Hoang Nam',     'coachee', 'B',  'IT Infrastructure Manager'),
  ('quang',  'de000000-0000-4000-8000-000000000025', 'quang.tv@demo-orgB.vn',  'Tran Van Quang',   'coachee', 'B',  'Supply Chain Manager'),
  ('dat',    'de000000-0000-4000-8000-000000000026', 'dat.bv@demo-orgB.vn',    'Bui Van Dat',      'coachee', 'B',  'Production Supervisor'),
  ('yen',    'de000000-0000-4000-8000-000000000027', 'yen.dt@demo-orgB.vn',    'Dang Thi Yen',     'coachee', 'B',  'Marketing Team Lead');

-- Passwords are bcrypt, as GoTrue expects. All demo accounts: demo123456.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change_token_new, recovery_token,
  email_change, phone_change, phone_change_token,
  email_change_token_current, reauthentication_token)
SELECT p.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
  p.email, extensions.crypt('demo123456', extensions.gen_salt('bf')), TIMESTAMPTZ '2026-02-16 09:00+07',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', p.full_name), TIMESTAMPTZ '2026-02-16 09:00+07', TIMESTAMPTZ '2026-02-16 09:00+07',
  '', '', '', '', '', '', '', ''
FROM _people p;

-- handle_new_user() created a profile, a coachee role and a coachee profile
-- for each account; make them what the demo needs.
INSERT INTO public.profiles (id, full_name, email, status, preferred_language, peer_coaching_opt_in,
  spoken_languages, bio, created_at, onboarding_completed_at)
SELECT p.id, p.full_name, p.email, 'active'::public.user_status, 'en', p.role = 'coachee',
  ARRAY['Vietnamese', 'English'],
  CASE p.slug WHEN 'duc' THEN
    'Executive coach with more than ten years of experience coaching senior leaders in banking and finance. '
    || 'Duc works with leaders stepping into bigger roles -- the first 100 days as a director, moving from '
    || 'specialist to general manager, leading peers who used to be colleagues -- and with leadership teams '
    || 'that need to align across functions. Before coaching he spent twelve years in retail and corporate '
    || 'banking, the last five as a regional director. ICF Professional Certified Coach (PCC).'
  END,
  TIMESTAMPTZ '2026-02-16 09:00+07', TIMESTAMPTZ '2026-02-16 09:30+07'
FROM _people p
ON CONFLICT (id) DO UPDATE
  SET full_name = excluded.full_name, status = excluded.status, preferred_language = excluded.preferred_language,
      peer_coaching_opt_in = excluded.peer_coaching_opt_in, spoken_languages = excluded.spoken_languages,
      bio = excluded.bio, created_at = excluded.created_at,
      onboarding_completed_at = excluded.onboarding_completed_at;

INSERT INTO public.user_roles (user_id, role)
SELECT p.id, p.role FROM _people p
ON CONFLICT DO NOTHING;
DELETE FROM public.user_roles r USING _people p
WHERE r.user_id = p.id AND r.role = 'coachee'::public.app_role AND p.role <> 'coachee';
DELETE FROM public.coachee_profiles cp USING _people p
WHERE cp.id = p.id AND p.role <> 'coachee';

INSERT INTO public.coachee_profiles (id, job_title, industry, location, timezone, approval_status)
SELECT p.id, p.job_title, CASE p.org WHEN 'A' THEN 'Banking & Financial Services' ELSE 'Manufacturing & Distribution' END,
  CASE p.org WHEN 'A' THEN 'Ha Noi, Viet Nam' ELSE 'Ho Chi Minh City, Viet Nam' END,
  'Asia/Ho_Chi_Minh', 'active'::public.user_status
FROM _people p WHERE p.role = 'coachee'
ON CONFLICT (id) DO UPDATE
  SET job_title = excluded.job_title, industry = excluded.industry, location = excluded.location,
      timezone = excluded.timezone, approval_status = excluded.approval_status;

-- The Coach. There is no separate mentor role: a Mentor is a Coach assigned
-- to a cohort's mentor pool (cohort_mentors, section 5). The schema has no
-- credential-tier column yet, so the ICF credential is recorded in the
-- certifications list and the title.
INSERT INTO public.coach_profiles (id, title, specialties, years_experience, nationality, country_based,
  diplomas_certifications, approval_status, peer_coaching_opt_in)
SELECT p.id, 'Executive Coach, ICF PCC',
  ARRAY['Leadership transitions', 'Cross-functional alignment', 'Banking & finance leadership'],
  11, 'Vietnamese', 'Viet Nam',
  ARRAY['ICF Professional Certified Coach (PCC)', 'Erickson Coaching International -- The Art & Science of Coaching'],
  'active'::public.user_status, false
FROM _people p WHERE p.slug = 'duc'
ON CONFLICT (id) DO UPDATE
  SET title = excluded.title, specialties = excluded.specialties, years_experience = excluded.years_experience,
      nationality = excluded.nationality, country_based = excluded.country_based,
      diplomas_certifications = excluded.diplomas_certifications, approval_status = excluded.approval_status;

-- ---------------------------------------------------------------------------
-- 2. Organisations and sponsors
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _orgs (code text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;

DO $orgs$
DECLARE v_a uuid; v_holder text;
BEGIN
  SELECT o.id INTO v_a FROM public.organizations o WHERE o.name = 'Clariva Demo Organization A' ORDER BY o.created_at LIMIT 1;
  IF v_a IS NULL THEN
    v_a := 'de0a0000-0000-4000-8000-00000000000a';
    INSERT INTO public.organizations (id, name, industry, hq_country, timezone, locale, company_size)
    VALUES (v_a, 'Clariva Demo Organization A', 'Banking & Financial Services', 'Viet Nam', 'Asia/Ho_Chi_Minh', 'vi', '1000+');
  END IF;
  -- Organisation B is created by migration 20260925090000.
  INSERT INTO public.organizations (id, name) VALUES ('d0000000-0000-4000-8000-00000000bbbb', 'Clariva Demo Organization B')
  ON CONFLICT (id) DO NOTHING;
  UPDATE public.organizations SET industry = coalesce(industry, 'Manufacturing & Distribution'),
    hq_country = coalesce(hq_country, 'Viet Nam'), timezone = coalesce(timezone, 'Asia/Ho_Chi_Minh')
  WHERE id = 'd0000000-0000-4000-8000-00000000bbbb';

  INSERT INTO _orgs VALUES ('A', v_a), ('B', 'd0000000-0000-4000-8000-00000000bbbb');

  -- One sponsor per organisation (sponsor_profiles UNIQUE(organization_id)):
  -- never take over a seat someone else holds.
  SELECT string_agg(o.name || ' -> ' || pr.email, '; ') INTO v_holder
  FROM public.sponsor_profiles sp
  JOIN _orgs x ON x.id = sp.organization_id
  JOIN public.organizations o ON o.id = sp.organization_id
  JOIN public.profiles pr ON pr.id = sp.user_id;
  IF v_holder IS NOT NULL THEN
    RAISE EXCEPTION 'A demo organisation already has a sponsor (%); remove that sponsor profile first', v_holder;
  END IF;
END
$orgs$;

INSERT INTO public.sponsor_profiles (user_id, organization_id, title, department)
SELECT p.id, o.id, p.job_title, 'People & Culture'
FROM _people p JOIN _orgs o ON o.code = p.org
WHERE p.role = 'sponsor';

-- ---------------------------------------------------------------------------
-- 3. Programmes
-- ---------------------------------------------------------------------------
-- Leadership Foundations: 12 checkpoints -- 7 Training weeks, 3 Coaching,
-- 1 Peer, 1 Mentoring. (Triads are supported by the system but are not in
-- this programme's 12-checkpoint design, and Cohort B's two leaders could
-- never form a group of three.)
-- Executive Coaching Sprint: 6 Coaching sessions only.
-- Emerging Leaders: 4 Training weeks, 3 Coaching, 2 Mentoring.
INSERT INTO public.programmes (id, name, description, duration_months, color, is_active, created_at) VALUES
  ('de100000-0000-4000-8000-000000000001', 'Leadership Foundations',
   'A 14-week blended programme for managers stepping into senior leadership: seven Training weeks, '
   || 'three executive coaching sessions, peer coaching practice and a mentoring conversation.',
   4, '#3AAECC', true, TIMESTAMPTZ '2026-02-16 09:00+07'),
  ('de100000-0000-4000-8000-000000000002', 'Executive Coaching Sprint',
   'Twelve weeks, six one-to-one executive coaching sessions every two weeks, focused on one or two '
   || 'high-stakes leadership goals.',
   3, '#E8834A', true, TIMESTAMPTZ '2026-02-16 09:00+07'),
  ('de100000-0000-4000-8000-000000000003', 'Emerging Leaders',
   'A 16-week programme for first-time people leaders: four Training weeks on the leadership basics, '
   || 'three coaching sessions and two mentoring conversations.',
   4, '#6B8E4E', true, TIMESTAMPTZ '2026-02-16 09:00+07');

-- ---------------------------------------------------------------------------
-- 4. Training content
-- ---------------------------------------------------------------------------
-- A Skill Card IS training_weeks.skill_card_html. Each Training week also has
-- a quiz (assignments + quiz_questions), one open reflection question
-- (programme_reflections + reflection_questions, matched on appears_at_week)
-- and optional daily prompts (never gate the week).
CREATE TEMP TABLE _weeks (
  prog integer, week_number integer, title text, subtitle text, html text, reflection text
) ON COMMIT DROP;
CREATE TEMP TABLE _quiz (
  prog integer, week_number integer, sort_order integer, question text, options jsonb, explanation text
) ON COMMIT DROP;
CREATE TEMP TABLE _prompts (
  prog integer, week_number integer, day_offset integer, prompt text
) ON COMMIT DROP;
-- Sample learner answers (used by the activity sections below).
CREATE TEMP TABLE _refl_answers (prog integer, week_number integer, variant integer, answer text) ON COMMIT DROP;
CREATE TEMP TABLE _prompt_responses (variant integer PRIMARY KEY, response text) ON COMMIT DROP;
CREATE TEMP TABLE _session_reflections (module public.programme_module_type, variant integer, body text) ON COMMIT DROP;
CREATE TEMP TABLE _coach_notes (variant integer PRIMARY KEY, body text) ON COMMIT DROP;
CREATE TEMP TABLE _action_titles (module public.programme_module_type, variant integer, title text) ON COMMIT DROP;

-- ===== Leadership Foundations -- Week 1 ======================================
INSERT INTO _weeks VALUES (1, 1, 'Self-awareness & leadership identity',
'How you see yourself, and how others experience you',
$html$<div class="skill-content">
  <h2>Understanding Your Leadership Identity</h2>
  <p>Before you can lead others effectively, you need to understand how you show up as a leader. Most managers are promoted because they were excellent at their previous job: the best credit analyst, the most reliable operations lead, the engineer everyone called when the system went down. That track record earned the promotion, but it does not describe the leader you now need to become. This module explores the gap between <strong>how you see yourself</strong> and <strong>how others experience you</strong> &mdash; and why closing that gap is the first task of every senior leader.</p>

  <img src="https://images.unsplash.com/photo-1552664730-d307ca884978?w=800" alt="A leadership team in discussion around a table" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Intention is invisible; impact is not</h3>
  <p>You judge yourself by your intentions. Everyone else judges you by your behaviour. When you interrupt a team member to "save time", you intend efficiency; they experience being dismissed. When you stay silent in a meeting to "let the team own it", you intend empowerment; they may experience a leader who has no view. Neither side is wrong. But only one side &mdash; yours &mdash; can change the pattern, and only once you can see it.</p>
  <p>Research on leadership self-assessment is consistent: the more senior the leader, the more their self-rating diverges from the ratings of the people around them. Seniority filters feedback. People tell the boss what the boss wants to hear, and the boss slowly loses access to the information they most need.</p>

  <h3>The Johari Window</h3>
  <p>The Johari Window, developed by psychologists Joseph Luft and Harrington Ingham, maps what you know about yourself against what others see. It has four panes:</p>
  <ul>
    <li><strong>Open area</strong> &mdash; known to you and to others: your visible strengths and habits.</li>
    <li><strong>Blind spot</strong> &mdash; seen by others, not by you: the sigh when a deadline slips, the way you finish other people's sentences.</li>
    <li><strong>Hidden area</strong> &mdash; known to you, kept from others: doubts, motives, the reasons behind your decisions.</li>
    <li><strong>Unknown</strong> &mdash; not yet known to anyone: capabilities that only appear under new conditions.</li>
  </ul>
  <p>In coaching, we focus on expanding the <em>open area</em> &mdash; the space where your self-perception and others' experience of you overlap. You expand it from two directions: by <strong>asking for feedback</strong>, which shrinks the blind spot, and by <strong>disclosing more of your thinking</strong>, which shrinks the hidden area. Leaders who explain the reasoning behind a decision are trusted more than leaders who only announce the decision, even when people disagree with it.</p>

  <div style="background:#f0f7fa;border-left:4px solid #3AAECC;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Reflection prompt:</strong> Think about the last time you received feedback that surprised you. What did it reveal about a blind spot? What made it possible for that person to tell you?
  </div>

  <h3>Three dimensions of leadership identity</h3>
  <ol>
    <li><strong>Values:</strong> What you stand for &mdash; your non-negotiables as a leader. Values become visible in the moments when they cost you something: the deal you walk away from, the underperformer you finally address, the credit you give away.</li>
    <li><strong>Strengths:</strong> What you do naturally well. Are you a connector, a challenger, a stabiliser, an architect? Every strength has a shadow when it is overused: the connector avoids conflict, the challenger exhausts the team, the stabiliser resists necessary change.</li>
    <li><strong>Impact:</strong> The effect you have on others. Not your intention &mdash; what people actually experience after an interaction with you. Do they leave clearer or more confused, more energised or more cautious?</li>
  </ol>

  <h3>From expert to leader</h3>
  <p>The hardest identity shift for most new senior leaders is from <em>expert</em> to <em>leader of experts</em>. As an expert, your value was the answer. As a leader, your value is the quality of other people's answers. Leaders who cannot make this shift become bottlenecks: every decision flows through them, their teams stop thinking, and they work longer hours while the organisation slows down. The shift starts with a different question. Instead of "What is the right answer?", ask "What does my team need in order to find the right answer without me?"</p>

  <img src="https://images.unsplash.com/photo-1531545514256-b1400bc00f31?w=800" alt="Two colleagues in a coaching conversation" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Gathering evidence this week</h3>
  <p>Self-awareness is not introspection alone; it is evidence. This week, collect three kinds:</p>
  <ul>
    <li><strong>Ask three people one question.</strong> Choose a peer, a direct report and your manager. Ask: "What is one thing I do that helps you do your best work, and one thing that gets in the way?" Listen, thank them, and do not explain yourself.</li>
    <li><strong>Watch your calendar.</strong> Your calendar is a more honest statement of your priorities than any strategy document. Look at last week: where did your time actually go?</li>
    <li><strong>Notice your triggers.</strong> Record one moment each day when you felt irritation, impatience or defensiveness. What was happening just before?</li>
  </ul>

  <h3>Your leadership story</h3>
  <p>Every leader carries a narrative that explains why they lead the way they do. Often it was formed early: a manager you admired, a crisis you came through, a failure you promised yourself never to repeat. That story is a source of strength and of blind spots. This week, write yours in 500 words. Start with: <em>"The moment I first understood what leadership meant to me was..."</em> Then add a final paragraph: <em>"What this story may be preventing me from seeing is..."</em> Bring both to your first coaching session.</p>

  <div style="background:#fff8e7;border-left:4px solid #E8834A;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Key takeaway:</strong> Leadership identity isn't fixed. It evolves as you grow and as you become more aware of the gap between intention and impact. The leaders who develop fastest are not the most talented &mdash; they are the ones who seek out, and act on, the information that closes that gap.
  </div>
</div>$html$,
'Which gap between your intention and your impact do you most want to close during this programme, and what evidence tells you it matters?');

INSERT INTO _quiz VALUES
  (1, 1, 1, 'In the Johari Window, the "blind spot" contains behaviour that is:',
   '[{"id":"a","text":"Known to you but hidden from others","is_correct":false},{"id":"b","text":"Seen by others but not by you","is_correct":true},{"id":"c","text":"Unknown to everyone","is_correct":false},{"id":"d","text":"Known to you and to others","is_correct":false}]',
   'The blind spot is what others can see and you cannot; feedback is the only way to shrink it.'),
  (1, 1, 2, 'Why does self-assessment tend to diverge further from others'' ratings as leaders become more senior?',
   '[{"id":"a","text":"Senior leaders are more self-critical","is_correct":false},{"id":"b","text":"Seniority filters the honest feedback that reaches the leader","is_correct":true},{"id":"c","text":"Teams rate senior leaders more harshly on principle","is_correct":false},{"id":"d","text":"Senior roles have fewer measurable outcomes","is_correct":false}]',
   'People tell the boss what the boss wants to hear, so the leader loses access to the information they most need.'),
  (1, 1, 3, 'A leader explains the reasoning behind a decision, not just the decision. Which Johari pane shrinks?',
   '[{"id":"a","text":"The open area","is_correct":false},{"id":"b","text":"The blind spot","is_correct":false},{"id":"c","text":"The hidden area","is_correct":true},{"id":"d","text":"The unknown area","is_correct":false}]',
   'Disclosing your thinking moves it from the hidden area into the open area.'),
  (1, 1, 4, 'According to the Skill Card, the overused strength of a "stabiliser" often shows up as:',
   '[{"id":"a","text":"Avoiding conflict","is_correct":false},{"id":"b","text":"Exhausting the team","is_correct":false},{"id":"c","text":"Resisting necessary change","is_correct":true},{"id":"d","text":"Over-planning every detail","is_correct":false}]',
   'Every strength has a shadow: the stabiliser''s is resistance to change.'),
  (1, 1, 5, 'When you ask a colleague what gets in the way of their best work, the recommended response is to:',
   '[{"id":"a","text":"Explain the context behind your behaviour","is_correct":false},{"id":"b","text":"Listen, thank them and not explain yourself","is_correct":true},{"id":"c","text":"Agree an action plan on the spot","is_correct":false},{"id":"d","text":"Ask them for a specific example to verify it","is_correct":false}]',
   'Explaining yourself teaches people that feedback leads to a debate, and they stop giving it.');

INSERT INTO _prompts VALUES
  (1, 1, 1, 'In your next meeting, notice one moment where your intention and your likely impact might differ. Write it down afterwards.'),
  (1, 1, 2, 'Ask one colleague: "What is one thing I do that helps you do your best work?" Just listen.'),
  (1, 1, 3, 'Look at yesterday''s calendar. Which hour best reflected what you say your priorities are?'),
  (1, 1, 4, 'Notice one moment of irritation today. What happened just before it?'),
  (1, 1, 5, 'Explain the reasoning behind one decision today, not just the decision itself.');

INSERT INTO _refl_answers VALUES
  (1, 1, 1, 'I want to close the gap between how decisive I think I am and how rushed my team experiences me. Two of the three people I asked this week said I decide before they have finished explaining the problem. I thought I was saving them time; they feel I do not trust their analysis.'),
  (1, 1, 2, 'The gap I want to close is between my intention to empower and the silence my team hears. My deputy told me that when I say nothing in meetings they assume I disagree. I will start explaining my thinking out loud, even when it is unfinished.'),
  (1, 1, 3, 'My calendar told the story before any feedback did: almost none of last week went to developing people, even though I call it my top priority. My impact is that I am the person who fixes problems, not the person who builds people who fix problems.');

-- ===== Leadership Foundations -- Week 2 ======================================
INSERT INTO _weeks VALUES (1, 2, 'Active listening & powerful questions',
'Listening to understand, and asking questions that make people think',
$html$<div class="skill-content">
  <h2>Listening That Changes the Conversation</h2>
  <p>Most listening in organisations is a polite pause before speaking. We hear enough to recognise the problem, our mind jumps to the solution, and we wait &mdash; not always patiently &mdash; for our turn. For an expert this is efficient. For a leader it is costly, because the person speaking rarely leads with the real issue. The first thing someone says is usually the safest version of the problem. The real one arrives later, if the listener leaves room for it.</p>
  <p>This week is about two skills that separate coaching leaders from directive ones: <strong>listening at depth</strong> and <strong>asking questions that make people think</strong> rather than questions that test whether they agree with you.</p>

  <img src="https://images.unsplash.com/photo-1543269865-cbf427effbad?w=800" alt="Colleagues listening to each other in conversation" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Three levels of listening</h3>
  <ol>
    <li><strong>Internal listening.</strong> Your attention is on yourself: your opinion, your next point, how the issue affects you. "That reminds me of when I..." is the classic signal.</li>
    <li><strong>Focused listening.</strong> Your attention is fully on the other person: their words, their emotion, what they are trying to achieve. You notice what they emphasise and what they leave out.</li>
    <li><strong>Global listening.</strong> You take in everything around the words: tone, energy, hesitation, the change in pace when a particular name comes up, the silence after a question. This is where the real issue usually shows itself.</li>
  </ol>
  <p>Leaders spend most of their day at level one. Coaching conversations happen at levels two and three. You cannot stay there all day &mdash; but you can choose to move there for the conversations that matter.</p>

  <h3>Reflect, check, pause</h3>
  <p>A simple discipline moves you out of internal listening:</p>
  <ul>
    <li><strong>Reflect</strong> the content in your own words: "So the rollout is on schedule, but the branch managers are not convinced."</li>
    <li><strong>Check</strong> the meaning: "Is it the timeline that worries them, or something else?"</li>
    <li><strong>Pause</strong> &mdash; and hold the silence for longer than feels comfortable. Five seconds feels like a minute. People very often say their most important sentence straight after a silence they did not expect you to leave.</li>
  </ul>

  <div style="background:#f0f7fa;border-left:4px solid #3AAECC;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Reflection prompt:</strong> In which of your regular meetings are you most often listening at level one &mdash; already composing your reply? What would change if you listened at level two for the first ten minutes?
  </div>

  <h3>What makes a question powerful</h3>
  <p>A powerful question is one the other person has not yet asked themselves. It is usually <strong>open</strong> (it cannot be answered with yes or no), <strong>short</strong>, and <strong>about the future or the person</strong> rather than the past or the problem. Compare:</p>
  <ul>
    <li>"Did you talk to the risk team?" (closed, checking) &rarr; "Who else needs to believe in this for it to work?"</li>
    <li>"Why did the launch slip?" (backward-looking, can sound like blame) &rarr; "What would you do differently if you were starting the launch today?"</li>
    <li>"Have you thought about delegating it?" (advice disguised as a question) &rarr; "What would it take for someone else to own this?"</li>
  </ul>
  <p>Beware of the disguised suggestion. "Have you thought about...?" is almost always your answer wearing a question mark. People recognise it, and it teaches them to wait for your view.</p>

  <h3>A small set of questions worth memorising</h3>
  <ul>
    <li>What is the real challenge here for you?</li>
    <li>What have you already tried?</li>
    <li>And what else?</li>
    <li>What would a good outcome look like?</li>
    <li>What do you want from me?</li>
  </ul>
  <p>"And what else?" deserves special mention. The first answer to any question is rarely the best one. Asking "And what else?" two or three times gives people permission to go past the answer they prepared.</p>

  <img src="https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=800" alt="A leader listening attentively" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>When not to ask questions</h3>
  <p>Coaching is not the right response to every situation. In a genuine emergency, when someone lacks information only you have, or when a safety or compliance issue is at stake, tell people what you need. The skill is to choose deliberately &mdash; and to notice how often "there is no time for questions" is a habit rather than a fact.</p>

  <h3>Questions across the hierarchy</h3>
  <p>In many organisations, and especially where respect for seniority runs deep, a question from the boss is heard as a test. People search for the answer they think you want. You can lower that pressure by saying why you are asking: "I don't have a view yet &mdash; I want to understand how you see it." Ask the most junior person first, so their view is not shaped by what their seniors have already said. And when someone gives an answer you disagree with, respond with curiosity before correction: "Tell me more about how you got there."</p>
  <p>Notice, too, the questions you are not asking. Leaders often ask about tasks and deadlines and rarely about obstacles, energy or what people are learning. A single question at the end of a one-to-one &mdash; "What was most useful for you in this conversation?" &mdash; tells you more about your impact than any engagement survey.</p>

  <h3>Practice this week</h3>
  <p>Choose three conversations this week where someone brings you a problem. In each one, ask at least three open questions before you offer any view, and use "And what else?" at least once. Afterwards, write down what the other person said after your silence that they had not said before it.</p>

  <div style="background:#fff8e7;border-left:4px solid #E8834A;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Key takeaway:</strong> The quality of your team's thinking is shaped by the quality of your listening. When you listen at depth and ask before you tell, people bring you the real problem &mdash; and more and more often, they bring you their own solution too.
  </div>
</div>$html$,
'In which recurring conversation do you most often jump to advice, and what might you learn if you asked three more questions first?');

INSERT INTO _quiz VALUES
  (1, 2, 1, 'A leader says "That reminds me of when I..." while a team member is describing a problem. Which level of listening is this?',
   '[{"id":"a","text":"Internal listening","is_correct":true},{"id":"b","text":"Focused listening","is_correct":false},{"id":"c","text":"Global listening","is_correct":false},{"id":"d","text":"Active listening","is_correct":false}]',
   'The attention has moved back to the listener''s own experience.'),
  (1, 2, 2, 'Why does the Skill Card recommend holding a silence after reflecting and checking?',
   '[{"id":"a","text":"It signals disapproval so the person reconsiders","is_correct":false},{"id":"b","text":"People often say their most important sentence after an unexpected silence","is_correct":true},{"id":"c","text":"It gives the leader time to prepare advice","is_correct":false},{"id":"d","text":"It shortens the meeting","is_correct":false}]',
   'The first thing people say is usually the safe version; silence invites the real issue.'),
  (1, 2, 3, 'Which of these is a powerful question rather than advice in disguise?',
   '[{"id":"a","text":"Have you thought about delegating it?","is_correct":false},{"id":"b","text":"Did you talk to the risk team?","is_correct":false},{"id":"c","text":"What would it take for someone else to own this?","is_correct":true},{"id":"d","text":"Why did the launch slip?","is_correct":false}]',
   'It is open, short and forward-looking, and it does not contain the leader''s answer.'),
  (1, 2, 4, 'What is the purpose of asking "And what else?"',
   '[{"id":"a","text":"To close the conversation politely","is_correct":false},{"id":"b","text":"To move past the first, prepared answer","is_correct":true},{"id":"c","text":"To check the facts","is_correct":false},{"id":"d","text":"To steer towards the leader''s preferred option","is_correct":false}]',
   'The first answer is rarely the best one.'),
  (1, 2, 5, 'When is telling, rather than asking, the right choice?',
   '[{"id":"a","text":"Whenever the leader already knows the answer","is_correct":false},{"id":"b","text":"In a genuine emergency or when a safety or compliance issue is at stake","is_correct":true},{"id":"c","text":"With experienced team members","is_correct":false},{"id":"d","text":"Never; coaching leaders always ask","is_correct":false}]',
   'Coaching is a deliberate choice, not a rule for every situation.');

INSERT INTO _prompts VALUES
  (1, 2, 1, 'Today, ask one open question instead of giving advice in your next meeting.'),
  (1, 2, 2, 'In one conversation, count to five before you reply. What did the silence bring out?'),
  (1, 2, 3, 'Ask "And what else?" twice in one conversation today.'),
  (1, 2, 4, 'Notice one "Have you thought about...?" before it leaves your mouth. What was the real question?'),
  (1, 2, 5, 'End one conversation by asking: "What do you want from me?"');

INSERT INTO _refl_answers VALUES
  (1, 2, 1, 'My weekly credit review is where I jump to advice most. The analysts present, I spot the flaw, I tell them. This week I asked three questions first and the junior analyst found the flaw herself, and a second one I had missed.'),
  (1, 2, 2, 'I jump to advice in one-to-ones with my branch managers because I used to do their job. When I held back and asked "And what else?" one of them told me the real issue was a conflict with head office that she had never mentioned.'),
  (1, 2, 3, 'With my deputy I give answers because it feels faster. When I asked what a good outcome looked like, we discovered we were solving two different problems. Three more questions would have saved us a week.');

-- ===== Leadership Foundations -- Week 4 ======================================
INSERT INTO _weeks VALUES (1, 4, 'Emotional intelligence in leadership',
'Managing your own state so it does not manage your decisions',
$html$<div class="skill-content">
  <h2>Emotional Intelligence: Leading From a Steady Place</h2>
  <p>Leaders are emotional contagion at scale. When you walk into a room anxious, the room becomes anxious; when you stay steady under pressure, people borrow your steadiness. Emotional intelligence is not about being nice or suppressing feelings. It is the ability to <strong>notice</strong> emotion &mdash; your own and other people's &mdash; and to <strong>use</strong> that information to make better decisions rather than being driven by it.</p>

  <img src="https://images.unsplash.com/photo-1517048676732-d65bc937f952?w=800" alt="A team meeting with a calm, focused leader" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>The four domains</h3>
  <p>Daniel Goleman's widely used model describes emotional intelligence in four domains:</p>
  <ol>
    <li><strong>Self-awareness:</strong> recognising your emotions as they happen and understanding how they affect your thinking and behaviour.</li>
    <li><strong>Self-management:</strong> choosing your response rather than reacting; staying composed, adaptable and focused under pressure.</li>
    <li><strong>Social awareness:</strong> reading the emotions, needs and concerns of others, and the mood of a group or organisation.</li>
    <li><strong>Relationship management:</strong> using that awareness to influence, develop others, manage conflict and build teams.</li>
  </ol>
  <p>The order matters. You cannot manage what you do not notice, and you cannot read others accurately while your own emotions are running the conversation.</p>

  <h3>What happens under pressure</h3>
  <p>When we feel threatened &mdash; by a missed target, a public challenge, a difficult regulator &mdash; the brain's threat response narrows our attention and speeds up our reactions. That is useful for escaping danger and unhelpful in a budget meeting. Under threat, leaders tend to fall back on their default pattern: some take control and start directing, some withdraw and go quiet, some become overly agreeable to reduce the tension. Knowing your default is the beginning of choice.</p>

  <div style="background:#f0f7fa;border-left:4px solid #3AAECC;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Reflection prompt:</strong> Under pressure, is your default to take control, to withdraw, or to accommodate? What does your team see when it happens, and what does it cost them?
  </div>

  <h3>Pause, label, choose</h3>
  <p>A practical sequence for the moments that matter:</p>
  <ul>
    <li><strong>Pause.</strong> Notice the physical signal first: the tight jaw, the faster breathing, the urge to interrupt. Take one slow breath before you speak.</li>
    <li><strong>Label.</strong> Name the emotion precisely, silently to yourself: not "this is a mess" but "I am frustrated because I promised this date to the board." Research on affect labelling shows that naming an emotion reduces its intensity and restores access to judgement.</li>
    <li><strong>Choose.</strong> Ask: "What response would serve the outcome I want?" Sometimes it is to say how you feel, calmly; sometimes to ask a question; sometimes to postpone the decision until tomorrow.</li>
  </ul>

  <h3>Reading the room</h3>
  <p>Social awareness is built by paying attention to what people do, not only what they say. In your next team meeting, watch for:</p>
  <ul>
    <li>Who speaks first, and who never speaks unless asked.</li>
    <li>The energy change when a particular topic comes up.</li>
    <li>Agreement that arrives too quickly &mdash; often a sign that people do not feel safe to disagree.</li>
    <li>What happens after the meeting: the real conversation that takes place in the corridor.</li>
  </ul>

  <img src="https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=800" alt="A leader reflecting before a conversation" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Empathy is not agreement</h3>
  <p>Many leaders avoid empathy because they fear it means agreeing, or lowering the standard. It does not. Empathy means showing that you understand the other person's experience: "I can see this deadline lands on top of the audit, and that is a lot." You can say that and still hold the deadline. What changes is that the person feels understood &mdash; and people who feel understood are far more willing to find a way to deliver.</p>

  <h3>Recovering after a reaction</h3>
  <p>Even with practice, you will sometimes react before you choose: a sharp reply in a meeting, an irritated message sent too quickly. What you do next matters as much as the reaction itself. Leaders who repair quickly build more trust than leaders who never slip, because the repair shows the team that the relationship matters more than being right. A good repair is short and specific: name what you did, own its impact, and say what you will do instead. "In this morning's meeting I cut you off when you raised the staffing issue. That was not fair, and I want to hear it properly &mdash; can we take ten minutes this afternoon?" Avoid the non-apology that explains your stress at length; the other person does not need your reasons, they need to know you noticed.</p>
  <p>Repair also teaches your team something about their own emotions: that strong feelings at work are normal, and that what counts is how we deal with them afterwards.</p>

  <h3>Practice this week</h3>
  <p>For five working days, record one moment where your emotional state shaped a decision or a conversation. Note the trigger, the precise label you would give the emotion, and what you chose to do. On the fifth day, look for the pattern. Is there a person, a type of meeting or a time of day that shows up again and again? Bring that pattern to your coaching session.</p>

  <div style="background:#fff8e7;border-left:4px solid #E8834A;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Key takeaway:</strong> You cannot choose whether emotions arise, but you can choose what they do next. Leaders who pause, label and choose make better decisions under pressure &mdash; and give their teams a steadier place to do their best work.
  </div>
</div>$html$,
'Describe one recent moment when your emotional state shaped a decision. What would "pause, label, choose" have changed?');

INSERT INTO _quiz VALUES
  (1, 4, 1, 'In the four-domain model, why does the order of the domains matter?',
   '[{"id":"a","text":"Each domain is only relevant at a certain career stage","is_correct":false},{"id":"b","text":"You cannot manage what you do not notice","is_correct":true},{"id":"c","text":"Relationship management is the least important","is_correct":false},{"id":"d","text":"The domains are scored in that order in assessments","is_correct":false}]',
   'Self-awareness comes first because every other domain depends on it.'),
  (1, 4, 2, 'What is the first step of "pause, label, choose"?',
   '[{"id":"a","text":"Explaining your feelings to the team","is_correct":false},{"id":"b","text":"Noticing the physical signal and taking a breath","is_correct":true},{"id":"c","text":"Postponing the decision","is_correct":false},{"id":"d","text":"Asking the other person how they feel","is_correct":false}]',
   'The body usually signals the emotion before the mind names it.'),
  (1, 4, 3, 'Research on affect labelling suggests that naming an emotion precisely:',
   '[{"id":"a","text":"Makes the emotion stronger","is_correct":false},{"id":"b","text":"Reduces its intensity and restores access to judgement","is_correct":true},{"id":"c","text":"Should only be done after the meeting","is_correct":false},{"id":"d","text":"Is useful only for negative emotions","is_correct":false}]',
   'Labelling engages the thinking brain and calms the threat response.'),
  (1, 4, 4, 'Agreement in a meeting that arrives very quickly can be a sign that:',
   '[{"id":"a","text":"The proposal is excellent","is_correct":false},{"id":"b","text":"People do not feel safe to disagree","is_correct":true},{"id":"c","text":"The meeting was well prepared","is_correct":false},{"id":"d","text":"The team is highly aligned","is_correct":false}]',
   'Watch for what people do, and for the conversation that happens in the corridor afterwards.'),
  (1, 4, 5, 'Which statement about empathy matches the Skill Card?',
   '[{"id":"a","text":"Empathy means lowering the standard to protect people","is_correct":false},{"id":"b","text":"Empathy means agreeing with the other person","is_correct":false},{"id":"c","text":"You can show you understand someone''s experience and still hold the deadline","is_correct":true},{"id":"d","text":"Empathy is best left to HR","is_correct":false}]',
   'Understanding is not agreement; it makes people more willing to find a way to deliver.');

INSERT INTO _prompts VALUES
  (1, 4, 1, 'Before your most important meeting today, take one slow breath and name how you feel in one precise word.'),
  (1, 4, 2, 'Watch who speaks first and who stays silent in one meeting today.'),
  (1, 4, 3, 'Say one sentence that shows you understand someone''s pressure, without changing your request.'),
  (1, 4, 4, 'Notice your default under pressure today: control, withdraw or accommodate?');

INSERT INTO _refl_answers VALUES
  (1, 4, 1, 'On Tuesday a regulator query arrived late and I rewrote my team''s response myself instead of guiding them. The label was fear of looking unprepared in front of the CEO. Pausing would have let me give them two comments and let them own the reply.'),
  (1, 4, 2, 'When the budget was cut I went quiet in the meeting and my team read it as agreement. The emotion was disappointment mixed with anger. If I had named it and chosen, I would have asked for one day to come back with a proposal.'),
  (1, 4, 3, 'I noticed I become overly agreeable with one senior colleague to avoid tension. Labelling it as anxiety about the relationship helped me see I was trading my team''s workload for my own comfort.');

-- ===== Leadership Foundations -- Week 6 ======================================
INSERT INTO _weeks VALUES (1, 6, 'Giving and receiving feedback',
'Specific, timely, about behaviour -- and easier to hear than you think',
$html$<div class="skill-content">
  <h2>Feedback That People Can Use</h2>
  <p>Almost every engagement survey tells the same story: people want more feedback than they get, and leaders believe they give more than they do. The gap is rarely about willingness. It is about skill and about fear &mdash; fear of damaging the relationship, fear of the other person's reaction, fear of being wrong. This week gives you a structure that lowers the risk for both sides, and a way of receiving feedback that makes people more willing to give it.</p>

  <img src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=800" alt="Two colleagues in a candid one-to-one conversation" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Why most feedback does not land</h3>
  <ul>
    <li><strong>It is about the person, not the behaviour.</strong> "You are not strategic" describes a judgement the person cannot act on. "In Tuesday's review you presented the numbers but not the decision you wanted from us" describes something they can change.</li>
    <li><strong>It arrives too late.</strong> Feedback saved for the annual review has lost its context and gained weight. Within 48 hours, the other person still remembers the moment.</li>
    <li><strong>It is buried.</strong> The "feedback sandwich" &mdash; praise, criticism, praise &mdash; teaches people to wait for the "but". Keep positive and developmental feedback separate and specific.</li>
  </ul>

  <h3>SBI: situation, behaviour, impact</h3>
  <p>The Center for Creative Leadership's SBI model is simple enough to use in a corridor:</p>
  <ol>
    <li><strong>Situation:</strong> anchor the moment. "In this morning's credit committee..."</li>
    <li><strong>Behaviour:</strong> describe what you observed, as a camera would have recorded it. "...you answered the chair's question about concentration risk with the full data table..."</li>
    <li><strong>Impact:</strong> say what it caused, for you or for the outcome. "...and the committee lost the thread, so the decision was deferred."</li>
  </ol>
  <p>Then stop, and ask a question: "How did it look from where you were sitting?" Feedback becomes a conversation instead of a verdict, and you may learn something you did not know &mdash; perhaps the chair asked for the table the day before.</p>

  <div style="background:#f0f7fa;border-left:4px solid #3AAECC;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Reflection prompt:</strong> Is there a piece of feedback you have been holding back for more than a month? What exactly are you protecting &mdash; the other person, the relationship, or yourself?
  </div>

  <h3>Positive feedback is not a warm-up</h3>
  <p>Specific positive feedback is the most under-used tool a leader has. "Great job" is pleasant and teaches nothing. "The way you pre-briefed the two sceptical branch managers before the meeting meant the proposal went through in ten minutes" tells the person exactly what to repeat. Use the same SBI structure for praise as for development &mdash; and aim for noticeably more of it.</p>

  <h3>Receiving feedback well</h3>
  <p>How you take feedback sets the ceiling for how honestly your team gives it. Every time you explain, justify or push back, people learn that feedback to you is expensive. A few habits change that quickly:</p>
  <ul>
    <li><strong>Say thank you first,</strong> and mean it: it cost them something to tell you.</li>
    <li><strong>Ask for an example</strong> to understand, not to test whether they are right.</li>
    <li><strong>Separate hearing from agreeing.</strong> You can take a day to decide what you think.</li>
    <li><strong>Close the loop.</strong> A week later, tell the person what you did with what they said. Nothing makes people give feedback again more reliably.</li>
  </ul>

  <img src="https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=800" alt="A team discussing openly in a meeting room" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Feedback across cultures</h3>
  <p>In many Vietnamese and wider Asian workplaces, direct critical feedback in front of others can cause a loss of face and damage trust. That does not mean feedback should be avoided &mdash; it means choosing the setting carefully. Give developmental feedback privately, start from shared goals, and be specific about behaviour rather than character. Directness in private and generosity in public is a combination that works in almost every culture.</p>

  <h3>When feedback meets defensiveness</h3>
  <p>Sometimes the other person pushes back, explains, or goes silent. That is a normal reaction to hearing something uncomfortable, not a sign the conversation has failed. Resist the urge to repeat your point more forcefully. Instead, acknowledge the reaction ("I can see this is not what you expected to hear"), return to the specific behaviour, and ask a question that invites them to think rather than defend: "What do you think the committee needed from you at that moment?" If emotions are running high, it is fine to pause and continue the next day.</p>
  <p>Finally, check your own contribution. Did you set the expectation clearly in the first place? Did something in the environment make the behaviour more likely? Feedback lands best when the other person can see that you are willing to look at your own part too.</p>

  <h3>Practice this week</h3>
  <p>Give one piece of specific developmental feedback using SBI, and one piece of specific positive feedback. Then explicitly ask one person for feedback on something you are working on, and practise receiving it: thank them, ask for an example, and do not explain yourself in the moment. Write down what you noticed about your own reaction.</p>

  <div style="background:#fff8e7;border-left:4px solid #E8834A;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Key takeaway:</strong> Feedback is a gift only when it is specific, timely and about behaviour. And the best way to build a feedback culture is not to give more feedback &mdash; it is to become a leader who is visibly good at receiving it.
  </div>
</div>$html$,
'What piece of feedback have you been avoiding, and how would you phrase it using situation, behaviour and impact?');

INSERT INTO _quiz VALUES
  (1, 6, 1, 'Which statement describes behaviour rather than a judgement about the person?',
   '[{"id":"a","text":"You are not strategic","is_correct":false},{"id":"b","text":"You lack executive presence","is_correct":false},{"id":"c","text":"In Tuesday''s review you presented the numbers but not the decision you wanted","is_correct":true},{"id":"d","text":"You need to be more confident","is_correct":false}]',
   'Behaviour is what a camera would have recorded; people can act on it.'),
  (1, 6, 2, 'What does SBI stand for?',
   '[{"id":"a","text":"Strength, Behaviour, Improvement","is_correct":false},{"id":"b","text":"Situation, Behaviour, Impact","is_correct":true},{"id":"c","text":"Summary, Background, Instruction","is_correct":false},{"id":"d","text":"Situation, Belief, Intention","is_correct":false}]',
   'Anchor the moment, describe what you saw, say what it caused.'),
  (1, 6, 3, 'Why does the Skill Card advise against the "feedback sandwich"?',
   '[{"id":"a","text":"It takes too long","is_correct":false},{"id":"b","text":"It teaches people to wait for the criticism and discount the praise","is_correct":true},{"id":"c","text":"Positive feedback should never be given","is_correct":false},{"id":"d","text":"It is only suitable for written feedback","is_correct":false}]',
   'Keep praise and developmental feedback separate and specific.'),
  (1, 6, 4, 'When receiving feedback, what is the purpose of asking for an example?',
   '[{"id":"a","text":"To test whether the person is right","is_correct":false},{"id":"b","text":"To understand what they observed","is_correct":true},{"id":"c","text":"To show you disagree politely","is_correct":false},{"id":"d","text":"To end the conversation","is_correct":false}]',
   'The aim is understanding; you can decide what you think later.'),
  (1, 6, 5, 'In workplaces where loss of face matters, the recommended approach is to:',
   '[{"id":"a","text":"Avoid developmental feedback","is_correct":false},{"id":"b","text":"Give developmental feedback in private and be generous in public","is_correct":true},{"id":"c","text":"Only give feedback in writing","is_correct":false},{"id":"d","text":"Give feedback through HR","is_correct":false}]',
   'Choose the setting carefully rather than avoiding feedback.');

INSERT INTO _prompts VALUES
  (1, 6, 1, 'Give one person specific positive feedback today: what they did, and what it made possible.'),
  (1, 6, 2, 'Ask one colleague: "What is one thing I could do differently in our meetings?" Thank them, and nothing else.'),
  (1, 6, 3, 'Write down one piece of feedback you have been holding back, using situation, behaviour and impact.'),
  (1, 6, 4, 'Close the loop: tell someone what you did with feedback they gave you.');

INSERT INTO _refl_answers VALUES
  (1, 6, 1, 'I have avoided telling a senior analyst that his committee papers are too long. Using SBI: in last week''s committee, his paper ran to 30 pages without a recommendation on page one, and the chair asked me for the conclusion instead of him. I will say that this week, privately.'),
  (1, 6, 2, 'The feedback I avoid is with a branch manager who agrees in meetings and then does not deliver. Situation: the opening-hours pilot. Behaviour: she committed to a start date and started three weeks later without telling me. Impact: I learned about it from a customer complaint.'),
  (1, 6, 3, 'I have not told my deputy that she interrupts her team. I was protecting myself, because I do the same. I will start by asking her for feedback on my own meetings and then share what I noticed in hers.');

-- ===== Leadership Foundations -- Week 8 ======================================
INSERT INTO _weeks VALUES (1, 8, 'Leading through change',
'People adopt change at the speed they understand it',
$html$<div class="skill-content">
  <h2>Leading People Through Change</h2>
  <p>Most change programmes do not fail in the strategy. They fail in the middle, when the announcement is over, the new way of working is still awkward, and the benefits are not yet visible. That is exactly when many leaders move on to the next priority. This week is about the human side of change: why people resist, what they need from you at each stage, and how to stay visible in the middle.</p>

  <img src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800" alt="A team working together on a new initiative" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Change and transition are different things</h3>
  <p>William Bridges drew a useful distinction. <strong>Change</strong> is the external event: the new system goes live, the branches move to new opening hours, two teams merge. <strong>Transition</strong> is the internal, psychological process people go through to come to terms with it. Change can happen on a date. Transition takes as long as it takes, and it has three phases:</p>
  <ol>
    <li><strong>Ending:</strong> letting go of the old way, the old identity, the old team. Loss comes before gain, even when the change is positive.</li>
    <li><strong>The neutral zone:</strong> the in-between time when the old way no longer works and the new way does not yet feel natural. Productivity dips, anxiety rises &mdash; and so does creativity.</li>
    <li><strong>New beginning:</strong> people commit to the new way and start to own it.</li>
  </ol>
  <p>Leaders are usually months ahead of their teams. By the time you announce a change, you have already been through your own ending. Remember that your team is starting from the beginning.</p>

  <h3>Resistance is information</h3>
  <p>What leaders call resistance is rarely stubbornness. It is usually one of three things:</p>
  <ul>
    <li><strong>An information problem:</strong> people do not understand why the change is needed, or what it means for them.</li>
    <li><strong>An agency problem:</strong> people feel the change is being done to them, with no say in how it happens.</li>
    <li><strong>A real concern:</strong> people can see a risk you have missed. Front-line staff often know exactly where a new process will break.</li>
  </ul>
  <p>Treat resistance as data. Ask: "What would need to be true for this to work for you?" and listen to the answer.</p>

  <div style="background:#f0f7fa;border-left:4px solid #3AAECC;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Reflection prompt:</strong> Think of a change you are leading now. Who is losing something because of it &mdash; status, expertise, a familiar routine &mdash; and have you acknowledged that loss out loud?
  </div>

  <h3>Four things people need from a leader in change</h3>
  <ol>
    <li><strong>The why, before the what.</strong> Explain the reason for the change in plain language before the plan. People who understand the problem will help solve it.</li>
    <li><strong>What will not change.</strong> Naming what stays the same &mdash; the customers we serve, how we treat each other, jobs that are secure &mdash; gives people stable ground. Continuity makes discontinuity tolerable.</li>
    <li><strong>A real decision.</strong> Give the team a genuine choice inside the change: how the rota works, which branch pilots first, how customers are told. Ownership grows from decisions, not from consultation.</li>
    <li><strong>Visibility in the middle.</strong> Keep showing up during the neutral zone: celebrate small wins, fix the irritations quickly, and keep repeating the why.</li>
  </ol>

  <img src="https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800" alt="Colleagues planning the next steps together" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Communicating change</h3>
  <p>A useful rule: say it seven times, in seven ways. What feels like repetition to you is the first time for someone who missed the town hall. Use the team meeting, the one-to-one, the written note and the informal conversation. And make it two-way: the questions people ask tell you where the transition is stuck.</p>

  <h3>Your own transition</h3>
  <p>Leaders go through transitions too, and it is easy to underestimate them. You may be letting go of a way of working you built, a team structure you designed, or a role in which you were the expert. If you have not acknowledged your own ending, you are likely to defend the old way without noticing, or to push the new way too hard to prove to yourself that it was right. Take a few minutes to write down what you are losing in this change, and what you are gaining. The leaders people follow through change are the ones who can say honestly, "This is hard for me too, and this is why I believe it is worth it."</p>

  <h3>How you will know it is working</h3>
  <p>Agree early how you will measure adoption, not just delivery. A system going live on time is delivery; people using it well three months later is adoption. Choose two or three simple signals &mdash; usage, error rates, the number of workarounds, the questions still being asked &mdash; and review them with the team every few weeks. Sharing those signals openly turns the team into partners in making the change work rather than subjects of it.</p>

  <h3>Practice this week</h3>
  <p>Identify a change you are leading. Write a one-page note that covers three things: why the change is needed, what will stay the same, and one decision your team genuinely owns. Deliver it in person, then write down every question you are asked. Those questions are your map of where people are in their transition.</p>

  <div style="background:#fff8e7;border-left:4px solid #E8834A;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Key takeaway:</strong> Change happens on a date; transition happens in people. Explain the why, name what stays, give people a real decision &mdash; and stay visible in the middle, where most change is won or lost.
  </div>
</div>$html$,
'In a change you are leading or have led, where did you lose people, and what would you do differently in the neutral zone?');

INSERT INTO _quiz VALUES
  (1, 8, 1, 'In Bridges'' model, what is the difference between change and transition?',
   '[{"id":"a","text":"There is no difference","is_correct":false},{"id":"b","text":"Change is the external event; transition is the internal process of adjusting to it","is_correct":true},{"id":"c","text":"Transition is the planning phase before a change","is_correct":false},{"id":"d","text":"Change is personal; transition is organisational","is_correct":false}]',
   'A change can happen on a date; a transition takes as long as it takes.'),
  (1, 8, 2, 'Which phase of transition does Bridges call "the neutral zone"?',
   '[{"id":"a","text":"The time before the change is announced","is_correct":false},{"id":"b","text":"The in-between time when the old way no longer works and the new way is not yet natural","is_correct":true},{"id":"c","text":"The phase after the change is complete","is_correct":false},{"id":"d","text":"The period of formal consultation","is_correct":false}]',
   'Productivity dips and anxiety rises, but so does creativity.'),
  (1, 8, 3, 'Resistance to change is most often:',
   '[{"id":"a","text":"A sign of poor performance","is_correct":false},{"id":"b","text":"An information problem, an agency problem, or a real concern","is_correct":true},{"id":"c","text":"Best ignored until it passes","is_correct":false},{"id":"d","text":"Caused by personality differences","is_correct":false}]',
   'Treat resistance as data about the change.'),
  (1, 8, 4, 'Why name what will NOT change?',
   '[{"id":"a","text":"It slows down adoption","is_correct":false},{"id":"b","text":"It gives people stable ground and makes the change tolerable","is_correct":true},{"id":"c","text":"It is required by labour law","is_correct":false},{"id":"d","text":"It weakens the case for change","is_correct":false}]',
   'Continuity is what makes discontinuity tolerable.'),
  (1, 8, 5, 'Where do most change programmes fail, according to the Skill Card?',
   '[{"id":"a","text":"In the strategy","is_correct":false},{"id":"b","text":"At the announcement","is_correct":false},{"id":"c","text":"In the middle, when benefits are not yet visible","is_correct":true},{"id":"d","text":"In the final review","is_correct":false}]',
   'That is when leaders tend to move on and momentum is lost.');

INSERT INTO _prompts VALUES
  (1, 8, 1, 'Explain the why of one change to someone today, before you mention the plan.'),
  (1, 8, 2, 'Name one thing that will not change, out loud, in a team conversation today.'),
  (1, 8, 3, 'Ask one person: "What would need to be true for this change to work for you?"'),
  (1, 8, 4, 'Celebrate one small win from a change in progress.');

INSERT INTO _refl_answers VALUES
  (1, 8, 1, 'We lost the operations team during the core banking migration because we announced the go-live date before explaining why. In the neutral zone I disappeared into steering committees. Next time I would hold a weekly fifteen-minute stand-up with the team for the whole middle phase.'),
  (1, 8, 2, 'In the opening-hours pilot I lost the long-serving tellers, who felt their experience no longer counted. I never acknowledged what they were losing. I would ask them to design the customer communication, which is exactly where their experience matters.'),
  (1, 8, 3, 'When our two finance teams merged I focused on the new structure and forgot that people were losing a manager they trusted. The questions people asked were all about who they would report to. I should have answered that first.');

-- ===== Leadership Foundations -- Week 10 =====================================
INSERT INTO _weeks VALUES (1, 10, 'Strategic thinking & decision-making',
'Seeing the whole system, and deciding well when you cannot know',
$html$<div class="skill-content">
  <h2>Thinking Strategically, Deciding Well</h2>
  <p>As you become more senior, the problems that reach you change shape. The easy decisions are made below you. What arrives on your desk is ambiguous, cross-functional and consequential: problems with no clean data, no obvious owner and no right answer. Strategic thinking is the ability to see the whole system those problems sit in; good decision-making is the discipline of choosing well when you cannot know for certain.</p>

  <img src="https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=800" alt="A leader working through analysis and plans at a desk" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Strategy is choice</h3>
  <p>A strategy is not a list of priorities; it is a set of choices about what you will do <em>and what you will not do</em>. Roger Martin's test is useful: if the opposite of your strategy is obviously stupid, it is not a strategy. "We will deliver excellent customer service" is not a choice &mdash; no one would choose poor service. "We will serve small business owners through relationship managers, not through the app" is a choice, because a reasonable competitor could choose the opposite.</p>
  <p>For a leader of a function or a region, strategic thinking means asking: given what the organisation is trying to win, where should my team play, and what must we stop doing to make room?</p>

  <h3>Seeing the system</h3>
  <p>Operational thinking fixes the problem in front of you. Strategic thinking asks why the problem keeps coming back. Three questions help:</p>
  <ul>
    <li><strong>Zoom out:</strong> "What larger pattern is this problem part of?" Five separate customer complaints may be one broken hand-off between two departments.</li>
    <li><strong>Look further ahead:</strong> "If this trend continues for two years, what will we wish we had started now?"</li>
    <li><strong>Change the lens:</strong> "How does this look from the customer's, the regulator's, the competitor's point of view?"</li>
  </ul>

  <div style="background:#f0f7fa;border-left:4px solid #3AAECC;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Reflection prompt:</strong> Which problem has landed on your desk more than three times this year? What system is producing it, and who else would need to be in the room to change that system?
  </div>

  <h3>Deciding under uncertainty</h3>
  <p>Judge decisions by the quality of the process, not only by the outcome. A good decision can have a bad outcome through bad luck, and a poor decision can turn out well. If you only learn from outcomes, you learn the wrong lessons. Before a significant decision, work through four questions:</p>
  <ol>
    <li><strong>Is it reversible?</strong> Amazon's distinction between "one-way doors" and "two-way doors" is helpful. Reversible decisions should be made quickly and close to the work; irreversible ones deserve more time and more voices.</li>
    <li><strong>What are the real options?</strong> If you only have two options, you have not looked hard enough. Ask the team for a third.</li>
    <li><strong>What would change my mind?</strong> Name the information that would make you choose differently &mdash; and check whether you can get it cheaply.</li>
    <li><strong>What is the cost of waiting?</strong> Delay is also a decision, and it is rarely free.</li>
  </ol>

  <h3>Guarding against common traps</h3>
  <ul>
    <li><strong>Confirmation bias:</strong> we notice evidence that supports what we already believe. Ask someone to argue the opposite case.</li>
    <li><strong>Sunk cost:</strong> money already spent is not a reason to continue. Ask: "Knowing what we know now, would we start this project today?"</li>
    <li><strong>Groupthink:</strong> quick consensus in senior teams often means people are protecting relationships. Ask for written views before the discussion.</li>
  </ul>

  <img src="https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=800" alt="Planning notes for a strategic decision" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Bringing your team into strategic thinking</h3>
  <p>Strategic thinking is not something you do alone in your office and then announce. Your team sees the front line, the customer and the process in ways you no longer do, and they will implement the strategy better if they helped shape it. Three simple practices help. First, share the context: what the organisation is trying to achieve this year and the pressures behind it. Second, ask the team to spot patterns: "What problems keep coming back in your work, and what do you think causes them?" Third, involve them in choosing what to stop: people are often relieved to be asked, because they have been doing low-value work they already knew did not matter.</p>
  <p>When you involve people this way, the strategy stops being your plan and becomes the team's plan. That shift is worth more than any amount of polish in the strategy document.</p>

  <h3>Practice this week</h3>
  <p>Choose one significant decision you face in the next month. Write a one-page decision record: the options (at least three), whether the decision is reversible, what would change your mind, the cost of waiting, and your decision. Put a reminder in your calendar for 30 days from now to review the record &mdash; and score the process, not the outcome.</p>

  <p>One last habit: when a decision turns out badly, hold a short, blame-free review with the people involved. Ask what you knew at the time, what you could reasonably have known, and what you would do differently in the process. Teams that review decisions this way get better at deciding; teams that look for someone to blame learn to hide information.</p>

  <div style="background:#fff8e7;border-left:4px solid #E8834A;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Key takeaway:</strong> Strategy is the courage to choose what not to do. Good decisions come from a good process: know whether the door is one-way or two-way, look for a third option, name what would change your mind, and remember that waiting is a decision too.
  </div>
</div>$html$,
'What significant decision are you facing, and how does it change when you ask whether it is reversible and what would change your mind?');

INSERT INTO _quiz VALUES
  (1, 10, 1, 'According to the Skill Card, a strategy is best described as:',
   '[{"id":"a","text":"A list of priorities","is_correct":false},{"id":"b","text":"A set of choices about what you will and will not do","is_correct":true},{"id":"c","text":"A detailed annual plan","is_correct":false},{"id":"d","text":"A vision statement","is_correct":false}]',
   'If the opposite of your strategy is obviously stupid, it is not a strategy.'),
  (1, 10, 2, 'Why should decisions be judged by the quality of the process rather than only the outcome?',
   '[{"id":"a","text":"Outcomes are never measurable","is_correct":false},{"id":"b","text":"Good decisions can have bad outcomes through luck, so outcomes alone teach the wrong lessons","is_correct":true},{"id":"c","text":"The process is easier to document","is_correct":false},{"id":"d","text":"Regulators require it","is_correct":false}]',
   'Learning only from outcomes confuses luck with judgement.'),
  (1, 10, 3, 'A "two-way door" decision should usually be:',
   '[{"id":"a","text":"Escalated to the executive committee","is_correct":false},{"id":"b","text":"Made quickly and close to the work","is_correct":true},{"id":"c","text":"Delayed until more data is available","is_correct":false},{"id":"d","text":"Made by consensus","is_correct":false}]',
   'Reversible decisions deserve speed; irreversible ones deserve more time and voices.'),
  (1, 10, 4, 'Which question guards against the sunk-cost trap?',
   '[{"id":"a","text":"How much have we spent so far?","is_correct":false},{"id":"b","text":"Knowing what we know now, would we start this project today?","is_correct":true},{"id":"c","text":"Who approved the original budget?","is_correct":false},{"id":"d","text":"How long until the project is finished?","is_correct":false}]',
   'Money already spent is not a reason to continue.'),
  (1, 10, 5, 'A problem has reached your desk several times this year. Strategic thinking suggests you should first:',
   '[{"id":"a","text":"Fix it faster each time","is_correct":false},{"id":"b","text":"Ask what larger system keeps producing it","is_correct":true},{"id":"c","text":"Delegate it to your deputy","is_correct":false},{"id":"d","text":"Add it to the risk register","is_correct":false}]',
   'Operational thinking fixes the problem; strategic thinking asks why it keeps coming back.');

INSERT INTO _prompts VALUES
  (1, 10, 1, 'For one decision today, ask: is this a one-way door or a two-way door?'),
  (1, 10, 2, 'When you hear two options today, ask the team for a third.'),
  (1, 10, 3, 'Name one thing your team should stop doing to make room for what matters most.'),
  (1, 10, 4, 'Before your next decision, write down what information would change your mind.');

INSERT INTO _refl_answers VALUES
  (1, 10, 1, 'I am deciding whether to centralise loan document checks. I had treated it as irreversible, but we could pilot it in one region for three months. What would change my mind is the turnaround time in the pilot, which we can measure cheaply.'),
  (1, 10, 2, 'The decision is whether to replace a long-standing supplier. It is a one-way door for at least two years because of the contract. What would change my mind is the new supplier''s performance on a small trial order, so I will ask for that before deciding.'),
  (1, 10, 3, 'We are deciding whether to delay the data-centre upgrade. Waiting felt safe, but the cost of waiting is rising maintenance risk. Writing it down showed me that delay was the riskiest option we had.');

-- ===== Leadership Foundations -- Week 12 =====================================
INSERT INTO _weeks VALUES (1, 12, 'Integration & personal leadership plan',
'Turning twelve weeks of learning into the way you lead',
$html$<div class="skill-content">
  <h2>Integration: Your Personal Leadership Plan</h2>
  <p>Programmes end; leadership development does not. The risk at the end of any programme is that insight fades faster than habit forms. Within a month, the pressure of the day job pulls most leaders back to their old patterns. This final week is about integration: pulling together what you have learned about yourself, choosing the few changes that matter most, and building the support that will make them last.</p>

  <img src="https://images.unsplash.com/photo-1475721027785-f74eccf877e2?w=800" alt="A leader presenting a plan to colleagues" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Look back before you look forward</h3>
  <p>Before you plan, review the evidence you have gathered over the programme: your leadership story from week 1, your feedback conversations, your emotion log, your decision records, your coaching notes and goal ratings. Ask three questions:</p>
  <ul>
    <li><strong>What has changed?</strong> Where do you now behave differently, and who has noticed?</li>
    <li><strong>What surprised you?</strong> Which insight about yourself was unexpected?</li>
    <li><strong>What is still hard?</strong> Where do you still fall back into old patterns, especially under pressure?</li>
  </ul>

  <h3>Few changes, deeply practised</h3>
  <p>Marshall Goldsmith's research on leadership development found that leaders who focused on one or two behaviours, and followed up regularly with their colleagues, were rated as improved far more often than those who tried to change everything. Choose no more than <strong>two leadership behaviours</strong> for the next six months. For each one, write:</p>
  <ol>
    <li><strong>The behaviour</strong>, stated as something people could observe: "I ask at least three questions before giving my view in one-to-ones."</li>
    <li><strong>Why it matters</strong> for your team and your results, not only for you.</li>
    <li><strong>The trigger</strong>: the situation where you will practise it.</li>
    <li><strong>How you will know</strong>: the evidence you will look for, and who you will ask.</li>
  </ol>

  <div style="background:#f0f7fa;border-left:4px solid #3AAECC;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Reflection prompt:</strong> If your team described your leadership in three words six months from now, which three words would you want them to use? Which one behaviour would make the biggest difference to whether they do?
  </div>

  <h3>Build your support system</h3>
  <p>Behaviour change is social. Leaders who tell others what they are working on, and ask for regular feedback, change more than those who work alone. Plan three kinds of support:</p>
  <ul>
    <li><strong>A feed-forward circle:</strong> three to five colleagues you ask every month, "What is one suggestion for how I could do this better next month?"</li>
    <li><strong>A peer partner:</strong> the peer coaching partner from this programme, or another leader, with whom you check in every few weeks.</li>
    <li><strong>A rhythm of reflection:</strong> fifteen minutes on Friday afternoon, reviewing the week against your two behaviours.</li>
  </ul>

  <h3>Anticipate the relapse</h3>
  <p>Old habits return under pressure: the quarter-end, the audit, the difficult board meeting. Plan for it. Write down your most likely relapse situation and what you will do when you notice it. A relapse is not failure; it is information about where your next practice needs to be.</p>

  <img src="https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800" alt="A leader writing a personal development plan" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>What your programme data tells you</h3>
  <p>Over the programme you have built up evidence that most leaders never have: goal ratings after each coaching session, reflections on every Training week, feedback from your peer coaching partner and your mentor. Look at the ratings as a line, not as single numbers. Where did your goals move quickly, and what were you practising at the time? Where did they stall? The pattern usually shows that progress follows practice, not insight: the weeks you tried something new between sessions are the weeks the numbers moved.</p>

  <h3>A conversation with your manager</h3>
  <p>Your manager is one of the most important people in whether your development continues. Book a thirty-minute conversation to share your plan. Tell them the two behaviours you are working on, why they matter for the team's results, and what support would help &mdash; for example, feedback after key meetings, or a stretch assignment where you can practise. Ask what they have noticed changing over the last three months. Many leaders are surprised by how much their manager has seen, and by how willing they are to help once they know what to look for.</p>

  <h3>Your personal leadership plan</h3>
  <p>This week, write a one-page plan with four sections:</p>
  <ol>
    <li><strong>My leadership purpose</strong> &mdash; one sentence on the difference you want to make as a leader.</li>
    <li><strong>My two behaviours</strong> &mdash; described as above.</li>
    <li><strong>My support</strong> &mdash; who, and how often.</li>
    <li><strong>My relapse plan</strong> &mdash; the situation and the response.</li>
  </ol>
  <p>Share it with your manager and bring it to your final coaching session. Then put a date in your calendar three months from now to review it.</p>

  <p>Remember, too, that your development now shapes other people's. The habits you model &mdash; asking before telling, giving specific feedback, explaining the why of change, deciding with a clear process &mdash; are the habits your team will copy. Consider which of your own team members would benefit from the same kind of development, and what conversation you could have with each of them in the next month about their growth.</p>

  <div style="background:#fff8e7;border-left:4px solid #E8834A;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Key takeaway:</strong> The end of the programme is the start of the practice. Choose two behaviours, make them visible to others, ask for feedback every month and plan for the relapse. That is how insight becomes the way you lead.
  </div>
</div>$html$,
'Which two leadership behaviours will you practise for the next six months, and who will help you notice whether they are changing?');

INSERT INTO _quiz VALUES
  (1, 12, 1, 'What did Goldsmith''s research find about leaders who improved most?',
   '[{"id":"a","text":"They attended the most training","is_correct":false},{"id":"b","text":"They focused on one or two behaviours and followed up regularly with colleagues","is_correct":true},{"id":"c","text":"They changed everything at once","is_correct":false},{"id":"d","text":"They worked on their development privately","is_correct":false}]',
   'Few changes, deeply practised, with regular follow-up.'),
  (1, 12, 2, 'Which is the best way to state a development behaviour?',
   '[{"id":"a","text":"Be a better listener","is_correct":false},{"id":"b","text":"Improve my executive presence","is_correct":false},{"id":"c","text":"Ask at least three questions before giving my view in one-to-ones","is_correct":true},{"id":"d","text":"Become more strategic","is_correct":false}]',
   'Write behaviours as something others could observe.'),
  (1, 12, 3, 'What is a "feed-forward circle"?',
   '[{"id":"a","text":"A formal 360-degree assessment","is_correct":false},{"id":"b","text":"Colleagues you ask each month for one suggestion to do better next month","is_correct":true},{"id":"c","text":"A performance review panel","is_correct":false},{"id":"d","text":"A team-building exercise","is_correct":false}]',
   'Future-focused suggestions are easier to give and to act on than criticism of the past.'),
  (1, 12, 4, 'How should a leader think about relapsing into old habits under pressure?',
   '[{"id":"a","text":"As proof that the programme did not work","is_correct":false},{"id":"b","text":"As information about where the next practice is needed","is_correct":true},{"id":"c","text":"As something to hide from the team","is_correct":false},{"id":"d","text":"As unavoidable, so not worth planning for","is_correct":false}]',
   'Plan for the relapse situation in advance.'),
  (1, 12, 5, 'Why does the Skill Card recommend sharing your plan with others?',
   '[{"id":"a","text":"It is required for certification","is_correct":false},{"id":"b","text":"Behaviour change is social; people who make their goals visible change more","is_correct":true},{"id":"c","text":"It helps with performance ratings","is_correct":false},{"id":"d","text":"It shows commitment to HR","is_correct":false}]',
   'Visibility creates feedback, and feedback sustains change.');

INSERT INTO _prompts VALUES
  (1, 12, 1, 'Write down three words you want your team to use about your leadership in six months.'),
  (1, 12, 2, 'Ask one colleague for one suggestion for next month. Just say thank you.'),
  (1, 12, 3, 'Name your most likely relapse situation and one thing you will do when you notice it.'),
  (1, 12, 4, 'Tell one person which leadership behaviour you are working on.');

INSERT INTO _refl_answers VALUES
  (1, 12, 1, 'My two behaviours: asking three questions before giving my view in one-to-ones, and closing every operations review with an owner and a date for each open issue. My deputy and two branch managers will be my feed-forward circle, and I will ask them every month.'),
  (1, 12, 2, 'I will practise giving SBI feedback within 48 hours, and explaining the why before the what in every change. My peer coaching partner and I agreed to check in every three weeks, and I have asked my manager to tell me when I slip.'),
  (1, 12, 3, 'I am choosing to delegate decisions within guardrails and to protect two hours a week for strategic work. My relapse situation is quarter-end, so I have already put a reminder in my calendar for the last week of September.');

-- ===== Emerging Leaders -- Week 1 ============================================
INSERT INTO _weeks VALUES (3, 1, 'Leadership basics: from doing to leading',
'What changes when your job becomes other people''s success',
$html$<div class="skill-content">
  <h2>From Doing the Work to Leading the People Who Do It</h2>
  <p>Most first-time leaders are promoted for being excellent individual contributors. Then, on the first day in the new role, the rules change without anyone announcing it. Your results now come through other people. The skills that made you successful &mdash; speed, expertise, personal ownership of every detail &mdash; can quietly become the things that hold your team back.</p>

  <img src="https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=800" alt="A new team leader presenting to the team" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Three shifts every new leader makes</h3>
  <ol>
    <li><strong>From my results to our results.</strong> A good day is no longer the day you finished the most work; it is the day your team moved forward. That can feel strange at first: you may go home without having "produced" anything visible.</li>
    <li><strong>From answering to asking.</strong> When a team member brings you a problem, the fastest response is to solve it. The better response, most of the time, is to ask what they think &mdash; so that next time they do not need you.</li>
    <li><strong>From being liked to being trusted.</strong> Especially if you now lead former peers, you will have to make decisions some people do not like. Trust comes from being fair, consistent and honest, not from avoiding difficult conversations.</li>
  </ol>

  <div style="background:#f0f7fa;border-left:4px solid #3AAECC;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Reflection prompt:</strong> Which part of your old job are you still holding on to? What would happen if you handed it to someone in your team?
  </div>

  <h3>Leading former peers</h3>
  <p>If you have been promoted inside your own team, the relationships have changed even if the people have not. A few habits help: have a one-to-one with each person in your first month and ask what they need from you; be open that the relationship is different now; and avoid both extremes &mdash; pretending nothing has changed, or suddenly becoming distant and formal.</p>

  <img src="https://images.unsplash.com/photo-1560250097-0b93528c311a?w=800" alt="A confident new leader" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Your first 90 days</h3>
  <ul>
    <li><strong>Listen first:</strong> meet every team member and ask what is working, what is not, and what they would change.</li>
    <li><strong>Agree expectations</strong> with your own manager: what does success look like in six months?</li>
    <li><strong>Pick one early win</strong> that the team cares about, and deliver it together.</li>
  </ul>

  <h3>Your time as a leader</h3>
  <p>Many new leaders try to keep doing their old job and lead the team at the same time, working longer and longer hours. It does not last. Look at how you spent last week and sort it into three groups: work only you can do as the leader (planning, coaching, decisions, representing the team), work someone in your team could learn to do, and work that should not be done at all. The middle group is your development opportunity for the team. The last group is your gift to yourself.</p>
  <p>It is normal to feel less productive for a while. You are learning a new job. The first sign that you are doing it well is not that you are busy &mdash; it is that your team can handle more without you.</p>

  <h3>Asking for help</h3>
  <p>Leaders are not expected to know everything, especially at the start. Ask your own manager what they wish they had known in their first leadership role. Find a peer who became a leader a year or two before you and ask how they handled the first months. Asking for help is not a weakness; it is a leadership behaviour your team will copy.</p>

  <h3>Practice this week</h3>
  <p>Hold a 30-minute one-to-one with at least two team members. Ask three questions: "What do you enjoy most about your work?", "What gets in your way?" and "What do you need from me?" Write down one thing you learned that you did not know before.</p>

  <div style="background:#fff8e7;border-left:4px solid #E8834A;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Key takeaway:</strong> Your job has changed from doing the work to building a team that does great work. Every time you ask instead of answering, you invest in that team.
  </div>
</div>$html$,
'Which part of your previous role are you still holding on to, and what would it take to hand it over?');

INSERT INTO _quiz VALUES
  (3, 1, 1, 'What is the biggest change for a first-time leader, according to the Skill Card?',
   '[{"id":"a","text":"Working longer hours","is_correct":false},{"id":"b","text":"Results now come through other people","is_correct":true},{"id":"c","text":"Learning new technical skills","is_correct":false}]',
   'Success is measured by the team''s progress, not your personal output.'),
  (3, 1, 2, 'A team member brings you a problem. What is usually the better first response?',
   '[{"id":"a","text":"Solve it quickly so they can move on","is_correct":false},{"id":"b","text":"Ask what they think the options are","is_correct":true},{"id":"c","text":"Escalate it to your manager","is_correct":false}]',
   'Asking builds a team that does not need you for every problem.'),
  (3, 1, 3, 'When leading former peers, the Skill Card recommends:',
   '[{"id":"a","text":"Pretending nothing has changed","is_correct":false},{"id":"b","text":"Becoming formal and distant","is_correct":false},{"id":"c","text":"Being open that the relationship has changed and asking what people need","is_correct":true}]',
   'Avoid both extremes; name the change and listen.');

INSERT INTO _prompts VALUES
  (3, 1, 1, 'Today, when someone asks you for an answer, ask "What do you think?" first.'),
  (3, 1, 2, 'Write down one task from your old job that you could hand over this week.'),
  (3, 1, 3, 'Ask one team member what they need from you, and just listen.');

INSERT INTO _refl_answers VALUES
  (3, 1, 1, 'I still check every production report myself before it goes to the plant manager. If I handed it to my senior operator, I would need to agree what "good" looks like and accept that the first two reports might not be perfect.'),
  (3, 1, 2, 'I still answer every customer escalation myself because I know the history. Handing it over would take a short guide and a week of me sitting beside my colleague, but it would free an hour every day.');

-- ===== Emerging Leaders -- Week 2 ============================================
INSERT INTO _weeks VALUES (3, 2, 'Communication that lands',
'Clear expectations, better one-to-ones, and listening first',
$html$<div class="skill-content">
  <h2>Communication That Lands</h2>
  <p>Most problems in teams are not caused by people being unwilling. They are caused by unclear expectations. The leader thought the task was obvious; the team member understood something slightly different; a week later, both are frustrated. Clear communication is the cheapest performance tool a new leader has.</p>

  <img src="https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=800" alt="A team leader and colleagues in discussion" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Setting clear expectations</h3>
  <p>When you hand over a task, cover four points:</p>
  <ol>
    <li><strong>The outcome:</strong> what does "done" look like?</li>
    <li><strong>The why:</strong> why does this matter, and to whom?</li>
    <li><strong>The boundaries:</strong> deadline, budget, and which decisions they can make alone.</li>
    <li><strong>The check-in:</strong> when you will talk about progress.</li>
  </ol>
  <p>Then ask the person to say back what they will do. Not "Is that clear?" &mdash; almost everyone says yes &mdash; but "Can you walk me through how you will approach it?"</p>

  <div style="background:#f0f7fa;border-left:4px solid #3AAECC;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Reflection prompt:</strong> Think of the last time a task came back different from what you expected. Which of the four points was missing when you handed it over?
  </div>

  <h3>One-to-ones that matter</h3>
  <p>A regular one-to-one is the single most useful meeting a new leader can hold. Keep it the team member's meeting, not a status update. A simple structure: what is going well, what is getting in the way, what you can do to help, and one thing they are learning. Protect it: moving a one-to-one again and again tells people they are not a priority.</p>

  <img src="https://images.unsplash.com/photo-1553877522-43269d4ea984?w=800" alt="Two colleagues in a one-to-one meeting" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Listen before you reply</h3>
  <p>When someone is speaking, notice whether you are listening to understand or preparing your answer. Reflect back what you heard, ask one more question, and allow a short silence. People often share the most important point last.</p>

  <h3>Choosing the right channel</h3>
  <p>Not every message belongs in a chat. A useful rule: use written messages for information, meetings for discussion, and face-to-face conversations for anything emotional or sensitive &mdash; feedback, bad news, a change that affects someone personally. A short chat message about a difficult topic can be read in the worst possible tone. If you notice a message thread getting longer and more tense, stop typing and call the person.</p>

  <h3>Communicating in a team meeting</h3>
  <p>Team meetings are where your team learns what you think is important. Start with the purpose of the meeting and the decisions you need. Keep updates short, or share them in writing beforehand, so the meeting time goes to the things that need discussion. Before the end, summarise what was decided, who owns each action and by when. Send that summary in writing on the same day. It takes five minutes and prevents most of the "I thought we agreed..." conversations a week later.</p>
  <p>Finally, remember that people listen to what you do as much as to what you say. If you ask for punctuality, arrive on time. If you ask for open discussion, stay calm when someone disagrees.</p>

  <h3>Practice this week</h3>
  <p>Hand over one task using the four points, and ask the person to walk you through their approach. Hold one one-to-one using the simple structure above, and let the team member speak for at least two-thirds of the time.</p>

  <p>A final point on feedback in everyday communication: when someone does something well, say so specifically and soon. "Thank you for the report" is polite; "Your report put the three problems on the first page, which made the decision easy" teaches the person what to repeat. New leaders often forget to say what is working because they are busy fixing what is not. Aim to notice good work at least as often as you correct mistakes.</p>

  <div style="background:#fff8e7;border-left:4px solid #E8834A;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Key takeaway:</strong> Most performance problems start as communication problems. Be clear about the outcome, the why, the boundaries and the check-in &mdash; and check understanding by asking, not assuming.
  </div>
</div>$html$,
'When did a task last come back different from what you expected, and what will you do differently the next time you hand one over?');

INSERT INTO _quiz VALUES
  (3, 2, 1, 'Which is NOT one of the four points for handing over a task?',
   '[{"id":"a","text":"The outcome","is_correct":false},{"id":"b","text":"The boundaries","is_correct":false},{"id":"c","text":"The exact steps to follow","is_correct":true}]',
   'Describe the outcome and boundaries; leave the steps to the person.'),
  (3, 2, 2, 'What is the best way to check that a task was understood?',
   '[{"id":"a","text":"Ask \"Is that clear?\"","is_correct":false},{"id":"b","text":"Ask the person to walk you through their approach","is_correct":true},{"id":"c","text":"Send a follow-up email","is_correct":false}]',
   'Almost everyone answers yes to "Is that clear?"'),
  (3, 2, 3, 'A good one-to-one is mainly:',
   '[{"id":"a","text":"A status update for the leader","is_correct":false},{"id":"b","text":"The team member''s meeting, focused on what helps and what gets in the way","is_correct":true},{"id":"c","text":"Optional when the team is busy","is_correct":false}]',
   'Protect it and let the team member lead it.');

INSERT INTO _prompts VALUES
  (3, 2, 1, 'Hand over one task today with the outcome, the why, the boundaries and the check-in.'),
  (3, 2, 2, 'In one conversation, reflect back what you heard before you reply.'),
  (3, 2, 3, 'Ask someone to walk you through their plan instead of asking "Is that clear?"');

INSERT INTO _refl_answers VALUES
  (3, 2, 1, 'A shift report came back without the downtime figures I needed. I had explained the outcome but not the why: the plant manager uses those figures for the weekly maintenance plan. Next time I will explain who uses the work and ask the person to walk me through it.'),
  (3, 2, 2, 'My colleague prepared a campaign brief for the wrong audience because I never said which decisions were hers. I will set the boundaries clearly and agree a check-in halfway through.');

-- ===== Emerging Leaders -- Week 3 ============================================
INSERT INTO _weeks VALUES (3, 3, 'Team dynamics',
'Trust, healthy conflict and shared commitment',
$html$<div class="skill-content">
  <h2>Building a Team, Not Just a Group</h2>
  <p>A group of talented people is not automatically a team. Teams share a goal, trust each other enough to disagree, and hold each other to account. As a new leader you have more influence over these dynamics than you might think &mdash; mostly through what you do, not what you say.</p>

  <img src="https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=800" alt="Team members joining hands" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Trust comes first</h3>
  <p>Patrick Lencioni's model of team dysfunction starts with an absence of trust: people who do not feel safe to admit mistakes or ask for help will not disagree openly, and teams that do not disagree openly make weaker decisions. Google's research on effective teams points the same way: the strongest predictor of team performance was psychological safety &mdash; the shared belief that it is safe to take interpersonal risks.</p>
  <p>You build it by going first: admit a mistake, ask for help, say "I don't know". When the leader does it, the team learns it is allowed.</p>

  <div style="background:#f0f7fa;border-left:4px solid #3AAECC;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Reflection prompt:</strong> When did someone in your team last tell you about a mistake early? If you cannot remember, what might be stopping them?
  </div>

  <h3>Healthy conflict</h3>
  <p>Disagreement about ideas makes decisions better; disagreement that becomes personal damages the team. Encourage the first: ask the quietest person for their view, ask someone to argue the other side, and thank people who disagree with you in public. Stop the second quickly and privately.</p>

  <img src="https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=800" alt="A team in lively discussion" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Commitment and accountability</h3>
  <p>People commit to decisions they helped shape, even when they did not get their way. Close every important discussion by stating the decision, who owns each action, and by when. Then follow up. Accountability is not blame; it is keeping the promises the team made to each other.</p>

  <h3>Understanding different working styles</h3>
  <p>Every team includes people who think out loud and people who need time to think before they speak; people who want detail and people who want the big picture; people who value harmony and people who value directness. None of these styles is better. Problems start when the leader expects everyone to work the way they do. Ask each team member how they prefer to receive information, give feedback and make decisions. Send the agenda in advance so reflective thinkers can prepare. In discussions, give people a minute of silence to write their ideas down before anyone speaks, so the loudest voice does not decide the outcome.</p>

  <h3>Handling a conflict between two team members</h3>
  <p>When two people in your team are in conflict, resist the temptation to judge who is right after hearing one side. Talk to each person separately first and listen for what each of them needs. Then bring them together, set the goal of the conversation ("we need a way of working that works for both of you"), and let them talk directly to each other while you keep the conversation fair. Your role is to make the conversation possible, not to deliver a verdict.</p>

  <h3>Practice this week</h3>
  <p>In your next team meeting, share one mistake you made recently and what you learned. Before any decision, ask at least two people for a view that differs from yours. End the meeting by confirming owners and dates.</p>

  <p>Pay attention, too, to how the team welcomes new members and how it celebrates success. Small rituals &mdash; a proper introduction on someone's first day, a short thank-you at the end of a difficult month, a team lunch after a big delivery &mdash; tell people that they belong. Teams with a strong sense of belonging recover faster from setbacks, and people are more willing to help each other without being asked.</p>

  <div style="background:#fff8e7;border-left:4px solid #E8834A;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Key takeaway:</strong> Teams perform when people feel safe enough to disagree and committed enough to follow through. As the leader, you go first.
  </div>
</div>$html$,
'What is one thing you could do in the next two weeks to make it safer for your team to disagree with you?');

INSERT INTO _quiz VALUES
  (3, 3, 1, 'In Google''s research, the strongest predictor of team effectiveness was:',
   '[{"id":"a","text":"Individual talent","is_correct":false},{"id":"b","text":"Psychological safety","is_correct":true},{"id":"c","text":"Team size","is_correct":false}]',
   'The shared belief that it is safe to take interpersonal risks.'),
  (3, 3, 2, 'How does a leader build trust most effectively?',
   '[{"id":"a","text":"By going first: admitting mistakes and asking for help","is_correct":true},{"id":"b","text":"By never showing uncertainty","is_correct":false},{"id":"c","text":"By organising social events","is_correct":false}]',
   'When the leader does it, the team learns it is allowed.'),
  (3, 3, 3, 'Which type of conflict should a leader encourage?',
   '[{"id":"a","text":"Personal conflict","is_correct":false},{"id":"b","text":"No conflict at all","is_correct":false},{"id":"c","text":"Disagreement about ideas","is_correct":true}]',
   'Debate about ideas improves decisions; personal conflict damages the team.');

INSERT INTO _prompts VALUES
  (3, 3, 1, 'Ask the quietest person in your next meeting for their view.'),
  (3, 3, 2, 'Share one small mistake with your team today and what you learned.');

INSERT INTO _refl_answers VALUES
  (3, 3, 1, 'I will start our Monday meeting by sharing something I got wrong the week before, and I will ask one person each week to argue against my proposal before we decide.'),
  (3, 3, 2, 'I will thank people in the meeting when they disagree with me, instead of explaining why I am right. My team watches how I react more than what I say.');

-- ===== Emerging Leaders -- Week 4 ============================================
INSERT INTO _weeks VALUES (3, 4, 'Personal effectiveness',
'Priorities, energy and focus when everything feels urgent',
$html$<div class="skill-content">
  <h2>Personal Effectiveness: Leading Yourself First</h2>
  <p>New leaders often feel they have less time than ever. Meetings multiply, people interrupt, and the work you used to do still needs doing. Personal effectiveness is not about working harder; it is about choosing what deserves your time and protecting the attention you need to lead well.</p>

  <img src="https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=800" alt="A focused workspace" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Urgent is not the same as important</h3>
  <p>The Eisenhower matrix sorts work into four boxes: urgent and important (do it), important but not urgent (schedule it), urgent but not important (delegate it), and neither (drop it). Leaders who stay in the first box all day become firefighters. The work that builds a strong team &mdash; coaching, planning, improving how the team works &mdash; almost always sits in the second box, and it only happens if it is scheduled.</p>

  <div style="background:#f0f7fa;border-left:4px solid #3AAECC;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Reflection prompt:</strong> Look at last week. How much of your time went to "important but not urgent" work? What would you move to make room for it?
  </div>

  <h3>Plan the week, protect the focus</h3>
  <ul>
    <li><strong>Weekly plan:</strong> on Friday or Monday, choose the three results that matter most this week and put time for them in your calendar.</li>
    <li><strong>Focus blocks:</strong> protect one or two 90-minute blocks a week with notifications off.</li>
    <li><strong>Batch the small things:</strong> answer messages at set times instead of all day.</li>
  </ul>

  <img src="https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=800" alt="A leader planning the week ahead" style="width:100%;border-radius:12px;margin:20px 0;" />

  <h3>Managing energy, not only time</h3>
  <p>Your energy sets the tone for the team. Notice when in the day you think most clearly and put your hardest work there. Take real breaks. A tired leader makes slower decisions and has less patience &mdash; and the team feels it.</p>

  <h3>Saying no, and saying not now</h3>
  <p>A new leader receives many requests from their own manager, from other departments and from their team. Saying yes to everything feels helpful and quickly becomes impossible. You do not always need to say no; often "not now" or "yes, if" works better. "I can take this on if we move the report deadline to next week" makes the trade-off visible and lets the other person decide. When you do say no, explain your priorities so the answer is about the work, not about the person.</p>

  <h3>A weekly review</h3>
  <p>End each week with a fifteen-minute review. Three questions are enough: What did I achieve that mattered? What got in the way? What are my three priorities for next week? Over a few weeks you will see patterns: the meetings that never produce decisions, the times of day you are most productive, the requests that keep pulling you away. Those patterns are where small changes make the biggest difference.</p>
  <p>Personal effectiveness is also something you model for your team. When they see you plan, protect your focus and leave on time most days, they learn that doing good work does not mean being busy all the time.</p>

  <h3>Practice this week</h3>
  <p>Write a weekly plan with your three most important results, share it with your team, and block one 90-minute focus session. At the end of the week, check what happened to the plan and what pulled you away from it.</p>

  <p>Delegation is part of personal effectiveness too. Every task you keep that someone in your team could do is time taken from the work only you can do. Start with one task a week: explain the outcome, agree the check-in, and accept that it may be done differently from how you would do it. Different is not the same as wrong.</p>

  <p>Start small. Choose one of these habits this week, not all of them, and notice what changes.</p>

  <div style="background:#fff8e7;border-left:4px solid #E8834A;padding:16px 20px;border-radius:8px;margin:20px 0;">
    <strong>Key takeaway:</strong> You cannot lead others well if everything is urgent. Choose your three priorities, schedule the important work, and protect your focus and energy.
  </div>
</div>$html$,
'What is the most important "not urgent" task you keep postponing, and when this week will you schedule it?');

INSERT INTO _quiz VALUES
  (3, 4, 1, 'In the Eisenhower matrix, what should you do with work that is important but not urgent?',
   '[{"id":"a","text":"Do it immediately","is_correct":false},{"id":"b","text":"Schedule it","is_correct":true},{"id":"c","text":"Drop it","is_correct":false}]',
   'The work that builds a strong team usually sits here and must be scheduled.'),
  (3, 4, 2, 'Which habit best protects a leader''s focus?',
   '[{"id":"a","text":"Answering every message as it arrives","is_correct":false},{"id":"b","text":"Blocking focus time and batching small tasks","is_correct":true},{"id":"c","text":"Accepting every meeting invitation","is_correct":false}]',
   'Protected focus blocks and batching reduce constant switching.'),
  (3, 4, 3, 'Why does the Skill Card talk about energy as well as time?',
   '[{"id":"a","text":"A tired leader makes slower decisions and the team feels it","is_correct":true},{"id":"b","text":"Energy is easier to measure than time","is_correct":false},{"id":"c","text":"Time management does not matter","is_correct":false}]',
   'Your energy sets the tone for the team.');

INSERT INTO _prompts VALUES
  (3, 4, 1, 'Write down the three results that matter most this week.'),
  (3, 4, 2, 'Block one 90-minute focus session in your calendar and protect it.');

INSERT INTO _refl_answers VALUES
  (3, 4, 1, 'I keep postponing the training plan for new operators. I will block Thursday morning for it and tell my team I will not be available for two hours.'),
  (3, 4, 2, 'The task I postpone is writing clear role descriptions for my team. I will schedule it for Monday afternoon and share a draft at our Wednesday meeting.');

-- ===== What learners wrote ===================================================
INSERT INTO _prompt_responses VALUES
  (1, 'Tried it in the morning stand-up. It felt slow at first, but two people spoke who usually stay quiet.'),
  (2, 'Harder than I expected. I caught myself halfway through giving the answer and turned it into a question.'),
  (3, 'Noticed the pattern straight away: it happens every time the numbers are late.'),
  (4, 'Did it with my deputy. She told me something about the project I had not heard in three months.'),
  (5, 'Only managed it once today, in the afternoon meeting. The silence was uncomfortable and useful.'),
  (6, 'Wrote it down before the meeting, which made it much easier to follow through.'),
  (7, 'My first instinct was to explain myself. I stopped, said thank you, and we moved on. Better than I feared.'),
  (8, 'Skipped it in the morning, came back to it after lunch. Small thing, but the conversation changed tone.');

INSERT INTO _session_reflections VALUES
  ('coaching', 1, 'The most useful moment was when Duc asked what I was protecting by not delegating. The honest answer is my reputation for never being wrong. My experiment for the next two weeks: hand one decision to my team each week and resist checking it before it goes out.'),
  ('coaching', 2, 'I came in wanting advice about a difficult stakeholder and left with a better question: what does he need to be true before he can say yes? I will ask him that directly this week instead of preparing another presentation.'),
  ('coaching', 3, 'We looked at my calendar together. Almost nothing in it serves the goal I say matters most. I have blocked two mornings a week and told my team why, so they can hold me to it.'),
  ('coaching', 4, 'I realised I have been treating every disagreement as a threat to my authority. Next week I will ask one person in each meeting to argue the other side before we decide.'),
  ('mentoring', 1, 'Hearing how Duc handled his first year as a regional director made my situation feel normal. The practical takeaway: map the three people whose support I need and meet each of them before the next planning cycle.'),
  ('mentoring', 2, 'Useful perspective on building credibility with senior people: bring a recommendation, not just analysis. I will rewrite my next committee paper to lead with the decision I want.'),
  ('mentoring', 3, 'The conversation about career paths helped me see that my next step depends less on technical depth and more on how visible my team''s results are. I will start a short monthly update to my director.'),
  ('peer_coaching', 1, 'Coaching a peer was harder than being coached. I kept wanting to give advice. When I held back and asked more questions, my partner found an option neither of us had seen.'),
  ('peer_coaching', 2, 'Being coached by a colleague from another organisation was valuable: she had no stake in the politics and asked questions my own team would not. My action: have the conversation I have been avoiding before the end of the month.'),
  ('peer_coaching', 3, 'We practised the difficult negotiation twice. The second time I led with interests instead of positions and it felt completely different. I will use the same preparation before the real meeting.');

INSERT INTO _coach_notes VALUES
  (1, 'Explored the pattern of taking decisions back from the team under pressure. Client identified the trigger (senior scrutiny) and chose one experiment: delegate one decision a week with clear guardrails. Energy high; follow up on what happened when the first decision went differently than expected.'),
  (2, 'Worked on stakeholder influence. Shifted from preparing more data to understanding what the stakeholder needs to say yes. Client will test a direct conversation this week. Watch for over-preparation as avoidance.'),
  (3, 'Reviewed goal progress against the baseline ratings. Clear movement on the primary goal; the secondary goal is stalling because it has no weekly practice attached. Agreed a small daily practice and a check-in point.'),
  (4, 'Client arrived frustrated after a difficult committee meeting. Used pause-label-choose to separate the emotion from the decision. Client reframed the meeting as useful data and planned the next conversation.'),
  (5, 'Integration session: client articulated two behaviours to keep practising and named a feed-forward circle. Strong self-awareness compared with the first session; relapse risk is quarter-end, and a plan is in place for it.');

INSERT INTO _action_titles VALUES
  ('coaching', 1, 'Delegate one recurring decision to the team with clear guardrails'),
  ('coaching', 2, 'Hold a direct conversation with the key stakeholder about what they need to say yes'),
  ('coaching', 3, 'Block two mornings a week for strategic work and share the reason with the team'),
  ('coaching', 4, 'Ask one person in each meeting to argue the opposite view before deciding'),
  ('coaching', 5, 'Give SBI feedback within 48 hours in three conversations'),
  ('mentoring', 1, 'Map the three people whose support I need and meet each of them'),
  ('mentoring', 2, 'Rewrite the next committee paper to lead with the recommendation'),
  ('mentoring', 3, 'Send a short monthly update on the team''s results to my director'),
  ('peer_coaching', 1, 'Have the conversation I have been avoiding before the end of the month'),
  ('peer_coaching', 2, 'Prepare interests, not positions, before the next negotiation'),
  ('peer_coaching', 3, 'Ask three open questions before offering advice in my next one-to-one');

INSERT INTO public.training_weeks (id, programme_id, week_number, title, subtitle, skill_card_html,
  is_visible, skill_card_visible, sort_order, created_at)
SELECT pg_temp.uid('week:' || w.prog || ':' || w.week_number),
  ('de100000-0000-4000-8000-00000000000' || w.prog)::uuid, w.week_number, w.title, w.subtitle, w.html,
  true, true, w.week_number, TIMESTAMPTZ '2026-02-16 10:00+07'
FROM _weeks w;

INSERT INTO public.assignments (id, training_week_id, assignment_type, title, instructions, is_visible,
  due_offset_days, sort_order, created_at)
SELECT pg_temp.uid('quiz:' || w.prog || ':' || w.week_number), pg_temp.uid('week:' || w.prog || ':' || w.week_number),
  'quiz'::public.assignment_type, 'Knowledge check: ' || w.title,
  format('%s questions on this week''s Skill Card. Choose the best answer for each.',
         (SELECT count(*) FROM _quiz q WHERE q.prog = w.prog AND q.week_number = w.week_number)),
  true, 7, 1, TIMESTAMPTZ '2026-02-16 10:00+07'
FROM _weeks w;

INSERT INTO public.quiz_questions (id, assignment_id, question_text, options, explanation, sort_order, created_at)
SELECT pg_temp.uid('qq:' || q.prog || ':' || q.week_number || ':' || q.sort_order),
  pg_temp.uid('quiz:' || q.prog || ':' || q.week_number), q.question, q.options, q.explanation, q.sort_order,
  TIMESTAMPTZ '2026-02-16 10:00+07'
FROM _quiz q;

INSERT INTO public.programme_reflections (id, programme_id, reflection_number, title, instructions,
  appears_at_week, is_visible, created_at)
SELECT pg_temp.uid('refl:' || w.prog || ':' || w.week_number),
  ('de100000-0000-4000-8000-00000000000' || w.prog)::uuid,
  row_number() OVER (PARTITION BY w.prog ORDER BY w.week_number)::integer,
  'Reflection: ' || w.title, w.reflection, w.week_number, true, TIMESTAMPTZ '2026-02-16 10:00+07'
FROM _weeks w;

INSERT INTO public.reflection_questions (id, reflection_id, question_text, question_type, is_required, sort_order)
SELECT pg_temp.uid('rq:' || w.prog || ':' || w.week_number), pg_temp.uid('refl:' || w.prog || ':' || w.week_number),
  w.reflection, 'open_text', true, 1
FROM _weeks w;

INSERT INTO public.daily_prompts (id, training_week_id, day_offset, prompt_text, is_visible, sort_order, created_at)
SELECT pg_temp.uid('dp:' || p.prog || ':' || p.week_number || ':' || p.day_offset),
  pg_temp.uid('week:' || p.prog || ':' || p.week_number), p.day_offset, p.prompt, true, p.day_offset,
  TIMESTAMPTZ '2026-02-16 10:00+07'
FROM _prompts p;

-- The module rows name the weeks, so they are written after them.
INSERT INTO public.programme_modules (programme_id, module, enabled, config) VALUES
  ('de100000-0000-4000-8000-000000000001', 'training', true, jsonb_build_object(
     'required', true, 'required_units', 7,
     'learning_components', jsonb_build_array('skill_cards', 'quizzes', 'reflections', 'daily_prompts'),
     'distribution_settings', jsonb_build_object('training_week_ids',
       (SELECT jsonb_agg(pg_temp.uid('week:1:' || w.week_number) ORDER BY w.week_number) FROM _weeks w WHERE w.prog = 1)))),
  ('de100000-0000-4000-8000-000000000001', 'coaching',      true, '{"required": true, "required_units": 3}'),
  ('de100000-0000-4000-8000-000000000001', 'peer_coaching', true, '{"required": true, "required_units": 1}'),
  ('de100000-0000-4000-8000-000000000001', 'mentoring',     true, '{"required": true, "required_units": 1}'),
  ('de100000-0000-4000-8000-000000000002', 'coaching',      true, '{"required": true, "required_units": 6}'),
  ('de100000-0000-4000-8000-000000000003', 'training', true, jsonb_build_object(
     'required', true, 'required_units', 4,
     'learning_components', jsonb_build_array('skill_cards', 'quizzes', 'reflections', 'daily_prompts'),
     'distribution_settings', jsonb_build_object('training_week_ids',
       (SELECT jsonb_agg(pg_temp.uid('week:3:' || w.week_number) ORDER BY w.week_number) FROM _weeks w WHERE w.prog = 3)))),
  ('de100000-0000-4000-8000-000000000003', 'coaching',      true, '{"required": true, "required_units": 3}'),
  ('de100000-0000-4000-8000-000000000003', 'mentoring',     true, '{"required": true, "required_units": 2}');

-- ---------------------------------------------------------------------------
-- 5. Cohorts, provider pools, week opening dates, requirement dates
-- ---------------------------------------------------------------------------
-- A mixed-organisation cohort carries no organisation of its own: sponsor
-- visibility follows each ENROLLMENT's organisation, never the cohort's, and
-- a cohort label naming one organisation would only mislead.
INSERT INTO public.cohorts (id, name, description, programme_id, organization_id, start_date, end_date,
  color, goal_setting_opens_on, goal_setting_due_on, created_at)
SELECT c.id, c.name, c.description, c.programme_id, o.id, c.start_date, c.end_date, c.color,
  c.start_date, c.start_date + 14, TIMESTAMPTZ '2026-02-16 11:00+07'
FROM (VALUES
  ('de300000-0000-4000-8000-000000000001'::uuid, 'Leadership Foundations — Cohort A',
   'Completed. Mixed cohort: Organisation A and Organisation B leaders.',
   'de100000-0000-4000-8000-000000000001'::uuid, NULL::text, DATE '2026-03-02', DATE '2026-06-08', '#3AAECC'),
  ('de300000-0000-4000-8000-000000000002', 'Executive Coaching Sprint — Cohort A',
   'Mixed cohort: Organisation A and Organisation B leaders.',
   'de100000-0000-4000-8000-000000000002', NULL, DATE '2026-09-01', DATE '2026-11-30', '#E8834A'),
  ('de300000-0000-4000-8000-000000000003', 'Emerging Leaders — Cohort A',
   'Mixed cohort: Organisation A and Organisation B leaders.',
   'de100000-0000-4000-8000-000000000003', NULL, DATE '2026-09-15', DATE '2027-01-05', '#6B8E4E'),
  ('de300000-0000-4000-8000-000000000004', 'Leadership Foundations — Cohort B',
   'Organisation A. Starts 6 October 2026.',
   'de100000-0000-4000-8000-000000000001', 'A', DATE '2026-10-06', DATE '2027-01-12', '#2E7D9A')
) AS c(id, name, description, programme_id, org, start_date, end_date, color)
LEFT JOIN _orgs o ON o.code = c.org;

-- Duc coaches every cohort and mentors every cohort that has Mentoring.
INSERT INTO public.cohort_coach_assignments (cohort_id, coach_id, is_active, assigned_at, assigned_by)
SELECT c.id, 'de000000-0000-4000-8000-000000000001', true, TIMESTAMPTZ '2026-02-16 11:00+07', (SELECT id FROM _admin)
FROM public.cohorts c WHERE c.id::text LIKE 'de300000-%';
INSERT INTO public.cohort_mentors (cohort_id, mentor_user_id, is_active, assigned_at, assigned_by)
SELECT c.id, 'de000000-0000-4000-8000-000000000001', true, TIMESTAMPTZ '2026-02-16 11:00+07', (SELECT id FROM _admin)
FROM public.cohorts c
WHERE c.id::text LIKE 'de300000-%'
  AND EXISTS (SELECT 1 FROM public.programme_modules pm
              WHERE pm.programme_id = c.programme_id AND pm.module = 'mentoring' AND pm.enabled);

-- Every checkpoint of every cohort, with its fixed due date. Training weeks
-- open 7 days before they are due; session requirements open 14 days before
-- (canonical_session_requirement_available_on).
CREATE TEMP TABLE _dates (cohort integer, module public.programme_module_type, ordinal integer,
  week_number integer, due_on date) ON COMMIT DROP;
INSERT INTO _dates VALUES
  -- Cohort 1: Leadership Foundations -- Cohort A
  (1, 'training', 1, 1, '2026-03-09'), (1, 'training', 2, 2, '2026-03-16'), (1, 'coaching', 1, NULL, '2026-03-23'),
  (1, 'training', 3, 4, '2026-03-30'), (1, 'peer_coaching', 1, NULL, '2026-04-06'), (1, 'training', 4, 6, '2026-04-13'),
  (1, 'coaching', 2, NULL, '2026-04-20'), (1, 'training', 5, 8, '2026-04-27'), (1, 'mentoring', 1, NULL, '2026-05-04'),
  (1, 'training', 6, 10, '2026-05-11'), (1, 'coaching', 3, NULL, '2026-05-18'), (1, 'training', 7, 12, '2026-05-25'),
  -- Cohort 2: Executive Coaching Sprint -- Cohort A
  (2, 'coaching', 1, NULL, '2026-09-15'), (2, 'coaching', 2, NULL, '2026-09-29'), (2, 'coaching', 3, NULL, '2026-10-13'),
  (2, 'coaching', 4, NULL, '2026-10-27'), (2, 'coaching', 5, NULL, '2026-11-10'), (2, 'coaching', 6, NULL, '2026-11-24'),
  -- Cohort 3: Emerging Leaders -- Cohort A
  (3, 'training', 1, 1, '2026-09-22'), (3, 'training', 2, 2, '2026-09-29'), (3, 'coaching', 1, NULL, '2026-10-13'),
  (3, 'training', 3, 3, '2026-10-20'), (3, 'mentoring', 1, NULL, '2026-10-27'), (3, 'training', 4, 4, '2026-11-10'),
  (3, 'coaching', 2, NULL, '2026-11-24'), (3, 'mentoring', 2, NULL, '2026-12-08'), (3, 'coaching', 3, NULL, '2026-12-22'),
  -- Cohort 4: Leadership Foundations -- Cohort B (same weekly spacing as Cohort A)
  (4, 'training', 1, 1, '2026-10-13'), (4, 'training', 2, 2, '2026-10-20'), (4, 'coaching', 1, NULL, '2026-10-27'),
  (4, 'training', 3, 4, '2026-11-03'), (4, 'peer_coaching', 1, NULL, '2026-11-10'), (4, 'training', 4, 6, '2026-11-17'),
  (4, 'coaching', 2, NULL, '2026-11-24'), (4, 'training', 5, 8, '2026-12-01'), (4, 'mentoring', 1, NULL, '2026-12-08'),
  (4, 'training', 6, 10, '2026-12-15'), (4, 'coaching', 3, NULL, '2026-12-22'), (4, 'training', 7, 12, '2026-12-29');

-- Week opening dates (cohort_week_overrides), 7 days before each week is due.
INSERT INTO public.cohort_week_overrides (cohort_id, training_week_id, unlock_date, is_visible)
SELECT ('de300000-0000-4000-8000-00000000000' || d.cohort)::uuid,
  pg_temp.uid('week:' || CASE WHEN d.cohort = 3 THEN 3 ELSE 1 END || ':' || d.week_number),
  d.due_on - 7, true
FROM _dates d WHERE d.module = 'training';

DO $requirement_dates$
DECLARE c integer; v_cohort uuid; v_programme uuid; n integer; expected integer;
BEGIN
  PERFORM pg_temp.act_as((SELECT id FROM _admin));
  FOR c IN 1..4 LOOP
    v_cohort := ('de300000-0000-4000-8000-00000000000' || c)::uuid;
    SELECT programme_id INTO v_programme FROM public.cohorts WHERE id = v_cohort;

    -- Module deadline = the module's last checkpoint (the admin's default).
    PERFORM public.admin_set_cohort_module_deadlines(v_cohort, (
      SELECT jsonb_agg(jsonb_build_object('programme_id', v_programme, 'module', d.module,
                                          'completion_deadline', max_due))
      FROM (SELECT d.module, max(d.due_on) AS max_due FROM _dates d
            WHERE d.cohort = c AND d.module <> 'training' GROUP BY d.module) d));

    -- Then each requirement's own date.
    PERFORM public.admin_set_cohort_requirement_dates(v_cohort, (
      SELECT jsonb_agg(jsonb_build_object('requirement_id', r.id, 'due_on', d.due_on))
      FROM _dates d
      JOIN public.cohort_requirement_dates r
        ON r.cohort_id = v_cohort AND r.module = d.module
       AND ((d.module = 'training' AND r.training_week_id =
               pg_temp.uid('week:' || CASE WHEN c = 3 THEN 3 ELSE 1 END || ':' || d.week_number))
            OR (d.module <> 'training' AND r.ordinal = d.ordinal))
      WHERE d.cohort = c));

    SELECT count(*) INTO n FROM public.cohort_requirement_dates r
    JOIN _dates d ON d.cohort = c AND d.module = r.module AND d.due_on = r.due_on
     AND ((d.module = 'training' AND r.training_week_id =
             pg_temp.uid('week:' || CASE WHEN c = 3 THEN 3 ELSE 1 END || ':' || d.week_number))
          OR (d.module <> 'training' AND r.ordinal = d.ordinal))
    WHERE r.cohort_id = v_cohort;
    SELECT count(*) INTO expected FROM _dates WHERE cohort = c;
    IF n <> expected OR (SELECT count(*) FROM public.cohort_requirement_dates WHERE cohort_id = v_cohort) <> expected THEN
      RAISE EXCEPTION 'Cohort %: % of % requirement dates set (% rows exist)', c, n, expected,
        (SELECT count(*) FROM public.cohort_requirement_dates WHERE cohort_id = v_cohort);
    END IF;
  END LOOP;
  PERFORM pg_temp.act_as_service();
END
$requirement_dates$;

-- ---------------------------------------------------------------------------
-- 6. Enrollments -- the organisation lives on the enrollment
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _enr (slug text PRIMARY KEY, id uuid NOT NULL, cohort integer NOT NULL) ON COMMIT DROP;
INSERT INTO _enr (slug, id, cohort)
SELECT p.slug, ('de400000' || substr(p.id::text, 9))::uuid, v.cohort
FROM _people p JOIN (VALUES
  ('ha', 1), ('binh', 1), ('lan', 1), ('thao', 1), ('nam', 1), ('quang', 1),
  ('huy', 2), ('mai', 2), ('khoa', 2), ('tam', 2),
  ('ngoc', 3), ('dat', 3), ('yen', 3),
  ('anh', 4), ('tung', 4)
) AS v(slug, cohort) ON v.slug = p.slug;

INSERT INTO public.programme_enrollments (id, programme_id, user_id, cohort_id, organization_id,
  start_date, end_date, status, created_at)
SELECT e.id, c.programme_id, p.id, c.id, o.id, c.start_date, c.end_date,
  -- Cohort 1 is closed (status completed) once its history is in place
  -- (section 12): a dyad member must be an active enrollment.
  'active'::public.enrollment_status,
  pg_temp.ict(c.start_date - 7, '10:00')
FROM _enr e
JOIN _people p ON p.slug = e.slug
JOIN _orgs o ON o.code = p.org
JOIN public.cohorts c ON c.id = ('de300000-0000-4000-8000-00000000000' || e.cohort)::uuid;

-- ---------------------------------------------------------------------------
-- 7. Goals (0-100 scale) -- set in each cohort's first week
-- ---------------------------------------------------------------------------
-- start/finish: the baseline and the rating after the last check-in. A NULL
-- start means the goal is set but not yet rated (Cohorts 3 and 4).
CREATE TEMP TABLE _goals (slug text, n integer, title text, description text,
  start_rating integer, finish_rating integer) ON COMMIT DROP;
INSERT INTO _goals VALUES
  -- Cohort 1 (completed): primary goal carries the headline growth.
  ('ha', 1, 'Lead operations reviews that end in decisions, not updates',
   'Every weekly review closes with an owner and a date for each open issue.', 30, 80),
  ('ha', 2, 'Build a leadership bench of two ready-now successors',
   'Two branch managers can run the operations review without me by June.', 40, 80),
  ('ha', 3, 'Protect two hours a week for strategic work',
   'Tuesday and Thursday mornings blocked, and kept, for the transformation plan.', 30, 70),
  ('binh', 1, 'Give direct feedback on credit decisions within 48 hours',
   'Specific, behaviour-based feedback to each analyst while the case is still fresh.', 40, 60),
  ('binh', 2, 'Influence the risk committee without escalating',
   'Pre-align two committee members before each proposal goes to the table.', 40, 60),
  ('lan', 1, 'Coach branch managers instead of solving their problems',
   'In one-to-ones, ask at least three open questions before offering any advice.', 20, 70),
  ('lan', 2, 'Run one network-wide change without losing the front line',
   'Launch the new opening-hours model with branch staff shaping the rollout.', 30, 70),
  ('lan', 3, 'Say no to low-value requests from head office',
   'Decline or renegotiate one request a week that does not serve the network plan.', 20, 60),
  ('thao', 1, 'Turn the monthly close into a business conversation',
   'Close meetings focus on three decisions for the business, not on reconciling numbers.', 30, 80),
  ('thao', 2, 'Delegate the audit preparation to my deputy',
   'My deputy owns audit preparation end to end; I review only the final pack.', 40, 80),
  ('nam', 1, 'Explain infrastructure risk in business language',
   'Every risk paper to the executive team states the business impact in the first paragraph.', 50, 70),
  ('nam', 2, 'Hold my team to deadlines without micromanaging',
   'Agree milestones up front and check in only at the milestones.', 50, 70),
  ('quang', 1, 'Align procurement and sales on one demand forecast',
   'One shared forecast, reviewed together every month, replaces two competing ones.', 40, 70),
  ('quang', 2, 'Lead difficult supplier conversations calmly',
   'Prepare interests, not positions, before each supplier negotiation.', 40, 70),
  -- Cohort 2 (active): rated once, after the first completed session.
  ('huy', 1, 'Win executive sponsorship for the mobile-first roadmap',
   'The CEO and CFO both sponsor the roadmap publicly by the end of the sprint.', 30, 45),
  ('huy', 2, 'Stop being the bottleneck on product decisions',
   'Squad leads make release decisions within agreed guardrails.', 20, 35),
  ('mai', 1, 'Position compliance as a partner to the business',
   'Business heads invite compliance into product design before launch, not after.', 30, 40),
  ('mai', 2, 'Reduce my team''s overtime without lowering quality',
   'Weekly overtime below five hours per person while audit findings stay at zero.', 30, 40),
  ('khoa', 1, 'Build a leadership team that runs the plant without me',
   'Plant heads resolve cross-site issues directly; I join only by exception.', 40, 55),
  ('khoa', 2, 'Hold a quarterly strategy offsite that produces three decisions',
   'The first offsite in November ends with three decisions and their owners.', 30, 40),
  ('tam', 1, 'Coach my sales managers on pipeline quality',
   'Pipeline reviews ask what the customer is trying to achieve before discussing price.', 30, 40),
  ('tam', 2, 'Rebuild trust with the northern region team',
   'Regular one-to-ones with every northern manager, kept even in closing weeks.', 20, 30),
  -- Cohort 3 (active, no session yet): set, not yet rated.
  ('ngoc', 1, 'Hold my first round of one-to-ones with every team member',
   'A 30-minute one-to-one with each of my eight team members by the end of October.', NULL, NULL),
  ('ngoc', 2, 'Give recognition that is specific, not generic',
   'Recognise one concrete contribution in each weekly team huddle.', NULL, NULL),
  ('dat', 1, 'Move from doing the work to leading the shift',
   'Spend at least half of each shift observing and coaching instead of operating the line.', NULL, NULL),
  ('yen', 1, 'Lead my former peers with confidence',
   'Agree working norms with my team in the first month of the new role.', NULL, NULL),
  ('yen', 2, 'Plan the team''s work a week ahead',
   'A weekly plan shared every Monday, with priorities the team helped set.', NULL, NULL),
  -- Cohort 4 (starting): set, not yet rated.
  ('anh', 1, 'Delegate daily liquidity reporting to my team',
   'Two analysts produce the daily report; I review exceptions only.', NULL, NULL),
  ('anh', 2, 'Communicate market risk clearly to non-specialists',
   'One-page summaries the branch network can act on without follow-up questions.', NULL, NULL),
  ('tung', 1, 'Lead the cards squad through the new product launch',
   'The squad owns the launch plan and I remove blockers instead of assigning tasks.', NULL, NULL);

-- Goals are written as the learner, as in the app.
DO $goals$
DECLARE g record;
BEGIN
  FOR g IN
    SELECT gl.*, e.id AS enrollment_id, p.id AS user_id, c.start_date, c.end_date
    FROM _goals gl
    JOIN _enr e ON e.slug = gl.slug
    JOIN _people p ON p.slug = gl.slug
    JOIN public.cohorts c ON c.id = ('de300000-0000-4000-8000-00000000000' || e.cohort)::uuid
    ORDER BY gl.slug, gl.n
  LOOP
    PERFORM pg_temp.act_as(g.user_id);
    INSERT INTO public.coachee_goals (id, coachee_id, enrollment_id, title, description, target_date,
      status, sort_order, created_at, updated_at)
    VALUES (pg_temp.uid('goal:' || g.slug || ':' || g.n), g.user_id, g.enrollment_id, g.title, g.description,
      g.end_date, 'active', g.n - 1, pg_temp.ict(g.start_date + 2, '19:00'), pg_temp.ict(g.start_date + 2, '19:00'));
    IF g.start_rating IS NOT NULL THEN
      INSERT INTO public.coachee_goal_ratings (goal_id, coachee_id, enrollment_id, start_rating, current_rating,
        target_rating, current_updated_at, created_at, updated_at)
      VALUES (pg_temp.uid('goal:' || g.slug || ':' || g.n), g.user_id, g.enrollment_id, g.start_rating,
        g.start_rating, greatest(g.finish_rating, 80), pg_temp.ict(g.start_date + 2, '19:00'),
        pg_temp.ict(g.start_date + 2, '19:00'), pg_temp.ict(g.start_date + 2, '19:00'));
    END IF;
  END LOOP;
  PERFORM pg_temp.act_as_service();
END
$goals$;

-- ---------------------------------------------------------------------------
-- 8. Sessions -- every one completed inside its requirement's window
-- ---------------------------------------------------------------------------
-- A session requirement opens 14 days before it is due. Times are Vietnam
-- time (ICT). Each session names its own requirement; the attribution
-- triggers check it belongs to the enrollment's cohort AND programme.
CREATE TEMP TABLE _sess (key text PRIMARY KEY, slug text, module public.programme_module_type,
  ordinal integer, day date, at time, topic text, partner text) ON COMMIT DROP;
INSERT INTO _sess VALUES
  -- Cohort 1 -- Coaching 1 (due 2026-03-23, window opens 03-09)
  ('c1:ha:1',    'ha',    'coaching', 1, '2026-03-10', '09:00', 'Leadership identity: how my team experiences me', NULL),
  ('c1:binh:1',  'binh',  'coaching', 1, '2026-03-11', '10:00', 'From expert to leader of experts', NULL),
  ('c1:lan:1',   'lan',   'coaching', 1, '2026-03-12', '14:00', 'What I want the network to say about my leadership', NULL),
  ('c1:thao:1',  'thao',  'coaching', 1, '2026-03-16', '09:00', 'Finance as a business partner: where I start', NULL),
  ('c1:nam:1',   'nam',   'coaching', 1, '2026-03-17', '15:00', 'Being heard at the executive table', NULL),
  ('c1:quang:1', 'quang', 'coaching', 1, '2026-03-19', '10:00', 'Two departments, one forecast', NULL),
  -- Coaching 2 (due 2026-04-20, opens 04-06)
  ('c1:ha:2',    'ha',    'coaching', 2, '2026-04-07', '09:00', 'Growing successors: what I keep and what I hand over', NULL),
  ('c1:binh:2',  'binh',  'coaching', 2, '2026-04-08', '10:00', 'Feedback that analysts can use', NULL),
  ('c1:lan:2',   'lan',   'coaching', 2, '2026-04-09', '14:00', 'Leading the opening-hours change with the front line', NULL),
  ('c1:thao:2',  'thao',  'coaching', 2, '2026-04-13', '09:00', 'Letting go of the audit pack', NULL),
  ('c1:nam:2',   'nam',   'coaching', 2, '2026-04-14', '15:00', 'Milestones instead of micromanagement', NULL),
  ('c1:quang:2', 'quang', 'coaching', 2, '2026-04-16', '10:00', 'Preparing for the supplier renegotiation', NULL),
  -- Coaching 3 (due 2026-05-18, opens 05-04)
  ('c1:ha:3',    'ha',    'coaching', 3, '2026-05-05', '09:00', 'Integration: my leadership plan for the next year', NULL),
  ('c1:binh:3',  'binh',  'coaching', 3, '2026-05-06', '10:00', 'Taking a position at the risk committee', NULL),
  ('c1:lan:3',   'lan',   'coaching', 3, '2026-05-07', '14:00', 'Saying no without damaging relationships', NULL),
  ('c1:thao:3',  'thao',  'coaching', 3, '2026-05-11', '09:00', 'Integration: the finance leader I am becoming', NULL),
  ('c1:nam:3',   'nam',   'coaching', 3, '2026-05-12', '15:00', 'Integration: risk stories that land', NULL),
  ('c1:quang:3', 'quang', 'coaching', 3, '2026-05-14', '10:00', 'Integration: sustaining the shared forecast', NULL),
  -- Mentoring 1 (due 2026-05-04, opens 04-20) -- Duc as mentor
  ('m1:ha:1',    'ha',    'mentoring', 1, '2026-04-21', '16:00', 'How a regional director builds a bench', NULL),
  ('m1:binh:1',  'binh',  'mentoring', 1, '2026-04-22', '16:00', 'Building credibility with senior committees', NULL),
  ('m1:lan:1',   'lan',   'mentoring', 1, '2026-04-23', '16:00', 'Running a network through change', NULL),
  ('m1:thao:1',  'thao',  'mentoring', 1, '2026-04-27', '16:00', 'The path from controller to CFO', NULL),
  ('m1:nam:1',   'nam',   'mentoring', 1, '2026-04-28', '16:00', 'Technology leaders in the executive team', NULL),
  ('m1:quang:1', 'quang', 'mentoring', 1, '2026-04-29', '16:00', 'Leading across functions without authority', NULL),
  -- Peer coaching 1 (due 2026-04-06, opens 03-23): one session per dyad
  -- credits both partners. slug = receiver, partner = provider.
  ('p1:binh:1',  'binh',  'peer_coaching', 1, '2026-03-25', '17:00', 'Peer practice: giving feedback on a live case', 'ha'),
  ('p1:thao:1',  'thao',  'peer_coaching', 1, '2026-03-26', '17:00', 'Peer practice: a conversation I have been avoiding', 'lan'),
  ('p1:quang:1', 'quang', 'peer_coaching', 1, '2026-03-31', '17:00', 'Peer practice: preparing a difficult negotiation', 'nam'),
  -- Cohort 2 -- Coaching 1 (due 2026-09-15, opens 09-01)
  ('c2:huy:1',   'huy',   'coaching', 1, '2026-09-03', '09:00', 'Defining the sprint: two goals that matter', NULL),
  ('c2:khoa:1',  'khoa',  'coaching', 1, '2026-09-08', '09:00', 'A COO who is not needed every day', NULL),
  ('c2:tam:1',   'tam',   'coaching', 1, '2026-09-09', '10:00', 'From top seller to sales leader', NULL),
  ('c2:mai:1',   'mai',   'coaching', 1, '2026-09-10', '14:00', 'Compliance at the design table', NULL),
  -- Coaching 2 (due 2026-09-29, opens 09-15): Tam and Mai have none.
  ('c2:huy:2',   'huy',   'coaching', 2, '2026-09-17', '10:00', 'Mapping the sponsors for the mobile roadmap', NULL),
  ('c2:khoa:2',  'khoa',  'coaching', 2, '2026-09-22', '09:00', 'Designing the November strategy offsite', NULL),
  -- Coaching 3 (due 2026-10-13, opens 09-29): Huy uses the early window.
  ('c2:huy:3',   'huy',   'coaching', 3, '2026-10-01', '09:00', 'Rehearsing the CEO conversation', NULL);

-- Peer dyads (the Admin pairs partners inside the cohort; pairs may cross
-- organisations -- each partner's unit still belongs to their own enrollment).
INSERT INTO public.peer_dyads (id, cohort_id, programme_id, status, created_by, created_at)
SELECT pg_temp.uid('dyad:' || d.a || ':' || d.b), c.id, c.programme_id, 'active', (SELECT id FROM _admin),
  TIMESTAMPTZ '2026-03-16 10:00+07'
FROM (VALUES ('ha', 'binh'), ('lan', 'thao'), ('nam', 'quang')) AS d(a, b)
CROSS JOIN public.cohorts c WHERE c.id = 'de300000-0000-4000-8000-000000000001';
INSERT INTO public.peer_dyad_members (dyad_id, enrollment_id, joined_at, status)
SELECT pg_temp.uid('dyad:' || d.a || ':' || d.b), e.id, TIMESTAMPTZ '2026-03-16 10:00+07', 'active'
FROM (VALUES ('ha', 'binh'), ('lan', 'thao'), ('nam', 'quang')) AS d(a, b)
JOIN _enr e ON e.slug IN (d.a, d.b);

-- The lifecycle service writes sessions (protected fields), so the seed
-- declares itself one for these inserts.
SELECT set_config('app.session_transition', 'on', true);

INSERT INTO public.sessions (id, coach_id, coachee_id, topic, start_time, duration_minutes, status,
  meeting_url, enrollment_id, cohort_requirement_id, confirmed_at, created_at, updated_at)
SELECT pg_temp.uid('session:' || s.key), 'de000000-0000-4000-8000-000000000001', p.id, s.topic,
  pg_temp.ict(s.day, s.at), 60, 'completed', 'https://meet.google.com/cla-riva-' || substr(md5(s.key), 1, 3),
  e.id, r.id, pg_temp.ict(s.day - 5, '11:00'), pg_temp.ict(s.day - 6, '20:00'), pg_temp.ict(s.day, s.at) + interval '1 hour'
FROM _sess s
JOIN _enr e ON e.slug = s.slug
JOIN _people p ON p.slug = s.slug
JOIN public.programme_enrollments pe ON pe.id = e.id
JOIN public.cohort_requirement_dates r
  ON r.cohort_id = pe.cohort_id AND r.programme_id = pe.programme_id AND r.module = s.module AND r.ordinal = s.ordinal
WHERE s.module = 'coaching';

INSERT INTO public.mentoring_sessions (id, mentor_id, mentee_id, topic, start_time, duration_minutes, status,
  meeting_url, enrollment_id, cohort_requirement_id, confirmed_at, created_at, updated_at)
SELECT pg_temp.uid('session:' || s.key), 'de000000-0000-4000-8000-000000000001', p.id, s.topic,
  pg_temp.ict(s.day, s.at), 60, 'completed', 'https://meet.google.com/cla-riva-' || substr(md5(s.key), 1, 3),
  e.id, r.id, pg_temp.ict(s.day - 5, '11:00'), pg_temp.ict(s.day - 6, '20:00'), pg_temp.ict(s.day, s.at) + interval '1 hour'
FROM _sess s
JOIN _enr e ON e.slug = s.slug
JOIN _people p ON p.slug = s.slug
JOIN public.programme_enrollments pe ON pe.id = e.id
JOIN public.cohort_requirement_dates r
  ON r.cohort_id = pe.cohort_id AND r.programme_id = pe.programme_id AND r.module = s.module AND r.ordinal = s.ordinal
WHERE s.module = 'mentoring';

-- The receiver's enrollment is on the session; the trigger records both
-- participations and attributes each to its own Peer requirement. The
-- entitlement check (can_book_coachee_peer_session) asks that the receiver
-- books, with their dyad partner: so each row is written as the receiver.
DO $peer$
DECLARE s record;
BEGIN
  FOR s IN
    SELECT x.*, e.id AS enrollment_id, recv.id AS receiver_id, prov.id AS provider_id
    FROM _sess x
    JOIN _enr e ON e.slug = x.slug
    JOIN _people recv ON recv.slug = x.slug
    JOIN _people prov ON prov.slug = x.partner
    WHERE x.module = 'peer_coaching'
    ORDER BY x.day
  LOOP
    PERFORM pg_temp.act_as(s.receiver_id);
    INSERT INTO public.coachee_peer_sessions (id, peer_provider_id, peer_receiver_id, topic, start_time,
      duration_minutes, status, meeting_url, enrollment_id, confirmed_at, created_at, updated_at)
    VALUES (pg_temp.uid('session:' || s.key), s.provider_id, s.receiver_id, s.topic, pg_temp.ict(s.day, s.at), 60,
      'completed', 'https://meet.google.com/cla-riva-' || substr(md5(s.key), 1, 3), s.enrollment_id,
      pg_temp.ict(s.day - 3, '11:00'), pg_temp.ict(s.day - 4, '20:00'), pg_temp.ict(s.day, s.at) + interval '1 hour');
  END LOOP;
  PERFORM pg_temp.act_as_service();
END
$peer$;

SELECT set_config('app.session_transition', 'off', true);

-- ---------------------------------------------------------------------------
-- 9. Training evidence -- inside each week's window
-- ---------------------------------------------------------------------------
-- A week opens 7 days before it is due. The week is complete when its Skill
-- Card, quiz and reflection are all done inside [opens, due]; daily prompts
-- are optional and never gate the week.
--   Cohort 1: all six leaders complete all seven weeks.
--   Cohort 3: Ngoc and Dat complete weeks 1-2; Yen completes week 1 and only
--             the Skill Card of week 2 (no quiz, no reflection).
CREATE TEMP TABLE _tw (slug text, prog integer, cohort integer, week_number integer,
  opens date, skill boolean, quiz boolean, reflection boolean) ON COMMIT DROP;
INSERT INTO _tw
SELECT e.slug, CASE WHEN e.cohort = 3 THEN 3 ELSE 1 END, e.cohort, d.week_number, d.due_on - 7,
  true,
  NOT (e.slug = 'yen' AND d.week_number = 2),
  NOT (e.slug = 'yen' AND d.week_number = 2)
FROM _enr e
JOIN _dates d ON d.cohort = e.cohort AND d.module = 'training'
WHERE e.cohort = 1
   OR (e.cohort = 3 AND d.week_number <= 2);

-- When each piece was done. Cohort 3's week 2 opened on 2026-09-22 and is
-- written on its first two days.
CREATE TEMP TABLE _tw_at ON COMMIT DROP AS
SELECT t.*,
  pg_temp.ict(t.opens + 1, '08:30') AS viewed_at,
  CASE WHEN t.cohort = 3 AND t.week_number = 2 THEN pg_temp.ict(t.opens, '19:00')
       ELSE pg_temp.ict(t.opens + 2, '19:00') END AS skill_at,
  CASE WHEN t.cohort = 3 AND t.week_number = 2 THEN pg_temp.ict(t.opens + 1, '07:30')
       ELSE pg_temp.ict(t.opens + 3, '20:00') END AS quiz_at,
  CASE WHEN t.cohort = 3 AND t.week_number = 2 THEN pg_temp.ict(t.opens + 1, '08:00')
       ELSE pg_temp.ict(t.opens + 4, '19:30') END AS reflection_at
FROM _tw t;

INSERT INTO public.training_progress (id, user_id, enrollment_id, training_week_id, viewed_at, completed_at, created_at)
SELECT pg_temp.uid('tp:' || t.slug || ':' || t.week_number), p.id, e.id,
  pg_temp.uid('week:' || t.prog || ':' || t.week_number), t.viewed_at, t.skill_at, t.viewed_at
FROM _tw_at t JOIN _enr e ON e.slug = t.slug JOIN _people p ON p.slug = t.slug
WHERE t.skill;

-- Quiz: every answer correct, except one miss on even weeks for three leaders.
INSERT INTO public.assignment_submissions (id, assignment_id, user_id, enrollment_id, answers,
  score_pct, correct_count, total_count, submitted_at)
SELECT pg_temp.uid('sub:' || t.slug || ':' || t.week_number), pg_temp.uid('quiz:' || t.prog || ':' || t.week_number),
  p.id, e.id, a.answers, round(a.correct * 100.0 / a.total, 0), a.correct, a.total, t.quiz_at
FROM _tw_at t
JOIN _enr e ON e.slug = t.slug JOIN _people p ON p.slug = t.slug
CROSS JOIN LATERAL (
  SELECT jsonb_object_agg(pg_temp.uid('qq:' || q.prog || ':' || q.week_number || ':' || q.sort_order)::text,
           CASE WHEN x.miss THEN (SELECT o->>'id' FROM jsonb_array_elements(q.options) o
                                  WHERE NOT (o->>'is_correct')::boolean LIMIT 1)
                ELSE (SELECT o->>'id' FROM jsonb_array_elements(q.options) o
                      WHERE (o->>'is_correct')::boolean LIMIT 1) END) AS answers,
    count(*) FILTER (WHERE NOT x.miss)::integer AS correct, count(*)::integer AS total
  FROM _quiz q
  CROSS JOIN LATERAL (SELECT t.slug IN ('binh', 'nam', 'quang', 'yen') AND t.week_number % 2 = 0
                             AND q.sort_order = 2 AS miss) x
  WHERE q.prog = t.prog AND q.week_number = t.week_number
) a
WHERE t.quiz;

INSERT INTO public.reflection_submissions (id, reflection_id, user_id, enrollment_id, confidence_score, submitted_at)
SELECT pg_temp.uid('rs:' || t.slug || ':' || t.week_number), pg_temp.uid('refl:' || t.prog || ':' || t.week_number),
  p.id, e.id, 6 + (abs(hashtext(t.slug || t.week_number)) % 4), t.reflection_at
FROM _tw_at t JOIN _enr e ON e.slug = t.slug JOIN _people p ON p.slug = t.slug
WHERE t.reflection;

INSERT INTO public.reflection_answers (submission_id, question_id, answer_text)
SELECT pg_temp.uid('rs:' || t.slug || ':' || t.week_number), pg_temp.uid('rq:' || t.prog || ':' || t.week_number),
  ra.answer
FROM _tw_at t
JOIN _refl_answers ra ON ra.prog = t.prog AND ra.week_number = t.week_number
 AND ra.variant = 1 + abs(hashtext(t.slug)) % (SELECT count(*) FROM _refl_answers x
                                                 WHERE x.prog = t.prog AND x.week_number = t.week_number)
WHERE t.reflection;

-- Daily prompts (optional). How many each leader answered:
--   Cohort 1 (30 prompts): Ha 24 (80%), Binh 15 (50%), Lan 21 (70%),
--                          Thao 18 (60%), Nam 12 (40%), Quang 17 (57%)
--   Cohort 3 (weeks 1-2, 6 prompts): Dat 6 (all), Ngoc 3, Yen 2
CREATE TEMP TABLE _dp_quota (slug text PRIMARY KEY, n integer) ON COMMIT DROP;
INSERT INTO _dp_quota VALUES ('ha', 24), ('binh', 15), ('lan', 21), ('thao', 18), ('nam', 12), ('quang', 17),
  ('dat', 6), ('ngoc', 3), ('yen', 2);

INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, enrollment_id, opened_at,
  response_text, confidence_score, responded_at, created_at)
SELECT pg_temp.uid('dpr:' || x.slug || ':' || x.prog || ':' || x.week_number || ':' || x.day_offset),
  pg_temp.uid('dp:' || x.prog || ':' || x.week_number || ':' || x.day_offset), x.user_id, x.enrollment_id,
  pg_temp.ict(x.opens + x.day_offset - 1, '07:10'),
  (SELECT r.response FROM _prompt_responses r
   WHERE r.variant = 1 + abs(hashtext(x.slug || x.week_number || x.day_offset)) % (SELECT count(*) FROM _prompt_responses)),
  5 + abs(hashtext(x.slug || x.day_offset)) % 5,
  pg_temp.ict(x.opens + x.day_offset - 1, '07:40'), pg_temp.ict(x.opens + x.day_offset - 1, '07:10')
FROM (
  SELECT t.slug, t.prog, t.week_number, t.opens, pr.day_offset, e.id AS enrollment_id, p.id AS user_id,
    row_number() OVER (PARTITION BY t.slug ORDER BY md5(t.slug || ':' || t.week_number || ':' || pr.day_offset)) AS rn
  FROM _tw t
  JOIN _prompts pr ON pr.prog = t.prog AND pr.week_number = t.week_number
  JOIN _enr e ON e.slug = t.slug JOIN _people p ON p.slug = t.slug
) x
JOIN _dp_quota q ON q.slug = x.slug
WHERE x.rn <= q.n;

-- ---------------------------------------------------------------------------
-- 10. After each session: reflection, notes, satisfaction, goal check-in,
--     follow-up actions
-- ---------------------------------------------------------------------------
-- Every completed session a learner took part in (a peer session counts for
-- both partners), with the day it was held.
CREATE TEMP TABLE _held ON COMMIT DROP AS
SELECT s.key, s.slug AS learner, s.module, s.ordinal, s.day, s.at, s.topic,
  CASE s.module WHEN 'coaching' THEN 'sessions' WHEN 'mentoring' THEN 'mentoring_sessions'
       ELSE 'coachee_peer_sessions' END AS source_table,
  pg_temp.uid('session:' || s.key) AS session_id, e.cohort
FROM _sess s JOIN _enr e ON e.slug = s.slug
UNION ALL
SELECT s.key, s.partner, s.module, s.ordinal, s.day, s.at, s.topic, 'coachee_peer_sessions',
  pg_temp.uid('session:' || s.key), e.cohort
FROM _sess s JOIN _enr e ON e.slug = s.partner
WHERE s.module = 'peer_coaching';

-- 10a. The learner's reflection on each session.
INSERT INTO public.session_learning_reflections (id, enrollment_id, source_activity_type, source_activity_id,
  body, submitted_at, created_at, updated_at)
SELECT pg_temp.uid('slr:' || h.key || ':' || h.learner), e.id, t.reflection_type, h.session_id,
  (SELECT r.body FROM _session_reflections r
   WHERE r.module = h.module
     AND r.variant = 1 + abs(hashtext(h.key || h.learner)) %
                         (SELECT count(*) FROM _session_reflections x WHERE x.module = h.module)),
  pg_temp.ict(h.day, '20:30'), pg_temp.ict(h.day, '20:30'), pg_temp.ict(h.day, '20:30')
FROM _held h
JOIN _enr e ON e.slug = h.learner
CROSS JOIN LATERAL public.session_deliverable_source_types(h.source_table) t;

-- 10b. The coach's and mentor's side.
INSERT INTO public.coach_session_private_notes (session_id, coach_id, body, created_at, updated_at)
SELECT h.session_id, 'de000000-0000-4000-8000-000000000001',
  (SELECT n.body FROM _coach_notes n
   WHERE n.variant = 1 + abs(hashtext(h.key)) % (SELECT count(*) FROM _coach_notes)),
  pg_temp.ict(h.day, h.at) + interval '90 minutes', pg_temp.ict(h.day, h.at) + interval '90 minutes'
FROM _held h WHERE h.module = 'coaching';

SELECT set_config('app.session_transition', 'on', true);
UPDATE public.mentoring_sessions m
SET mentor_notes = 'Shared how I approached the same transition as a regional director: what I kept, '
                   || 'what I handed over, and the conversation I wish I had held sooner. Agreed that '
                   || 'the mentee maps three key stakeholders before our next contact.',
    feedback_submitted_at = pg_temp.ict(h.day, '19:00')
FROM _held h
WHERE h.module = 'mentoring' AND m.id = h.session_id;
SELECT set_config('app.session_transition', 'off', true);

INSERT INTO public.mentoring_feedback (mentoring_session_id, mentor_id, mentee_id, submitted_by,
  overall_notes, submitted_at, created_at, updated_at)
SELECT h.session_id, 'de000000-0000-4000-8000-000000000001', p.id, 'de000000-0000-4000-8000-000000000001',
  'Came prepared with a real situation and was honest about what is not working yet. Next step: test the '
  || 'stakeholder map with one senior colleague before the end of the month.',
  pg_temp.ict(h.day, '19:00'), pg_temp.ict(h.day, '19:00'), pg_temp.ict(h.day, '19:00')
FROM _held h JOIN _people p ON p.slug = h.learner
WHERE h.module = 'mentoring';

-- 10c. Satisfaction (1-5), rated by the learner. Enrollment averages:
--   Ha 4.8, Binh 4.2, Lan 4.5 (peer session not rated), Thao 4.6, Nam 4.0,
--   Quang 4.3 (three coaching ratings; mentoring and peer not rated),
--   Huy 5.0, Khoa 4.5, Tam 4.0, Mai 4.0.
CREATE TEMP TABLE _ratings (slug text, module public.programme_module_type, ordinal integer, rating smallint) ON COMMIT DROP;
INSERT INTO _ratings VALUES
  ('ha', 'coaching', 1, 5), ('ha', 'coaching', 2, 5), ('ha', 'coaching', 3, 5), ('ha', 'mentoring', 1, 5), ('ha', 'peer_coaching', 1, 4),
  ('binh', 'coaching', 1, 4), ('binh', 'coaching', 2, 4), ('binh', 'coaching', 3, 4), ('binh', 'mentoring', 1, 5), ('binh', 'peer_coaching', 1, 4),
  ('lan', 'coaching', 1, 5), ('lan', 'coaching', 2, 4), ('lan', 'coaching', 3, 5), ('lan', 'mentoring', 1, 4),
  ('thao', 'coaching', 1, 5), ('thao', 'coaching', 2, 5), ('thao', 'coaching', 3, 4), ('thao', 'mentoring', 1, 5), ('thao', 'peer_coaching', 1, 4),
  ('nam', 'coaching', 1, 4), ('nam', 'coaching', 2, 4), ('nam', 'coaching', 3, 4), ('nam', 'mentoring', 1, 4), ('nam', 'peer_coaching', 1, 4),
  ('quang', 'coaching', 1, 4), ('quang', 'coaching', 2, 4), ('quang', 'coaching', 3, 5),
  ('huy', 'coaching', 1, 5), ('huy', 'coaching', 2, 5), ('huy', 'coaching', 3, 5),
  ('khoa', 'coaching', 1, 5), ('khoa', 'coaching', 2, 4),
  ('tam', 'coaching', 1, 4),
  ('mai', 'coaching', 1, 4);

DO $satisfaction$
DECLARE h record;
BEGIN
  FOR h IN
    SELECT hd.*, e.id AS enrollment_id, p.id AS user_id, r.rating
    FROM _held hd
    JOIN _ratings r ON r.slug = hd.learner AND r.module = hd.module AND r.ordinal = hd.ordinal
    JOIN _enr e ON e.slug = hd.learner JOIN _people p ON p.slug = hd.learner
  LOOP
    PERFORM pg_temp.act_as(h.user_id);
    PERFORM public.submit_session_satisfaction(h.source_table, h.session_id, h.enrollment_id, h.rating);
  END LOOP;
  PERFORM pg_temp.act_as_service();
END
$satisfaction$;

-- Pin each rating's timestamp to the evening of the session.
SELECT set_config('app.session_transition', 'on', true);
UPDATE public.sessions s SET coachee_rated_at = pg_temp.ict(h.day, '20:00')
FROM _held h WHERE h.source_table = 'sessions' AND s.id = h.session_id AND s.coachee_rating IS NOT NULL;
UPDATE public.mentoring_sessions s SET mentee_rated_at = pg_temp.ict(h.day, '20:00')
FROM _held h WHERE h.source_table = 'mentoring_sessions' AND s.id = h.session_id AND s.mentee_rating IS NOT NULL;
UPDATE public.coachee_peer_sessions s
SET receiver_rated_at = CASE WHEN s.receiver_rating IS NOT NULL THEN pg_temp.ict(h.day, '20:00') END,
    provider_rated_at = CASE WHEN s.provider_rating IS NOT NULL THEN pg_temp.ict(h.day, '20:05') END
FROM (SELECT DISTINCT session_id, day FROM _held WHERE source_table = 'coachee_peer_sessions') h
WHERE s.id = h.session_id;
SELECT set_config('app.session_transition', 'off', true);

-- 10d. Goal check-ins, written by the learner after the session.
--   Cohort 1: after every session. Ratings move after Coaching 1, 2 and 3
--   (30% / 65% / 100% of the way from baseline to finish, rounded to 5);
--   the peer and mentoring check-ins record a note without a new rating.
--   Cohort 2: one rating, after the learner's first completed session.
DO $checkins$
DECLARE h record; v_items jsonb;
BEGIN
  FOR h IN
    SELECT hd.*, e.id AS enrollment_id, p.id AS user_id, t.checkin_type
    FROM _held hd
    JOIN _enr e ON e.slug = hd.learner JOIN _people p ON p.slug = hd.learner
    CROSS JOIN LATERAL public.session_deliverable_source_types(hd.source_table) t
    WHERE hd.cohort = 1 OR (hd.cohort = 2 AND hd.ordinal = 1)
    ORDER BY hd.day, hd.at
  LOOP
    SELECT jsonb_agg(jsonb_build_object(
             'goal_id', pg_temp.uid('goal:' || g.slug || ':' || g.n),
             'new_rating', CASE
               WHEN h.cohort = 2 THEN to_jsonb(g.finish_rating)
               WHEN h.module = 'coaching' THEN to_jsonb((round((g.start_rating + (g.finish_rating - g.start_rating)
                     * CASE h.ordinal WHEN 1 THEN 0.30 WHEN 2 THEN 0.65 ELSE 1.0 END) / 5.0) * 5)::integer)
               ELSE 'null'::jsonb END,
             'note', CASE
               WHEN h.module = 'coaching' AND h.cohort = 1 AND h.ordinal = 3
                 THEN 'Where I have landed by the end of the programme, and what I will keep practising.'
               WHEN h.module = 'coaching'
                 THEN 'Visible progress since the last session; the next experiment is agreed.'
               ELSE 'Useful perspective from this conversation; no change to my rating yet.' END)
           ORDER BY g.n)
      INTO v_items
    FROM _goals g WHERE g.slug = h.learner;

    PERFORM pg_temp.act_as(h.user_id);
    PERFORM public.record_goal_checkins(h.enrollment_id, h.checkin_type, h.session_id, v_items,
      pg_temp.uid('checkin:' || h.key || ':' || h.learner));
    PERFORM pg_temp.act_as_service();

    UPDATE public.goal_checkins SET created_at = pg_temp.ict(h.day, '20:40')
    WHERE submission_id = pg_temp.uid('checkin:' || h.key || ':' || h.learner);
    UPDATE public.coachee_goal_ratings r SET current_updated_at = pg_temp.ict(h.day, '20:40')
    WHERE r.enrollment_id = h.enrollment_id
      AND EXISTS (SELECT 1 FROM public.goal_checkins c
                  WHERE c.submission_id = pg_temp.uid('checkin:' || h.key || ':' || h.learner)
                    AND c.goal_id = r.goal_id AND c.new_rating IS NOT NULL);
  END LOOP;
END
$checkins$;

-- 10e. Follow-up actions: a deadline and a goal on every one.
--   Cohort 1: one per session, all completed before their deadline.
--   Cohort 2: as the story needs it (see each row).
CREATE TEMP TABLE _actions (key text, learner text, goal_n integer, title text, due_date date,
  status text, completed_on date) ON COMMIT DROP;
INSERT INTO _actions
SELECT h.key, h.learner,
  1 + (h.ordinal + CASE h.module WHEN 'coaching' THEN 0 WHEN 'mentoring' THEN 1 ELSE 2 END)
      % (SELECT count(*) FROM _goals g WHERE g.slug = h.learner),
  (SELECT a.title FROM _action_titles a
   WHERE a.module = h.module
     AND a.variant = 1 + abs(hashtext(h.key || h.learner)) %
                         (SELECT count(*) FROM _action_titles x WHERE x.module = h.module)),
  h.day + 14, 'completed', h.day + 9
FROM _held h WHERE h.cohort = 1;
INSERT INTO _actions VALUES
  ('c2:khoa:2', 'khoa', 1, 'Ask each plant head to bring one cross-site issue they will resolve without me', '2026-10-10', 'open', NULL),
  ('c2:tam:1',  'tam',  1, 'Run the next two pipeline reviews starting with the customer''s objective', '2026-09-25', 'completed', '2026-09-24'),
  ('c2:huy:2',  'huy',  1, 'Book one-to-ones with the CFO and COO to test the roadmap story', '2026-10-15', 'open', NULL),
  ('c2:huy:3',  'huy',  2, 'Write the release guardrails and agree them with the three squad leads', '2026-10-20', 'open', NULL),
  ('c2:mai:1',  'mai',  2, 'Map where overtime comes from for two weeks and bring the pattern to coaching', '2026-10-01', 'open', NULL);

INSERT INTO public.enrollment_actions (id, enrollment_id, owner_user_id, goal_id, source_activity_type,
  source_activity_id, title, due_date, status, completed_at, created_at, updated_at)
SELECT pg_temp.uid('action:' || a.key || ':' || a.learner), e.id, p.id,
  pg_temp.uid('goal:' || a.learner || ':' || a.goal_n), t.action_type, h.session_id, a.title, a.due_date,
  a.status, CASE WHEN a.completed_on IS NOT NULL THEN pg_temp.ict(a.completed_on, '18:00') END,
  pg_temp.ict(h.day, '20:45'), pg_temp.ict(coalesce(a.completed_on, h.day), '18:00')
FROM _actions a
JOIN _held h ON h.key = a.key AND h.learner = a.learner
JOIN _enr e ON e.slug = a.learner JOIN _people p ON p.slug = a.learner
CROSS JOIN LATERAL public.session_deliverable_source_types(h.source_table) t;

-- ---------------------------------------------------------------------------
-- 11. Duc's availability for booking -- 2026-10-07 .. 2026-12-02
-- ---------------------------------------------------------------------------
-- coach_availability stores one row per slot: a date and a wall-clock start
-- and end time (time without time zone), and a slot type. These are written
-- exactly as the coach's own availability page writes them when Duc enters
-- them in Vietnam: "09:00".."10:00" (ICT). Tuesdays and Thursdays,
-- 09:00-12:00 and 14:00-17:00, one 60-minute Coaching slot per hour.
--
-- KNOWN APP LIMITATION (not a data problem): the booking page treats these
-- wall-clock times as the BROWSER's local time, while book_coaching_session
-- reads them as UTC. From a browser in Vietnam, picking 09:00 sends 02:00 UTC
-- and the function refuses it as "outside the availability slot". Storing the
-- slots in UTC instead would show 02:00 on every screen and still fail.
-- Booking works end to end only once the app gives slots a time zone.
INSERT INTO public.coach_availability (id, coach_id, slot_date, start_time, end_time, is_booked, slot_type,
  created_at, updated_at)
SELECT pg_temp.uid('slot:' || d::date || ':' || h), 'de000000-0000-4000-8000-000000000001', d::date,
  make_time(h, 0, 0), make_time(h + 1, 0, 0), false, 'coaching'::public.availability_slot_type,
  TIMESTAMPTZ '2026-09-21 09:00+07', TIMESTAMPTZ '2026-09-21 09:00+07'
FROM generate_series(DATE '2026-10-07', DATE '2026-12-02', interval '1 day') d
CROSS JOIN unnest(ARRAY[9, 10, 11, 14, 15, 16]) h
WHERE extract(isodow FROM d) IN (2, 4);

-- ---------------------------------------------------------------------------
-- 12. Cohort A is over: close its enrollments
-- ---------------------------------------------------------------------------
UPDATE public.programme_enrollments e SET status = 'completed'::public.enrollment_status
FROM _enr x WHERE x.id = e.id AND x.cohort = 1;

-- ---------------------------------------------------------------------------
-- 13. VERIFICATION -- the seed commits only if every check holds
-- ---------------------------------------------------------------------------
-- The story is checked as of 2026-10-07; the date-independent invariants are
-- also checked as of today.
DO $verify$
DECLARE
  story constant date := DATE '2026-10-07';
  bad text; n integer; rec record; seen text; expected text;
BEGIN
  -- V1. No activity outside its window: admin_ineligible_programme_activity() is empty.
  PERFORM pg_temp.act_as((SELECT id FROM _admin));
  SELECT count(*), string_agg(x.enrollment_id || ' ' || x.module || ' ' || x.reason, '; ') INTO n, bad
  FROM public.admin_ineligible_programme_activity() x;
  PERFORM pg_temp.act_as_service();
  IF n <> 0 THEN RAISE EXCEPTION 'VERIFY 1 FAILED: % ineligible activities: %', n, bad; END IF;

  -- V2. Every progress number is exactly its requirement calendar (story date and today).
  SELECT string_agg(format('%s@%s req %s/%s done %s/%s due %s/%s overdue %s/%s', e.slug, d.as_of,
           cp.required_units, cal.required, cp.completed_units, cal.completed, cp.due_units, cal.due,
           cp.overdue_units, cal.overdue), '; ') INTO bad
  FROM _enr e
  CROSS JOIN (VALUES (story), (current_date)) d(as_of)
  CROSS JOIN LATERAL public.canonical_enrollment_progress(e.id, d.as_of) cp
  CROSS JOIN LATERAL (
    SELECT count(*) AS required, count(*) FILTER (WHERE k.is_completed) AS completed,
      count(*) FILTER (WHERE k.is_due_as_of) AS due, count(*) FILTER (WHERE k.is_overdue) AS overdue
    FROM public.canonical_enrollment_requirement_calendar(e.id, d.as_of) k) cal
  WHERE (cp.required_units, cp.completed_units, cp.due_units, cp.overdue_units)
        IS DISTINCT FROM (cal.required::int, cal.completed::int, cal.due::int, cal.overdue::int);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY 2 FAILED: progress differs from the calendar: %', bad; END IF;

  -- V3. Completed learners: completed = due = required = 12, on any date after the end.
  SELECT string_agg(format('%s@%s %s/%s/%s %s', e.slug, d.as_of, p.completed_units, p.due_units,
           p.required_units, p.effective_enrollment_status), '; ') INTO bad
  FROM _enr e CROSS JOIN (VALUES (story), (current_date)) d(as_of)
  CROSS JOIN LATERAL public.canonical_enrollment_progress(e.id, d.as_of) p
  WHERE e.cohort = 1
    AND NOT (p.completed_units = 12 AND p.due_units = 12 AND p.required_units = 12
             AND p.effective_enrollment_status = 'completed' AND p.full_completion_pct = 100);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY 3 FAILED: completed learners not complete: %', bad; END IF;

  -- V4. Active learners (story date): due < required, and completed <= due --
  --     except Huy, who is ahead by exactly one early session.
  SELECT string_agg(format('%s %s/%s/%s', e.slug, p.completed_units, p.due_units, p.required_units), '; ') INTO bad
  FROM _enr e CROSS JOIN LATERAL public.canonical_enrollment_progress(e.id, story) p
  WHERE e.cohort IN (2, 3)
    AND NOT (p.due_units < p.required_units
             AND CASE WHEN e.slug = 'huy' THEN p.completed_units = p.due_units + 1
                      ELSE p.completed_units <= p.due_units END);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY 4 FAILED: active learners: %', bad; END IF;

  -- V4b. The story, leader by leader (story date): done / due / overdue / pace.
  SELECT string_agg(format('%s %s/%s/%s %s (expected %s/%s/%s %s)', x.slug, p.completed_units, p.due_units,
           p.overdue_units, p.pace_status, x.done, x.due, x.overdue, x.pace), '; ') INTO bad
  FROM (VALUES
    ('khoa', 2, 2, 0, 'on_track'), ('tam', 1, 2, 1, 'behind'), ('huy', 3, 2, 0, 'ahead'), ('mai', 1, 2, 1, 'behind'),
    ('ngoc', 2, 2, 0, 'on_track'), ('dat', 2, 2, 0, 'on_track'), ('yen', 1, 2, 1, 'behind')
  ) AS x(slug, done, due, overdue, pace)
  JOIN _enr e ON e.slug = x.slug
  CROSS JOIN LATERAL public.canonical_enrollment_progress(e.id, story) p
  WHERE (p.completed_units, p.due_units, p.overdue_units, p.pace_status)
        IS DISTINCT FROM (x.done, x.due, x.overdue, x.pace);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY 4b FAILED: %', bad; END IF;

  -- V5. Cohort B (starting): nothing completed, nothing due, on the story date and today.
  SELECT string_agg(format('%s@%s done %s due %s', e.slug, d.as_of, p.completed_units, p.due_units), '; ') INTO bad
  FROM _enr e CROSS JOIN (VALUES (story), (current_date)) d(as_of)
  CROSS JOIN LATERAL public.canonical_enrollment_progress(e.id, d.as_of) p
  WHERE e.cohort = 4 AND (p.completed_units <> 0 OR p.due_units <> 0 OR p.required_units <> 12);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY 5 FAILED: starting learners: %', bad; END IF;

  -- V6/V7. No evidence before its checkpoint opens or after the programme ends.
  SELECT string_agg(format('%s %s on %s (window %s..%s)', x.slug, x.what, x.on_day, x.opens, x.closes), '; ') INTO bad
  FROM (
    SELECT h.learner AS slug, h.module::text AS what, h.day AS on_day, d.due_on - 14 AS opens,
      least(d.due_on, c.end_date) AS closes
    FROM _held h
    JOIN _dates d ON d.cohort = h.cohort AND d.module = h.module AND d.ordinal = h.ordinal
    JOIN public.cohorts c ON c.id = ('de300000-0000-4000-8000-00000000000' || h.cohort)::uuid
    UNION ALL
    SELECT t.slug, 'training w' || t.week_number || ' ' || k.what, k.at::date, t.opens,
      least(t.opens + 7, c.end_date)
    FROM _tw_at t
    JOIN public.cohorts c ON c.id = ('de300000-0000-4000-8000-00000000000' || t.cohort)::uuid
    CROSS JOIN LATERAL (VALUES ('skill card', t.skill_at, t.skill), ('quiz', t.quiz_at, t.quiz),
                               ('reflection', t.reflection_at, t.reflection)) k(what, at, done)
    WHERE k.done
    UNION ALL
    SELECT e.slug, 'daily prompt', (r.responded_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, w.unlock_date,
      least(w.unlock_date + 7, c.end_date)
    FROM public.daily_prompt_responses r
    JOIN _enr e ON e.id = r.enrollment_id
    JOIN public.daily_prompts dp ON dp.id = r.daily_prompt_id
    JOIN public.cohort_week_overrides w ON w.training_week_id = dp.training_week_id
     AND w.cohort_id = ('de300000-0000-4000-8000-00000000000' || e.cohort)::uuid
    JOIN public.cohorts c ON c.id = w.cohort_id
  ) x
  WHERE x.on_day < x.opens OR x.on_day > x.closes;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY 6/7 FAILED: evidence outside its window: %', bad; END IF;

  -- The stored timestamps are the seed's own (no trigger replaced them with now()).
  SELECT count(*) INTO n FROM public.training_progress tp JOIN _enr e ON e.id = tp.enrollment_id
  WHERE tp.completed_at > TIMESTAMPTZ '2026-09-24 00:00+07';
  IF n <> 0 THEN RAISE EXCEPTION 'VERIFY 6 FAILED: % training completions were re-stamped', n; END IF;

  -- V8. Every follow-up action has a deadline and a goal of its own enrollment.
  SELECT count(*) INTO n FROM public.enrollment_actions a JOIN _enr e ON e.id = a.enrollment_id
  WHERE a.due_date IS NULL OR a.goal_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.coachee_goals g WHERE g.id = a.goal_id AND g.enrollment_id = a.enrollment_id);
  IF n <> 0 THEN RAISE EXCEPTION 'VERIFY 8 FAILED: % actions without a deadline or goal', n; END IF;
  SELECT string_agg(e.slug, ', ') INTO bad FROM _enr e
  WHERE e.cohort = 1 AND (SELECT count(*) FROM public.enrollment_actions a
                          WHERE a.enrollment_id = e.id AND a.status = 'completed') < 2;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY 8 FAILED: fewer than two completed actions: %', bad; END IF;

  -- V9. Sponsor isolation, through THE visibility rule, acting as each sponsor.
  FOR rec IN SELECT * FROM (VALUES
      ('phuong', 'A', 'anh,binh,ha,huy,lan,mai,ngoc,tung'),
      ('tuan',   'B', 'dat,khoa,nam,quang,tam,thao,yen')) AS v(sponsor, org, expected)
  LOOP
    PERFORM pg_temp.act_as((SELECT id FROM _people WHERE slug = rec.sponsor));
    SELECT string_agg(e.slug, ',' ORDER BY e.slug) INTO seen
    FROM public.sponsor_visible_enrollments() v JOIN _enr e ON e.id = v.enrollment_id;
    SELECT count(*) INTO n FROM public.sponsor_visible_enrollments() v
    WHERE v.organization_id IS DISTINCT FROM (SELECT id FROM _orgs WHERE code = rec.org);
    PERFORM pg_temp.act_as_service();
    IF seen IS DISTINCT FROM rec.expected OR n <> 0 THEN
      RAISE EXCEPTION 'VERIFY 9 FAILED: % sees [%] (% from another organisation), expected [%]',
        rec.sponsor, seen, n, rec.expected;
    END IF;
  END LOOP;

  -- ... and both see their own rows of the SAME mixed cohorts 1 and 2.
  FOR rec IN SELECT * FROM (VALUES
      ('phuong', 1, 'binh,ha,lan'), ('tuan', 1, 'nam,quang,thao'),
      ('phuong', 2, 'huy,mai'),     ('tuan', 2, 'khoa,tam')) AS v(sponsor, cohort, expected)
  LOOP
    PERFORM pg_temp.act_as((SELECT id FROM _people WHERE slug = rec.sponsor));
    SELECT string_agg(e.slug, ',' ORDER BY e.slug) INTO seen
    FROM public.sponsor_canonical_enrollment_progress(('de300000-0000-4000-8000-00000000000' || rec.cohort)::uuid, story) p
    JOIN _enr e ON e.id = p.enrollment_id;
    PERFORM pg_temp.act_as_service();
    IF seen IS DISTINCT FROM rec.expected THEN
      RAISE EXCEPTION 'VERIFY 9 FAILED: % sees [%] in cohort %, expected [%]', rec.sponsor, seen, rec.cohort, rec.expected;
    END IF;
  END LOOP;

  -- V10. Tam and Mai: exactly one overdue session each, and behind (the risk
  --      signal; P1 made at_risk a derived state, never stored).
  SELECT string_agg(format('%s overdue %s pace %s', e.slug, p.overdue_units, p.pace_status), '; ') INTO bad
  FROM _enr e CROSS JOIN LATERAL public.canonical_enrollment_progress(e.id, story) p
  WHERE e.slug IN ('tam', 'mai') AND NOT (p.overdue_units = 1 AND p.coaching_completed_units = 1 AND p.pace_status = 'behind');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY 10 FAILED: %', bad; END IF;

  -- V11. Yen: week 1 complete; week 2 has its Skill Card but not its quiz, so it is NOT complete.
  SELECT string_agg(format('week %s complete=%s skill=%s quiz=%s', f.week_number, f.week_complete,
           f.skill_card_completed, f.quiz_completed), '; ') INTO bad
  FROM public.canonical_training_week_fulfilment((SELECT id FROM _enr WHERE slug = 'yen'), story) f
  WHERE f.week_number IN (1, 2)
    AND (f.week_complete, f.skill_card_completed, f.quiz_completed)
        IS DISTINCT FROM (f.week_number = 1, true, f.week_number = 1);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY 11 FAILED: Yen %', bad; END IF;

  -- V12. Huy's Coaching 3, held 2026-10-01 inside its 14-day early window, is fulfilled.
  SELECT count(*) INTO n
  FROM public.canonical_enrollment_requirement_calendar((SELECT id FROM _enr WHERE slug = 'huy'), story) k
  WHERE k.module = 'coaching' AND k.requirement_index = 3 AND k.is_completed AND k.completed_on = DATE '2026-10-01';
  IF n <> 1 THEN RAISE EXCEPTION 'VERIFY 12 FAILED: Huy''s Coaching 3 does not count'; END IF;

  -- Satisfaction averages.
  SELECT string_agg(format('%s %s (expected %s)', x.slug, a.avg, x.expected), '; ') INTO bad
  FROM (VALUES ('ha', 4.8), ('binh', 4.2), ('lan', 4.5), ('thao', 4.6), ('nam', 4.0), ('quang', 4.3),
               ('huy', 5.0), ('khoa', 4.5), ('tam', 4.0), ('mai', 4.0)) AS x(slug, expected)
  JOIN _enr e ON e.slug = x.slug
  CROSS JOIN LATERAL (SELECT round(avg(s.rating), 1) AS avg FROM public.canonical_enrollment_satisfaction(e.id) s) a
  WHERE a.avg IS DISTINCT FROM x.expected;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY satisfaction FAILED: %', bad; END IF;

  -- Goal growth: every Cohort 1 goal ends at its finish rating; Cohort 2 was rated once.
  SELECT string_agg(format('%s#%s %s->%s', g.slug, g.n, r.start_rating, r.current_rating), '; ') INTO bad
  FROM _goals g
  JOIN public.coachee_goal_ratings r ON r.goal_id = pg_temp.uid('goal:' || g.slug || ':' || g.n)
  WHERE (r.start_rating, r.current_rating) IS DISTINCT FROM (g.start_rating, g.finish_rating);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY goals FAILED: %', bad; END IF;
  SELECT string_agg(e.slug, ', ') INTO bad FROM _enr e
  WHERE e.cohort IN (3, 4) AND (EXISTS (SELECT 1 FROM public.goal_checkins c WHERE c.enrollment_id = e.id)
                                OR EXISTS (SELECT 1 FROM public.coachee_goal_ratings c WHERE c.enrollment_id = e.id));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY goals FAILED: unrated goals carry ratings: %', bad; END IF;

  -- Daily prompts answered (Cohort 1 has 30; Cohort 3 weeks 1-2 have 6).
  SELECT string_agg(format('%s %s (expected %s)', q.slug, coalesce(c.n, 0), q.n), '; ') INTO bad
  FROM _dp_quota q JOIN _enr e ON e.slug = q.slug
  LEFT JOIN LATERAL (SELECT count(*) AS n FROM public.daily_prompt_responses r WHERE r.enrollment_id = e.id) c ON true
  WHERE coalesce(c.n, 0) <> q.n;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY prompts FAILED: %', bad; END IF;

  -- Cohort 1 deliverables: every session has a reflection, check-in and action
  -- (ratings are left out on the sessions Lan and Quang did not rate).
  SELECT string_agg(format('%s %s', e.slug, d.source_table), '; ') INTO bad
  FROM _enr e CROSS JOIN LATERAL public.canonical_session_deliverables(e.id) d
  WHERE e.cohort = 1 AND NOT (d.has_reflection AND d.has_goal_checkin AND d.has_action);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY deliverables FAILED: %', bad; END IF;

  -- Coach and mentor write-ups are all done.
  SELECT count(*) INTO n
  FROM _held h CROSS JOIN LATERAL public.canonical_counterpart_deliverables(h.source_table, h.session_id) d
  WHERE h.source_table IN ('sessions', 'mentoring_sessions') AND d.required AND NOT d.done;
  IF n <> 0 THEN RAISE EXCEPTION 'VERIFY counterpart FAILED: % coach/mentor items outstanding', n; END IF;

  -- Schedule integrity: one dated requirement per unit, nothing unattributed.
  SELECT string_agg(i.issue || ' ' || coalesce(i.detail, ''), '; ') INTO bad
  FROM public.requirement_integrity_issues() i
  WHERE i.cohort_id IN (SELECT id FROM public.cohorts WHERE id::text LIKE 'de300000-%');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'VERIFY integrity FAILED: %', bad; END IF;
  SELECT count(*) INTO n FROM public.peer_session_participants p JOIN _enr e ON e.id = p.enrollment_id
  WHERE p.cohort_requirement_id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'VERIFY integrity FAILED: % peer participations hold no requirement', n; END IF;

  -- Booking: Khoa (Cohort 2) can book Coaching 3 in one of Duc's slots through
  -- the real booking function, at the slot's own start (eligibility, pool,
  -- requirement, goal gate and slot all accepted). Done in a sub-transaction
  -- and undone. See section 11 for the browser time-zone limitation.
  BEGIN
    PERFORM pg_temp.act_as((SELECT id FROM _people WHERE slug = 'khoa'));
    PERFORM public.book_coaching_session(
      (SELECT id FROM _enr WHERE slug = 'khoa'), 'de000000-0000-4000-8000-000000000001',
      pg_temp.uid('slot:2026-10-08:9'),
      (SELECT d.id FROM public.cohort_requirement_dates d
       WHERE d.cohort_id = 'de300000-0000-4000-8000-000000000002' AND d.module = 'coaching' AND d.ordinal = 3),
      'Verification booking', NULL, 60);
    RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'demo booking verified';
  EXCEPTION WHEN SQLSTATE 'P0999' THEN
    NULL;  -- booked, then undone
  END;
  PERFORM pg_temp.act_as_service();

  RAISE NOTICE 'Demo seed: all verification checks passed.';
END
$verify$;

-- ---------------------------------------------------------------------------
-- 14. Summary
-- ---------------------------------------------------------------------------
DO $summary$
DECLARE r record;
BEGIN
  RAISE NOTICE '== PROGRESS AS OF 2026-10-07 (canonical_enrollment_progress) ==';
  FOR r IN
    SELECT c.name AS cohort, pr.full_name AS leader, o.code AS org, p.completed_units, p.due_units,
      p.required_units, p.overdue_units, p.pace_status
    FROM _enr e
    JOIN public.programme_enrollments pe ON pe.id = e.id
    JOIN public.cohorts c ON c.id = pe.cohort_id
    JOIN public.profiles pr ON pr.id = pe.user_id
    JOIN _orgs o ON o.id = pe.organization_id
    CROSS JOIN LATERAL public.canonical_enrollment_progress(e.id, DATE '2026-10-07') p
    ORDER BY e.cohort, o.code, pr.full_name
  LOOP
    RAISE NOTICE '%  %  (Org %)  done %/%  due %  overdue %  %', rpad(r.cohort, 38), rpad(r.leader, 17), r.org,
      r.completed_units, r.required_units, r.due_units, r.overdue_units, r.pace_status;
  END LOOP;
  RAISE NOTICE '';
  RAISE NOTICE '== LOGINS (demo accounts: password demo123456) ==';
  RAISE NOTICE 'trang.tt@erickson.vn     admin    (existing account, untouched)';
  RAISE NOTICE 'duc.nm@erickson.vn       coach + mentor, ICF PCC; Tue/Thu slots 2026-10-08 .. 2026-12-01';
  RAISE NOTICE 'phuong.lt@demo-orgA.vn   sponsor, Organisation A (8 leaders)';
  RAISE NOTICE 'tuan.vt@demo-orgB.vn     sponsor, Organisation B (7 leaders)';
  RAISE NOTICE 'learners: ha.tt, binh.nv, lan.pt, huy.dq, mai.bt, anh.hd, tung.lv, ngoc.vt @demo-orgA.vn;';
  RAISE NOTICE '          khoa.pd, tam.tm, thao.nt, nam.lh, quang.tv, dat.bv, yen.dt @demo-orgB.vn';
END
$summary$;

COMMIT;
