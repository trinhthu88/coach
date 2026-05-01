-- 1) Programmes: drop total_sessions, add peer_given_limit
ALTER TABLE public.programmes DROP COLUMN IF EXISTS total_sessions;
ALTER TABLE public.programmes ADD COLUMN IF NOT EXISTS peer_given_limit integer NOT NULL DEFAULT 4;

-- 2) Coach session limits: add peer-given limit
ALTER TABLE public.coach_session_limits ADD COLUMN IF NOT EXISTS peer_given_monthly_limit integer NOT NULL DEFAULT 4;

-- 3) Per-session goal rating snapshots (one per goal per session, by the coachee)
CREATE TABLE IF NOT EXISTS public.session_goal_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  coachee_id uuid NOT NULL,
  rating smallint NOT NULL CHECK (rating >= 0 AND rating <= 100),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, goal_id)
);

CREATE INDEX IF NOT EXISTS idx_session_goal_ratings_coachee ON public.session_goal_ratings(coachee_id);
CREATE INDEX IF NOT EXISTS idx_session_goal_ratings_session ON public.session_goal_ratings(session_id);
CREATE INDEX IF NOT EXISTS idx_session_goal_ratings_goal ON public.session_goal_ratings(goal_id);

ALTER TABLE public.session_goal_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SGR: admin all" ON public.session_goal_ratings;
CREATE POLICY "SGR: admin all" ON public.session_goal_ratings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "SGR: coachee manage own" ON public.session_goal_ratings;
CREATE POLICY "SGR: coachee manage own" ON public.session_goal_ratings
  FOR ALL TO authenticated
  USING (coachee_id = auth.uid())
  WITH CHECK (coachee_id = auth.uid());

DROP POLICY IF EXISTS "SGR: coach view client" ON public.session_goal_ratings;
CREATE POLICY "SGR: coach view client" ON public.session_goal_ratings
  FOR SELECT TO authenticated
  USING (public.coach_has_client(auth.uid(), coachee_id));

CREATE TRIGGER trg_session_goal_ratings_updated_at
  BEFORE UPDATE ON public.session_goal_ratings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();