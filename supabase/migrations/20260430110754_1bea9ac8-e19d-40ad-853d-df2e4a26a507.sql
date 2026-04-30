-- Coachee goals
CREATE TABLE public.coachee_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coachee_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  target_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.coachee_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES public.coachee_goals(id) ON DELETE CASCADE,
  coachee_id UUID NOT NULL,
  title TEXT NOT NULL,
  target_date DATE,
  is_done BOOLEAN NOT NULL DEFAULT false,
  done_at TIMESTAMPTZ,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Coachee personal reflections / journal
CREATE TABLE public.coachee_reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coachee_id UUID NOT NULL,
  body TEXT NOT NULL,
  mood TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Coach private notes per coachee (independent from session notes)
CREATE TABLE public.coach_client_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL,
  coachee_id UUID NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Triggers
CREATE TRIGGER tg_coachee_goals_updated BEFORE UPDATE ON public.coachee_goals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tg_coachee_milestones_updated BEFORE UPDATE ON public.coachee_milestones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tg_coachee_reflections_updated BEFORE UPDATE ON public.coachee_reflections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tg_coach_client_notes_updated BEFORE UPDATE ON public.coach_client_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Helper: does a coach have any confirmed/completed session with this coachee?
CREATE OR REPLACE FUNCTION public.coach_has_client(_coach_id uuid, _coachee_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.coach_id = _coach_id
      AND s.coachee_id = _coachee_id
      AND s.status IN ('confirmed','completed')
  );
$$;

-- Enable RLS
ALTER TABLE public.coachee_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coachee_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coachee_reflections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_client_notes ENABLE ROW LEVEL SECURITY;

-- Goals: coachee owns; coach view-only when client; admin all
CREATE POLICY "Goals: coachee manage own" ON public.coachee_goals FOR ALL TO authenticated
  USING (coachee_id = auth.uid()) WITH CHECK (coachee_id = auth.uid());
CREATE POLICY "Goals: coach view client" ON public.coachee_goals FOR SELECT TO authenticated
  USING (public.coach_has_client(auth.uid(), coachee_id));
CREATE POLICY "Goals: admin all" ON public.coachee_goals FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- Milestones: same pattern
CREATE POLICY "Milestones: coachee manage own" ON public.coachee_milestones FOR ALL TO authenticated
  USING (coachee_id = auth.uid()) WITH CHECK (coachee_id = auth.uid());
CREATE POLICY "Milestones: coach view client" ON public.coachee_milestones FOR SELECT TO authenticated
  USING (public.coach_has_client(auth.uid(), coachee_id));
CREATE POLICY "Milestones: admin all" ON public.coachee_milestones FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- Reflections: coachee-only (private), admin all
CREATE POLICY "Reflections: coachee manage own" ON public.coachee_reflections FOR ALL TO authenticated
  USING (coachee_id = auth.uid()) WITH CHECK (coachee_id = auth.uid());
CREATE POLICY "Reflections: admin all" ON public.coachee_reflections FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- Coach client notes: only owning coach; admin all
CREATE POLICY "ClientNotes: coach manage own" ON public.coach_client_notes FOR ALL TO authenticated
  USING (coach_id = auth.uid() AND has_role(auth.uid(),'coach'::app_role))
  WITH CHECK (coach_id = auth.uid() AND has_role(auth.uid(),'coach'::app_role) AND public.coach_has_client(auth.uid(), coachee_id));
CREATE POLICY "ClientNotes: admin all" ON public.coach_client_notes FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE INDEX idx_coachee_goals_coachee ON public.coachee_goals(coachee_id);
CREATE INDEX idx_coachee_milestones_goal ON public.coachee_milestones(goal_id);
CREATE INDEX idx_coachee_reflections_coachee ON public.coachee_reflections(coachee_id, created_at DESC);
CREATE INDEX idx_coach_client_notes ON public.coach_client_notes(coach_id, coachee_id, created_at DESC);
