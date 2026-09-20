-- Peer participation becomes enrollment-scoped and requirement-attributed
-- (Peer canonical cutover, phase 1).
--
-- A Peer session is one real meeting between two learners, but only ONE of
-- them was ever attributed to a programme:
--
--   peer_sessions.enrollment_id          the peer_coachee (the RECEIVER)
--   coachee_peer_sessions.enrollment_id  the peer_receiver (the RECEIVER)
--
-- (Confirmed from the 20260910161000 backfill, which derived both columns from
-- the receiving side.) The provider's half of every Peer meeting therefore
-- counted toward nobody's progress, and the receiving half reached canonical
-- progress through session_activity_attributions with requirement_due_on NULL
-- -- the same defect fixed for Mentoring in 20260921110000, where an early
-- completed unit silently masks a later overdue one.
--
-- This migration adds participant-level attribution so one real session can
-- satisfy each participant's OWN requirement, independently:
--
--   Peer session S1
--     |-- participant A -> enrollment EA -> cohort requirement A2
--     `-- participant B -> enrollment EB -> cohort requirement B1
--
-- The two requirement ids are never assumed equal, and neither participant
-- ever borrows the other's. The structure deliberately makes no same-cohort
-- assumption, so phase 2's cross-cohort permissions need no schema change.
--
-- Both relationship tables are kept. The audit established they model
-- different relationships (coach-to-coach vs coachee-to-coachee), not two
-- copies of one interaction, so they are canonicalised consistently rather
-- than merged.

-- ---------------------------------------------------------------------------
-- 1. Participant attribution
-- ---------------------------------------------------------------------------
--
-- One shared table across both relationship tables, discriminated by
-- session_kind. A real foreign key cannot span two parents, so the reference
-- is validated by trigger instead; the session ids themselves are untouched,
-- so every existing link, reflection and feedback row keeps working.

CREATE TABLE public.peer_session_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which relationship table peer_session_id points at.
  session_kind text NOT NULL CHECK (session_kind IN ('peer', 'coachee_peer')),
  peer_session_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Whose programme progress this participation belongs to. NULL only for
  -- legacy rows whose enrollment could not be determined without guessing;
  -- new rows are required to carry one (section 5 below).
  enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE CASCADE,
  -- What role they played. Deliberately separate from enrollment: role answers
  -- "what did they do", enrollment answers "whose progress is it".
  participant_role text NOT NULL CHECK (participant_role IN ('provider', 'receiver')),
  -- The Peer requirement THIS participant's enrollment fulfils. Never copied
  -- from the other participant.
  cohort_requirement_id uuid REFERENCES public.cohort_requirement_dates(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One row per person per session.
  CONSTRAINT peer_session_participants_unique
    UNIQUE (session_kind, peer_session_id, user_id)
);

COMMENT ON TABLE public.peer_session_participants IS
  'Enrollment-scoped participation in a Peer session. One real session has one '
  'row per participant, each carrying its own enrollment and its own cohort '
  'Peer requirement, so both sides count independently.';

CREATE INDEX peer_session_participants_session_idx
  ON public.peer_session_participants (session_kind, peer_session_id);
CREATE INDEX peer_session_participants_enrollment_idx
  ON public.peer_session_participants (enrollment_id) WHERE enrollment_id IS NOT NULL;
CREATE INDEX peer_session_participants_requirement_idx
  ON public.peer_session_participants (cohort_requirement_id) WHERE cohort_requirement_id IS NOT NULL;

-- ENROLLMENT-FIRST uniqueness, the lesson from Coaching C1: one enrollment may
-- hold a given Peer requirement once. Not (cohort_requirement_id) alone, which
-- would lock the requirement cohort-wide, and not (user_id, ...), which would
-- let a historical enrollment collide with a current one.
CREATE UNIQUE INDEX peer_participants_one_fulfilment_per_requirement
  ON public.peer_session_participants (enrollment_id, cohort_requirement_id)
  WHERE enrollment_id IS NOT NULL AND cohort_requirement_id IS NOT NULL;

ALTER TABLE public.peer_session_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Peer participants: admin manage"
  ON public.peer_session_participants FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- A learner sees the participant rows of sessions they took part in -- their
-- own, and their partner's identity. This carries no narrative: reflections,
-- feedback and private notes keep their own policies untouched.
--
-- Membership is resolved against the SESSION tables, never against this table:
-- a policy on peer_session_participants that queries peer_session_participants
-- recurses infinitely the moment RLS is actually in force.
CREATE POLICY "Peer participants: participant view"
  ON public.peer_session_participants FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (session_kind = 'peer' AND EXISTS (
          SELECT 1 FROM public.peer_sessions s
          WHERE s.id = peer_session_participants.peer_session_id
            AND auth.uid() IN (s.peer_coach_id, s.peer_coachee_id)))
    OR (session_kind = 'coachee_peer' AND EXISTS (
          SELECT 1 FROM public.coachee_peer_sessions s
          WHERE s.id = peer_session_participants.peer_session_id
            AND auth.uid() IN (s.peer_provider_id, s.peer_receiver_id)))
  );

REVOKE ALL ON public.peer_session_participants FROM anon;
GRANT SELECT ON public.peer_session_participants TO authenticated;

CREATE TRIGGER peer_session_participants_set_updated_at
  BEFORE UPDATE ON public.peer_session_participants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Validation
-- ---------------------------------------------------------------------------
--
-- The requirement must belong to the PARTICIPANT'S OWN cohort and programme
-- and be a Peer requirement. A cross-cohort Peer session never means one
-- participant borrows the other's requirement.

CREATE OR REPLACE FUNCTION public.validate_peer_session_participant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_enr record;
  v_req record;
  v_exists boolean;
BEGIN
  -- The session must exist in the table its kind names.
  IF NEW.session_kind = 'peer' THEN
    SELECT EXISTS (SELECT 1 FROM public.peer_sessions s WHERE s.id = NEW.peer_session_id) INTO v_exists;
  ELSE
    SELECT EXISTS (SELECT 1 FROM public.coachee_peer_sessions s WHERE s.id = NEW.peer_session_id) INTO v_exists;
  END IF;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'Peer session % does not exist in %', NEW.peer_session_id, NEW.session_kind
      USING ERRCODE = '23503';
  END IF;

  IF NEW.enrollment_id IS NOT NULL THEN
    SELECT e.id, e.user_id, e.cohort_id, e.programme_id INTO v_enr
    FROM public.programme_enrollments e WHERE e.id = NEW.enrollment_id;

    -- The enrollment must belong to the participant. This is what stops a
    -- historical enrollment of one user being attached to another's session.
    IF v_enr.user_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'Enrollment % does not belong to participant %', NEW.enrollment_id, NEW.user_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.cohort_requirement_id IS NOT NULL THEN
    IF NEW.enrollment_id IS NULL THEN
      RAISE EXCEPTION 'A Peer requirement cannot be attributed without an enrollment'
        USING ERRCODE = '23514';
    END IF;

    SELECT d.id, d.cohort_id, d.programme_id, d.module INTO v_req
    FROM public.cohort_requirement_dates d WHERE d.id = NEW.cohort_requirement_id;

    IF v_req.id IS NULL THEN
      RAISE EXCEPTION 'Peer requirement % does not exist', NEW.cohort_requirement_id
        USING ERRCODE = '23503';
    END IF;
    IF v_req.module <> 'peer_coaching'::public.programme_module_type THEN
      RAISE EXCEPTION 'Requirement % is not a Peer requirement (module=%)',
        NEW.cohort_requirement_id, v_req.module USING ERRCODE = '23514';
    END IF;
    -- The participant's OWN cohort, never their partner's.
    IF v_req.cohort_id IS DISTINCT FROM v_enr.cohort_id
       OR v_req.programme_id IS DISTINCT FROM v_enr.programme_id THEN
      RAISE EXCEPTION 'Peer requirement % belongs to another cohort or programme than enrollment %',
        NEW.cohort_requirement_id, NEW.enrollment_id USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER peer_session_participants_validate
  BEFORE INSERT OR UPDATE ON public.peer_session_participants
  FOR EACH ROW EXECUTE FUNCTION public.validate_peer_session_participant();

-- ---------------------------------------------------------------------------
-- 3. Backfill participants from the existing sessions
-- ---------------------------------------------------------------------------
--
-- The receiving side's enrollment is recorded on the session already, so it is
-- carried across verbatim -- no inference at all.
--
-- The providing side has never been attributed. only_enrollment_candidate()
-- returns an enrollment only when the user has exactly ONE covering the
-- session date, so an ambiguous provider is left NULL rather than guessed. The
-- diagnostic in section 6 reports those.

INSERT INTO public.peer_session_participants
  (session_kind, peer_session_id, user_id, enrollment_id, participant_role)
SELECT 'peer', s.id, s.peer_coachee_id, s.enrollment_id, 'receiver'
FROM public.peer_sessions s
ON CONFLICT (session_kind, peer_session_id, user_id) DO NOTHING;

INSERT INTO public.peer_session_participants
  (session_kind, peer_session_id, user_id, enrollment_id, participant_role)
SELECT 'peer', s.id, s.peer_coach_id,
  public.only_enrollment_candidate(s.peer_coach_id, NULL, s.start_time::date), 'provider'
FROM public.peer_sessions s
ON CONFLICT (session_kind, peer_session_id, user_id) DO NOTHING;

INSERT INTO public.peer_session_participants
  (session_kind, peer_session_id, user_id, enrollment_id, participant_role)
SELECT 'coachee_peer', s.id, s.peer_receiver_id, s.enrollment_id, 'receiver'
FROM public.coachee_peer_sessions s
ON CONFLICT (session_kind, peer_session_id, user_id) DO NOTHING;

INSERT INTO public.peer_session_participants
  (session_kind, peer_session_id, user_id, enrollment_id, participant_role)
SELECT 'coachee_peer', s.id, s.peer_provider_id,
  public.only_enrollment_candidate(s.peer_provider_id, NULL, s.start_time::date), 'provider'
FROM public.coachee_peer_sessions s
ON CONFLICT (session_kind, peer_session_id, user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Backfill requirement attribution
-- ---------------------------------------------------------------------------
--
-- Within one enrollment, the Nth completed-or-live Peer participation in
-- chronological order fulfils the Nth Peer requirement of its cohort -- the
-- same deterministic convention used for Coaching (20260921180000) and
-- Mentoring (20260921110000). Participations beyond the requirement count, and
-- those whose cohort schedules no Peer, stay unattributed raw activity.

WITH ordered AS (
  SELECT p.id, p.enrollment_id,
    row_number() OVER (
      PARTITION BY p.enrollment_id
      ORDER BY coalesce(ps.start_time, cps.start_time), p.peer_session_id) AS rn
  FROM public.peer_session_participants p
  LEFT JOIN public.peer_sessions ps
    ON p.session_kind = 'peer' AND ps.id = p.peer_session_id
  LEFT JOIN public.coachee_peer_sessions cps
    ON p.session_kind = 'coachee_peer' AND cps.id = p.peer_session_id
  WHERE p.enrollment_id IS NOT NULL
    AND p.cohort_requirement_id IS NULL
    AND coalesce(ps.status, cps.status) IN
        ('pending_coach_approval', 'confirmed', 'completed')
), reqs AS (
  SELECT e.id AS enrollment_id, d.id AS requirement_id,
    row_number() OVER (PARTITION BY e.id ORDER BY d.ordinal) AS rn
  FROM public.programme_enrollments e
  JOIN public.cohort_requirement_dates d
    ON d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
   AND d.module = 'peer_coaching'::public.programme_module_type
)
UPDATE public.peer_session_participants t
   SET cohort_requirement_id = r.requirement_id
  FROM ordered o
  JOIN reqs r ON r.enrollment_id = o.enrollment_id AND r.rn = o.rn
 WHERE t.id = o.id;

-- ---------------------------------------------------------------------------
-- 5. New sessions get participants automatically, and nothing determinable
--    is left unattributed
-- ---------------------------------------------------------------------------
--
-- Two rules, deliberately separate.
--
-- (a) Every Peer session gets participant rows the moment it is created.
--     Without this, a session created by any path that predates the booking
--     RPC would have no participants, and Peer progress -- which now reads
--     requirement fulfilment -- would silently drop to zero for it. This is
--     the same compatibility bridge Mentoring got in 20260921110000.
--
-- (b) A participant whose enrollment is DETERMINABLE must carry it. A NULL
--     enrollment is only acceptable when the person genuinely has none that
--     covers the session (a Coach delivering peer practice while enrolled in
--     no programme has no programme progress to attribute), or when several
--     enrollments match and choosing would be a guess. Both are reported by
--     the diagnostic rather than invented.

CREATE OR REPLACE FUNCTION public.validate_peer_participant_enrollment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_candidates integer;
  v_when date;
BEGIN
  IF NEW.enrollment_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.session_kind = 'peer' THEN
    SELECT (s.start_time AT TIME ZONE 'UTC')::date INTO v_when
    FROM public.peer_sessions s WHERE s.id = NEW.peer_session_id;
  ELSE
    SELECT (s.start_time AT TIME ZONE 'UTC')::date INTO v_when
    FROM public.coachee_peer_sessions s WHERE s.id = NEW.peer_session_id;
  END IF;

  SELECT count(*) INTO v_candidates
  FROM public.programme_enrollments e
  WHERE e.user_id = NEW.user_id
    AND (v_when IS NULL OR (v_when >= e.start_date AND (e.end_date IS NULL OR v_when <= e.end_date)));

  -- Exactly one candidate means the enrollment was determinable and should
  -- have been recorded. Zero (no programme) and several (ambiguous) are both
  -- legitimate reasons to carry no attribution.
  IF v_candidates = 1 THEN
    RAISE EXCEPTION 'Peer participation for % has a determinable enrollment and must record it', NEW.user_id
      USING ERRCODE = '23502';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER peer_session_participants_require_enrollment
  BEFORE INSERT ON public.peer_session_participants
  FOR EACH ROW EXECUTE FUNCTION public.validate_peer_participant_enrollment();

-- Creates both participant rows for a new Peer session, attributing each side
-- to its own enrollment and its own next free Peer requirement. Each side is
-- resolved independently, so the two participants may sit at different
-- checkpoints and, once phase 2 lands, in different cohorts.
CREATE OR REPLACE FUNCTION public.sync_peer_session_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_kind text := CASE TG_TABLE_NAME WHEN 'peer_sessions' THEN 'peer' ELSE 'coachee_peer' END;
  v_receiver uuid;
  v_provider uuid;
  v_when date := (NEW.start_time AT TIME ZONE 'UTC')::date;
  r record;
BEGIN
  IF TG_TABLE_NAME = 'peer_sessions' THEN
    v_receiver := NEW.peer_coachee_id; v_provider := NEW.peer_coach_id;
  ELSE
    v_receiver := NEW.peer_receiver_id; v_provider := NEW.peer_provider_id;
  END IF;

  -- The receiving side's enrollment is recorded on the session itself.
  INSERT INTO public.peer_session_participants
    (session_kind, peer_session_id, user_id, enrollment_id, participant_role)
  VALUES (v_kind, NEW.id, v_receiver, NEW.enrollment_id, 'receiver')
  ON CONFLICT (session_kind, peer_session_id, user_id) DO UPDATE
    SET enrollment_id = coalesce(public.peer_session_participants.enrollment_id, excluded.enrollment_id);

  INSERT INTO public.peer_session_participants
    (session_kind, peer_session_id, user_id, enrollment_id, participant_role)
  VALUES (v_kind, NEW.id, v_provider,
          public.only_enrollment_candidate(v_provider, NULL, v_when), 'provider')
  ON CONFLICT (session_kind, peer_session_id, user_id) DO UPDATE
    SET enrollment_id = coalesce(public.peer_session_participants.enrollment_id, excluded.enrollment_id);

  -- Attribute each side to its own next unheld Peer requirement.
  FOR r IN
    SELECT p.id AS participant_id, p.enrollment_id
    FROM public.peer_session_participants p
    WHERE p.session_kind = v_kind AND p.peer_session_id = NEW.id
      AND p.enrollment_id IS NOT NULL AND p.cohort_requirement_id IS NULL
  LOOP
    UPDATE public.peer_session_participants t
       SET cohort_requirement_id = (
         SELECT d.id FROM public.cohort_requirement_dates d
         JOIN public.programme_enrollments e ON e.id = r.enrollment_id
         WHERE d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
           AND d.module = 'peer_coaching'::public.programme_module_type
           AND NOT EXISTS (
             SELECT 1 FROM public.peer_session_participants held
             WHERE held.enrollment_id = r.enrollment_id
               AND held.cohort_requirement_id = d.id)
         ORDER BY d.ordinal LIMIT 1)
     WHERE t.id = r.participant_id;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER peer_sessions_sync_participants
  AFTER INSERT OR UPDATE OF enrollment_id ON public.peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.sync_peer_session_participants();

CREATE TRIGGER coachee_peer_sessions_sync_participants
  AFTER INSERT OR UPDATE OF enrollment_id ON public.coachee_peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.sync_peer_session_participants();

-- ---------------------------------------------------------------------------
-- 6. Canonical fulfilment, next requirement, diagnostic
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.canonical_peer_requirement_fulfilment(p_enrollment_id uuid)
RETURNS TABLE (
  requirement_id uuid,
  ordinal integer,
  due_on date,
  fulfilled_on date,
  booked_on date,
  session_kind text,
  peer_session_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH enrollment AS (
    SELECT e.id, e.cohort_id, e.programme_id
    FROM public.programme_enrollments e WHERE e.id = p_enrollment_id
  ), requirements AS (
    SELECT d.id, d.ordinal, d.due_on
    FROM public.cohort_requirement_dates d
    JOIN enrollment e ON e.cohort_id = d.cohort_id AND e.programme_id = d.programme_id
    WHERE d.module = 'peer_coaching'::public.programme_module_type
  ), attributed AS (
    -- The participation THIS enrollment holds against each requirement. The
    -- enrollment-first unique index guarantees at most one.
    SELECT p.cohort_requirement_id AS requirement_id, p.session_kind, p.peer_session_id,
      coalesce(ps.status, cps.status)::text AS status,
      coalesce(ps.start_time, cps.start_time) AS start_time
    FROM public.peer_session_participants p
    LEFT JOIN public.peer_sessions ps
      ON p.session_kind = 'peer' AND ps.id = p.peer_session_id
    LEFT JOIN public.coachee_peer_sessions cps
      ON p.session_kind = 'coachee_peer' AND cps.id = p.peer_session_id
    WHERE p.enrollment_id = p_enrollment_id
      AND p.cohort_requirement_id IS NOT NULL
  )
  SELECT r.id, r.ordinal, r.due_on,
    -- A completed session is the completion evidence. Reflection, feedback,
    -- goals, actions and ratings are post-session artefacts and gate nothing.
    CASE WHEN a.status = 'completed' THEN (a.start_time AT TIME ZONE 'UTC')::date END,
    CASE WHEN a.status IN ('pending_coach_approval', 'confirmed')
         THEN (a.start_time AT TIME ZONE 'UTC')::date END,
    a.session_kind, a.peer_session_id
  FROM requirements r
  LEFT JOIN attributed a ON a.requirement_id = r.id
  ORDER BY r.ordinal;
$$;

REVOKE ALL ON FUNCTION public.canonical_peer_requirement_fulfilment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canonical_peer_requirement_fulfilment(uuid) TO authenticated;

COMMENT ON FUNCTION public.canonical_peer_requirement_fulfilment(uuid) IS
  'THE Peer completion rule: one row per cohort Peer requirement of the '
  'enrollment; a COMPLETED session attributed to that enrollment fulfils its '
  'requirement, once. Each participant of a shared session fulfils their own.';

CREATE OR REPLACE FUNCTION public.next_peer_requirement(p_enrollment_id uuid)
RETURNS TABLE (requirement_id uuid, ordinal integer, due_on date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT f.requirement_id, f.ordinal, f.due_on
  FROM public.canonical_peer_requirement_fulfilment(p_enrollment_id) f
  WHERE f.peer_session_id IS NULL
  ORDER BY f.ordinal
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.next_peer_requirement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_peer_requirement(uuid) TO authenticated;

-- Reports the malformed PARTICIPANT side, not the whole session: one valid and
-- one unattributable participant is a half-attributed real meeting, not a
-- missing one.
CREATE OR REPLACE FUNCTION public.peer_participants_without_requirement()
RETURNS TABLE (
  participant_id uuid,
  session_kind text,
  peer_session_id uuid,
  user_id uuid,
  enrollment_id uuid,
  participant_role text,
  status text,
  reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p.id, p.session_kind, p.peer_session_id, p.user_id, p.enrollment_id,
    p.participant_role, coalesce(ps.status, cps.status)::text,
    CASE
      WHEN p.enrollment_id IS NULL THEN 'participant has no determinable enrollment'
      WHEN NOT EXISTS (
        SELECT 1 FROM public.cohort_requirement_dates d
        JOIN public.programme_enrollments e ON e.id = p.enrollment_id
        WHERE d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
          AND d.module = 'peer_coaching'::public.programme_module_type
      ) THEN 'cohort schedules no Peer requirements'
      ELSE 'more Peer participation than requirements (extra activity)'
    END
  FROM public.peer_session_participants p
  LEFT JOIN public.peer_sessions ps
    ON p.session_kind = 'peer' AND ps.id = p.peer_session_id
  LEFT JOIN public.coachee_peer_sessions cps
    ON p.session_kind = 'coachee_peer' AND cps.id = p.peer_session_id
  WHERE p.cohort_requirement_id IS NULL;
$$;

REVOKE ALL ON FUNCTION public.peer_participants_without_requirement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peer_participants_without_requirement() TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Canonical activity: one row per Peer requirement
-- ---------------------------------------------------------------------------
--
-- Peer stops emitting one row per session attribution (which carried no
-- requirement due date, so an early unit masked a later overdue one) and
-- starts emitting one row per cohort Peer requirement, exactly as Coaching,
-- Mentoring and Triads do. Every other branch is unchanged.
--
-- session_activity_attributions is left writing as it does today for Peer: it
-- still answers "did this activity happen at all", which learner_session_history
-- uses, but it is no longer the requirement authority.

CREATE OR REPLACE FUNCTION public.sponsor_canonical_activity(p_enrollment_id uuid)
RETURNS TABLE(module programme_module_type, occurred_on date, status text, requirement_due_on date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT 'coaching'::public.programme_module_type,
    coalesce(f.fulfilled_on, f.booked_on),
    CASE WHEN f.fulfilled_on IS NOT NULL THEN 'completed' ELSE 'confirmed' END,
    f.due_on
  FROM public.canonical_coaching_requirement_fulfilment(p_enrollment_id) f
  WHERE coalesce(f.fulfilled_on, f.booked_on) IS NOT NULL

  UNION ALL
  -- Peer: one row per cohort Peer requirement, never one per session.
  SELECT 'peer_coaching'::public.programme_module_type,
    coalesce(f.fulfilled_on, f.booked_on),
    CASE WHEN f.fulfilled_on IS NOT NULL THEN 'completed' ELSE 'confirmed' END,
    f.due_on
  FROM public.canonical_peer_requirement_fulfilment(p_enrollment_id) f
  WHERE coalesce(f.fulfilled_on, f.booked_on) IS NOT NULL

  UNION ALL
  SELECT 'mentoring'::public.programme_module_type,
    coalesce(f.fulfilled_on, f.booked_on),
    CASE WHEN f.fulfilled_on IS NOT NULL THEN 'completed' ELSE 'confirmed' END,
    f.due_on
  FROM public.canonical_mentoring_requirement_fulfilment(p_enrollment_id) f
  WHERE coalesce(f.fulfilled_on, f.booked_on) IS NOT NULL

  UNION ALL
  SELECT 'triads'::public.programme_module_type,
    coalesce(f.fulfilled_on, f.booked_on, f.proposed_on),
    CASE WHEN f.fulfilled_on IS NOT NULL THEN 'completed'
         WHEN f.booked_on IS NOT NULL THEN 'confirmed'
         ELSE 'proposed' END,
    f.due_on
  FROM public.canonical_triad_requirement_fulfilment(p_enrollment_id) f
  WHERE coalesce(f.fulfilled_on, f.booked_on, f.proposed_on) IS NOT NULL

  UNION ALL
  SELECT a.module, a.occurred_on, 'completed', NULL::date
  FROM public.session_activity_attributions a
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type IN ('quiz', 'daily_prompt')

  UNION ALL
  SELECT 'training'::public.programme_module_type,
    i.completed_on,
    'completed',
    NULL::date
  FROM public.canonical_training_learning_items(p_enrollment_id, current_date) i
  WHERE i.completed_units > 0
    AND i.completed_on IS NOT NULL;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Verification
-- ---------------------------------------------------------------------------

DO $$
DECLARE n bigint; bad text;
BEGIN
  -- No requirement attributed to an enrollment of another cohort.
  SELECT string_agg(p.id::text, ', ') INTO bad
  FROM public.peer_session_participants p
  JOIN public.programme_enrollments e ON e.id = p.enrollment_id
  JOIN public.cohort_requirement_dates d ON d.id = p.cohort_requirement_id
  WHERE d.cohort_id IS DISTINCT FROM e.cohort_id
     OR d.module <> 'peer_coaching'::public.programme_module_type;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Peer phase 1: participants attributed outside their own cohort: %', bad;
  END IF;

  -- Every participant's enrollment belongs to that participant.
  SELECT count(*) INTO n
  FROM public.peer_session_participants p
  JOIN public.programme_enrollments e ON e.id = p.enrollment_id
  WHERE e.user_id IS DISTINCT FROM p.user_id;
  IF n > 0 THEN
    RAISE EXCEPTION 'Peer phase 1: % participants hold another user''s enrollment', n;
  END IF;

  -- Peer activity must now carry a requirement due date wherever it is
  -- attributed, so an early unit can no longer mask a later overdue one.
  IF pg_get_functiondef('public.sponsor_canonical_activity(uuid)'::regprocedure)
       !~ 'canonical_peer_requirement_fulfilment' THEN
    RAISE EXCEPTION 'Peer phase 1: canonical activity does not read Peer requirement fulfilment';
  END IF;

  RAISE NOTICE 'Peer phase 1: % participant rows, % without an enrollment, % without a requirement',
    (SELECT count(*) FROM public.peer_session_participants),
    (SELECT count(*) FROM public.peer_session_participants WHERE enrollment_id IS NULL),
    (SELECT count(*) FROM public.peer_session_participants WHERE cohort_requirement_id IS NULL);
END $$;
