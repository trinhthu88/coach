-- Sponsor is an exclusive portal role.
--
-- handle_new_user() provisions a default `coachee` role (and a pending
-- coachee_profiles row) for every new auth user that is not a coach. The
-- invite-sponsor edge function undoes that explicitly, but every other path
-- that creates a Sponsor (supabase/seed-demo.sql, supabase/seed.sql, manual
-- SQL) left the default in place, so the user held {coachee, sponsor}. The
-- client resolved coachee first and sponsor@clariva.demo landed in the
-- learner dashboard instead of the Sponsor portal.
--
-- user_roles stays the single source of a user's role. This migration makes
-- the invariant hold in the database rather than in each provisioning path:
--
--   1. A user granted `sponsor` loses the trigger-default `coachee` row and
--      its coachee_profiles row -- unless they are genuinely a learner (they
--      hold a programme enrollment), which is never silently removed.
--   2. Existing rows are cleaned up the same way.
--   3. The migration fails if a non-learner Sponsor still carries coachee.

CREATE OR REPLACE FUNCTION public.trg_user_roles_sponsor_exclusive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role = 'sponsor'::public.app_role
     AND NOT EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.user_id = NEW.user_id) THEN
    DELETE FROM public.user_roles
     WHERE user_id = NEW.user_id AND role = 'coachee'::public.app_role;
    DELETE FROM public.coachee_profiles WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_user_roles_sponsor_exclusive() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_user_roles_sponsor_exclusive ON public.user_roles;
CREATE TRIGGER trg_user_roles_sponsor_exclusive
  AFTER INSERT OR UPDATE OF role ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.trg_user_roles_sponsor_exclusive();

-- Existing data.
WITH stray AS (
  SELECT r.user_id
  FROM public.user_roles r
  WHERE r.role = 'coachee'::public.app_role
    AND EXISTS (SELECT 1 FROM public.user_roles s
                WHERE s.user_id = r.user_id AND s.role = 'sponsor'::public.app_role)
    AND NOT EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.user_id = r.user_id)
), removed_profiles AS (
  DELETE FROM public.coachee_profiles cp USING stray WHERE cp.id = stray.user_id
  RETURNING cp.id
)
DELETE FROM public.user_roles r
USING stray
WHERE r.user_id = stray.user_id AND r.role = 'coachee'::public.app_role;

DO $verify$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
  FROM public.user_roles r
  WHERE r.role = 'coachee'::public.app_role
    AND EXISTS (SELECT 1 FROM public.user_roles s
                WHERE s.user_id = r.user_id AND s.role = 'sponsor'::public.app_role)
    AND NOT EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.user_id = r.user_id);
  IF n > 0 THEN
    RAISE EXCEPTION 'Sponsor role exclusivity: % non-learner sponsors still hold coachee', n;
  END IF;

  -- A profile with no role cannot be routed; the client now shows an explicit
  -- error for it. Report, do not guess a role.
  SELECT count(*) INTO n
  FROM public.profiles p
  WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id);
  IF n > 0 THEN
    RAISE NOTICE 'Role integrity: % profiles have no user_roles row', n;
  END IF;
END
$verify$;
