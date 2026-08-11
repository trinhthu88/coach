-- Phase 4 (coach programme model): give the coach side of the platform the same
-- programme/enrollment concept the coachee side already has (programmes /
-- programme_enrollments), covering all four coach-side session dimensions:
--   1. client_coaching_limit  — sessions this coach provides to their own coachees
--                                (currently unlimited — nothing enforces this today)
--   2. mentee_sessions_limit  — sessions this coach receives from their own coach
--                                (today: coach_session_limits.monthly_limit)
--   3. peer_given_limit       — peer sessions this coach gives
--                                (currently unlimited — coach_session_limits has a
--                                 peer_given_monthly_limit column, but nothing reads it)
--   4. peer_received_limit    — peer sessions this coach receives
--                                (today: coach_session_limits.peer_monthly_limit)
--
-- coach_session_limits is intentionally left in place (not dropped) so the migrated
-- data can be double-checked against it, but it becomes unused by application code
-- as of this migration series.

CREATE TABLE public.coach_programmes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  color text DEFAULT 'cobalt',
  is_active boolean NOT NULL DEFAULT true,
  -- All four limits are nullable: NULL = unlimited.
  client_coaching_limit integer,
  mentee_sessions_limit integer,
  peer_given_limit integer,
  peer_received_limit integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_coach_programmes_name UNIQUE (name)
);

ALTER TABLE public.coach_programmes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coach programmes: admin manage" ON public.coach_programmes
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Coach programmes: authenticated view active" ON public.coach_programmes
  FOR SELECT TO authenticated USING (is_active = true);

CREATE TRIGGER trg_coach_programmes_updated BEFORE UPDATE ON public.coach_programmes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- A coach has exactly one active coach programme at a time (unlike coachees, who can
-- be enrolled in multiple programmes simultaneously) — hence UNIQUE on coach_id alone,
-- not (coach_id, coach_programme_id).
CREATE TABLE public.coach_programme_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL UNIQUE,
  coach_programme_id uuid NOT NULL REFERENCES public.coach_programmes(id) ON DELETE RESTRICT,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  status public.enrollment_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_coach_programme_enrollments_programme ON public.coach_programme_enrollments(coach_programme_id);

ALTER TABLE public.coach_programme_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coach enrollments: admin manage" ON public.coach_programme_enrollments
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Coach enrollments: coach view own" ON public.coach_programme_enrollments
  FOR SELECT TO authenticated USING (coach_id = auth.uid());

CREATE TRIGGER trg_coach_programme_enrollments_updated BEFORE UPDATE ON public.coach_programme_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
