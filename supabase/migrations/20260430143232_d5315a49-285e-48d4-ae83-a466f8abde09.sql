
-- 1. Peer coaching opt-in on coach profiles
ALTER TABLE public.coach_profiles
  ADD COLUMN IF NOT EXISTS peer_coaching_opt_in BOOLEAN NOT NULL DEFAULT false;

-- 2. Slot type on availability (coaching | peer)
DO $$ BEGIN
  CREATE TYPE public.availability_slot_type AS ENUM ('coaching', 'peer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.coach_availability
  ADD COLUMN IF NOT EXISTS slot_type public.availability_slot_type NOT NULL DEFAULT 'coaching';

-- 3. peer_sessions table (mirror of sessions, separate space)
CREATE TABLE IF NOT EXISTS public.peer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  peer_coach_id UUID NOT NULL,           -- the coach providing peer coaching
  peer_coachee_id UUID NOT NULL,         -- the coach receiving peer coaching
  slot_id UUID,
  topic TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status public.session_status NOT NULL DEFAULT 'pending_coach_approval',
  meeting_url TEXT,
  coach_notes TEXT,
  coach_private_notes TEXT,
  coachee_notes TEXT,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID,
  cancel_reason TEXT,
  coachee_rating SMALLINT,
  coachee_rating_comment TEXT,
  coachee_rated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.peer_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Peer sessions: participants view"
  ON public.peer_sessions FOR SELECT TO authenticated
  USING (auth.uid() = peer_coach_id OR auth.uid() = peer_coachee_id);

CREATE POLICY "Peer sessions: admin view all"
  ON public.peer_sessions FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Peer sessions: peer-coachee create own"
  ON public.peer_sessions FOR INSERT TO authenticated
  WITH CHECK (peer_coachee_id = auth.uid() AND has_role(auth.uid(), 'coach'::app_role));

CREATE POLICY "Peer sessions: peer-coach update own"
  ON public.peer_sessions FOR UPDATE TO authenticated
  USING (peer_coach_id = auth.uid());

CREATE POLICY "Peer sessions: peer-coachee update own"
  ON public.peer_sessions FOR UPDATE TO authenticated
  USING (peer_coachee_id = auth.uid());

CREATE POLICY "Peer sessions: admin manage"
  ON public.peer_sessions FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER peer_sessions_updated_at
  BEFORE UPDATE ON public.peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER peer_sessions_validate_duration
  BEFORE INSERT OR UPDATE ON public.peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_session_duration();

CREATE TRIGGER peer_sessions_validate_rating
  BEFORE INSERT OR UPDATE ON public.peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_session_rating();

CREATE INDEX IF NOT EXISTS idx_peer_sessions_peer_coach ON public.peer_sessions(peer_coach_id);
CREATE INDEX IF NOT EXISTS idx_peer_sessions_peer_coachee ON public.peer_sessions(peer_coachee_id);
CREATE INDEX IF NOT EXISTS idx_peer_sessions_start ON public.peer_sessions(start_time);

-- 4. Allowlist for coaches acting as coachees (admin-curated)
CREATE TABLE IF NOT EXISTS public.coach_as_coachee_allowlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id UUID NOT NULL,            -- the coach who is being coached
  selectable_coach_id UUID NOT NULL,      -- the coach they may book
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (coach_user_id, selectable_coach_id)
);

ALTER TABLE public.coach_as_coachee_allowlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "CoachAsCoacheeAllowlist: admin manage"
  ON public.coach_as_coachee_allowlist FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "CoachAsCoacheeAllowlist: coach view own"
  ON public.coach_as_coachee_allowlist FOR SELECT TO authenticated
  USING (coach_user_id = auth.uid());

CREATE POLICY "CoachAsCoacheeAllowlist: selected view own"
  ON public.coach_as_coachee_allowlist FOR SELECT TO authenticated
  USING (selectable_coach_id = auth.uid());

-- 5. Coach session limit (when coach acts as coachee)
CREATE TABLE IF NOT EXISTS public.coach_session_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id UUID UNIQUE,              -- NULL row = global default
  monthly_limit INTEGER NOT NULL DEFAULT 4,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.coach_session_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coach session limits: admin all"
  ON public.coach_session_limits FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Coach session limits: coach view own"
  ON public.coach_session_limits FOR SELECT TO authenticated
  USING (coach_user_id = auth.uid() OR coach_user_id IS NULL);

CREATE TRIGGER coach_session_limits_updated_at
  BEFORE UPDATE ON public.coach_session_limits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
