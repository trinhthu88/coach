-- Part 1 of the "extend peer coaching to coachees" task: a second, separate
-- pool for coachee-to-coachee peer practice, structurally parallel to the
-- existing coach-to-coach peer_sessions pool but NOT merged with it — see
-- RULES.md §3 Relationship 3 for the coach pool this mirrors.
--
-- New mirror table (coachee_peer_sessions) rather than generalizing
-- peer_sessions, per this repo's one-table-per-relationship convention
-- (sessions vs. peer_sessions already follows this) and to avoid auditing
-- every existing peer_sessions consumer (useSessionPeerFeedback.ts,
-- CoachPeerCoaching.tsx, dashboards, alert scans) for a hardcoded
-- coach-only assumption on peer_coach_id/peer_coachee_id.
--
-- Column names: peer_provider_id / peer_receiver_id instead of
-- peer_coach_id / peer_coachee_id (both parties are coachees here, so
-- "coach"/"coachee" labels would be confusing) — provider plays the
-- coaching role for the session, receiver plays the client role and is the
-- one who books (mirrors peer_coachee_id = auth.uid() on insert in the
-- coach pool). Notes/rating columns renamed to match (provider_notes,
-- provider_private_notes, receiver_notes, receiver_rating*).
--
-- Opt-in flag lives directly on public.profiles (simpler than a dedicated
-- table for a single boolean; unused/ignored for coach-role rows, which
-- keep using coach_profiles.peer_coaching_opt_in unchanged).
--
-- Coachees have no availability-publishing mechanism today (coach_availability
-- is coach-only). Built one (coachee_availability) mirroring the coach
-- model exactly, per explicit confirmation, rather than a slot-less
-- propose-a-time flow — so coachee_peer_sessions.slot_id reuses the same
-- partial-unique-index double-booking-prevention pattern (RULES.md §5) the
-- coach pool uses.

ALTER TABLE public.profiles
  ADD COLUMN peer_coaching_opt_in BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- coachee_availability (mirrors coach_availability, single-purpose: this
-- pool only ever needs one slot "type", so no slot_type column)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.coachee_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coachee_id UUID NOT NULL,
  slot_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_booked BOOLEAN NOT NULL DEFAULT false,
  session_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coachee_availability_time_valid CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_coachee_availability_coachee_date
  ON public.coachee_availability (coachee_id, slot_date);

ALTER TABLE public.coachee_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "CoacheeAvailability: coachee manage own"
ON public.coachee_availability
FOR ALL TO authenticated
USING (coachee_id = auth.uid() AND public.has_role(auth.uid(), 'coachee'::app_role))
WITH CHECK (coachee_id = auth.uid() AND public.has_role(auth.uid(), 'coachee'::app_role));

CREATE POLICY "CoacheeAvailability: admin manage all"
ON public.coachee_availability
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Mirrors "Availability: authenticated view" (coach_availability): visible
-- to any authenticated user once the coachee's profile is active. Opt-in
-- status is NOT checked here (matching the coach pool) — the actual
-- booking-eligibility gate is the INSERT policy below, and the frontend
-- list page (CoacheePeerPractice.tsx) filters opt-in candidates before a
-- user ever reaches a booking page.
CREATE POLICY "CoacheeAvailability: authenticated view"
ON public.coachee_availability
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = coachee_availability.coachee_id AND p.status = 'active'::user_status
  )
);

CREATE TRIGGER trg_coachee_availability_updated
BEFORE UPDATE ON public.coachee_availability
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- coachee_peer_sessions (mirrors peer_sessions column-for-column, renamed
-- as described in the header comment)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.coachee_peer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  peer_provider_id UUID NOT NULL,   -- the coachee providing peer practice (playing the coaching role)
  peer_receiver_id UUID NOT NULL,   -- the coachee receiving peer practice (books the session)
  slot_id UUID,
  topic TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status public.session_status NOT NULL DEFAULT 'pending_coach_approval',
  meeting_url TEXT,
  provider_notes TEXT,
  provider_private_notes TEXT,
  receiver_notes TEXT,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID,
  cancel_reason TEXT,
  receiver_rating SMALLINT,
  receiver_rating_comment TEXT,
  receiver_rated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.coachee_peer_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "CoacheePeerSessions: participants view"
  ON public.coachee_peer_sessions FOR SELECT TO authenticated
  USING (auth.uid() = peer_provider_id OR auth.uid() = peer_receiver_id);

CREATE POLICY "CoacheePeerSessions: admin view all"
  ON public.coachee_peer_sessions FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Mirrors "Peer sessions: peer-coachee create own" +
-- 20260810121500_enforce_peer_opt_in.sql's opt-in check, folded into one
-- policy from the start (peer_sessions got the opt-in check retrofitted
-- later; no need to repeat that history here).
CREATE POLICY "CoacheePeerSessions: receiver create own"
  ON public.coachee_peer_sessions FOR INSERT TO authenticated
  WITH CHECK (
    peer_receiver_id = auth.uid()
    AND public.has_role(auth.uid(), 'coachee'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = coachee_peer_sessions.peer_provider_id AND p.peer_coaching_opt_in = true
    )
  );

CREATE POLICY "CoacheePeerSessions: provider update own"
  ON public.coachee_peer_sessions FOR UPDATE TO authenticated
  USING (peer_provider_id = auth.uid());

CREATE POLICY "CoacheePeerSessions: receiver update own"
  ON public.coachee_peer_sessions FOR UPDATE TO authenticated
  USING (peer_receiver_id = auth.uid());

CREATE POLICY "CoacheePeerSessions: admin manage"
  ON public.coachee_peer_sessions FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER coachee_peer_sessions_updated_at
  BEFORE UPDATE ON public.coachee_peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- validate_session_duration() only reads NEW.duration_minutes (table-agnostic,
-- already reused by mentoring_sessions) — safe to reuse verbatim.
CREATE TRIGGER coachee_peer_sessions_validate_duration
  BEFORE INSERT OR UPDATE ON public.coachee_peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_session_duration();

-- validate_session_rating() hardcodes NEW.coachee_rating (peer_sessions
-- deliberately kept that exact column name so it could reuse this trigger
-- unchanged) — this table's rating column is named receiver_rating instead
-- (clearer given both parties are coachees), so it needs its own trigger
-- rather than forcing a column-name match onto an otherwise-unrelated
-- shared function.
CREATE OR REPLACE FUNCTION public.validate_coachee_peer_session_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.receiver_rating IS NOT NULL AND (NEW.receiver_rating < 1 OR NEW.receiver_rating > 5) THEN
    RAISE EXCEPTION 'receiver_rating must be between 1 and 5';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER coachee_peer_sessions_validate_rating
  BEFORE INSERT OR UPDATE ON public.coachee_peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_coachee_peer_session_rating();

CREATE UNIQUE INDEX IF NOT EXISTS coachee_peer_sessions_slot_id_unique
  ON public.coachee_peer_sessions (slot_id) WHERE slot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coachee_peer_sessions_provider ON public.coachee_peer_sessions(peer_provider_id);
CREATE INDEX IF NOT EXISTS idx_coachee_peer_sessions_receiver ON public.coachee_peer_sessions(peer_receiver_id);
CREATE INDEX IF NOT EXISTS idx_coachee_peer_sessions_start ON public.coachee_peer_sessions(start_time);
