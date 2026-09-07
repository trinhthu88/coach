-- Optional, coach-only quality/engagement feedback on a regular coaching
-- session (sessions table only — peer/coachee-peer/mentoring have their own
-- feedback shapes already). A coach can privately rate session quality,
-- note the client's engagement level, and flag a session for admin
-- attention with a note; admins see flagged sessions surfaced as alerts
-- (see the alertScan.ts / AdminAlerts.tsx changes in the same task).
CREATE TABLE public.coach_session_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  coach_id uuid NOT NULL REFERENCES public.profiles(id),
  quality_rating smallint CHECK (quality_rating BETWEEN 1 AND 5),
  engagement_level text CHECK (engagement_level IN ('high', 'moderate', 'low', 'disengaged')),
  flag_for_admin boolean NOT NULL DEFAULT false,
  flag_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, coach_id)
);

ALTER TABLE public.coach_session_feedback ENABLE ROW LEVEL SECURITY;

-- Beyond "it's their own feedback row", this also checks the referenced
-- session actually belongs to them — coach_id = auth.uid() alone would let
-- a coach attach a feedback row (with themselves as coach_id) to a session
-- they don't own, since nothing else ties session_id to the caller.
CREATE POLICY "Coach session feedback: coach manage own"
  ON public.coach_session_feedback
  FOR ALL
  TO authenticated
  USING (coach_id = auth.uid())
  WITH CHECK (
    coach_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_id AND s.coach_id = auth.uid())
  );

CREATE POLICY "Coach session feedback: admin read"
  ON public.coach_session_feedback
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_coach_session_feedback_updated
  BEFORE UPDATE ON public.coach_session_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_coach_session_feedback_session ON public.coach_session_feedback(session_id);
CREATE INDEX idx_coach_session_feedback_flagged ON public.coach_session_feedback(coach_id) WHERE flag_for_admin = true;
