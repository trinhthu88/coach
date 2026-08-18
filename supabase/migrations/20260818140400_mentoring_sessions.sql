-- Mentoring's session table, mirroring sessions/peer_sessions (RULES.md §1
-- structure) plus the two fields peer coaching doesn't need: a required
-- preparation file (hard-gated below) and a feedback-submitted stamp.
--
-- Confirmed before writing this: session_status enum, set_updated_at(),
-- validate_session_duration() (table-agnostic — checks NEW.duration_minutes,
-- not a hardcoded table) and the sessions_slot_id_unique partial-index
-- pattern (20260810140000_*) already exist and are safe to reuse verbatim.

CREATE TABLE IF NOT EXISTS public.mentoring_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mentee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  slot_id UUID,
  topic TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status public.session_status NOT NULL DEFAULT 'pending_coach_approval',
  meeting_url TEXT,
  mentor_notes TEXT,
  mentee_notes TEXT,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  prep_file_path TEXT,
  prep_file_notes TEXT,
  prep_file_submitted_at TIMESTAMPTZ,
  feedback_submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mentoring_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "MentoringSessions: participants view"
  ON public.mentoring_sessions FOR SELECT TO authenticated
  USING (auth.uid() = mentor_id OR auth.uid() = mentee_id);

CREATE POLICY "MentoringSessions: admin view all"
  ON public.mentoring_sessions FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "MentoringSessions: mentee create own"
  ON public.mentoring_sessions FOR INSERT TO authenticated
  WITH CHECK (
    mentee_id = auth.uid()
    AND public.can_book_mentoring_session(auth.uid(), mentor_id)
  );

CREATE POLICY "MentoringSessions: mentor update own"
  ON public.mentoring_sessions FOR UPDATE TO authenticated
  USING (mentor_id = auth.uid());

CREATE POLICY "MentoringSessions: mentee update own"
  ON public.mentoring_sessions FOR UPDATE TO authenticated
  USING (mentee_id = auth.uid());

CREATE POLICY "MentoringSessions: admin manage"
  ON public.mentoring_sessions FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER mentoring_sessions_updated_at
  BEFORE UPDATE ON public.mentoring_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER mentoring_sessions_validate_duration
  BEFORE INSERT OR UPDATE ON public.mentoring_sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_session_duration();

CREATE UNIQUE INDEX IF NOT EXISTS mentoring_sessions_slot_id_unique
  ON public.mentoring_sessions (slot_id) WHERE slot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mentoring_sessions_mentor ON public.mentoring_sessions(mentor_id);
CREATE INDEX IF NOT EXISTS idx_mentoring_sessions_mentee ON public.mentoring_sessions(mentee_id);
CREATE INDEX IF NOT EXISTS idx_mentoring_sessions_start ON public.mentoring_sessions(start_time);

-- Hard gate (per the task's explicit requirement, stronger than the
-- frontend-only completionGate.ts rule used for regular/peer sessions):
-- a mentoring session cannot transition to 'completed' without a
-- preparation file on file.
CREATE OR REPLACE FUNCTION public.enforce_mentoring_prep_file_before_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' AND NEW.prep_file_path IS NULL THEN
    RAISE EXCEPTION 'Cannot mark mentoring session complete: preparation file has not been submitted';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_mentoring_sessions_prep_gate
  BEFORE UPDATE ON public.mentoring_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_mentoring_prep_file_before_completion();
