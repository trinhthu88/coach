-- Peer booking is gated by the cohort rule, and Peer gets the operational
-- lifecycle the other modules already have (Peer canonical cutover, phase 3).
--
-- Phase 2 established WHO may peer with whom. Nothing enforced it: the only
-- server-side gate on a new learner-to-learner session was still the global
-- opt-in flag, so a hand-written PostgREST insert -- or any client that skipped
-- the filtered partner list -- could book across cohorts that were never
-- connected. Frontend filtering is a convenience; this makes it a rule.
--
-- It also closes a defect phase 1 carried over from the pre-canonical model.
-- Mentoring learned this in 20260921110000: requirement ownership has to be
-- LIVE-status-aware, or a cancelled session keeps its requirement forever.
-- peer_session_participants held cohort_requirement_id unconditionally, so:
--
--   book Peer unit 2  ->  participant holds R2
--   cancel it         ->  participant STILL holds R2
--   book again        ->  no free requirement; the unique index refuses R2
--
-- The learner's second Peer unit became permanently unbookable, and
-- canonical_peer_requirement_fulfilment() reported R2 as "booked" forever
-- because it read attribution without reading status.
--
-- Status therefore moves onto the participant row, exactly as it sits on
-- mentoring_sessions, so one partial unique index and one reader can both see
-- it. Nothing is deleted on cancellation: the participant row keeps naming the
-- requirement it was aimed at, and simply stops owning it.

-- ---------------------------------------------------------------------------
-- 1. Participation carries the session's status
-- ---------------------------------------------------------------------------
--
-- A denormalisation, deliberately. The alternative -- NULLing
-- cohort_requirement_id on cancellation -- destroys the record of what the
-- meeting was for, and "do not erase history" outranks "do not denormalise".
-- The column is derived, never supplied: every write path below sets it from
-- the session, and the BEFORE trigger fills it for any path that does not.

-- The default is never the operative value -- the BEFORE trigger overwrites it
-- from the session on every write -- but it keeps the column out of the
-- required set of generated Insert types, so no caller is asked to supply a
-- value that will be ignored.
ALTER TABLE public.peer_session_participants
  ADD COLUMN session_status public.session_status
  DEFAULT 'pending_coach_approval'::public.session_status;

COMMENT ON COLUMN public.peer_session_participants.session_status IS
  'The owning session''s status, mirrored here so requirement ownership can be '
  'status-aware in one index and one reader. Derived, never supplied.';

UPDATE public.peer_session_participants p
   SET session_status = s.status
  FROM public.peer_sessions s
 WHERE p.session_kind = 'peer' AND s.id = p.peer_session_id;

UPDATE public.peer_session_participants p
   SET session_status = s.status
  FROM public.coachee_peer_sessions s
 WHERE p.session_kind = 'coachee_peer' AND s.id = p.peer_session_id;

ALTER TABLE public.peer_session_participants
  ALTER COLUMN session_status SET NOT NULL;

-- Requirement ownership is now LIVE ownership. A cancelled or rescheduled
-- participation no longer occupies the requirement, so the learner can book
-- that unit again; a completed one is terminal and keeps it.
DROP INDEX IF EXISTS public.peer_participants_one_fulfilment_per_requirement;
CREATE UNIQUE INDEX peer_participants_one_fulfilment_per_requirement
  ON public.peer_session_participants (enrollment_id, cohort_requirement_id)
  WHERE enrollment_id IS NOT NULL
    AND cohort_requirement_id IS NOT NULL
    AND session_status IN ('pending_coach_approval'::public.session_status,
                           'confirmed'::public.session_status,
                           'completed'::public.session_status);

-- ---------------------------------------------------------------------------
-- 2. Derivation and propagation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_peer_session_participant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_enr record;
  v_req record;
  v_status public.session_status;
BEGIN
  -- The session must exist in the table its kind names. Reading its status at
  -- the same time is what keeps session_status derived rather than supplied.
  IF NEW.session_kind = 'peer' THEN
    SELECT s.status INTO v_status FROM public.peer_sessions s WHERE s.id = NEW.peer_session_id;
  ELSE
    SELECT s.status INTO v_status FROM public.coachee_peer_sessions s WHERE s.id = NEW.peer_session_id;
  END IF;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Peer session % does not exist in %', NEW.peer_session_id, NEW.session_kind
      USING ERRCODE = '23503';
  END IF;
  NEW.session_status := v_status;

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
    -- The participant's OWN cohort, never their partner's. A cross-cohort Peer
    -- session credits each side against its own schedule.
    IF v_req.cohort_id IS DISTINCT FROM v_enr.cohort_id
       OR v_req.programme_id IS DISTINCT FROM v_enr.programme_id THEN
      RAISE EXCEPTION 'Peer requirement % belongs to another cohort or programme than enrollment %',
        NEW.cohort_requirement_id, NEW.enrollment_id USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- A session's status change reaches its participants. Without this the
-- denormalised column drifts the first time anything is cancelled.
CREATE OR REPLACE FUNCTION public.sync_peer_participant_session_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_kind text := CASE TG_TABLE_NAME WHEN 'peer_sessions' THEN 'peer' ELSE 'coachee_peer' END;
BEGIN
  UPDATE public.peer_session_participants p
     SET session_status = NEW.status
   WHERE p.session_kind = v_kind
     AND p.peer_session_id = NEW.id
     AND p.session_status IS DISTINCT FROM NEW.status;
  RETURN NEW;
END;
$$;

CREATE TRIGGER peer_sessions_sync_participant_status
  AFTER UPDATE OF status ON public.peer_sessions
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.sync_peer_participant_session_status();

CREATE TRIGGER coachee_peer_sessions_sync_participant_status
  AFTER UPDATE OF status ON public.coachee_peer_sessions
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.sync_peer_participant_session_status();

-- ---------------------------------------------------------------------------
-- 3. Attribution picks the next requirement no LIVE participation holds
-- ---------------------------------------------------------------------------

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

  -- The providing side. For learner-to-learner practice the answer is already
  -- known: peer_partner_enrollment() is the very enrollment that made this
  -- person an eligible partner, so the rule that admitted the booking is the
  -- rule that attributes it. only_enrollment_candidate() -- which asks only
  -- "which enrollment covers this DATE" -- disagreed with it whenever the
  -- session fell outside the enrollment window, admitting a booking and then
  -- crediting nobody for the provider's half.
  --
  -- The coach-provided pool keeps only_enrollment_candidate(): its provider is
  -- a Coach who holds no cohort, so there is no eligible-partner enrollment to
  -- resolve, and an ambiguous Coach stays unattributed rather than guessed at.
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

  -- Attribute each side to its own next unheld Peer requirement. "Unheld" now
  -- means "held by no LIVE or completed participation": a requirement whose
  -- only claimant was cancelled is free again.
  FOR r IN
    SELECT p.id AS participant_id, p.enrollment_id
    FROM public.peer_session_participants p
    WHERE p.session_kind = v_kind AND p.peer_session_id = NEW.id
      AND p.enrollment_id IS NOT NULL AND p.cohort_requirement_id IS NULL
      AND p.session_status IN ('pending_coach_approval'::public.session_status,
                               'confirmed'::public.session_status,
                               'completed'::public.session_status)
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
               AND held.cohort_requirement_id = d.id
               AND held.session_status IN ('pending_coach_approval'::public.session_status,
                                           'confirmed'::public.session_status,
                                           'completed'::public.session_status))
         ORDER BY d.ordinal LIMIT 1)
     WHERE t.id = r.participant_id;
  END LOOP;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Canonical fulfilment reads live ownership
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
    -- The LIVE or completed participation THIS enrollment holds against each
    -- requirement. The partial unique index guarantees at most one; a
    -- cancelled or rescheduled participation owns nothing and is skipped, so
    -- the requirement reads as free and can be booked again.
    SELECT p.cohort_requirement_id AS requirement_id, p.session_kind, p.peer_session_id,
      p.session_status::text AS status,
      coalesce(ps.start_time, cps.start_time) AS start_time
    FROM public.peer_session_participants p
    LEFT JOIN public.peer_sessions ps
      ON p.session_kind = 'peer' AND ps.id = p.peer_session_id
    LEFT JOIN public.coachee_peer_sessions cps
      ON p.session_kind = 'coachee_peer' AND cps.id = p.peer_session_id
    WHERE p.enrollment_id = p_enrollment_id
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

-- The diagnostic must be able to say "this participation was cancelled", or a
-- cancelled half-session reads as unexplained malformed data.
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
    p.participant_role, p.session_status::text,
    CASE
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
-- 5. Cohort eligibility is enforced on every write path
-- ---------------------------------------------------------------------------
--
-- Two layers, deliberately different.
--
-- (a) can_book_coachee_peer_session() answers "may I, the signed-in learner,
--     book this?" It is what the UI pre-checks and what the INSERT policy
--     applies, and it necessarily reasons about auth.uid().
--
-- (b) The trigger answers "is this ROW legitimate?", with no reference to who
--     is writing it. That is what makes a service-role or Admin insert subject
--     to the same cohort rule as a learner's booking -- the gap (a) cannot
--     close on its own, because auth.uid() is NULL for those callers.

CREATE OR REPLACE FUNCTION public.can_book_coachee_peer_session(
  p_provider_id uuid,
  p_enrollment_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public, pg_temp
AS $$
DECLARE e public.programme_enrollments; cfg jsonb; limit_count integer; used_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT * INTO e FROM public.programme_enrollments WHERE id=p_enrollment_id AND user_id=auth.uid();
  IF NOT FOUND OR e.status NOT IN ('active'::public.enrollment_status,'at_risk'::public.enrollment_status) THEN RETURN false; END IF;
  IF p_provider_id=auth.uid() THEN RETURN false; END IF;
  -- WHO: the cohort rule. The global opt-in flag is still required -- it lives
  -- inside peer_partner_is_eligible() -- but it is no longer sufficient.
  IF NOT public.peer_partner_is_eligible(p_enrollment_id, p_provider_id) THEN RETURN false; END IF;
  cfg := public.enrollment_module_config(p_enrollment_id,'peer_coaching'::public.programme_module_type);
  IF cfg IS NULL OR NOT EXISTS (SELECT 1 FROM public.programme_modules pm WHERE pm.programme_id=e.programme_id AND pm.module='peer_coaching' AND pm.enabled) THEN RETURN false; END IF;
  limit_count := COALESCE(public.programme_config_integer(cfg,'receive_limit'), public.programme_config_integer(cfg,'monthly_limit'));
  SELECT count(*)::integer INTO used_count FROM public.coachee_peer_sessions
    WHERE enrollment_id=p_enrollment_id AND status IN ('pending_coach_approval','confirmed','completed');
  RETURN limit_count IS NULL OR used_count < limit_count;
END;
$$;

COMMENT ON FUNCTION public.can_book_coachee_peer_session(uuid, uuid) IS
  'Canonical learner-to-learner Peer booking eligibility for one enrollment. '
  'WHO comes from the cohort rule (own cohort plus peer_cohort_permissions, '
  'via peer_partner_is_eligible); the global opt-in flag is necessary but no '
  'longer sufficient.';

-- Caller-agnostic row validity. Removing a cohort grant later does NOT reach
-- existing rows: this fires on INSERT, and on UPDATE only when the people or
-- the enrollment change. A completed cross-cohort session stays valid history
-- after the permission that allowed it is withdrawn -- withdrawal stops future
-- selection, it does not rewrite the past.
CREATE OR REPLACE FUNCTION public.validate_coachee_peer_session_partner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF NEW.peer_provider_id = NEW.peer_receiver_id THEN
    RAISE EXCEPTION 'A Peer session needs two different people' USING ERRCODE = '23514';
  END IF;

  IF NEW.enrollment_id IS NULL THEN
    RAISE EXCEPTION 'A Peer session must name the receiving learner''s enrollment'
      USING ERRCODE = '23502';
  END IF;

  SELECT user_id INTO v_owner FROM public.programme_enrollments WHERE id = NEW.enrollment_id;
  IF v_owner IS DISTINCT FROM NEW.peer_receiver_id THEN
    RAISE EXCEPTION 'Peer session enrollment % does not belong to the receiver', NEW.enrollment_id
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.peer_partner_is_eligible(NEW.enrollment_id, NEW.peer_provider_id) THEN
    RAISE EXCEPTION 'Peer partner % is not eligible for enrollment % (cohort rule)',
      NEW.peer_provider_id, NEW.enrollment_id USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER coachee_peer_sessions_validate_partner
  BEFORE INSERT OR UPDATE OF peer_provider_id, peer_receiver_id, enrollment_id
  ON public.coachee_peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_coachee_peer_session_partner();

-- ---------------------------------------------------------------------------
-- 6. One operational lifecycle, one writer
-- ---------------------------------------------------------------------------
--
-- The statuses are the platform's existing session_status values; no Peer
-- synonym is introduced. Reachable transitions:
--
--   pending_coach_approval -> confirmed   the PROVIDER (or Admin) accepts
--   pending_coach_approval -> cancelled   either participant, or Admin
--   confirmed              -> completed   either participant, or Admin,
--                                         once the session has started
--   confirmed              -> cancelled   either participant, or Admin
--
-- 'rescheduled' is reachable only through the reschedule path, never here.
-- There is no 'no_show' in session_status and none is invented: a meeting that
-- did not happen is cancelled, which is exactly how it already counts (it
-- fulfils nothing and releases its requirement).
--
-- Completion asks ONLY whether the meeting could legitimately have happened.
-- It never asks for a reflection, feedback, a rating, a goal or an action --
-- for either participant. Both sides' requirements are then fulfilled by the
-- same completed session, independently, through phase 1's participant rows.

CREATE OR REPLACE FUNCTION public.transition_peer_session_status(
  p_session_kind text,
  p_session_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_provider uuid;
  v_receiver uuid;
  v_status public.session_status;
  v_start timestamptz;
  v_next public.session_status;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  v_is_admin := public.has_role(v_actor, 'admin'::public.app_role);

  IF p_session_kind NOT IN ('peer', 'coachee_peer') THEN
    RAISE EXCEPTION 'Unknown Peer session kind %', p_session_kind USING ERRCODE = '23514';
  END IF;
  IF p_status NOT IN ('confirmed', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Unsupported Peer transition target %', p_status USING ERRCODE = '23514';
  END IF;
  v_next := p_status::public.session_status;

  IF p_session_kind = 'peer' THEN
    SELECT s.peer_coach_id, s.peer_coachee_id, s.status, s.start_time
      INTO v_provider, v_receiver, v_status, v_start
    FROM public.peer_sessions s WHERE s.id = p_session_id FOR UPDATE;
  ELSE
    SELECT s.peer_provider_id, s.peer_receiver_id, s.status, s.start_time
      INTO v_provider, v_receiver, v_status, v_start
    FROM public.coachee_peer_sessions s WHERE s.id = p_session_id FOR UPDATE;
  END IF;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Peer session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;
  IF NOT (v_is_admin OR v_actor = v_provider OR v_actor = v_receiver) THEN
    RAISE EXCEPTION 'Not authorised to change this Peer session' USING ERRCODE = '42501';
  END IF;

  IF v_next = 'confirmed'::public.session_status THEN
    IF v_status <> 'pending_coach_approval'::public.session_status THEN
      RAISE EXCEPTION 'Only a pending Peer session can be confirmed (status=%)', v_status
        USING ERRCODE = '23514';
    END IF;
    -- The person being asked to deliver accepts; the requester cannot accept
    -- on their behalf.
    IF NOT (v_is_admin OR v_actor = v_provider) THEN
      RAISE EXCEPTION 'Only the peer providing the session, or an Admin, may confirm it'
        USING ERRCODE = '42501';
    END IF;

  ELSIF v_next = 'completed'::public.session_status THEN
    IF v_status <> 'confirmed'::public.session_status THEN
      RAISE EXCEPTION 'Only a confirmed Peer session can be completed (status=%)', v_status
        USING ERRCODE = '23514';
    END IF;
    IF v_start > now() THEN
      RAISE EXCEPTION 'A session cannot be completed before it starts' USING ERRCODE = '23514';
    END IF;
    -- Either participant may record that the meeting happened. Peer practice
    -- has no Coach to be the sole authority, and both sides were there.

  ELSE -- cancelled
    IF v_status NOT IN ('pending_coach_approval'::public.session_status,
                        'confirmed'::public.session_status) THEN
      RAISE EXCEPTION 'Only a live Peer session can be cancelled (status=%)', v_status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- The established escape hatch guard_session_protected_fields() looks for:
  -- status, confirmed_at, cancelled_* are writable by the lifecycle service
  -- and by nothing else.
  PERFORM set_config('app.session_transition', 'on', true);

  IF p_session_kind = 'peer' THEN
    UPDATE public.peer_sessions
       SET status = v_next,
           confirmed_at = CASE WHEN v_next = 'confirmed'::public.session_status THEN now() ELSE confirmed_at END,
           cancelled_at = CASE WHEN v_next = 'cancelled'::public.session_status THEN now() ELSE cancelled_at END,
           cancelled_by = CASE WHEN v_next = 'cancelled'::public.session_status THEN v_actor ELSE cancelled_by END,
           cancel_reason = CASE WHEN v_next = 'cancelled'::public.session_status THEN p_reason ELSE cancel_reason END
     WHERE id = p_session_id;
  ELSE
    UPDATE public.coachee_peer_sessions
       SET status = v_next,
           confirmed_at = CASE WHEN v_next = 'confirmed'::public.session_status THEN now() ELSE confirmed_at END,
           cancelled_at = CASE WHEN v_next = 'cancelled'::public.session_status THEN now() ELSE cancelled_at END,
           cancelled_by = CASE WHEN v_next = 'cancelled'::public.session_status THEN v_actor ELSE cancelled_by END,
           cancel_reason = CASE WHEN v_next = 'cancelled'::public.session_status THEN p_reason ELSE cancel_reason END
     WHERE id = p_session_id;
  END IF;

  -- The participant status trigger propagates; the partial unique index
  -- releases the requirement on cancellation by no longer matching the row.
  RETURN p_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_peer_session_status(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_peer_session_status(text, uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.transition_peer_session_status(text, uuid, text, text) IS
  'THE writer of Peer session status, across both Peer relationship tables. '
  'Operational lifecycle only: completion records that the meeting happened '
  'and never requires a reflection, feedback, rating, goal or action from '
  'either participant.';

-- ---------------------------------------------------------------------------
-- 7. Rescheduling
-- ---------------------------------------------------------------------------
--
-- reattribute_activity_on_reschedule() already knew both Peer tables by name,
-- but was only ever attached to `sessions` and `mentoring_sessions`. A
-- rescheduled Peer session therefore kept reporting against its ORIGINAL
-- cadence milestone. Attaching it here does not create duplicate progress:
-- re-attribution rewrites the one attribution row rather than adding another,
-- and the requirement is untouched by a date change -- the same participation
-- keeps the same requirement, so one meeting still fulfils one unit.

CREATE TRIGGER peer_sessions_reattribute_on_reschedule
  AFTER UPDATE OF start_time ON public.peer_sessions
  FOR EACH ROW
  WHEN (
    OLD.start_time IS DISTINCT FROM NEW.start_time
    AND NEW.status IN ('pending_coach_approval', 'confirmed', 'completed')
  )
  EXECUTE FUNCTION public.reattribute_activity_on_reschedule();

CREATE TRIGGER coachee_peer_sessions_reattribute_on_reschedule
  AFTER UPDATE OF start_time ON public.coachee_peer_sessions
  FOR EACH ROW
  WHEN (
    OLD.start_time IS DISTINCT FROM NEW.start_time
    AND NEW.status IN ('pending_coach_approval', 'confirmed', 'completed')
  )
  EXECUTE FUNCTION public.reattribute_activity_on_reschedule();

-- ---------------------------------------------------------------------------
-- 8. Verification
-- ---------------------------------------------------------------------------

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.peer_session_participants WHERE session_status IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Peer phase 3: % participants carry no session status', n;
  END IF;

  -- Every participant's mirrored status equals its session's real one.
  SELECT count(*) INTO n
  FROM public.peer_session_participants p
  LEFT JOIN public.peer_sessions ps ON p.session_kind = 'peer' AND ps.id = p.peer_session_id
  LEFT JOIN public.coachee_peer_sessions cps ON p.session_kind = 'coachee_peer' AND cps.id = p.peer_session_id
  WHERE p.session_status IS DISTINCT FROM coalesce(ps.status, cps.status);
  IF n > 0 THEN
    RAISE EXCEPTION 'Peer phase 3: % participants disagree with their session status', n;
  END IF;

  IF pg_get_functiondef('public.can_book_coachee_peer_session(uuid,uuid)'::regprocedure)
       !~ 'peer_partner_is_eligible' THEN
    RAISE EXCEPTION 'Peer phase 3: booking eligibility does not apply the cohort rule';
  END IF;

  RAISE NOTICE 'Peer phase 3: % participants (% live/completed), lifecycle writer installed',
    (SELECT count(*) FROM public.peer_session_participants),
    (SELECT count(*) FROM public.peer_session_participants
      WHERE session_status IN ('pending_coach_approval','confirmed','completed'));
END $$;
