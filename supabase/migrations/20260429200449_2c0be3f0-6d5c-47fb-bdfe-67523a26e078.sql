-- Update signup handler to honor selected role and create coach_profiles row for coaches
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _is_admin BOOLEAN := NEW.email = 'trang.tt@erickson.vn';
  _requested_role public.app_role;
  _final_role public.app_role;
  _profile_status public.user_status;
BEGIN
  -- Read requested role from signup metadata; default coachee
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
    _profile_status := 'active'::public.user_status;
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

  -- For coaches, create a stub coach_profiles row pending approval
  IF _final_role = 'coach' THEN
    INSERT INTO public.coach_profiles (id, approval_status)
    VALUES (NEW.id, 'pending_approval'::public.user_status);
  END IF;

  RETURN NEW;
END;
$function$;

-- Ensure trigger exists on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Allow admins to insert coach_profiles (for manual creation)
DROP POLICY IF EXISTS "Coach profiles: admin insert" ON public.coach_profiles;
CREATE POLICY "Coach profiles: admin insert"
ON public.coach_profiles
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- updated_at triggers
DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_coach_profiles_updated_at ON public.coach_profiles;
CREATE TRIGGER set_coach_profiles_updated_at BEFORE UPDATE ON public.coach_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_sessions_updated_at ON public.sessions;
CREATE TRIGGER set_sessions_updated_at BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();