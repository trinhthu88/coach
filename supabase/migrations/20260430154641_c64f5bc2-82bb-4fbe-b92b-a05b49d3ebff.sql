-- 1. Add peer_monthly_limit to coach_session_limits
ALTER TABLE public.coach_session_limits
  ADD COLUMN IF NOT EXISTS peer_monthly_limit integer NOT NULL DEFAULT 4;

-- 2. Peer session competency feedback table
CREATE TABLE IF NOT EXISTS public.peer_session_competency_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  peer_session_id uuid NOT NULL UNIQUE,
  peer_coach_id uuid NOT NULL,
  peer_coachee_id uuid NOT NULL,
  ethical_practice smallint,
  coaching_mindset smallint,
  maintains_agreements smallint,
  trust_safety smallint,
  maintains_presence smallint,
  listens_actively smallint,
  evokes_awareness smallint,
  facilitates_growth smallint,
  feedback_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.peer_session_competency_feedback ENABLE ROW LEVEL SECURITY;

-- Validate score range (0-100) via trigger (NOT a CHECK constraint)
CREATE OR REPLACE FUNCTION public.validate_competency_scores()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.ethical_practice IS NOT NULL AND (NEW.ethical_practice < 0 OR NEW.ethical_practice > 100))
     OR (NEW.coaching_mindset IS NOT NULL AND (NEW.coaching_mindset < 0 OR NEW.coaching_mindset > 100))
     OR (NEW.maintains_agreements IS NOT NULL AND (NEW.maintains_agreements < 0 OR NEW.maintains_agreements > 100))
     OR (NEW.trust_safety IS NOT NULL AND (NEW.trust_safety < 0 OR NEW.trust_safety > 100))
     OR (NEW.maintains_presence IS NOT NULL AND (NEW.maintains_presence < 0 OR NEW.maintains_presence > 100))
     OR (NEW.listens_actively IS NOT NULL AND (NEW.listens_actively < 0 OR NEW.listens_actively > 100))
     OR (NEW.evokes_awareness IS NOT NULL AND (NEW.evokes_awareness < 0 OR NEW.evokes_awareness > 100))
     OR (NEW.facilitates_growth IS NOT NULL AND (NEW.facilitates_growth < 0 OR NEW.facilitates_growth > 100)) THEN
    RAISE EXCEPTION 'Competency scores must be between 0 and 100';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_competency_scores ON public.peer_session_competency_feedback;
CREATE TRIGGER trg_validate_competency_scores
  BEFORE INSERT OR UPDATE ON public.peer_session_competency_feedback
  FOR EACH ROW EXECUTE FUNCTION public.validate_competency_scores();

DROP TRIGGER IF EXISTS trg_pscf_updated_at ON public.peer_session_competency_feedback;
CREATE TRIGGER trg_pscf_updated_at
  BEFORE UPDATE ON public.peer_session_competency_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS policies
CREATE POLICY "PSCF: peer-coachee insert own"
  ON public.peer_session_competency_feedback FOR INSERT TO authenticated
  WITH CHECK (
    peer_coachee_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.peer_sessions ps
      WHERE ps.id = peer_session_id
        AND ps.peer_coachee_id = auth.uid()
    )
  );

CREATE POLICY "PSCF: peer-coachee update own"
  ON public.peer_session_competency_feedback FOR UPDATE TO authenticated
  USING (peer_coachee_id = auth.uid())
  WITH CHECK (peer_coachee_id = auth.uid());

CREATE POLICY "PSCF: participants view"
  ON public.peer_session_competency_feedback FOR SELECT TO authenticated
  USING (peer_coach_id = auth.uid() OR peer_coachee_id = auth.uid());

CREATE POLICY "PSCF: admin manage"
  ON public.peer_session_competency_feedback FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_pscf_peer_coach ON public.peer_session_competency_feedback(peer_coach_id);
CREATE INDEX IF NOT EXISTS idx_pscf_peer_coachee ON public.peer_session_competency_feedback(peer_coachee_id);

-- 3. Helper: peer session monthly usage for a coach (the would-be peer-coachee)
CREATE OR REPLACE FUNCTION public.get_coach_peer_session_usage(_coach_id uuid)
RETURNS TABLE(peer_monthly_limit integer, used_this_month integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(
      (SELECT csl.peer_monthly_limit FROM public.coach_session_limits csl WHERE csl.coach_user_id = _coach_id),
      (SELECT csl.peer_monthly_limit FROM public.coach_session_limits csl WHERE csl.coach_user_id IS NULL),
      4
    ) AS peer_monthly_limit,
    (
      SELECT COUNT(*)::int FROM public.peer_sessions ps
      WHERE ps.peer_coachee_id = _coach_id
        AND ps.status IN ('pending_coach_approval','confirmed','completed')
        AND ps.start_time >= date_trunc('month', now())
        AND ps.start_time < date_trunc('month', now()) + interval '1 month'
    ) AS used_this_month;
$$;