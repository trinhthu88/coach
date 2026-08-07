CREATE OR REPLACE FUNCTION public.is_active_coach_profile(_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.coach_profiles cp WHERE cp.id = _id AND cp.approval_status = 'active'::public.user_status);
$$;
REVOKE EXECUTE ON FUNCTION public.is_active_coach_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_coach_profile(uuid) TO authenticated;

CREATE POLICY "Profiles: coaches view active coach directory"
ON public.profiles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'coach'::public.app_role) AND public.is_active_coach_profile(id));