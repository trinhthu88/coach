-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'coach', 'coachee');
CREATE TYPE public.user_status AS ENUM ('inactive', 'pending_approval', 'active', 'suspended', 'rejected');
CREATE TYPE public.session_status AS ENUM ('pending_coach_approval', 'confirmed', 'completed', 'cancelled', 'rescheduled');

-- ============================================================
-- PROFILES
-- ============================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  bio TEXT,
  status public.user_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- USER ROLES (separate table for security)
-- ============================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer to avoid recursive RLS
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.get_primary_role(_user_id UUID)
RETURNS public.app_role
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY CASE role
    WHEN 'admin' THEN 1
    WHEN 'coach' THEN 2
    WHEN 'coachee' THEN 3
  END
  LIMIT 1
$$;

-- ============================================================
-- COACH PROFILES
-- ============================================================
CREATE TABLE public.coach_profiles (
  id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT,
  specialties TEXT[] DEFAULT '{}',
  hourly_rate NUMERIC,
  years_experience INTEGER,
  nationality TEXT,
  country_based TEXT,
  diplomas_certifications TEXT[] DEFAULT '{}',
  is_featured BOOLEAN NOT NULL DEFAULT false,
  approval_status public.user_status NOT NULL DEFAULT 'pending_approval',
  rating_avg NUMERIC NOT NULL DEFAULT 5.0,
  sessions_completed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.coach_profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SESSIONS
-- ============================================================
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  coachee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes IN (30, 45, 60)),
  status public.session_status NOT NULL DEFAULT 'pending_coach_approval',
  meeting_url TEXT,
  coach_notes TEXT,
  coach_private_notes TEXT,
  coachee_notes TEXT,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_coach_profiles_updated_at BEFORE UPDATE ON public.coach_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_sessions_updated_at BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Auto-create profile + assign role on signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_admin BOOLEAN := NEW.email = 'trang.tt@erickson.vn';
BEGIN
  INSERT INTO public.profiles (id, full_name, email, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    CASE WHEN _is_admin THEN 'active'::public.user_status ELSE 'active'::public.user_status END
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    CASE WHEN _is_admin THEN 'admin'::public.app_role ELSE 'coachee'::public.app_role END
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- RLS POLICIES — profiles
-- ============================================================
CREATE POLICY "Profiles: view own" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Profiles: view active" ON public.profiles
  FOR SELECT TO authenticated USING (status = 'active');
CREATE POLICY "Profiles: admin view all" ON public.profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Profiles: update own" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "Profiles: admin update all" ON public.profiles
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- RLS POLICIES — user_roles
-- ============================================================
CREATE POLICY "Roles: view own" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Roles: admin view all" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Roles: admin manage" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- RLS POLICIES — coach_profiles
-- ============================================================
CREATE POLICY "Coach profiles: view active" ON public.coach_profiles
  FOR SELECT TO authenticated USING (approval_status = 'active');
CREATE POLICY "Coach profiles: view own" ON public.coach_profiles
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Coach profiles: admin view all" ON public.coach_profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Coach profiles: own update" ON public.coach_profiles
  FOR UPDATE TO authenticated USING (id = auth.uid() AND public.has_role(auth.uid(), 'coach'));
CREATE POLICY "Coach profiles: coach insert own" ON public.coach_profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid() AND public.has_role(auth.uid(), 'coach'));
CREATE POLICY "Coach profiles: admin manage" ON public.coach_profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- RLS POLICIES — sessions
-- ============================================================
CREATE POLICY "Sessions: participant view" ON public.sessions
  FOR SELECT TO authenticated
  USING (auth.uid() IN (coach_id, coachee_id));
CREATE POLICY "Sessions: admin view all" ON public.sessions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Sessions: coachee create own" ON public.sessions
  FOR INSERT TO authenticated
  WITH CHECK (coachee_id = auth.uid() AND public.has_role(auth.uid(), 'coachee'));
CREATE POLICY "Sessions: coach update own" ON public.sessions
  FOR UPDATE TO authenticated USING (coach_id = auth.uid());
CREATE POLICY "Sessions: coachee update own" ON public.sessions
  FOR UPDATE TO authenticated USING (coachee_id = auth.uid());
CREATE POLICY "Sessions: admin manage" ON public.sessions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX idx_sessions_coach ON public.sessions(coach_id);
CREATE INDEX idx_sessions_coachee ON public.sessions(coachee_id);
CREATE INDEX idx_coach_profiles_approval ON public.coach_profiles(approval_status);