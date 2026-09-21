-- Post-session deliverables: one pattern, one evidence function, one
-- satisfaction aggregate, for all four session modules.
--
-- A held session and the learner's write-up are two different facts. Session
-- completion is the lifecycle (it decides programme units, elsewhere); the
-- post-session DELIVERABLES are what each participating learner still owes
-- afterwards. Before this migration only Coaching had that second fact
-- (coaching_session_evidence); Mentoring had an unused variant reading a
-- different reflection store, Peer had none (and gave the providing learner no
-- deliverables at all), and Triads had none.
--
-- The shared base, per participating learner and per completed session:
--
--   reflection      session_learning_reflections      (every module)
--   goal check-in   goal_checkins (only required while the enrollment holds
--                   an active goal)
--   follow-up       enrollment_actions
--   satisfaction    the learner's own 1-5 rating of THAT session:
--                     Coaching   sessions.coachee_rating
--                     Peer       coachee_peer_sessions.receiver_rating /
--                                .provider_rating (NEW), peer_sessions
--                                .coachee_rating / .coach_rating (NEW)
--                     Mentoring  mentoring_sessions.mentee_rating (NEW)
--                     Triads     triad_reflections.satisfaction_rating
--
-- Module-specific extras (coach notes and feedback, mentor notes and feedback,
-- peer role feedback, triad group sharing) are layered on top in the UI and
-- keep their own stores; none of them is a learner deliverable.
--
-- Source-type naming. The three shared stores predate each other and spell
-- the modules differently ('triads' vs 'triad', and enrollment_actions keys
-- learner-to-learner peer as 'coachee_peer_coaching'). Renaming stored data
-- that other readers depend on is a larger change than this one, so the
-- mapping is written down ONCE, in session_deliverable_source_types(), and
-- every deliverable reader goes through it. src/lib/postSessionDeliverables.ts
-- mirrors the same table for the client writers.
--
-- Objects:
--   session_deliverable_source_types(table)          the naming map
--   canonical_session_participation(t, s, e)         role / status / rating
--   canonical_session_deliverable_state(t, s, e)     THE evidence rule
--   canonical_session_deliverables(e)                every completed session
--   learner_session_deliverables(e)                  self wrapper
--   admin_enrollment_session_deliverables(e)         admin wrapper
--   session_deliverables(t, s)                       per-session, participants
--   submit_session_satisfaction(t, s, e, rating)     the one rating writer
--   canonical_enrollment_satisfaction(e)             every rating, all modules
--   admin_enrollment_satisfaction(e[])               numeric only, admin
--   learner_module_requirements(e)                   next requirement per module
--   coaching_session_evidence                        now derived from the above
--   canonical_enrollment_engagement                  satisfaction across modules

-- ---------------------------------------------------------------------------
-- 1. Satisfaction columns that were missing
-- ---------------------------------------------------------------------------

ALTER TABLE public.mentoring_sessions
  ADD COLUMN IF NOT EXISTS mentee_rating smallint
    CONSTRAINT mentoring_sessions_mentee_rating_range CHECK (mentee_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS mentee_rated_at timestamptz;
COMMENT ON COLUMN public.mentoring_sessions.mentee_rating IS
  'The mentee''s own 1-5 satisfaction with this session. Written only via '
  'submit_session_satisfaction(); aggregated by canonical_enrollment_satisfaction().';

ALTER TABLE public.coachee_peer_sessions
  ADD COLUMN IF NOT EXISTS provider_rating smallint
    CONSTRAINT coachee_peer_sessions_provider_rating_range CHECK (provider_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS provider_rated_at timestamptz;
COMMENT ON COLUMN public.coachee_peer_sessions.provider_rating IS
  'The PROVIDING learner''s own 1-5 satisfaction with this peer session '
  '(receiver_rating is the receiving learner''s). Attributed to the provider''s '
  'own enrollment via peer_session_participants.';

ALTER TABLE public.peer_sessions
  ADD COLUMN IF NOT EXISTS coach_rating smallint
    CONSTRAINT peer_sessions_coach_rating_range CHECK (coach_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS coach_rated_at timestamptz;
COMMENT ON COLUMN public.peer_sessions.coach_rating IS
  'The providing peer''s own 1-5 satisfaction (coachee_rating is the receiver''s).';

-- Each rating belongs to the person who gave it. The lifecycle guard
-- (guard_session_protected_fields) protects lifecycle columns; this guard adds
-- the rating columns without re-stating that function.
CREATE OR REPLACE FUNCTION public.guard_session_satisfaction_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE u uuid := auth.uid();
BEGIN
  IF u IS NULL OR public.has_role(u, 'admin'::public.app_role) THEN RETURN NEW; END IF;
  IF current_setting('app.session_transition', true) = 'on' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'sessions' THEN
    IF NEW.coachee_rating IS DISTINCT FROM OLD.coachee_rating AND u IS DISTINCT FROM OLD.coachee_id THEN
      RAISE EXCEPTION 'Only the learner may rate this session' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'coachee_peer_sessions' THEN
    IF (NEW.receiver_rating IS DISTINCT FROM OLD.receiver_rating AND u IS DISTINCT FROM OLD.peer_receiver_id)
       OR (NEW.provider_rating IS DISTINCT FROM OLD.provider_rating AND u IS DISTINCT FROM OLD.peer_provider_id) THEN
      RAISE EXCEPTION 'A peer may only change their own rating' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'peer_sessions' THEN
    IF (NEW.coachee_rating IS DISTINCT FROM OLD.coachee_rating AND u IS DISTINCT FROM OLD.peer_coachee_id)
       OR (NEW.coach_rating IS DISTINCT FROM OLD.coach_rating AND u IS DISTINCT FROM OLD.peer_coach_id) THEN
      RAISE EXCEPTION 'A peer may only change their own rating' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'mentoring_sessions' THEN
    IF NEW.mentee_rating IS DISTINCT FROM OLD.mentee_rating AND u IS DISTINCT FROM OLD.mentee_id THEN
      RAISE EXCEPTION 'Only the mentee may rate this session' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sessions_guard_satisfaction ON public.sessions;
CREATE TRIGGER sessions_guard_satisfaction BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_session_satisfaction_fields();
DROP TRIGGER IF EXISTS coachee_peer_sessions_guard_satisfaction ON public.coachee_peer_sessions;
CREATE TRIGGER coachee_peer_sessions_guard_satisfaction BEFORE UPDATE ON public.coachee_peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_session_satisfaction_fields();
DROP TRIGGER IF EXISTS peer_sessions_guard_satisfaction ON public.peer_sessions;
CREATE TRIGGER peer_sessions_guard_satisfaction BEFORE UPDATE ON public.peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_session_satisfaction_fields();
DROP TRIGGER IF EXISTS mentoring_sessions_guard_satisfaction ON public.mentoring_sessions;
CREATE TRIGGER mentoring_sessions_guard_satisfaction BEFORE UPDATE ON public.mentoring_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_session_satisfaction_fields();

-- ---------------------------------------------------------------------------
-- 2. The source-type naming map (written down once)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.session_deliverable_source_types(p_source_table text)
RETURNS TABLE (
  module public.programme_module_type,
  reflection_type text,   -- session_learning_reflections.source_activity_type
  checkin_type text,      -- goal_checkins.source_activity_type
  action_type text        -- enrollment_actions.source_activity_type
)
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT m.module, m.reflection_type, m.checkin_type, m.action_type
  FROM (VALUES
    ('sessions',              'coaching'::public.programme_module_type,      'coaching',      'coaching',      'coaching'),
    ('peer_sessions',         'peer_coaching'::public.programme_module_type, 'peer_coaching', 'peer_coaching', 'peer_coaching'),
    ('coachee_peer_sessions', 'peer_coaching'::public.programme_module_type, 'peer_coaching', 'peer_coaching', 'coachee_peer_coaching'),
    ('mentoring_sessions',    'mentoring'::public.programme_module_type,     'mentoring',     'mentoring',     'mentoring'),
    ('triad_sessions',        'triads'::public.programme_module_type,        'triads',        'triad',         'triad')
  ) AS m(source_table, module, reflection_type, checkin_type, action_type)
  WHERE m.source_table = p_source_table;
$$;

REVOKE ALL ON FUNCTION public.session_deliverable_source_types(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_deliverable_source_types(text) TO authenticated;

COMMENT ON FUNCTION public.session_deliverable_source_types(text) IS
  'THE mapping from a session table to the source_activity_type each shared '
  'post-session store uses for it (reflections / goal check-ins / actions). '
  'The stores disagree on spelling (triads vs triad, coachee_peer_coaching); '
  'this function is the one place that says how. Mirrored in '
  'src/lib/postSessionDeliverables.ts.';

-- ---------------------------------------------------------------------------
-- 3. Reflections: one store for every module
-- ---------------------------------------------------------------------------
--
-- The validation trigger only checked Coaching, so a learner could file a
-- Mentoring / Peer / Triad reflection against a session they never attended.
-- Every module now requires that the enrollment PARTICIPATED in the session.

CREATE OR REPLACE FUNCTION public.validate_session_learning_reflection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_session_enrollment uuid;
  v_ok boolean;
BEGIN
  IF NEW.source_activity_type = 'coaching' THEN
    SELECT s.enrollment_id INTO v_session_enrollment
    FROM public.sessions s WHERE s.id = NEW.source_activity_id;

    IF v_session_enrollment IS NULL THEN
      RAISE EXCEPTION 'Coaching session % does not exist or has no enrollment', NEW.source_activity_id
        USING ERRCODE = '23503';
    END IF;

    IF v_session_enrollment IS DISTINCT FROM NEW.enrollment_id THEN
      RAISE EXCEPTION 'Reflection enrollment % does not match session enrollment %',
        NEW.enrollment_id, v_session_enrollment USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.source_activity_type = 'mentoring' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.mentoring_sessions m
      WHERE m.id = NEW.source_activity_id AND m.enrollment_id = NEW.enrollment_id
    ) INTO v_ok;
  ELSIF NEW.source_activity_type = 'peer_coaching' THEN
    -- Either side of a Peer session, each on its own enrollment. The session's
    -- own enrollment_id (the receiver) is accepted too, so a reflection bridged
    -- from receiver_notes before the participant row exists is not refused.
    SELECT EXISTS (
      SELECT 1 FROM public.peer_session_participants p
      WHERE p.peer_session_id = NEW.source_activity_id AND p.enrollment_id = NEW.enrollment_id
    ) OR EXISTS (
      SELECT 1 FROM public.coachee_peer_sessions s
      WHERE s.id = NEW.source_activity_id AND s.enrollment_id = NEW.enrollment_id
    ) OR EXISTS (
      SELECT 1 FROM public.peer_sessions s
      WHERE s.id = NEW.source_activity_id AND s.enrollment_id = NEW.enrollment_id
    ) INTO v_ok;
  ELSIF NEW.source_activity_type = 'triads' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.triad_sessions s
      JOIN public.triad_group_members m
        ON m.triad_group_id = s.triad_group_id AND m.enrollment_id = NEW.enrollment_id
      WHERE s.id = NEW.source_activity_id
    ) INTO v_ok;
  ELSE
    v_ok := false;
  END IF;

  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'Enrollment % did not take part in % session %',
      NEW.enrollment_id, NEW.source_activity_type, NEW.source_activity_id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- The mentor of a Mentoring session may read the mentee's reflection on it,
-- exactly as the coach of a Coaching session may (policy of 20260920120000).
-- Peer reflections stay private to their author: the partner is a fellow
-- learner, not the facilitator. A Sponsor never gets a policy here.
DROP POLICY IF EXISTS "Session learning reflections: session mentor view" ON public.session_learning_reflections;
CREATE POLICY "Session learning reflections: session mentor view"
  ON public.session_learning_reflections
  FOR SELECT TO authenticated
  USING (
    source_activity_type = 'mentoring'
    AND EXISTS (
      SELECT 1 FROM public.mentoring_sessions m
      WHERE m.id = session_learning_reflections.source_activity_id
        AND m.enrollment_id = session_learning_reflections.enrollment_id
        AND m.mentor_id = auth.uid()
    )
  );

COMMENT ON TABLE public.session_learning_reflections IS
  'Canonical post-session learner reflection for EVERY session module '
  '(coaching, peer_coaching, mentoring, triads), scoped to the enrollment that '
  'participated. mentee_notes / receiver_notes / peer coachee_notes are bridged '
  'here (20260925500000); Triad structured answers are mirrored here from '
  'triad_reflection_answers, which stay the authoring record for group sharing.';

-- 3a. Bridge the legacy learner-note columns (one-time copy, canonical wins).

INSERT INTO public.session_learning_reflections
  (enrollment_id, source_activity_type, source_activity_id, body, submitted_at)
SELECT m.enrollment_id, 'mentoring', m.id, btrim(m.mentee_notes), coalesce(m.updated_at, m.start_time, now())
FROM public.mentoring_sessions m
WHERE m.enrollment_id IS NOT NULL
  AND nullif(btrim(coalesce(m.mentee_notes, '')), '') IS NOT NULL
ON CONFLICT (enrollment_id, source_activity_type, source_activity_id) DO NOTHING;

INSERT INTO public.session_learning_reflections
  (enrollment_id, source_activity_type, source_activity_id, body, submitted_at)
SELECT s.enrollment_id, 'peer_coaching', s.id, btrim(s.receiver_notes), coalesce(s.updated_at, s.start_time, now())
FROM public.coachee_peer_sessions s
WHERE s.enrollment_id IS NOT NULL
  AND nullif(btrim(coalesce(s.receiver_notes, '')), '') IS NOT NULL
ON CONFLICT (enrollment_id, source_activity_type, source_activity_id) DO NOTHING;

INSERT INTO public.session_learning_reflections
  (enrollment_id, source_activity_type, source_activity_id, body, submitted_at)
SELECT s.enrollment_id, 'peer_coaching', s.id, btrim(s.coachee_notes), coalesce(s.updated_at, s.start_time, now())
FROM public.peer_sessions s
WHERE s.enrollment_id IS NOT NULL
  AND nullif(btrim(coalesce(s.coachee_notes, '')), '') IS NOT NULL
ON CONFLICT (enrollment_id, source_activity_type, source_activity_id) DO NOTHING;

-- 3b. Keep bridging while any legacy writer remains (update_session_notes,
--     update_mentoring_session_notes, admin editors). A non-empty learner note
--     is the learner's reflection and lands in the canonical store; clearing
--     the legacy note never deletes a canonical reflection.
CREATE OR REPLACE FUNCTION public.bridge_legacy_learner_note()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_note text;
  v_old text;
  v_type text;
BEGIN
  IF TG_TABLE_NAME = 'mentoring_sessions' THEN
    v_note := NEW.mentee_notes; v_type := 'mentoring';
    IF TG_OP = 'UPDATE' THEN v_old := OLD.mentee_notes; END IF;
  ELSIF TG_TABLE_NAME = 'coachee_peer_sessions' THEN
    v_note := NEW.receiver_notes; v_type := 'peer_coaching';
    IF TG_OP = 'UPDATE' THEN v_old := OLD.receiver_notes; END IF;
  ELSIF TG_TABLE_NAME = 'peer_sessions' THEN
    v_note := NEW.coachee_notes; v_type := 'peer_coaching';
    IF TG_OP = 'UPDATE' THEN v_old := OLD.coachee_notes; END IF;
  ELSE
    v_note := NEW.coachee_notes; v_type := 'coaching';
    IF TG_OP = 'UPDATE' THEN v_old := OLD.coachee_notes; END IF;
  END IF;

  -- Only a real change is bridged: re-saving an unchanged legacy note (a
  -- "save progress" that rewrites every field) must never overwrite a newer
  -- reflection written in the canonical store.
  IF TG_OP = 'UPDATE' AND v_note IS NOT DISTINCT FROM v_old THEN
    RETURN NEW;
  END IF;

  IF NEW.enrollment_id IS NULL OR nullif(btrim(coalesce(v_note, '')), '') IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.session_learning_reflections
    (enrollment_id, source_activity_type, source_activity_id, body, submitted_at)
  VALUES (NEW.enrollment_id, v_type, NEW.id, btrim(v_note), now())
  ON CONFLICT (enrollment_id, source_activity_type, source_activity_id)
    DO UPDATE SET body = excluded.body, submitted_at = excluded.submitted_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mentoring_sessions_bridge_learner_note ON public.mentoring_sessions;
CREATE TRIGGER mentoring_sessions_bridge_learner_note
  AFTER INSERT OR UPDATE OF mentee_notes ON public.mentoring_sessions
  FOR EACH ROW EXECUTE FUNCTION public.bridge_legacy_learner_note();
DROP TRIGGER IF EXISTS coachee_peer_sessions_bridge_learner_note ON public.coachee_peer_sessions;
CREATE TRIGGER coachee_peer_sessions_bridge_learner_note
  AFTER INSERT OR UPDATE OF receiver_notes ON public.coachee_peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.bridge_legacy_learner_note();
DROP TRIGGER IF EXISTS peer_sessions_bridge_learner_note ON public.peer_sessions;
CREATE TRIGGER peer_sessions_bridge_learner_note
  AFTER INSERT OR UPDATE OF coachee_notes ON public.peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.bridge_legacy_learner_note();
DROP TRIGGER IF EXISTS sessions_bridge_learner_note ON public.sessions;
CREATE TRIGGER sessions_bridge_learner_note
  AFTER INSERT OR UPDATE OF coachee_notes ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.bridge_legacy_learner_note();

COMMENT ON COLUMN public.mentoring_sessions.mentee_notes IS
  'HISTORICAL as of 2026-09-25: the canonical mentee reflection is '
  'session_learning_reflections (bridged by trigger). Nothing reads this for evidence.';
COMMENT ON COLUMN public.coachee_peer_sessions.receiver_notes IS
  'HISTORICAL as of 2026-09-25: the canonical receiver reflection is '
  'session_learning_reflections (bridged by trigger). Nothing reads this for evidence.';

-- 3c. Triads: the structured answers stay the authoring record (sections,
--     group unlock); their text is mirrored so "has this learner reflected"
--     is one existence test across modules.
CREATE OR REPLACE FUNCTION public.mirror_triad_reflection(p_reflection_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ref record;
  v_body text;
BEGIN
  SELECT r.id, r.enrollment_id, r.triad_session_id, r.submitted_at INTO v_ref
  FROM public.triad_reflections r WHERE r.id = p_reflection_id;
  IF v_ref.id IS NULL OR v_ref.enrollment_id IS NULL OR v_ref.triad_session_id IS NULL THEN
    RETURN;
  END IF;

  SELECT string_agg(btrim(a.answer_text), E'\n\n' ORDER BY q.display_order, q.id) INTO v_body
  FROM public.triad_reflection_answers a
  JOIN public.triad_reflection_questions q ON q.id = a.question_id
  WHERE a.triad_reflection_id = p_reflection_id AND nullif(btrim(a.answer_text), '') IS NOT NULL;

  IF v_body IS NULL THEN
    DELETE FROM public.session_learning_reflections
    WHERE enrollment_id = v_ref.enrollment_id AND source_activity_type = 'triads'
      AND source_activity_id = v_ref.triad_session_id;
  ELSE
    INSERT INTO public.session_learning_reflections
      (enrollment_id, source_activity_type, source_activity_id, body, submitted_at)
    VALUES (v_ref.enrollment_id, 'triads', v_ref.triad_session_id, v_body, coalesce(v_ref.submitted_at, now()))
    ON CONFLICT (enrollment_id, source_activity_type, source_activity_id)
      DO UPDATE SET body = excluded.body;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.mirror_triad_reflection(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mirror_triad_reflection_answers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.mirror_triad_reflection(NEW.triad_reflection_id);
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    PERFORM public.mirror_triad_reflection(OLD.triad_reflection_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS triad_reflection_answers_mirror ON public.triad_reflection_answers;
CREATE TRIGGER triad_reflection_answers_mirror
  AFTER INSERT OR UPDATE OR DELETE ON public.triad_reflection_answers
  FOR EACH ROW EXECUTE FUNCTION public.mirror_triad_reflection_answers();

CREATE OR REPLACE FUNCTION public.mirror_triad_reflection_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF OLD.enrollment_id IS NOT NULL AND OLD.triad_session_id IS NOT NULL THEN
    DELETE FROM public.session_learning_reflections
    WHERE enrollment_id = OLD.enrollment_id AND source_activity_type = 'triads'
      AND source_activity_id = OLD.triad_session_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS triad_reflections_mirror_delete ON public.triad_reflections;
CREATE TRIGGER triad_reflections_mirror_delete
  AFTER DELETE ON public.triad_reflections
  FOR EACH ROW EXECUTE FUNCTION public.mirror_triad_reflection_delete();

-- One-time mirror of every existing Triad reflection whose author is a
-- member of the session's group (the validation trigger's rule).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tr.id FROM public.triad_reflections tr
    JOIN public.triad_sessions s ON s.id = tr.triad_session_id
    JOIN public.triad_group_members m
      ON m.triad_group_id = s.triad_group_id AND m.enrollment_id = tr.enrollment_id
  LOOP
    PERFORM public.mirror_triad_reflection(r.id);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Actions and goal check-ins for every participant
-- ---------------------------------------------------------------------------
--
-- enrollment_activity_participants() is the authority the action store checks
-- ownership against. It knew only the RECEIVING side of a Peer session and no
-- Triad at all, so a provider could not record a follow-up on their own
-- enrollment and no Triad follow-up could be recorded anywhere.

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
 -- The PROVIDING side of a Peer session, on the provider's own enrollment
 -- (peer_session_participants is the one record of whose participation a
 -- session half is). learner = the provider, counterpart = the receiver.
 UNION ALL SELECT s.peer_coach_id,s.peer_coachee_id FROM public.peer_sessions s
 JOIN public.peer_session_participants p ON p.session_kind='peer' AND p.peer_session_id=s.id
  AND p.participant_role='provider' AND p.enrollment_id=p_enrollment_id AND p.user_id=s.peer_coach_id
 WHERE p_source_activity_type='peer_coaching' AND s.id=p_source_activity_id
 UNION ALL SELECT s.peer_provider_id,s.peer_receiver_id FROM public.coachee_peer_sessions s
 JOIN public.peer_session_participants p ON p.session_kind='coachee_peer' AND p.peer_session_id=s.id
  AND p.participant_role='provider' AND p.enrollment_id=p_enrollment_id AND p.user_id=s.peer_provider_id
 WHERE p_source_activity_type='coachee_peer_coaching' AND s.id=p_source_activity_id
 -- Triads: each member on their own enrollment; nobody else manages it.
 UNION ALL SELECT e.user_id,NULL::uuid FROM public.triad_sessions s
 JOIN public.triad_group_members m ON m.triad_group_id=s.triad_group_id AND m.enrollment_id=p_enrollment_id
 JOIN public.programme_enrollments e ON e.id=m.enrollment_id
 WHERE p_source_activity_type='triad' AND s.id=p_source_activity_id
$$;
REVOKE ALL ON FUNCTION public.enrollment_activity_participants(uuid,text,uuid) FROM PUBLIC,anon,authenticated;

-- record_goal_checkins: latest definition (20260918190000) with ONE change --
-- the peer branch also accepts the providing learner's own enrollment.
CREATE OR REPLACE FUNCTION public.record_goal_checkins(p_enrollment_id uuid, p_source_activity_type text, p_source_activity_id uuid, p_checkins jsonb, p_submission_id uuid DEFAULT gen_random_uuid())
 RETURNS SETOF goal_checkins
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  elsif p_source_activity_type = 'peer_coaching' and not exists (
      select 1 from public.peer_sessions s where s.id=p_source_activity_id and s.enrollment_id=p_enrollment_id and s.status='completed'
      union all select 1 from public.coachee_peer_sessions s where s.id=p_source_activity_id and s.enrollment_id=p_enrollment_id and s.status='completed'
      -- either participant, on their own enrollment
      union all select 1 from public.peer_session_participants p
        left join public.peer_sessions ps on p.session_kind='peer' and ps.id=p.peer_session_id
        left join public.coachee_peer_sessions cps on p.session_kind='coachee_peer' and cps.id=p.peer_session_id
        where p.peer_session_id=p_source_activity_id and p.enrollment_id=p_enrollment_id
          and coalesce(ps.status::text, cps.status::text)='completed') then
    raise exception 'Peer-coaching session is not a completed session in this enrollment' using errcode='42501';
  elsif p_source_activity_type = 'triad' and not exists (select 1 from public.triad_sessions s join public.triad_group_members m on m.triad_group_id=s.triad_group_id and m.enrollment_id=p_enrollment_id where s.id=p_source_activity_id and s.status='completed') then
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
end $function$;

REVOKE EXECUTE ON FUNCTION public.record_goal_checkins(uuid,text,uuid,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_goal_checkins(uuid,text,uuid,jsonb,uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. THE evidence rule
-- ---------------------------------------------------------------------------

-- One enrollment's participation in one session: its role, the session's
-- lifecycle status, and the learner's OWN satisfaction rating. The only place
-- that knows which column holds whose rating. Zero rows when the enrollment
-- did not take part.
CREATE OR REPLACE FUNCTION public.canonical_session_participation(
  p_source_table text, p_session_id uuid, p_enrollment_id uuid
)
RETURNS TABLE (participant_role text, session_status text, satisfaction_rating smallint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT 'coachee'::text, x.status::text, x.coachee_rating::smallint
  FROM public.sessions x
  WHERE p_source_table = 'sessions' AND x.id = p_session_id AND x.enrollment_id = p_enrollment_id

  UNION ALL
  SELECT p.participant_role, x.status::text,
    (CASE p.participant_role WHEN 'receiver' THEN x.receiver_rating ELSE x.provider_rating END)::smallint
  FROM public.coachee_peer_sessions x
  JOIN public.peer_session_participants p
    ON p.session_kind = 'coachee_peer' AND p.peer_session_id = x.id AND p.enrollment_id = p_enrollment_id
  WHERE p_source_table = 'coachee_peer_sessions' AND x.id = p_session_id

  UNION ALL
  SELECT p.participant_role, x.status::text,
    (CASE p.participant_role WHEN 'receiver' THEN x.coachee_rating ELSE x.coach_rating END)::smallint
  FROM public.peer_sessions x
  JOIN public.peer_session_participants p
    ON p.session_kind = 'peer' AND p.peer_session_id = x.id AND p.enrollment_id = p_enrollment_id
  WHERE p_source_table = 'peer_sessions' AND x.id = p_session_id

  UNION ALL
  SELECT 'mentee'::text, x.status::text, x.mentee_rating
  FROM public.mentoring_sessions x
  WHERE p_source_table = 'mentoring_sessions' AND x.id = p_session_id AND x.enrollment_id = p_enrollment_id

  UNION ALL
  -- Triad roles rotate and the canonical model records no per-session role
  -- (the legacy triad_sessions.*_enrollment_id columns are no longer written
  -- and are retired in deployment 2), so every member is a 'participant'.
  SELECT 'participant'::text, x.status::text, r.satisfaction_rating::smallint
  FROM public.triad_sessions x
  JOIN public.triad_group_members m
    ON m.triad_group_id = x.triad_group_id AND m.enrollment_id = p_enrollment_id
  LEFT JOIN public.triad_reflections r
    ON r.triad_session_id = x.id AND r.enrollment_id = p_enrollment_id
  WHERE p_source_table = 'triad_sessions' AND x.id = p_session_id
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.canonical_session_participation(text, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.canonical_session_deliverable_state(
  p_source_table text, p_session_id uuid, p_enrollment_id uuid
)
RETURNS TABLE (
  module public.programme_module_type,
  source_table text,
  session_id uuid,
  enrollment_id uuid,
  participant_role text,
  session_status text,
  session_completed boolean,
  has_reflection boolean,
  has_goal_checkin boolean,
  goal_checkin_required boolean,
  has_action boolean,
  has_satisfaction boolean,
  satisfaction_rating smallint,
  deliverables_complete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH t AS (
    SELECT * FROM public.session_deliverable_source_types(p_source_table)
  ), p AS (
    SELECT * FROM public.canonical_session_participation(p_source_table, p_session_id, p_enrollment_id)
  ), gates AS (
    SELECT t.module, p.participant_role, p.session_status, p.satisfaction_rating,
      EXISTS (
        SELECT 1 FROM public.session_learning_reflections r
        WHERE r.enrollment_id = p_enrollment_id
          AND r.source_activity_type = t.reflection_type AND r.source_activity_id = p_session_id
      ) AS has_reflection,
      EXISTS (
        SELECT 1 FROM public.goal_checkins c
        WHERE c.enrollment_id = p_enrollment_id
          AND c.source_activity_type = t.checkin_type AND c.source_activity_id = p_session_id
      ) AS has_goal_checkin,
      -- The check-in applies only while the enrollment holds an active goal:
      -- an outstanding list must never show an item the learner cannot do.
      EXISTS (
        SELECT 1 FROM public.coachee_goals g
        WHERE g.enrollment_id = p_enrollment_id AND g.status = 'active'
      ) AS goal_checkin_required,
      EXISTS (
        SELECT 1 FROM public.enrollment_actions a
        WHERE a.enrollment_id = p_enrollment_id
          AND a.source_activity_type = t.action_type AND a.source_activity_id = p_session_id
      ) AS has_action
    FROM t CROSS JOIN p
  )
  SELECT g.module, p_source_table, p_session_id, p_enrollment_id, g.participant_role,
    g.session_status, g.session_status = 'completed',
    g.has_reflection, g.has_goal_checkin, g.goal_checkin_required, g.has_action,
    g.satisfaction_rating IS NOT NULL, g.satisfaction_rating,
    -- Reporting only. Nothing reads this to decide a programme unit.
    (g.has_reflection
      AND (NOT g.goal_checkin_required OR g.has_goal_checkin)
      AND g.has_action
      AND g.satisfaction_rating IS NOT NULL)
  FROM gates g;
$$;
REVOKE ALL ON FUNCTION public.canonical_session_deliverable_state(text, uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.canonical_session_deliverable_state(text, uuid, uuid) IS
  'THE post-session deliverable rule for one participating enrollment in one '
  'session of any module: reflection, goal check-in (when an active goal '
  'exists), follow-up action, own 1-5 satisfaction. REPORTING ONLY -- session '
  'completion (the lifecycle) decides programme units, never this. Internal.';

-- Every completed session the enrollment took part in, with its deliverables.
-- Participation comes from canonical_session_history (the one reader of
-- "which sessions are this enrollment's", both Peer sides included).
CREATE OR REPLACE FUNCTION public.canonical_session_deliverables(p_enrollment_id uuid)
RETURNS TABLE (
  module public.programme_module_type,
  source_table text,
  session_id uuid,
  participant_role text,
  title text,
  start_time timestamptz,
  counterpart_names text[],
  requirement_unit_number integer,
  has_reflection boolean,
  has_goal_checkin boolean,
  goal_checkin_required boolean,
  has_action boolean,
  has_satisfaction boolean,
  satisfaction_rating smallint,
  deliverables_complete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT st.module, h.source_table, h.source_id, st.participant_role, h.title, h.start_time,
    h.counterpart_names, h.requirement_unit_number,
    st.has_reflection, st.has_goal_checkin, st.goal_checkin_required, st.has_action,
    st.has_satisfaction, st.satisfaction_rating, st.deliverables_complete
  FROM public.canonical_session_history(p_enrollment_id) h
  CROSS JOIN LATERAL public.canonical_session_deliverable_state(h.source_table, h.source_id, p_enrollment_id) st
  WHERE h.status = 'completed'
  ORDER BY h.start_time DESC NULLS LAST, h.source_id;
$$;
REVOKE ALL ON FUNCTION public.canonical_session_deliverables(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.learner_session_deliverables(p_enrollment_id uuid)
RETURNS TABLE (
  module public.programme_module_type,
  source_table text,
  session_id uuid,
  participant_role text,
  title text,
  start_time timestamptz,
  counterpart_names text[],
  requirement_unit_number integer,
  has_reflection boolean,
  has_goal_checkin boolean,
  goal_checkin_required boolean,
  has_action boolean,
  has_satisfaction boolean,
  satisfaction_rating smallint,
  deliverables_complete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT d.*
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_session_deliverables(e.id) d
  WHERE e.id = p_enrollment_id
    AND e.user_id = auth.uid()
    AND auth.uid() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.learner_session_deliverables(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_session_deliverables(uuid) TO authenticated;

COMMENT ON FUNCTION public.learner_session_deliverables(uuid) IS
  'The learner''s own post-session deliverables, one row per completed session '
  'they took part in (all four modules, both Peer roles). The single definition '
  'of "outstanding" for My Journey, module pages and session detail.';

CREATE OR REPLACE FUNCTION public.admin_enrollment_session_deliverables(p_enrollment_id uuid)
RETURNS TABLE (
  module public.programme_module_type,
  source_table text,
  session_id uuid,
  participant_role text,
  title text,
  start_time timestamptz,
  counterpart_names text[],
  requirement_unit_number integer,
  has_reflection boolean,
  has_goal_checkin boolean,
  goal_checkin_required boolean,
  has_action boolean,
  has_satisfaction boolean,
  satisfaction_rating smallint,
  deliverables_complete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT d.*
  FROM public.canonical_session_deliverables(p_enrollment_id) d
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role);
$$;
REVOKE ALL ON FUNCTION public.admin_enrollment_session_deliverables(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_enrollment_session_deliverables(uuid) TO authenticated;

-- Per-session view for session detail pages: one row per participating
-- enrollment, visible to the session's participants (learners, coach, mentor,
-- peer partner, Triad members) and Admin. Flags and the viewer's own rating
-- only; no narrative. is_self marks the caller's own row.
CREATE OR REPLACE FUNCTION public.session_deliverables(p_source_table text, p_session_id uuid)
RETURNS TABLE (
  module public.programme_module_type,
  source_table text,
  session_id uuid,
  enrollment_id uuid,
  participant_role text,
  is_self boolean,
  session_status text,
  session_completed boolean,
  has_reflection boolean,
  has_goal_checkin boolean,
  goal_checkin_required boolean,
  has_action boolean,
  has_satisfaction boolean,
  satisfaction_rating smallint,
  deliverables_complete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH parts AS (
    SELECT s.enrollment_id, s.coachee_id AS user_id, ARRAY[s.coach_id, s.coachee_id] AS members
    FROM public.sessions s
    WHERE p_source_table = 'sessions' AND s.id = p_session_id AND s.enrollment_id IS NOT NULL
    UNION ALL
    SELECT p.enrollment_id, p.user_id, ARRAY[x.peer_provider_id, x.peer_receiver_id]
    FROM public.coachee_peer_sessions x
    JOIN public.peer_session_participants p ON p.session_kind = 'coachee_peer' AND p.peer_session_id = x.id
    WHERE p_source_table = 'coachee_peer_sessions' AND x.id = p_session_id AND p.enrollment_id IS NOT NULL
    UNION ALL
    SELECT p.enrollment_id, p.user_id, ARRAY[x.peer_coach_id, x.peer_coachee_id]
    FROM public.peer_sessions x
    JOIN public.peer_session_participants p ON p.session_kind = 'peer' AND p.peer_session_id = x.id
    WHERE p_source_table = 'peer_sessions' AND x.id = p_session_id AND p.enrollment_id IS NOT NULL
    UNION ALL
    SELECT m.enrollment_id, m.mentee_id, ARRAY[m.mentor_id, m.mentee_id]
    FROM public.mentoring_sessions m
    WHERE p_source_table = 'mentoring_sessions' AND m.id = p_session_id AND m.enrollment_id IS NOT NULL
    UNION ALL
    SELECT gm.enrollment_id, e.user_id,
      ARRAY(SELECT e2.user_id FROM public.triad_group_members m2
            JOIN public.programme_enrollments e2 ON e2.id = m2.enrollment_id
            WHERE m2.triad_group_id = x.triad_group_id)
    FROM public.triad_sessions x
    JOIN public.triad_group_members gm ON gm.triad_group_id = x.triad_group_id
    JOIN public.programme_enrollments e ON e.id = gm.enrollment_id
    WHERE p_source_table = 'triad_sessions' AND x.id = p_session_id
  )
  SELECT st.module, st.source_table, st.session_id, st.enrollment_id, st.participant_role,
    (p.user_id = auth.uid()) AS is_self,
    st.session_status, st.session_completed,
    st.has_reflection, st.has_goal_checkin, st.goal_checkin_required, st.has_action,
    st.has_satisfaction,
    -- A rating is the rater's own; a counterpart sees only that it exists.
    CASE WHEN p.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role)
         THEN st.satisfaction_rating END,
    st.deliverables_complete
  FROM parts p
  CROSS JOIN LATERAL public.canonical_session_deliverable_state(p_source_table, p_session_id, p.enrollment_id) st
  WHERE auth.uid() IS NOT NULL
    AND (auth.uid() = ANY (p.members) OR public.has_role(auth.uid(), 'admin'::public.app_role));
$$;
REVOKE ALL ON FUNCTION public.session_deliverables(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_deliverables(text, uuid) TO authenticated;

-- Coaching evidence keeps its exact contract, now DERIVED from the one rule.
CREATE OR REPLACE FUNCTION public.coaching_session_evidence(p_session_id uuid)
RETURNS TABLE (
  session_id uuid,
  enrollment_id uuid,
  session_completed boolean,
  has_reflection boolean,
  has_goal_checkin boolean,
  has_action boolean,
  has_satisfaction boolean,
  goal_checkin_required boolean,
  evidence_complete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT s.id, s.enrollment_id, s.status = 'completed',
    coalesce(st.has_reflection, false), coalesce(st.has_goal_checkin, false),
    coalesce(st.has_action, false), coalesce(st.has_satisfaction, false),
    coalesce(st.goal_checkin_required, false), coalesce(st.deliverables_complete, false)
  FROM public.sessions s
  LEFT JOIN LATERAL public.canonical_session_deliverable_state('sessions', s.id, s.enrollment_id) st ON true
  WHERE s.id = p_session_id;
$$;

COMMENT ON FUNCTION public.coaching_session_evidence(uuid) IS
  'After-session evidence for one Coaching session, derived from '
  'canonical_session_deliverable_state() (the rule shared by every module). '
  'REPORTING ONLY -- it decides no programme unit.';

-- Mentoring evidence: the mentee reflection now reads the one store only.
CREATE OR REPLACE FUNCTION public.mentoring_session_evidence(p_session_id uuid)
RETURNS TABLE (
  session_id uuid,
  enrollment_id uuid,
  session_status text,
  has_prep_file boolean,
  has_mentee_reflection boolean,
  has_mentor_notes boolean,
  has_mentor_feedback boolean,
  has_goal_checkin boolean,
  action_count integer,
  goal_checkin_available boolean,
  evidence_complete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT m.id, m.enrollment_id, m.status::text,
    nullif(btrim(coalesce(m.prep_file_path, '')), '') IS NOT NULL,
    coalesce(st.has_reflection, false),
    nullif(btrim(coalesce(m.mentor_notes, '')), '') IS NOT NULL,
    EXISTS (SELECT 1 FROM public.mentoring_feedback f WHERE f.mentoring_session_id = m.id),
    coalesce(st.has_goal_checkin, false),
    (SELECT count(*)::integer FROM public.enrollment_actions a
      WHERE a.enrollment_id = m.enrollment_id
        AND a.source_activity_type = 'mentoring' AND a.source_activity_id = m.id),
    coalesce(st.goal_checkin_required, false),
    (coalesce(st.has_reflection, false)
      AND EXISTS (SELECT 1 FROM public.mentoring_feedback f WHERE f.mentoring_session_id = m.id)
      AND (NOT coalesce(st.goal_checkin_required, false) OR coalesce(st.has_goal_checkin, false)))
  FROM public.mentoring_sessions m
  LEFT JOIN LATERAL public.canonical_session_deliverable_state('mentoring_sessions', m.id, m.enrollment_id) st ON true
  WHERE m.id = p_session_id;
$$;

-- ---------------------------------------------------------------------------
-- 6. The one satisfaction writer
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_session_satisfaction(
  p_source_table text, p_session_id uuid, p_enrollment_id uuid, p_rating smallint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_part record;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.programme_enrollments e WHERE e.id = p_enrollment_id AND e.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the learner can rate their own session' USING ERRCODE = '42501';
  END IF;
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Satisfaction must be between 1 and 5' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_part
  FROM public.canonical_session_participation(p_source_table, p_session_id, p_enrollment_id);
  IF v_part.session_status IS NULL THEN
    RAISE EXCEPTION 'This enrollment did not take part in that session' USING ERRCODE = '42501';
  END IF;
  IF v_part.session_status <> 'completed' THEN
    RAISE EXCEPTION 'A session can be rated once it has been completed' USING ERRCODE = 'P0001';
  END IF;

  IF p_source_table = 'sessions' THEN
    UPDATE public.sessions SET coachee_rating = p_rating, coachee_rated_at = now() WHERE id = p_session_id;
  ELSIF p_source_table = 'mentoring_sessions' THEN
    UPDATE public.mentoring_sessions SET mentee_rating = p_rating, mentee_rated_at = now() WHERE id = p_session_id;
  ELSIF p_source_table = 'coachee_peer_sessions' THEN
    IF v_part.participant_role = 'receiver' THEN
      UPDATE public.coachee_peer_sessions SET receiver_rating = p_rating, receiver_rated_at = now() WHERE id = p_session_id;
    ELSE
      UPDATE public.coachee_peer_sessions SET provider_rating = p_rating, provider_rated_at = now() WHERE id = p_session_id;
    END IF;
  ELSIF p_source_table = 'peer_sessions' THEN
    IF v_part.participant_role = 'receiver' THEN
      UPDATE public.peer_sessions SET coachee_rating = p_rating, coachee_rated_at = now() WHERE id = p_session_id;
    ELSE
      UPDATE public.peer_sessions SET coach_rating = p_rating, coach_rated_at = now() WHERE id = p_session_id;
    END IF;
  ELSIF p_source_table = 'triad_sessions' THEN
    -- The Triad rating lives on the learner's reflection submission.
    UPDATE public.triad_reflections SET satisfaction_rating = p_rating
    WHERE triad_session_id = p_session_id AND enrollment_id = p_enrollment_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      RAISE EXCEPTION 'Submit your Triad reflection before rating the session' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported session source %', p_source_table USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_session_satisfaction(text, uuid, uuid, smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_session_satisfaction(text, uuid, uuid, smallint) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. One satisfaction aggregate across the four modules
-- ---------------------------------------------------------------------------

-- Every own rating of every completed session the enrollment took part in.
-- Numeric only: no comment, no narrative, no counterpart.
CREATE OR REPLACE FUNCTION public.canonical_enrollment_satisfaction(p_enrollment_id uuid)
RETURNS TABLE (module public.programme_module_type, source_table text, session_id uuid, rating smallint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT h.module, h.source_table, h.source_id, p.satisfaction_rating
  FROM public.canonical_session_history(p_enrollment_id) h
  CROSS JOIN LATERAL public.canonical_session_participation(h.source_table, h.source_id, p_enrollment_id) p
  WHERE h.status = 'completed'
    AND p.session_status = 'completed'
    AND p.satisfaction_rating IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.canonical_enrollment_satisfaction(uuid) FROM PUBLIC, anon, authenticated;

-- Same signature and columns as 20260918120000; only the satisfaction CTE
-- changes (Coaching-only -> every module the learner rated).
CREATE OR REPLACE FUNCTION public.canonical_enrollment_engagement(
  p_enrollment_id uuid
)
RETURNS TABLE (
  goal_count integer,
  goal_setup boolean,
  goal_progress_pct numeric,
  open_action_count integer,
  completed_action_count integer,
  total_action_count integer,
  action_completion_pct numeric,
  satisfaction_avg numeric,
  satisfaction_rated_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH goals AS (
    SELECT
      count(gp.goal_id)::integer AS goal_count,
      coalesce(bool_or(gp.has_rating), false) AS goal_setup,
      round(avg(gp.progress_pct), 1) AS goal_progress_pct
    FROM public.canonical_goal_progress(p_enrollment_id) gp
  ), actions AS (
    SELECT
      count(a.id) FILTER (WHERE a.status IN ('open', 'in_progress'))::integer AS open_action_count,
      count(a.id) FILTER (WHERE a.status = 'completed')::integer AS completed_action_count,
      count(a.id)::integer AS total_action_count
    FROM public.enrollment_actions a
    WHERE a.enrollment_id = p_enrollment_id
      AND a.status <> 'cancelled'
  ), satisfaction AS (
    -- The learner's own 1-5 ratings across Coaching, Peer (either role),
    -- Mentoring and Triads, completed sessions only.
    SELECT
      round(avg(r.rating), 2) AS satisfaction_avg,
      count(*)::integer AS satisfaction_rated_count
    FROM public.canonical_enrollment_satisfaction(p_enrollment_id) r
  )
  SELECT
    g.goal_count,
    g.goal_setup,
    g.goal_progress_pct,
    a.open_action_count,
    a.completed_action_count,
    a.total_action_count,
    CASE WHEN a.total_action_count = 0 THEN NULL
      ELSE round(a.completed_action_count * 100.0 / a.total_action_count, 1)
    END,
    s.satisfaction_avg,
    s.satisfaction_rated_count
  FROM goals g
  CROSS JOIN actions a
  CROSS JOIN satisfaction s;
$$;

REVOKE ALL ON FUNCTION public.canonical_enrollment_engagement(uuid)
  FROM PUBLIC, anon, authenticated;

-- Admin analytics: the numeric distribution per enrollment and module, from
-- the same ratings the engagement average is built from. rating_counts[n] is
-- the number of n-star ratings.
CREATE OR REPLACE FUNCTION public.admin_enrollment_satisfaction(p_enrollment_ids uuid[])
RETURNS TABLE (
  enrollment_id uuid,
  module public.programme_module_type,
  rated_count integer,
  rating_sum integer,
  satisfaction_avg numeric,
  rating_counts integer[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT e.id, r.module, count(*)::integer, sum(r.rating)::integer, round(avg(r.rating), 2),
    ARRAY[
      count(*) FILTER (WHERE r.rating = 1),
      count(*) FILTER (WHERE r.rating = 2),
      count(*) FILTER (WHERE r.rating = 3),
      count(*) FILTER (WHERE r.rating = 4),
      count(*) FILTER (WHERE r.rating = 5)
    ]::integer[]
  FROM unnest(coalesce(p_enrollment_ids, ARRAY[]::uuid[])) AS x(id)
  JOIN public.programme_enrollments e ON e.id = x.id
  CROSS JOIN LATERAL public.canonical_enrollment_satisfaction(e.id) r
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  GROUP BY e.id, r.module;
$$;
REVOKE ALL ON FUNCTION public.admin_enrollment_satisfaction(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_enrollment_satisfaction(uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Next requirement per module (module pages)
-- ---------------------------------------------------------------------------
--
-- A thin self-scoped projection of the four canonical fulfilment functions,
-- so a module page reads each requirement's deadline and state from the same
-- engines progress is built from.
CREATE OR REPLACE FUNCTION public.learner_module_requirements(p_enrollment_id uuid)
RETURNS TABLE (
  module public.programme_module_type,
  requirement_id uuid,
  ordinal integer,
  due_on date,
  fulfilled_on date,
  booked_on date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH me AS (
    SELECT e.id FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id AND e.user_id = auth.uid() AND auth.uid() IS NOT NULL
  )
  SELECT 'coaching'::public.programme_module_type, f.requirement_id, f.ordinal, f.due_on, f.fulfilled_on, f.booked_on
  FROM me CROSS JOIN LATERAL public.canonical_coaching_requirement_fulfilment(me.id) f
  UNION ALL
  SELECT 'peer_coaching', f.requirement_id, f.ordinal, f.due_on, f.fulfilled_on, f.booked_on
  FROM me CROSS JOIN LATERAL public.canonical_peer_requirement_fulfilment(me.id) f
  UNION ALL
  SELECT 'mentoring', f.requirement_id, f.ordinal, f.due_on, f.fulfilled_on, f.booked_on
  FROM me CROSS JOIN LATERAL public.canonical_mentoring_requirement_fulfilment(me.id) f
  UNION ALL
  SELECT 'triads', f.cohort_requirement_date_id, f.unit_number, f.due_on, f.fulfilled_on,
    coalesce(f.booked_on, f.proposed_on)
  FROM me CROSS JOIN LATERAL public.canonical_triad_requirement_fulfilment(me.id) f
  ORDER BY 1, 3;
$$;
REVOKE ALL ON FUNCTION public.learner_module_requirements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_module_requirements(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Reflection feed reads the one store for Peer (both roles) and Mentoring
-- ---------------------------------------------------------------------------
--
-- canonical_reflection_feed (20260925300000) with the three legacy-note
-- branches (coachee_peer receiver_notes, peer coachee_notes, mentee_notes)
-- replaced by session_learning_reflections. Every other branch is unchanged.

CREATE OR REPLACE FUNCTION public.canonical_reflection_feed(
  p_enrollment_id uuid
)
RETURNS TABLE (
  reflection_key text,
  source_type text,
  source_table text,
  source_id uuid,
  module public.programme_module_type,
  occurred_at timestamptz,
  title text,
  body text,
  details jsonb,
  rating numeric,
  previous_rating numeric,
  linked_session_table text,
  linked_session_id uuid,
  linked_goal_id uuid,
  linked_activity_id uuid,
  is_private boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT e.id AS enrollment_id, e.user_id
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
  ), feed AS (
    SELECT 'coaching_session_reflection'::text AS source_type, 'sessions'::text AS source_table, s.id AS source_id,
      'coaching'::public.programme_module_type AS module, s.start_time AS occurred_at, s.topic AS title,
      btrim(r.body) AS body, NULL::jsonb AS details, NULL::numeric AS rating, NULL::numeric AS previous_rating,
      'sessions'::text AS linked_session_table, s.id AS linked_session_id, NULL::uuid AS linked_goal_id,
      s.id AS linked_activity_id, false AS is_private
    FROM public.sessions s
    JOIN me ON s.enrollment_id = me.enrollment_id AND s.coachee_id = me.user_id
    JOIN public.session_learning_reflections r
      ON r.enrollment_id = me.enrollment_id
     AND r.source_activity_type = 'coaching'
     AND r.source_activity_id = s.id
    WHERE nullif(btrim(r.body), '') IS NOT NULL

    UNION ALL
    SELECT 'coaching_session_rating', 'sessions', s.id, 'coaching', coalesce(s.coachee_rated_at, s.start_time), s.topic,
      btrim(s.coachee_rating_comment), NULL, s.coachee_rating, NULL,
      'sessions', s.id, NULL, s.id, false
    FROM public.sessions s
    JOIN me ON s.enrollment_id = me.enrollment_id AND s.coachee_id = me.user_id
    WHERE nullif(btrim(s.coachee_rating_comment), '') IS NOT NULL

    -- Peer (both relationship tables, BOTH roles): the learner's own
    -- reflection from the canonical store, on their own enrollment.
    UNION ALL
    SELECT 'peer_session_reflection',
      CASE WHEN cps.id IS NOT NULL THEN 'coachee_peer_sessions' ELSE 'peer_sessions' END,
      r.source_activity_id, 'peer_coaching', coalesce(cps.start_time, ps.start_time), coalesce(cps.topic, ps.topic),
      btrim(r.body), NULL, NULL, NULL,
      CASE WHEN cps.id IS NOT NULL THEN 'coachee_peer_sessions' ELSE 'peer_sessions' END,
      r.source_activity_id, NULL, r.source_activity_id, false
    FROM public.session_learning_reflections r
    JOIN me ON r.enrollment_id = me.enrollment_id
    LEFT JOIN public.coachee_peer_sessions cps ON cps.id = r.source_activity_id
    LEFT JOIN public.peer_sessions ps ON ps.id = r.source_activity_id
    WHERE r.source_activity_type = 'peer_coaching'
      AND (cps.id IS NOT NULL OR ps.id IS NOT NULL)
      AND nullif(btrim(r.body), '') IS NOT NULL

    UNION ALL
    SELECT 'peer_session_rating', 'coachee_peer_sessions', cps.id, 'peer_coaching', coalesce(cps.receiver_rated_at, cps.start_time), cps.topic,
      btrim(cps.receiver_rating_comment), NULL, cps.receiver_rating, NULL,
      'coachee_peer_sessions', cps.id, NULL, cps.id, false
    FROM public.coachee_peer_sessions cps
    JOIN me ON cps.enrollment_id = me.enrollment_id AND cps.peer_receiver_id = me.user_id
    WHERE nullif(btrim(cps.receiver_rating_comment), '') IS NOT NULL

    UNION ALL
    SELECT 'peer_session_rating', 'peer_sessions', ps.id, 'peer_coaching', coalesce(ps.coachee_rated_at, ps.start_time), ps.topic,
      btrim(ps.coachee_rating_comment), NULL, ps.coachee_rating, NULL,
      'peer_sessions', ps.id, NULL, ps.id, false
    FROM public.peer_sessions ps
    JOIN me ON ps.enrollment_id = me.enrollment_id AND ps.peer_coachee_id = me.user_id
    WHERE nullif(btrim(ps.coachee_rating_comment), '') IS NOT NULL

    -- Mentoring: the mentee's own reflection from the canonical store.
    UNION ALL
    SELECT 'mentoring_session_reflection', 'mentoring_sessions', ms.id, 'mentoring', ms.start_time, ms.topic,
      btrim(r.body), NULL, NULL, NULL,
      'mentoring_sessions', ms.id, NULL, ms.id, false
    FROM public.session_learning_reflections r
    JOIN me ON r.enrollment_id = me.enrollment_id
    JOIN public.mentoring_sessions ms
      ON ms.id = r.source_activity_id AND ms.enrollment_id = me.enrollment_id AND ms.mentee_id = me.user_id
    WHERE r.source_activity_type = 'mentoring'
      AND nullif(btrim(r.body), '') IS NOT NULL

    -- Triads: the learner's own post-session reflection answers (one
    -- submission per session and enrollment; answers per stable question).
    UNION ALL
    SELECT 'triad_reflection', 'triad_reflections', trf.id, 'triads', trf.submitted_at, NULL::text,
      ans.body,
      jsonb_strip_nulls(jsonb_build_object('answers', ans.answers,
        'session_start_time', ts.scheduled_start_time, 'triad_group_id', ts.triad_group_id,
        'requirement_unit', (SELECT d.ordinal FROM public.triad_groups g
                             JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id
                             WHERE g.id = ts.triad_group_id))),
      trf.satisfaction_rating::numeric, NULL,
      'triad_sessions', trf.triad_session_id, NULL, trf.triad_session_id, false
    FROM public.triad_reflections trf
    JOIN me ON trf.enrollment_id = me.enrollment_id
    CROSS JOIN LATERAL (
      SELECT string_agg(btrim(a.answer_text), E'\n\n' ORDER BY q.display_order, q.id) AS body,
        jsonb_agg(jsonb_build_object(
          'question_id', q.id, 'question_key', q.question_key, 'section', q.section,
          'question', q.label, 'question_vi', q.label_vi, 'answer', btrim(a.answer_text))
          ORDER BY q.display_order, q.id) AS answers
      FROM public.triad_reflection_answers a
      JOIN public.triad_reflection_questions q ON q.id = a.question_id
      WHERE a.triad_reflection_id = trf.id AND nullif(btrim(a.answer_text), '') IS NOT NULL
    ) ans
    LEFT JOIN public.triad_sessions ts ON ts.id = trf.triad_session_id
    WHERE ans.body IS NOT NULL

    UNION ALL
    SELECT 'goal_checkin', 'goal_checkins', gc.id, NULL, gc.created_at, g.title,
      btrim(gc.note), jsonb_build_object('source_activity_type', gc.source_activity_type),
      gc.new_rating::numeric, gc.previous_rating::numeric,
      CASE gc.source_activity_type
        WHEN 'coaching' THEN 'sessions'
        WHEN 'mentoring' THEN 'mentoring_sessions'
        WHEN 'peer_coaching' THEN (
          SELECT CASE WHEN EXISTS (SELECT 1 FROM public.coachee_peer_sessions x WHERE x.id = gc.source_activity_id)
            THEN 'coachee_peer_sessions' ELSE 'peer_sessions' END)
        WHEN 'triad' THEN 'triad_sessions'
        ELSE NULL
      END,
      CASE WHEN gc.source_activity_type IN ('coaching', 'mentoring', 'peer_coaching', 'triad') THEN gc.source_activity_id END,
      gc.goal_id, gc.source_activity_id, false
    FROM public.goal_checkins gc
    JOIN me ON gc.enrollment_id = me.enrollment_id AND gc.actor_user_id = me.user_id
    JOIN public.coachee_goals g ON g.id = gc.goal_id
    WHERE nullif(btrim(gc.note), '') IS NOT NULL

    UNION ALL
    SELECT 'training_reflection', 'reflection_submissions', rs.id, 'training', rs.submitted_at, pr.title,
      string_agg(btrim(ra.answer_text), E'\n\n' ORDER BY rq.sort_order, rq.id),
      jsonb_build_object(
        'answers', jsonb_agg(jsonb_build_object('question', rq.question_text, 'answer', btrim(ra.answer_text)) ORDER BY rq.sort_order, rq.id),
        'confidence_score', rs.confidence_score,
        'reflection_number', pr.reflection_number),
      NULL, NULL,
      NULL, NULL, NULL, rs.reflection_id, false
    FROM public.reflection_submissions rs
    JOIN me ON rs.enrollment_id = me.enrollment_id AND rs.user_id = me.user_id
    JOIN public.programme_reflections pr ON pr.id = rs.reflection_id
    JOIN public.reflection_answers ra ON ra.submission_id = rs.id
    JOIN public.reflection_questions rq ON rq.id = ra.question_id
    WHERE nullif(btrim(ra.answer_text), '') IS NOT NULL
    GROUP BY rs.id, rs.submitted_at, rs.confidence_score, rs.reflection_id, pr.title, pr.reflection_number

    UNION ALL
    SELECT 'quiz_reflection', 'assignment_submissions', asub.id, 'training', asub.submitted_at, a.title,
      btrim(asub.reflection_text), NULL, NULL, NULL,
      NULL, NULL, NULL, asub.assignment_id, false
    FROM public.assignment_submissions asub
    JOIN me ON asub.enrollment_id = me.enrollment_id AND asub.user_id = me.user_id
    JOIN public.assignments a ON a.id = asub.assignment_id
    WHERE nullif(btrim(asub.reflection_text), '') IS NOT NULL

    UNION ALL
    SELECT 'daily_prompt_response', 'daily_prompt_responses', dpr.id, 'training', coalesce(dpr.responded_at, dpr.created_at), dp.prompt_text,
      btrim(dpr.response_text), jsonb_strip_nulls(jsonb_build_object('confidence_score', dpr.confidence_score)), NULL, NULL,
      NULL, NULL, NULL, dpr.daily_prompt_id, false
    FROM public.daily_prompt_responses dpr
    JOIN me ON dpr.enrollment_id = me.enrollment_id AND dpr.user_id = me.user_id
    JOIN public.daily_prompts dp ON dp.id = dpr.daily_prompt_id
    WHERE nullif(btrim(dpr.response_text), '') IS NOT NULL

    UNION ALL
    SELECT 'journey_reflection', 'coachee_reflections', cr.id, NULL, cr.created_at, NULL,
      btrim(cr.body), jsonb_strip_nulls(jsonb_build_object('mood', nullif(btrim(cr.mood), ''))), NULL, NULL,
      NULL, NULL, NULL, NULL, true
    FROM public.coachee_reflections cr
    JOIN me ON cr.enrollment_id = me.enrollment_id AND cr.coachee_id = me.user_id
    WHERE nullif(btrim(cr.body), '') IS NOT NULL
  )
  SELECT f.source_type || ':' || f.source_id::text,
    f.source_type, f.source_table, f.source_id, f.module, f.occurred_at, f.title, f.body, f.details,
    f.rating, f.previous_rating, f.linked_session_table, f.linked_session_id, f.linked_goal_id,
    f.linked_activity_id, f.is_private
  FROM feed f
  ORDER BY f.occurred_at DESC NULLS LAST, f.source_type, f.source_id;
$$;
REVOKE ALL ON FUNCTION public.canonical_reflection_feed(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Verification
-- ---------------------------------------------------------------------------

DO $$
DECLARE n bigint; def text;
BEGIN
  -- Every legacy learner note now exists canonically.
  SELECT count(*) INTO n FROM public.mentoring_sessions m
  WHERE m.enrollment_id IS NOT NULL AND nullif(btrim(coalesce(m.mentee_notes, '')), '') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.session_learning_reflections r
      WHERE r.enrollment_id = m.enrollment_id AND r.source_activity_type = 'mentoring' AND r.source_activity_id = m.id);
  IF n > 0 THEN RAISE EXCEPTION 'Deliverables: % mentee notes were not bridged', n; END IF;

  SELECT count(*) INTO n FROM public.coachee_peer_sessions s
  WHERE s.enrollment_id IS NOT NULL AND nullif(btrim(coalesce(s.receiver_notes, '')), '') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.session_learning_reflections r
      WHERE r.enrollment_id = s.enrollment_id AND r.source_activity_type = 'peer_coaching' AND r.source_activity_id = s.id);
  IF n > 0 THEN RAISE EXCEPTION 'Deliverables: % peer receiver notes were not bridged', n; END IF;

  -- The feed no longer reads the legacy note columns.
  def := pg_get_functiondef('public.canonical_reflection_feed(uuid)'::regprocedure);
  IF def ~ 'mentee_notes' OR def ~ 'receiver_notes' OR def ~ 'ps\.coachee_notes' THEN
    RAISE EXCEPTION 'Deliverables: the reflection feed still reads a legacy note column';
  END IF;

  -- Coaching evidence and engagement are derived from the shared rule.
  IF pg_get_functiondef('public.coaching_session_evidence(uuid)'::regprocedure) !~ 'canonical_session_deliverable_state' THEN
    RAISE EXCEPTION 'Deliverables: coaching_session_evidence is not derived from the shared rule';
  END IF;
  IF pg_get_functiondef('public.canonical_enrollment_engagement(uuid)'::regprocedure) !~ 'canonical_enrollment_satisfaction' THEN
    RAISE EXCEPTION 'Deliverables: engagement satisfaction is not the cross-module aggregate';
  END IF;

  -- Internal engines are not client-callable.
  IF has_function_privilege('authenticated', 'public.canonical_session_deliverable_state(text, uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.canonical_session_deliverables(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.canonical_enrollment_satisfaction(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Deliverables: an internal engine is client-callable';
  END IF;
END $$;
