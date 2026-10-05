-- Grants and profile guard (D-4, D-6, D-20, L-24, P-22, P-9a).
--
-- 1. Shared constructions are not client-callable. Every canonical_*,
--    *_internal and next_*_requirement function, programme_required_units,
--    assert_enrollment_scope and resolve_current_enrollment loses EXECUTE for
--    PUBLIC, anon and authenticated. Supabase's default privileges grant
--    EXECUTE on every new public function to anon and authenticated, so a
--    function re-created by a later migration is exposed again unless it is
--    revoked there too; supabase/tests/grants_and_profile_guard_test.sql fails
--    when that happens. service_role keeps its own grant (edge functions).
--    Before this, any signed-in user could read any enrollment's Coaching /
--    Mentoring / Peer fulfilment and next requirement, its required units and
--    any user's current enrollment by passing an id.
-- 2. dashboard_summary is dropped. Nothing calls it, and anon could execute it.
-- 3. The app reads through role wrappers with owner checks:
--      learner_next_coaching_requirement(enrollment)      -- own enrollment
--      learner_coaching_requirement_fulfilment(enrollment)  -- own enrollment
--      coach_coaching_requirement_fulfilment(enrollment)    -- only the rows of
--                                                            sessions the caller coaches
-- 4. coach_profiles: max_coachee_invites, approval_status, rating_avg and
--    sessions_completed change only by an Admin or by trusted SQL (the service
--    role, migrations, SECURITY DEFINER functions such as
--    recompute_coach_rating and admin_update_coach). The "own update" policy
--    let a Coach approve themself, raise their own invite cap or set their own
--    rating.

-- ---------------------------------------------------------------------------
-- 1. dashboard_summary
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.dashboard_summary(uuid);

-- ---------------------------------------------------------------------------
-- 2. Revoke the shared constructions
-- ---------------------------------------------------------------------------
DO $revoke$
DECLARE f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'canonical\_%'
        OR p.proname LIKE '%\_internal'
        OR p.proname ~ '^next_.+_requirement$'
        OR p.proname IN ('programme_required_units', 'assert_enrollment_scope', 'resolve_current_enrollment'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END
$revoke$;

-- ---------------------------------------------------------------------------
-- 3. Role wrappers the app calls
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.learner_next_coaching_requirement(p_enrollment_id uuid)
RETURNS TABLE (requirement_id uuid, ordinal integer, due_on date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.requirement_id, r.ordinal, r.due_on
  FROM public.next_coaching_requirement(p_enrollment_id) r
  WHERE EXISTS (SELECT 1 FROM public.programme_enrollments e
                WHERE e.id = p_enrollment_id AND e.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.learner_coaching_requirement_fulfilment(p_enrollment_id uuid)
RETURNS TABLE (requirement_id uuid, ordinal integer, due_on date, fulfilled_on date,
               booked_on date, session_id uuid, post_session_pending boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT f.*
  FROM public.canonical_coaching_requirement_fulfilment(p_enrollment_id) f
  WHERE EXISTS (SELECT 1 FROM public.programme_enrollments e
                WHERE e.id = p_enrollment_id AND e.user_id = auth.uid());
$$;

-- A Coach sees which requirement THEIR session fulfils, never the learner's
-- other units (booked with someone else, or still free).
CREATE OR REPLACE FUNCTION public.coach_coaching_requirement_fulfilment(p_enrollment_id uuid)
RETURNS TABLE (requirement_id uuid, ordinal integer, due_on date, fulfilled_on date,
               booked_on date, session_id uuid, post_session_pending boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT f.*
  FROM public.canonical_coaching_requirement_fulfilment(p_enrollment_id) f
  JOIN public.sessions s ON s.id = f.session_id
  WHERE s.coach_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.learner_next_coaching_requirement(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.learner_coaching_requirement_fulfilment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.coach_coaching_requirement_fulfilment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_next_coaching_requirement(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.learner_coaching_requirement_fulfilment(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.coach_coaching_requirement_fulfilment(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. coach_profiles protected fields
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: current_user is then the role that ran the
-- UPDATE. A client request runs as anon / authenticated; the service role,
-- migrations and SECURITY DEFINER functions (recompute_coach_rating fires when
-- a LEARNER rates a session, so auth.uid() alone cannot tell them apart) run
-- as their own role and are trusted.
CREATE OR REPLACE FUNCTION public.guard_coach_profile_protected_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN RETURN NEW; END IF;
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN RETURN NEW; END IF;
  IF NEW.max_coachee_invites IS DISTINCT FROM OLD.max_coachee_invites
     OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
     OR NEW.rating_avg IS DISTINCT FROM OLD.rating_avg
     OR NEW.sessions_completed IS DISTINCT FROM OLD.sessions_completed THEN
    RAISE EXCEPTION 'Only an administrator can change a Coach''s approval, invite limit, rating or completed sessions'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.guard_coach_profile_protected_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_coach_profile_protected_fields ON public.coach_profiles;
CREATE TRIGGER guard_coach_profile_protected_fields
BEFORE UPDATE ON public.coach_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_coach_profile_protected_fields();

-- ---------------------------------------------------------------------------
-- 5. Final-state guard
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.proname LIKE 'canonical\_%'
      OR p.proname LIKE '%\_internal'
      OR p.proname ~ '^next_.+_requirement$'
      OR p.proname IN ('programme_required_units', 'assert_enrollment_scope',
                       'resolve_current_enrollment', 'dashboard_summary'))
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Client-executable internal functions remain: %', bad;
  END IF;
END
$verify$;
