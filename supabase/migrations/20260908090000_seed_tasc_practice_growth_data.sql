-- Extra practice-growth data for trang.tt@hsp.consulting on top of the TASC
-- seed (20260907120000_seed_tasc_essential_course.sql). That migration only
-- gave her one peer_session_competency_feedback row, and it rates coach2's
-- coaching of HER (peer_coach_id = coach2), not her own coaching — the
-- Practice Journey page (src/pages/CoachPracticeJourney.tsx) only shows
-- feedback where peer_coach_id = the viewer, so her radar/trend charts were
-- actually empty, not "flat". This adds 3 completed peer sessions where she
-- is the peer_coach (giving coaching), each with competency feedback on the
-- real 0-100 scale (public.peer_session_competency_feedback has a
-- validate_competency_scores trigger enforcing 0-100, not 1-10), so the
-- trend shows a visible growth arc across the programme. Also adds 2
-- Wheel of Life tool_sessions on her existing coaching sessions.
--
-- A separate migration rather than editing 20260907120000 in place: that
-- migration has already been applied, and editing an applied migration file
-- doesn't get re-run by Supabase's migration tracking — a fresh migration is
-- the only way this data actually reaches the database. Idempotent: safe to
-- re-run (upserts throughout).

DO $tasc_growth_seed$
DECLARE
  v_trang_id UUID;
  v_peer1_id UUID;
  v_peer2_id UUID;
BEGIN
  SELECT id INTO v_trang_id FROM public.profiles WHERE email = 'trang.tt@hsp.consulting';
  IF v_trang_id IS NULL THEN
    RAISE NOTICE 'User trang.tt@hsp.consulting not found — skipping practice-growth seed';
    RETURN;
  END IF;

  -- Same resolution order as 20260907120000 so peer1/peer2 line up with the
  -- triad group already seeded there.
  SELECT p.id INTO v_peer1_id FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.id
    WHERE r.role = 'coachee'::app_role AND p.id <> v_trang_id ORDER BY p.id LIMIT 1;
  SELECT p.id INTO v_peer2_id FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.id
    WHERE r.role = 'coachee'::app_role AND p.id <> v_trang_id AND p.id <> v_peer1_id ORDER BY p.id LIMIT 1;
  v_peer2_id := COALESCE(v_peer2_id, v_peer1_id);

  IF v_peer1_id IS NULL THEN
    RAISE NOTICE 'No other coachee found — skipping practice-growth peer sessions for trang.tt@hsp.consulting';
    RETURN;
  END IF;

  -- Peer session 2 (week 2): Trang coaches peer1
  INSERT INTO public.peer_sessions (id, peer_coach_id, peer_coachee_id, topic, start_time, duration_minutes, status, coach_notes, coachee_notes, action_items, coachee_rating)
  VALUES ('e0000000-0000-0000-0000-000000000011', v_trang_id, v_peer1_id, 'Practice: Helping peer explore a career transition using open questions', '2026-09-16T10:00:00+07:00'::timestamptz, 45, 'completed', 'I focused on using only open questions. Caught myself twice about to give advice and redirected to "What matters most to you in this decision?" I kept pauses at about 4-5 seconds. My peer said they felt really heard.', 'Trang was very patient. I appreciated how she didn''t rush to solutions. The question about what I would lose and gain in each scenario was particularly clarifying.', '[{"text":"Review question types from Week 2 skill card","done":true}]'::jsonb, 4)
  ON CONFLICT (id) DO UPDATE SET topic = EXCLUDED.topic, status = EXCLUDED.status, coach_notes = EXCLUDED.coach_notes, coachee_notes = EXCLUDED.coachee_notes, action_items = EXCLUDED.action_items, coachee_rating = EXCLUDED.coachee_rating;

  INSERT INTO public.peer_session_competency_feedback (id, peer_session_id, peer_coach_id, peer_coachee_id, ethical_practice, coaching_mindset, maintains_agreements, trust_safety, maintains_presence, listens_actively, evokes_awareness, facilitates_growth, feedback_note, created_at)
  VALUES ('f1a00000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000011', v_trang_id, v_peer1_id, 70, 65, 60, 80, 55, 70, 65, 60, 'Good first practice coaching session from Trang. She created a very safe space and I felt comfortable sharing real concerns. Her questions were mostly open but a few were slightly leading. She could work on sitting with silence a bit longer.', '2026-09-16T11:00:00Z'::timestamptz)
  ON CONFLICT (peer_session_id) DO UPDATE SET ethical_practice = EXCLUDED.ethical_practice, coaching_mindset = EXCLUDED.coaching_mindset, maintains_agreements = EXCLUDED.maintains_agreements, trust_safety = EXCLUDED.trust_safety, maintains_presence = EXCLUDED.maintains_presence, listens_actively = EXCLUDED.listens_actively, evokes_awareness = EXCLUDED.evokes_awareness, facilitates_growth = EXCLUDED.facilitates_growth, feedback_note = EXCLUDED.feedback_note, created_at = EXCLUDED.created_at;

  -- Peer session 3 (week 3): Trang coaches peer2
  INSERT INTO public.peer_sessions (id, peer_coach_id, peer_coachee_id, topic, start_time, duration_minutes, status, coach_notes, coachee_notes, action_items, coachee_rating)
  VALUES ('e0000000-0000-0000-0000-000000000012', v_trang_id, v_peer2_id, 'SHIFT practice: Coaching through a team conflict using full SHIFT structure', '2026-09-23T14:00:00+07:00'::timestamptz, 45, 'completed', 'First time I consciously followed SHIFT all the way through. I spent 5 minutes on S (setting the foundation), 8 minutes on H, 12 minutes on I (best I have done), 10 minutes on F, and 10 minutes on T. My peer said the I stage was where they had their breakthrough. The silence at 7 seconds felt natural this time.', 'Trang is visibly improving. She structured the conversation well using SHIFT. The question "When this conflict is resolved, what will the team meetings look like?" really helped me see what I actually wanted.', '[{"text":"Keep tracking time per SHIFT stage","done":true},{"text":"Practice F stage — surfacing existing resources","done":false}]'::jsonb, 5)
  ON CONFLICT (id) DO UPDATE SET topic = EXCLUDED.topic, status = EXCLUDED.status, coach_notes = EXCLUDED.coach_notes, coachee_notes = EXCLUDED.coachee_notes, action_items = EXCLUDED.action_items, coachee_rating = EXCLUDED.coachee_rating;

  INSERT INTO public.peer_session_competency_feedback (id, peer_session_id, peer_coach_id, peer_coachee_id, ethical_practice, coaching_mindset, maintains_agreements, trust_safety, maintains_presence, listens_actively, evokes_awareness, facilitates_growth, feedback_note, created_at)
  VALUES ('f1a00000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000012', v_trang_id, v_peer2_id, 78, 75, 72, 85, 68, 78, 76, 70, 'Clear improvement from Trang. Her SHIFT structure was visible and well-paced. She held a 7-second pause that led to my breakthrough moment. Still could probe deeper during the F stage — she found my resources but could have explored them more. Strongest area: trust and safety.', '2026-09-23T15:00:00Z'::timestamptz)
  ON CONFLICT (peer_session_id) DO UPDATE SET ethical_practice = EXCLUDED.ethical_practice, coaching_mindset = EXCLUDED.coaching_mindset, maintains_agreements = EXCLUDED.maintains_agreements, trust_safety = EXCLUDED.trust_safety, maintains_presence = EXCLUDED.maintains_presence, listens_actively = EXCLUDED.listens_actively, evokes_awareness = EXCLUDED.evokes_awareness, facilitates_growth = EXCLUDED.facilitates_growth, feedback_note = EXCLUDED.feedback_note, created_at = EXCLUDED.created_at;

  -- Peer session 4 (week 4): Trang coaches peer1 again
  INSERT INTO public.peer_sessions (id, peer_coach_id, peer_coachee_id, topic, start_time, duration_minutes, status, coach_notes, coachee_notes, action_items, coachee_rating, coachee_rating_comment)
  VALUES ('e0000000-0000-0000-0000-000000000013', v_trang_id, v_peer1_id, 'Full SHIFT session: Coaching on setting boundaries with a demanding stakeholder', '2026-09-30T10:00:00+07:00'::timestamptz, 45, 'completed', 'My strongest session yet. I followed SHIFT cleanly: S (3 min), H (7 min), I (15 min — my best), F (12 min), T (8 min). The "I" stage was where the real work happened. My peer discovered they actually knew what boundaries to set but were afraid of the reaction. I used a scaling question for the first time: "On a scale of 1-10, how ready are you to have that conversation?" They said 7. I asked "What would make it an 8?" That unlocked specific preparation steps. Silence: averaging 6-8 seconds now and it feels generative, not awkward.', 'This was a genuinely helpful coaching session. Trang was confident, patient, and her questions kept going deeper. The scaling question was brilliant — it made my readiness feel tangible and specific instead of vague. I walked away with three concrete actions and genuine confidence.', '[{"text":"Have the boundary conversation by Friday","done":false},{"text":"Write down the 3 key phrases to use","done":true}]'::jsonb, 5, 'Trang has grown enormously as a coach. This session felt genuinely professional. Her questioning and silence are now strengths, not weaknesses.')
  ON CONFLICT (id) DO UPDATE SET topic = EXCLUDED.topic, status = EXCLUDED.status, coach_notes = EXCLUDED.coach_notes, coachee_notes = EXCLUDED.coachee_notes, action_items = EXCLUDED.action_items, coachee_rating = EXCLUDED.coachee_rating, coachee_rating_comment = EXCLUDED.coachee_rating_comment;

  INSERT INTO public.peer_session_competency_feedback (id, peer_session_id, peer_coach_id, peer_coachee_id, ethical_practice, coaching_mindset, maintains_agreements, trust_safety, maintains_presence, listens_actively, evokes_awareness, facilitates_growth, feedback_note, created_at)
  VALUES ('f1a00000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000013', v_trang_id, v_peer1_id, 85, 83, 80, 90, 78, 85, 84, 80, 'Remarkable growth trajectory. Trang''s coaching feels natural and confident now. She used a scaling question for the first time and it was perfectly timed. Her silence is now a tool, not a gap. Trust and safety remain her standout strength — I would genuinely recommend her as a coach. Growth edge: continues to be facilitating the client''s own resource-finding (F stage) rather than subtly suggesting resources.', '2026-09-30T11:00:00Z'::timestamptz)
  ON CONFLICT (peer_session_id) DO UPDATE SET ethical_practice = EXCLUDED.ethical_practice, coaching_mindset = EXCLUDED.coaching_mindset, maintains_agreements = EXCLUDED.maintains_agreements, trust_safety = EXCLUDED.trust_safety, maintains_presence = EXCLUDED.maintains_presence, listens_actively = EXCLUDED.listens_actively, evokes_awareness = EXCLUDED.evokes_awareness, facilitates_growth = EXCLUDED.facilitates_growth, feedback_note = EXCLUDED.feedback_note, created_at = EXCLUDED.created_at;

  -- Wheel of Life tool entries on Trang's two coaching sessions (from
  -- 20260907120000: e0000000-...0001 and ...0002). Skipped gracefully if
  -- those sessions don't exist on this project.
  IF EXISTS (SELECT 1 FROM public.sessions WHERE id = 'e0000000-0000-0000-0000-000000000001') THEN
    INSERT INTO public.tool_sessions (id, session_id, tool_type, filled_by, responses, created_at)
    VALUES ('f2b00000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'wheel_of_life', v_trang_id,
      '{"career":7,"finance":5,"health":8,"relationships":7,"fun":4,"personal_growth":8,"physical_environment":6,"contribution":7}'::jsonb,
      '2026-09-10T09:30:00Z'::timestamptz)
    ON CONFLICT (id) DO UPDATE SET responses = EXCLUDED.responses;
  END IF;

  IF EXISTS (SELECT 1 FROM public.sessions WHERE id = 'e0000000-0000-0000-0000-000000000002') THEN
    INSERT INTO public.tool_sessions (id, session_id, tool_type, filled_by, responses, created_at)
    VALUES ('f2b00000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002', 'wheel_of_life', v_trang_id,
      '{"career":8,"finance":6,"health":8,"relationships":8,"fun":5,"personal_growth":9,"physical_environment":6,"contribution":8}'::jsonb,
      '2026-09-24T09:30:00Z'::timestamptz)
    ON CONFLICT (id) DO UPDATE SET responses = EXCLUDED.responses;
  END IF;
END;
$tasc_growth_seed$;
