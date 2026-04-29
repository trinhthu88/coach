-- 1. Add tracking columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_profile_update_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.coach_profiles
  ADD COLUMN IF NOT EXISTS last_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_profile_update_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS calendly_url text;

-- 2. Triggers to bump last_profile_update_at
CREATE OR REPLACE FUNCTION public.bump_profile_update_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.last_profile_update_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_bump_update ON public.profiles;
CREATE TRIGGER trg_profiles_bump_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.bump_profile_update_at();

DROP TRIGGER IF EXISTS trg_coach_profiles_bump_update ON public.coach_profiles;
CREATE TRIGGER trg_coach_profiles_bump_update
BEFORE UPDATE ON public.coach_profiles
FOR EACH ROW EXECUTE FUNCTION public.bump_profile_update_at();

-- 3. Update handle_new_user: coachees pending approval
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin BOOLEAN := NEW.email = 'trang.tt@erickson.vn';
  _requested_role public.app_role;
  _final_role public.app_role;
  _profile_status public.user_status;
BEGIN
  BEGIN
    _requested_role := COALESCE(NULLIF(NEW.raw_user_meta_data->>'role',''), 'coachee')::public.app_role;
  EXCEPTION WHEN OTHERS THEN
    _requested_role := 'coachee'::public.app_role;
  END;

  IF _is_admin THEN
    _final_role := 'admin'::public.app_role;
    _profile_status := 'active'::public.user_status;
  ELSIF _requested_role = 'coach' THEN
    _final_role := 'coach'::public.app_role;
    _profile_status := 'pending_approval'::public.user_status;
  ELSE
    _final_role := 'coachee'::public.app_role;
    _profile_status := 'pending_approval'::public.user_status;
  END IF;

  INSERT INTO public.profiles (id, full_name, email, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    _profile_status
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _final_role);

  IF _final_role = 'coach' THEN
    INSERT INTO public.coach_profiles (id, approval_status)
    VALUES (NEW.id, 'pending_approval'::public.user_status);
  END IF;

  RETURN NEW;
END;
$$;

-- 4. coach_availability table
CREATE TABLE IF NOT EXISTS public.coach_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL,
  slot_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_booked boolean NOT NULL DEFAULT false,
  session_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_availability_time_valid CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_coach_availability_coach_date
  ON public.coach_availability (coach_id, slot_date);

ALTER TABLE public.coach_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Availability: coach manage own"
ON public.coach_availability
FOR ALL
TO authenticated
USING (coach_id = auth.uid() AND public.has_role(auth.uid(), 'coach'))
WITH CHECK (coach_id = auth.uid() AND public.has_role(auth.uid(), 'coach'));

CREATE POLICY "Availability: admin manage all"
ON public.coach_availability
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Availability: authenticated view"
ON public.coach_availability
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.coach_profiles cp
    WHERE cp.id = coach_availability.coach_id
      AND cp.approval_status = 'active'
  )
);

DROP TRIGGER IF EXISTS trg_coach_availability_updated ON public.coach_availability;
CREATE TRIGGER trg_coach_availability_updated
BEFORE UPDATE ON public.coach_availability
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. Backfill last_approved_at for already-approved coaches
UPDATE public.coach_profiles
SET last_approved_at = updated_at
WHERE approval_status = 'active' AND last_approved_at IS NULL;