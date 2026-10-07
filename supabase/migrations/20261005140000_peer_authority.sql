-- Peer authority (L-6, P-3, D-5).
--
-- Only an Admin-assigned dyad session (coachee_peer_sessions, whose partner
-- validate_coachee_peer_session_partner checks against the receiver's active
-- dyad) earns a Peer requirement. A session booked from the Coach opt-in pool
-- (peer_sessions) is practice: it keeps its participants -- so each person's
-- Sessions hub still files it under their own enrollment -- but it never holds
-- a requirement.
--
-- Before this, sync_peer_session_participants attributed both kinds, so a
-- learner who booked practice with any opted-in Coach completed Peer units
-- the programme meant to be earned with their assigned partner, and the
-- partner then found every unit already held.
--
-- 1. peer_attribute_participant_internal: THE attribution step, dyad sessions
--    only. sync_peer_session_participants calls it.
-- 2. A CHECK keeps practice participations requirement-free.
-- 3. Existing practice participations release their requirements, and the
--    dyad participations those requirements had crowded out are attributed
--    in session order.
-- 4. canonical_peer_requirement_fulfilment counts dyad participations only;
--    peer_participants_without_requirement names practice as the reason.

-- ---------------------------------------------------------------------------
-- 1. Attribution: dyad sessions only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.peer_attribute_participant_internal(p_participant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE p public.peer_session_participants;
BEGIN
  SELECT * INTO p FROM public.peer_session_participants WHERE id = p_participant_id;
  IF NOT FOUND
     OR p.session_kind <> 'coachee_peer'
     OR p.enrollment_id IS NULL
     OR p.cohort_requirement_id IS NOT NULL
     OR p.session_status NOT IN ('pending_coach_approval'::public.session_status,
                                 'confirmed'::public.session_status,
                                 'completed'::public.session_status) THEN
    RETURN;
  END IF;

  -- The participant's own next requirement held by no LIVE or completed
  -- participation: a requirement whose only claimant was cancelled is free.
  UPDATE public.peer_session_participants t
     SET cohort_requirement_id = (
       SELECT d.id FROM public.cohort_requirement_dates d
       JOIN public.programme_enrollments e ON e.id = p.enrollment_id
       WHERE d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
         AND d.module = 'peer_coaching'::public.programme_module_type
         AND NOT EXISTS (
           SELECT 1 FROM public.peer_session_participants held
           WHERE held.enrollment_id = p.enrollment_id
             AND held.cohort_requirement_id = d.id
             AND held.session_status IN ('pending_coach_approval'::public.session_status,
                                         'confirmed'::public.session_status,
                                         'completed'::public.session_status))
       ORDER BY d.ordinal LIMIT 1)
   WHERE t.id = p.id;
END;
$$;

REVOKE ALL ON FUNCTION public.peer_attribute_participant_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.peer_attribute_participant_internal(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_peer_session_participants()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind text := CASE TG_TABLE_NAME WHEN 'peer_sessions' THEN 'peer' ELSE 'coachee_peer' END;
  v_receiver uuid;
  v_provider uuid;
  v_when date := (NEW.start_time AT TIME ZONE 'UTC')::date;
  v_provider_enrollment uuid;
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

  -- The providing side. In a dyad session the partner's enrollment is the
  -- one that made them the receiver's assigned partner. A practice session's
  -- provider is a Coach who holds no cohort: only_enrollment_candidate()
  -- leaves an ambiguous Coach unattributed rather than guessing.
  IF v_kind = 'coachee_peer' THEN
    v_provider_enrollment := public.peer_partner_enrollment(NEW.enrollment_id, v_provider);
  ELSE
    v_provider_enrollment := public.only_enrollment_candidate(v_provider, NULL, v_when);
  END IF;

  INSERT INTO public.peer_session_participants
    (session_kind, peer_session_id, user_id, enrollment_id, participant_role)
  VALUES (v_kind, NEW.id, v_provider, v_provider_enrollment, 'provider')
  ON CONFLICT (session_kind, peer_session_id, user_id) DO UPDATE
    SET enrollment_id = coalesce(public.peer_session_participants.enrollment_id, excluded.enrollment_id);

  -- Only a dyad session earns a Peer requirement (20261005140000). Practice
  -- from the Coach opt-in pool keeps its participants and holds none.
  IF v_kind = 'coachee_peer' THEN
    FOR r IN
      SELECT p.id FROM public.peer_session_participants p
      WHERE p.session_kind = v_kind AND p.peer_session_id = NEW.id
    LOOP
      PERFORM public.peer_attribute_participant_internal(r.id);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2 + 3. Practice releases its requirements; dyad sessions take them
-- ---------------------------------------------------------------------------
UPDATE public.peer_session_participants
   SET cohort_requirement_id = NULL
 WHERE session_kind = 'peer' AND cohort_requirement_id IS NOT NULL;

ALTER TABLE public.peer_session_participants
  DROP CONSTRAINT IF EXISTS peer_practice_holds_no_requirement;
ALTER TABLE public.peer_session_participants
  ADD CONSTRAINT peer_practice_holds_no_requirement
  CHECK (session_kind = 'coachee_peer' OR cohort_requirement_id IS NULL);

DO $reattribute$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.id
    FROM public.peer_session_participants p
    JOIN public.coachee_peer_sessions s ON s.id = p.peer_session_id
    WHERE p.session_kind = 'coachee_peer'
      AND p.enrollment_id IS NOT NULL
      AND p.cohort_requirement_id IS NULL
      AND p.session_status IN ('pending_coach_approval'::public.session_status,
                               'confirmed'::public.session_status,
                               'completed'::public.session_status)
    ORDER BY s.start_time, s.id, p.id
  LOOP
    PERFORM public.peer_attribute_participant_internal(r.id);
  END LOOP;
END
$reattribute$;

-- ---------------------------------------------------------------------------
-- 4. Readers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_peer_requirement_fulfilment(p_enrollment_id uuid)
RETURNS TABLE (requirement_id uuid, ordinal integer, due_on date, fulfilled_on date, booked_on date,
               session_kind text, peer_session_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
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
    -- The LIVE or completed DYAD participation this enrollment holds against
    -- each requirement. Practice from the Coach opt-in pool holds none
    -- (peer_practice_holds_no_requirement); a cancelled or rescheduled
    -- participation owns nothing, so the requirement reads as free.
    SELECT p.cohort_requirement_id AS requirement_id, p.session_kind, p.peer_session_id,
      p.session_status::text AS status, cps.start_time
    FROM public.peer_session_participants p
    JOIN public.coachee_peer_sessions cps ON cps.id = p.peer_session_id
    WHERE p.enrollment_id = p_enrollment_id
      AND p.session_kind = 'coachee_peer'
      AND p.cohort_requirement_id IS NOT NULL
      AND p.session_status IN ('pending_coach_approval'::public.session_status,
                               'confirmed'::public.session_status,
                               'completed'::public.session_status)
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

CREATE OR REPLACE FUNCTION public.peer_participants_without_requirement()
RETURNS TABLE (participant_id uuid, session_kind text, peer_session_id uuid, user_id uuid,
               enrollment_id uuid, participant_role text, status text, reason text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.session_kind, p.peer_session_id, p.user_id, p.enrollment_id,
    p.participant_role, p.session_status::text,
    CASE
      WHEN p.session_kind = 'peer'
        THEN 'practice session (Coach opt-in pool): earns no Peer requirement'
      WHEN p.session_status NOT IN ('pending_coach_approval'::public.session_status,
                                    'confirmed'::public.session_status,
                                    'completed'::public.session_status)
        THEN 'session is not live, so it holds no requirement'
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
  WHERE p.cohort_requirement_id IS NULL;
$$;

-- ---------------------------------------------------------------------------
-- 5. Final-state guard
-- ---------------------------------------------------------------------------
DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.peer_session_participants
             WHERE session_kind = 'peer' AND cohort_requirement_id IS NOT NULL) THEN
    RAISE EXCEPTION 'A practice Peer session still holds a requirement';
  END IF;
END
$verify$;
