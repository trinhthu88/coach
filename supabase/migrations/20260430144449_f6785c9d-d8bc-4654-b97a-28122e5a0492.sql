CREATE OR REPLACE FUNCTION public.bump_profile_update_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.last_approved_at IS DISTINCT FROM OLD.last_approved_at
     AND ROW(
       NEW.id, NEW.title, NEW.specialties, NEW.hourly_rate, NEW.years_experience,
       NEW.nationality, NEW.country_based, NEW.diplomas_certifications, NEW.is_featured,
       NEW.approval_status, NEW.rating_avg, NEW.sessions_completed, NEW.created_at,
       NEW.updated_at, NEW.last_profile_update_at, NEW.calendly_url, NEW.peer_coaching_opt_in
     ) IS NOT DISTINCT FROM ROW(
       OLD.id, OLD.title, OLD.specialties, OLD.hourly_rate, OLD.years_experience,
       OLD.nationality, OLD.country_based, OLD.diplomas_certifications, OLD.is_featured,
       OLD.approval_status, OLD.rating_avg, OLD.sessions_completed, OLD.created_at,
       OLD.updated_at, OLD.last_profile_update_at, OLD.calendly_url, OLD.peer_coaching_opt_in
     ) THEN
    RETURN NEW;
  END IF;
  NEW.last_profile_update_at = now();
  RETURN NEW;
END;
$function$;