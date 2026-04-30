
-- Enum for enrollment status
DO $$ BEGIN
  CREATE TYPE public.enrollment_status AS ENUM ('active','completed','paused','at_risk');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.alert_severity AS ENUM ('info','warning','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- programmes
CREATE TABLE IF NOT EXISTS public.programmes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  total_sessions integer NOT NULL DEFAULT 8,
  duration_months integer NOT NULL DEFAULT 3,
  color text DEFAULT 'cobalt',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.programmes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Programmes: admin manage" ON public.programmes
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Programmes: authenticated view active" ON public.programmes
  FOR SELECT TO authenticated USING (is_active = true);

CREATE TRIGGER trg_programmes_updated BEFORE UPDATE ON public.programmes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- cohorts
CREATE TABLE IF NOT EXISTS public.cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  programme_id uuid REFERENCES public.programmes(id) ON DELETE SET NULL,
  start_date date,
  end_date date,
  color text DEFAULT 'teal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cohorts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cohorts: admin manage" ON public.cohorts
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Cohorts: authenticated view" ON public.cohorts
  FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_cohorts_updated BEFORE UPDATE ON public.cohorts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- programme enrollments
CREATE TABLE IF NOT EXISTS public.programme_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coachee_id uuid NOT NULL,
  programme_id uuid NOT NULL REFERENCES public.programmes(id) ON DELETE RESTRICT,
  cohort_id uuid REFERENCES public.cohorts(id) ON DELETE SET NULL,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  status public.enrollment_status NOT NULL DEFAULT 'active',
  progress_pct integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coachee_id, programme_id)
);
ALTER TABLE public.programme_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enrollments: admin manage" ON public.programme_enrollments
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Enrollments: coachee view own" ON public.programme_enrollments
  FOR SELECT TO authenticated USING (coachee_id = auth.uid());
CREATE POLICY "Enrollments: coach view client" ON public.programme_enrollments
  FOR SELECT TO authenticated USING (coach_has_client(auth.uid(), coachee_id));

CREATE TRIGGER trg_enrollments_updated BEFORE UPDATE ON public.programme_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- admin alerts
CREATE TABLE IF NOT EXISTS public.admin_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity public.alert_severity NOT NULL DEFAULT 'info',
  alert_type text NOT NULL,
  title text NOT NULL,
  message text,
  related_coachee_id uuid,
  related_coach_id uuid,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Alerts: admin manage" ON public.admin_alerts
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE TRIGGER trg_admin_alerts_updated BEFORE UPDATE ON public.admin_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed programmes
INSERT INTO public.programmes (name, description, total_sessions, duration_months, color)
VALUES
  ('Foundations', 'Introductory coaching programme — build core habits and clarity.', 8, 3, 'cobalt'),
  ('Growth', 'Mid-level programme focused on leadership skills and team dynamics.', 12, 6, 'teal'),
  ('Executive', 'Long-form executive coaching with deep behavioural work.', 16, 9, 'gold')
ON CONFLICT DO NOTHING;
