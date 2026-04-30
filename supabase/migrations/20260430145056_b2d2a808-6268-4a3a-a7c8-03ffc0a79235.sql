CREATE OR REPLACE FUNCTION public.bump_profile_update_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Generic: just bump the timestamp on every update.
  -- Skip when only last_approved_at changed (coach_profiles only).
  IF TG_TABLE_NAME = 'coach_profiles' THEN
    IF NEW.last_approved_at IS DISTINCT FROM OLD.last_approved_at
       AND NEW.title IS NOT DISTINCT FROM OLD.title
       AND NEW.specialties IS NOT DISTINCT FROM OLD.specialties
       AND NEW.hourly_rate IS NOT DISTINCT FROM OLD.hourly_rate
       AND NEW.years_experience IS NOT DISTINCT FROM OLD.years_experience
       AND NEW.nationality IS NOT DISTINCT FROM OLD.nationality
       AND NEW.country_based IS NOT DISTINCT FROM OLD.country_based
       AND NEW.diplomas_certifications IS NOT DISTINCT FROM OLD.diplomas_certifications
       AND NEW.is_featured IS NOT DISTINCT FROM OLD.is_featured
       AND NEW.approval_status IS NOT DISTINCT FROM OLD.approval_status
       AND NEW.calendly_url IS NOT DISTINCT FROM OLD.calendly_url
       AND NEW.peer_coaching_opt_in IS NOT DISTINCT FROM OLD.peer_coaching_opt_in THEN
      RETURN NEW;
    END IF;
  END IF;
  NEW.last_profile_update_at = now();
  RETURN NEW;
END;
$function$;