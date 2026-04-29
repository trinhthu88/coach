
-- 1. Coachee profile table
CREATE TABLE public.coachee_profiles (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  job_title text,
  industry text,
  location text,
  phone text,
  timezone text,
  goals text,
  approval_status public.user_status NOT NULL DEFAULT 'pending_approval',
  last_approved_at timestamptz,
  last_profile_update_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.coachee_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coachee profiles: own view" ON public.coachee_profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

CREATE POLICY "Coachee profiles: own upsert" ON public.coachee_profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() AND public.has_role(auth.uid(), 'coachee'));

CREATE POLICY "Coachee profiles: own update" ON public.coachee_profiles
  FOR UPDATE TO authenticated USING (id = auth.uid());

CREATE POLICY "Coachee profiles: admin all" ON public.coachee_profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Coach can view profile of coachees who booked with them
CREATE POLICY "Coachee profiles: coach view booked" ON public.coachee_profiles
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.coachee_id = coachee_profiles.id AND s.coach_id = auth.uid()
  ));

CREATE TRIGGER coachee_profiles_set_updated_at
  BEFORE UPDATE ON public.coachee_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER coachee_profiles_bump_profile_update
  BEFORE UPDATE ON public.coachee_profiles
  FOR EACH ROW EXECUTE FUNCTION public.bump_profile_update_at();

-- 2. Auto-create coachee_profiles row when a coachee user is created
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
  ELSIF _final_role = 'coachee' THEN
    INSERT INTO public.coachee_profiles (id, approval_status)
    VALUES (NEW.id, 'pending_approval'::public.user_status);
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill coachee_profiles for any existing coachees missing one
INSERT INTO public.coachee_profiles (id, approval_status)
SELECT ur.user_id, COALESCE(p.status, 'pending_approval'::public.user_status)
FROM public.user_roles ur
JOIN public.profiles p ON p.id = ur.user_id
WHERE ur.role = 'coachee'::public.app_role
  AND NOT EXISTS (SELECT 1 FROM public.coachee_profiles cp WHERE cp.id = ur.user_id);

-- 3. Extend sessions
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS slot_id uuid;

-- Validate duration is one of the allowed values
CREATE OR REPLACE FUNCTION public.validate_session_duration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.duration_minutes NOT IN (30, 45, 60) THEN
    RAISE EXCEPTION 'duration_minutes must be 30, 45, or 60';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sessions_validate_duration ON public.sessions;
CREATE TRIGGER sessions_validate_duration
  BEFORE INSERT OR UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_session_duration();

-- 4. Session attachments
CREATE TABLE public.session_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  file_size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.session_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Attachments: participants view" ON public.session_attachments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = session_attachments.session_id
      AND (s.coach_id = auth.uid() OR s.coachee_id = auth.uid())
  ) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Attachments: participants upload" ON public.session_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_attachments.session_id
        AND (s.coach_id = auth.uid() OR s.coachee_id = auth.uid())
    )
  );

CREATE POLICY "Attachments: uploader delete" ON public.session_attachments
  FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- 5. Session limits
CREATE TABLE public.session_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coachee_id uuid UNIQUE,  -- NULL => global default
  monthly_limit integer NOT NULL DEFAULT 4,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Insert global default row
INSERT INTO public.session_limits (coachee_id, monthly_limit, notes)
VALUES (NULL, 4, 'Global default monthly session cap');

ALTER TABLE public.session_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Session limits: admin all" ON public.session_limits
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Session limits: coachee view own" ON public.session_limits
  FOR SELECT TO authenticated
  USING (coachee_id = auth.uid() OR coachee_id IS NULL);

CREATE TRIGGER session_limits_set_updated_at
  BEFORE UPDATE ON public.session_limits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. Helper to compute active limit + current month count
CREATE OR REPLACE FUNCTION public.get_coachee_session_usage(_coachee_id uuid)
RETURNS TABLE(monthly_limit integer, used_this_month integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(
      (SELECT sl.monthly_limit FROM public.session_limits sl WHERE sl.coachee_id = _coachee_id),
      (SELECT sl.monthly_limit FROM public.session_limits sl WHERE sl.coachee_id IS NULL),
      4
    ) AS monthly_limit,
    (
      SELECT COUNT(*)::int FROM public.sessions s
      WHERE s.coachee_id = _coachee_id
        AND s.status IN ('pending_coach_approval','confirmed','completed')
        AND s.start_time >= date_trunc('month', now())
        AND s.start_time < date_trunc('month', now()) + interval '1 month'
    ) AS used_this_month;
$$;
