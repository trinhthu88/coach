-- Phase 3 (triads), part 2: a scheduled practice session for a triad_group,
-- with the rotating Coach/Coachee/Observer role assignment for that
-- specific session. Any member of the group can propose a session (unlike
-- the coach/mentoring booking flows, there's no "provider publishes
-- availability, other party books a slot" shape here — all 3 members
-- already know each other and self-schedule directly), so booking uses a
-- plain date/time picker rather than coachee_availability.

CREATE TABLE public.triad_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triad_group_id UUID NOT NULL REFERENCES public.triad_groups(id) ON DELETE CASCADE,
  training_week_id UUID REFERENCES public.training_weeks(id),   -- Which week this session is for
  session_date DATE NOT NULL,
  start_time TIMESTAMPTZ,
  duration_minutes INT NOT NULL DEFAULT 60,
  -- Who played which role this session (rotating each week)
  coach_role_id UUID NOT NULL REFERENCES public.profiles(id),
  coachee_role_id UUID NOT NULL REFERENCES public.profiles(id),
  observer_role_id UUID NOT NULL REFERENCES public.profiles(id),
  status public.session_status NOT NULL DEFAULT 'confirmed',
  meeting_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- All 3 roles must be different
  CONSTRAINT triad_session_roles_distinct CHECK (
    coach_role_id != coachee_role_id
    AND coach_role_id != observer_role_id
    AND coachee_role_id != observer_role_id
  )
);

ALTER TABLE public.triad_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Triad sessions: admin manage" ON public.triad_sessions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Members can view and update their own triad sessions
CREATE POLICY "Triad sessions: members view own" ON public.triad_sessions
  FOR SELECT TO authenticated
  USING (
    auth.uid() IN (coach_role_id, coachee_role_id, observer_role_id)
    AND public.has_programme_module('triads'::programme_module_type)
  );

CREATE POLICY "Triad sessions: members update own" ON public.triad_sessions
  FOR UPDATE TO authenticated
  USING (
    auth.uid() IN (coach_role_id, coachee_role_id, observer_role_id)
    AND public.has_programme_module('triads'::programme_module_type)
  );

-- Any member of the triad group can create a session for that group — the
-- 3 role columns must also each be one of that same group's 3 members, so a
-- session can't be created assigning roles to people outside the triad.
CREATE POLICY "Triad sessions: members create" ON public.triad_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_programme_module('triads'::programme_module_type)
    AND EXISTS (
      SELECT 1 FROM public.triad_groups tg
      WHERE tg.id = triad_sessions.triad_group_id
        AND auth.uid() IN (tg.member_1_id, tg.member_2_id, tg.member_3_id)
        AND coach_role_id IN (tg.member_1_id, tg.member_2_id, tg.member_3_id)
        AND coachee_role_id IN (tg.member_1_id, tg.member_2_id, tg.member_3_id)
        AND observer_role_id IN (tg.member_1_id, tg.member_2_id, tg.member_3_id)
    )
  );

CREATE TRIGGER trg_triad_sessions_updated BEFORE UPDATE ON public.triad_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_triad_sessions_group ON public.triad_sessions(triad_group_id);
CREATE INDEX idx_triad_sessions_week ON public.triad_sessions(training_week_id);
