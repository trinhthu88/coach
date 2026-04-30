-- 1. Add limit columns to programmes
ALTER TABLE public.programmes
  ADD COLUMN IF NOT EXISTS coachee_session_limit integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS coach_session_limit integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS peer_session_limit integer NOT NULL DEFAULT 4;

-- 2. Staged enrollments (apply on signup if email matches)
CREATE TABLE IF NOT EXISTS public.staged_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  full_name text,
  programme_id uuid REFERENCES public.programmes(id) ON DELETE SET NULL,
  cohort_id uuid REFERENCES public.cohorts(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);

ALTER TABLE public.staged_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staged: admin manage" ON public.staged_enrollments;
CREATE POLICY "Staged: admin manage" ON public.staged_enrollments
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 3. Trigger on profiles to auto-apply staged enrollment
CREATE OR REPLACE FUNCTION public.apply_staged_enrollment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
BEGIN
  SELECT * INTO s FROM public.staged_enrollments
   WHERE lower(email) = lower(NEW.email) AND applied_at IS NULL
   LIMIT 1;
  IF FOUND AND s.programme_id IS NOT NULL THEN
    INSERT INTO public.programme_enrollments (coachee_id, programme_id, cohort_id, status, start_date)
    VALUES (NEW.id, s.programme_id, s.cohort_id, 'active'::enrollment_status, CURRENT_DATE)
    ON CONFLICT DO NOTHING;
    UPDATE public.staged_enrollments SET applied_at = now() WHERE id = s.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_staged_enrollment_trg ON public.profiles;
CREATE TRIGGER apply_staged_enrollment_trg
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.apply_staged_enrollment();