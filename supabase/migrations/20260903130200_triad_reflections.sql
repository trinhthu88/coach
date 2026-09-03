-- Phase 3 (triads), part 3: post-session reflection, one row per
-- (triad_session, participant) — same "3 roles this session had, reflect on
-- each" shape the frontend form asks for, not split into 3 separate tables.

CREATE TABLE public.triad_reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triad_session_id UUID NOT NULL REFERENCES public.triad_sessions(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Reflection questions (all optional text)
  learned_as_coach TEXT,
  will_use_as_coach TEXT,
  learned_as_coachee TEXT,
  will_use_as_coachee TEXT,
  learned_as_observer TEXT,
  will_use_as_observer TEXT,
  -- Satisfaction
  satisfaction_rating SMALLINT CHECK (satisfaction_rating BETWEEN 1 AND 5),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (triad_session_id, participant_id)
);

ALTER TABLE public.triad_reflections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Triad reflections: user manage own" ON public.triad_reflections
  FOR ALL TO authenticated
  USING (participant_id = auth.uid())
  WITH CHECK (
    participant_id = auth.uid()
    AND public.has_programme_module('triads'::programme_module_type)
  );

CREATE POLICY "Triad reflections: admin view all" ON public.triad_reflections
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Members of the same triad can see each other's reflections
CREATE POLICY "Triad reflections: triad members view" ON public.triad_reflections
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.triad_sessions ts
      WHERE ts.id = triad_reflections.triad_session_id
        AND auth.uid() IN (ts.coach_role_id, ts.coachee_role_id, ts.observer_role_id)
    )
  );

CREATE INDEX idx_triad_reflections_session ON public.triad_reflections(triad_session_id);
CREATE INDEX idx_triad_reflections_participant ON public.triad_reflections(participant_id);
