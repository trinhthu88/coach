-- Coaching sessions become explicit about which cohort requirement they fulfil,
-- and availability slots are RESERVED instead of destroyed (Coaching redesign,
-- deployment 1).
--
-- Two problems this fixes.
--
-- 1. Requirement attribution was implicit. A Coaching session recorded only
--    enrollment_id, so "is this Coaching #1 or #2" could only be inferred from
--    chronological order. sessions.cohort_requirement_id now states it, using
--    the same generic cohort_requirement_dates object the Triad requirement
--    groups use. No Coaching-specific deadline table is introduced.
--
-- 2. Booking destroyed the availability slot. trg_sessions_remove_booked_slot
--    ran AFTER INSERT and DELETEd the coach_availability row outright, so a
--    cancelled session could never give the slot back -- the row was gone. In
--    production this left 4 sessions pointing at deleted slots and 0 sessions
--    with a surviving slot. Slots are now reserved (is_booked = true plus a
--    session_id back-reference) from the moment a request is created, and
--    released when it is cancelled. The destructive trigger is removed.
--
-- Slots deleted by the old behaviour are not resurrected; that data is gone.
-- Affected historical sessions keep their slot_id as a dangling reference and
-- are reported by the audit query at the end of this file.

-- ---------------------------------------------------------------------------
-- 1. Requirement + cohort columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.sessions
  ADD COLUMN cohort_requirement_id uuid REFERENCES public.cohort_requirement_dates(id) ON DELETE RESTRICT,
  -- Denormalised for integrity and for cheap cohort-scoped reads. It is never
  -- accepted from a caller: the trigger below overwrites it from the
  -- enrollment, so it cannot become a second, independent cohort identity.
  ADD COLUMN cohort_id uuid REFERENCES public.cohorts(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.sessions.cohort_requirement_id IS
  'The cohort Coaching requirement (cohort_requirement_dates) this session fulfils. '
  'Server-assigned and validated; never trusted from the client.';
COMMENT ON COLUMN public.sessions.cohort_id IS
  'Mirror of programme_enrollments.cohort_id for sessions.enrollment_id. '
  'Server-assigned; never accepted from a caller.';

CREATE INDEX sessions_cohort_requirement_idx
  ON public.sessions (cohort_requirement_id) WHERE cohort_requirement_id IS NOT NULL;
CREATE INDEX sessions_cohort_idx
  ON public.sessions (cohort_id) WHERE cohort_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Live-session uniqueness (section 35 / section 34)
-- ---------------------------------------------------------------------------

-- One Coaching requirement may hold at most one live session. A cancelled or
-- rescheduled session does not reserve the requirement, so the learner can
-- immediately book again.
CREATE UNIQUE INDEX sessions_one_live_session_per_requirement
  ON public.sessions (cohort_requirement_id)
  WHERE cohort_requirement_id IS NOT NULL
    AND status IN ('pending_coach_approval', 'confirmed');

-- A slot may be owned by at most one live session. This is the database-level
-- half of double-booking prevention; the booking function below supplies the
-- locking half.
CREATE UNIQUE INDEX sessions_one_live_session_per_slot
  ON public.sessions (slot_id)
  WHERE slot_id IS NOT NULL
    AND status IN ('pending_coach_approval', 'confirmed');

-- The legacy index was unique on slot_id across EVERY status, so once a slot
-- had been used it could never be booked again -- a cancelled session kept
-- holding it forever. That was invisible while booking deleted the slot row
-- outright (nothing survived to rebook), but it directly defeats the release
-- semantics this migration introduces: section 13 requires a cancelled
-- session's slot to become available again.
--
-- sessions_one_live_session_per_slot is the same guarantee restricted to live
-- sessions, so dropping this loses no protection against double-booking.
DROP INDEX IF EXISTS public.sessions_slot_id_unique;

-- ---------------------------------------------------------------------------
-- 3. Cross-table validation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_coaching_session_requirement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_enrollment_cohort uuid;
  v_req record;
BEGIN
  IF NEW.enrollment_id IS NULL THEN
    RETURN NEW;  -- validate_session_enrollment_booking already rejects this.
  END IF;

  SELECT e.cohort_id INTO v_enrollment_cohort
  FROM public.programme_enrollments e WHERE e.id = NEW.enrollment_id;

  -- cohort_id is derived, never supplied.
  NEW.cohort_id := v_enrollment_cohort;

  IF NEW.cohort_requirement_id IS NOT NULL THEN
    SELECT d.id, d.cohort_id, d.module INTO v_req
    FROM public.cohort_requirement_dates d WHERE d.id = NEW.cohort_requirement_id;

    IF v_req.id IS NULL THEN
      RAISE EXCEPTION 'Coaching requirement % does not exist', NEW.cohort_requirement_id
        USING ERRCODE = '23503';
    END IF;

    IF v_req.module <> 'coaching'::public.programme_module_type THEN
      RAISE EXCEPTION 'Session requirement % is not a coaching requirement (module=%)',
        NEW.cohort_requirement_id, v_req.module USING ERRCODE = '23514';
    END IF;

    IF v_req.cohort_id IS DISTINCT FROM v_enrollment_cohort THEN
      RAISE EXCEPTION 'Coaching requirement belongs to cohort %, enrollment belongs to cohort %',
        v_req.cohort_id, v_enrollment_cohort USING ERRCODE = '42501';
    END IF;
  END IF;

  -- The Coach must be in the cohort Coach pool. Checked on the session itself
  -- so a direct table write cannot bypass the booking function (section 34:
  -- not frontend-only, not RPC-only).
  --
  -- Only newly-created bookings, a Coach reassignment, or a revival back into
  -- a live state are gated. Updating an already-live session that predates the
  -- Coach pool -- cancelling it, rating it, marking it complete -- must not be
  -- blocked, or this migration would freeze the 22 confirmed sessions that
  -- exist when it runs. Those rows were created under the allowlist model and
  -- are grandfathered by the backfill in 20260920100000, not by an exemption.
  IF v_enrollment_cohort IS NOT NULL
     AND NEW.status IN ('pending_coach_approval', 'confirmed')
     AND (
       TG_OP = 'INSERT'
       OR NEW.coach_id IS DISTINCT FROM OLD.coach_id
       OR OLD.status NOT IN ('pending_coach_approval', 'confirmed')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.cohort_coaching_coach_pool(v_enrollment_cohort) p
       WHERE p.coach_id = NEW.coach_id
     ) THEN
    RAISE EXCEPTION 'Coach % is not in the Coach pool for cohort %', NEW.coach_id, v_enrollment_cohort
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sessions_validate_coaching_requirement
  BEFORE INSERT OR UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_coaching_session_requirement();

-- ---------------------------------------------------------------------------
-- 4. Slot reservation replaces slot deletion
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_sessions_remove_booked_slot ON public.sessions;

-- The old function is kept (not dropped) so historical migrations that
-- reference it still resolve, but nothing calls it any more.
COMMENT ON FUNCTION public.delete_booked_availability_slot() IS
  'RETIRED 2026-09-20 (Coaching redesign). Destroyed the availability slot on '
  'booking, making cancellation unable to release it. Replaced by '
  'sync_coaching_slot_reservation(). Retained for historical compatibility only; '
  'no trigger calls it.';

CREATE OR REPLACE FUNCTION public.sync_coaching_slot_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_live constant text[] := ARRAY['pending_coach_approval', 'confirmed'];
BEGIN
  -- Release the previously held slot when the session stops being live or
  -- moves to a different slot.
  IF TG_OP = 'UPDATE' AND OLD.slot_id IS NOT NULL
     AND (NEW.slot_id IS DISTINCT FROM OLD.slot_id OR NOT (NEW.status::text = ANY(v_live))) THEN
    UPDATE public.coach_availability
      SET is_booked = false, session_id = NULL
      WHERE id = OLD.slot_id AND session_id = OLD.id;
  END IF;

  -- Reserve the current slot while the session is live. Reservation happens at
  -- pending_coach_approval, not at confirmation: the slot is unavailable to
  -- everyone else the moment the request exists.
  IF NEW.slot_id IS NOT NULL AND NEW.status::text = ANY(v_live) THEN
    UPDATE public.coach_availability
      SET is_booked = true, session_id = NEW.id
      WHERE id = NEW.slot_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sessions_sync_slot_reservation
  AFTER INSERT OR UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.sync_coaching_slot_reservation();

-- ---------------------------------------------------------------------------
-- 5. Audit of legacy rows that cannot be attributed (section 33)
-- ---------------------------------------------------------------------------

-- Read-only. Legacy Coaching sessions with no resolvable cohort requirement
-- keep cohort_requirement_id NULL: attribution is not invented. They are
-- excluded from requirement-based completion by construction, so they cannot
-- contaminate current enrollment progress.
CREATE OR REPLACE FUNCTION public.coaching_sessions_without_requirement()
RETURNS TABLE (
  session_id uuid,
  enrollment_id uuid,
  cohort_id uuid,
  status text,
  start_time timestamptz,
  reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT s.id, s.enrollment_id, s.cohort_id, s.status::text, s.start_time,
    CASE
      WHEN s.enrollment_id IS NULL THEN 'no enrollment'
      WHEN s.cohort_id IS NULL THEN 'enrollment has no cohort'
      WHEN NOT EXISTS (
        SELECT 1 FROM public.cohort_requirement_dates d
        WHERE d.cohort_id = s.cohort_id AND d.module = 'coaching'::public.programme_module_type
      ) THEN 'cohort has no coaching requirements'
      ELSE 'unresolved'
    END
  FROM public.sessions s
  WHERE s.cohort_requirement_id IS NULL;
$$;

REVOKE ALL ON FUNCTION public.coaching_sessions_without_requirement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coaching_sessions_without_requirement() TO authenticated;
