-- Peer eligibility becomes a COHORT decision (Peer canonical cutover, phase 2).
--
-- Phase 1 made a Peer session two enrollments, each fulfilling its own cohort
-- requirement. It deliberately changed nothing about WHO may sit on the other
-- side of the meeting, and who may is currently a global fact:
--
--   profiles.peer_coaching_opt_in = true
--
-- That is the whole gate. CoacheePeerPractice.tsx selects every opted-in
-- profile in the system, and can_book_coachee_peer_session() checks only the
-- same flag, so a learner in one organisation's cohort can peer with a learner
-- in another's. Opt-in answers "am I willing to do peer practice at all"; it
-- was never meant to answer "with whom".
--
-- The canonical rule, matching how Coaching (cohort_coach_assignments) and
-- Mentoring (cohort_mentors) already work:
--
--   A learner may peer with eligible learners
--     1. in their OWN cohort                    -- no permission row needed
--     2. in cohorts their cohort explicitly allows
--
-- Permissions are DIRECTIONAL. peer_cohort_permissions(A, B) says learners of
-- A may select learners of B. It says nothing about B selecting A; mutual
-- access is two rows. Reciprocity is never implied, because "cohort B may be
-- practised on" and "cohort B may go looking" are different grants -- a pilot
-- cohort can be opened up as a partner pool without also being given the run
-- of everybody else's.
--
-- Scope: this is the LEARNER-to-LEARNER pool (coachee_peer_sessions). The
-- coach-provided pool (peer_sessions, gated by coach_profiles.peer_coaching_opt_in)
-- is a different relationship -- RULES.md §3 -- whose provider is a Coach and
-- therefore holds no cohort at all. Cohort permissions do not and cannot apply
-- to it. Both pools continue to share phase 1's participant attribution, so
-- Peer PROGRESS stays one number however the meeting was sourced.

-- ---------------------------------------------------------------------------
-- 1. Directional cohort permissions
-- ---------------------------------------------------------------------------

CREATE TABLE public.peer_cohort_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Learners of THIS cohort gain the ability to select...
  source_cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  -- ...eligible learners of THIS one.
  allowed_peer_cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- One grant per ordered pair. The pair is ordered, so (A,B) and (B,A) are
  -- two different rows and both may exist.
  CONSTRAINT peer_cohort_permissions_unique
    UNIQUE (source_cohort_id, allowed_peer_cohort_id),
  -- Own-cohort peering needs no row, so a self-grant is meaningless rather
  -- than merely redundant: it would suggest the own-cohort rule is optional.
  CONSTRAINT peer_cohort_permissions_not_self
    CHECK (source_cohort_id <> allowed_peer_cohort_id)
);

COMMENT ON TABLE public.peer_cohort_permissions IS
  'Directional cross-cohort Peer grants: learners of source_cohort_id may '
  'select eligible learners of allowed_peer_cohort_id. Never symmetric -- '
  'mutual access is two rows. Own-cohort peering is implicit and has no row.';

CREATE INDEX peer_cohort_permissions_source_idx
  ON public.peer_cohort_permissions (source_cohort_id);
CREATE INDEX peer_cohort_permissions_allowed_idx
  ON public.peer_cohort_permissions (allowed_peer_cohort_id);

-- ---------------------------------------------------------------------------
-- 2. Structural compatibility, enforced in the database
-- ---------------------------------------------------------------------------
--
-- Two cohorts may only be connected when they are structurally comparable.
-- The programme is what makes them comparable: it defines the module set and
-- required_units, so learners of two cohorts of the SAME programme are doing
-- the same Peer work against the same unit count, and one may stand in as the
-- other's partner. Cohorts of different programmes are not interchangeable,
-- and the repo has no more general compatibility notion than the programme.
--
-- This lives in a trigger rather than in the Admin UI because UI filtering is
-- a convenience, not a control: a direct PostgREST insert would bypass it.

CREATE OR REPLACE FUNCTION public.validate_peer_cohort_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_source_programme uuid;
  v_allowed_programme uuid;
BEGIN
  SELECT programme_id INTO v_source_programme
  FROM public.cohorts WHERE id = NEW.source_cohort_id;
  SELECT programme_id INTO v_allowed_programme
  FROM public.cohorts WHERE id = NEW.allowed_peer_cohort_id;

  -- A cohort with no programme has no module set, so nothing can be said
  -- about whether its learners are doing comparable Peer work.
  IF v_source_programme IS NULL OR v_allowed_programme IS NULL THEN
    RAISE EXCEPTION 'Peer cohort permission requires both cohorts to belong to a programme'
      USING ERRCODE = '23514';
  END IF;

  IF v_source_programme IS DISTINCT FROM v_allowed_programme THEN
    RAISE EXCEPTION 'Peer cohort permission requires both cohorts to belong to the same programme (% vs %)',
      v_source_programme, v_allowed_programme USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER peer_cohort_permissions_validate
  BEFORE INSERT OR UPDATE ON public.peer_cohort_permissions
  FOR EACH ROW EXECUTE FUNCTION public.validate_peer_cohort_permission();

-- ---------------------------------------------------------------------------
-- 3. Access
-- ---------------------------------------------------------------------------
--
-- Admins configure. Learners never read this table directly -- they read the
-- resolved partner list through eligible_peer_partners(), which is SECURITY
-- DEFINER -- so exposing the grant graph to every authenticated user would
-- disclose the cohort topology for no functional gain.

ALTER TABLE public.peer_cohort_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Peer cohort permissions: admin manage"
  ON public.peer_cohort_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE ALL ON public.peer_cohort_permissions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.peer_cohort_permissions TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. The eligible cohort set
-- ---------------------------------------------------------------------------
--
-- Own cohort first, then granted cohorts. is_own_cohort is carried through so
-- every surface can distinguish "my cohort" from "a cohort we were opened up
-- to" without re-deriving it.

CREATE OR REPLACE FUNCTION public.peer_eligible_cohorts(p_cohort_id uuid)
RETURNS TABLE (cohort_id uuid, is_own_cohort boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_cohort_id, true
  WHERE p_cohort_id IS NOT NULL
  UNION
  SELECT g.allowed_peer_cohort_id, false
  FROM public.peer_cohort_permissions g
  WHERE g.source_cohort_id = p_cohort_id;
$$;

COMMENT ON FUNCTION public.peer_eligible_cohorts(uuid) IS
  'The cohorts a learner of p_cohort_id may draw Peer partners from: their own '
  '(always, with no permission row) plus every cohort explicitly granted to it. '
  'Directional -- being granted TO a cohort gives no access back.';

REVOKE ALL ON FUNCTION public.peer_eligible_cohorts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peer_eligible_cohorts(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. The canonical partner resolver
-- ---------------------------------------------------------------------------
--
-- ONE server-side source for "who may I peer with", resolved ENROLLMENT-FIRST:
--
--   source enrollment -> its cohort -> own + allowed cohorts
--                     -> eligible enrollments in those cohorts
--                     -> the people holding them
--
-- The source is evaluated through the REQUESTED enrollment only. A learner
-- holding a completed enrollment in cohort A and an active one in cohort B
-- draws partners from B's permissions when asking as B, and never inherits A's
-- -- historical membership is history, not entitlement. The same applies to the
-- partner side: a partner qualifies through an enrollment that is currently
-- live in an eligible cohort, not through having once been in one.
--
-- Returns only what partner SELECTION needs. No sponsor, organisation, email,
-- goals or narrative: this list is shown to a peer, not to a reporter.

CREATE OR REPLACE FUNCTION public.eligible_peer_partners(p_enrollment_id uuid)
RETURNS TABLE (
  user_id uuid,
  enrollment_id uuid,
  display_name text,
  cohort_id uuid,
  cohort_name text,
  programme_id uuid,
  programme_name text,
  is_own_cohort boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  e public.programme_enrollments;
BEGIN
  SELECT * INTO e FROM public.programme_enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- A learner may ask about their own enrollment; an admin may ask about any.
  IF e.user_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not authorised to resolve Peer partners for enrollment %', p_enrollment_id
      USING ERRCODE = '42501';
  END IF;

  -- An enrollment that is not itself live, or whose programme does not run
  -- Peer, has no partner pool at all.
  IF e.status NOT IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
     OR e.cohort_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.programme_modules pm
       WHERE pm.programme_id = e.programme_id
         AND pm.module = 'peer_coaching'::public.programme_module_type
         AND pm.enabled) THEN
    RETURN;
  END IF;

  RETURN QUERY
  -- One row per PERSON. The same user could in principle be reachable through
  -- more than one eligible enrollment; DISTINCT ON collapses that to the one
  -- the learner would actually book against, preferring their own cohort.
  SELECT DISTINCT ON (pe.user_id)
    pe.user_id,
    pe.id,
    coalesce(pr.full_name, '')::text,
    pe.cohort_id,
    c.name,
    pe.programme_id,
    pg.name,
    ec.is_own_cohort
  FROM public.peer_eligible_cohorts(e.cohort_id) ec
  JOIN public.programme_enrollments pe ON pe.cohort_id = ec.cohort_id
  JOIN public.cohorts c ON c.id = pe.cohort_id
  LEFT JOIN public.programmes pg ON pg.id = pe.programme_id
  JOIN public.profiles pr ON pr.id = pe.user_id
  WHERE pe.user_id <> e.user_id
    -- Live enrollment only: a finished one is not a partner.
    AND pe.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
    -- Willing: the opt-in still answers "am I available for peer practice".
    AND pr.peer_coaching_opt_in
    -- A usable account, the set RULES.md §1 treats as usable. 'reach_limit'
    -- stays eligible on purpose: it means this learner has used up their own
    -- entitlement to RECEIVE, not that they may not give peer practice.
    AND pr.status IN ('active'::public.user_status, 'reach_limit'::public.user_status)
    -- Peer must actually run in the partner's programme too.
    AND EXISTS (
      SELECT 1 FROM public.programme_modules pm
      WHERE pm.programme_id = pe.programme_id
        AND pm.module = 'peer_coaching'::public.programme_module_type
        AND pm.enabled)
  ORDER BY pe.user_id, ec.is_own_cohort DESC, pe.start_date DESC;
END;
$$;

COMMENT ON FUNCTION public.eligible_peer_partners(uuid) IS
  'THE Peer partner rule: the people a given ENROLLMENT may book peer practice '
  'with -- live, opted-in learners of its own cohort plus every cohort granted '
  'to it by peer_cohort_permissions. Selection data only; no private profile, '
  'sponsor or narrative fields.';

REVOKE ALL ON FUNCTION public.eligible_peer_partners(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eligible_peer_partners(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. The single-partner resolver used by enforcement and attribution
-- ---------------------------------------------------------------------------
--
-- Booking validation asks a yes/no question about one candidate, and must be
-- able to ask it while running as the row's owner OR as a trigger with no JWT
-- at all. It therefore cannot go through eligible_peer_partners(), which
-- deliberately authorises the CALLER. Same rule, no caller check: the trigger
-- has already established which enrollment is booking.

CREATE OR REPLACE FUNCTION public.peer_partner_enrollment(
  p_enrollment_id uuid,
  p_partner_user_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT pe.id
  FROM public.programme_enrollments e
  JOIN public.peer_eligible_cohorts(e.cohort_id) ec ON true
  JOIN public.programme_enrollments pe ON pe.cohort_id = ec.cohort_id
  JOIN public.profiles pr ON pr.id = pe.user_id
  WHERE e.id = p_enrollment_id
    AND e.cohort_id IS NOT NULL
    AND e.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
    AND pe.user_id = p_partner_user_id
    AND pe.user_id <> e.user_id
    AND pe.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
    AND pr.peer_coaching_opt_in
    AND pr.status IN ('active'::public.user_status, 'reach_limit'::public.user_status)
    AND EXISTS (
      SELECT 1 FROM public.programme_modules pm
      WHERE pm.programme_id = e.programme_id
        AND pm.module = 'peer_coaching'::public.programme_module_type
        AND pm.enabled)
    AND EXISTS (
      SELECT 1 FROM public.programme_modules pm
      WHERE pm.programme_id = pe.programme_id
        AND pm.module = 'peer_coaching'::public.programme_module_type
        AND pm.enabled)
  ORDER BY ec.is_own_cohort DESC, pe.start_date DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.peer_partner_enrollment(uuid, uuid) IS
  'The partner''s OWN enrollment that makes them eligible for p_enrollment_id, '
  'or NULL if they are not. This is the enrollment their half of the resulting '
  'session is attributed to, so the rule that ADMITS a booking and the rule '
  'that ATTRIBUTES it are the same rule and cannot drift.';

REVOKE ALL ON FUNCTION public.peer_partner_enrollment(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peer_partner_enrollment(uuid, uuid) TO authenticated;

-- The yes/no form, defined ON the resolver so there is exactly one predicate.
CREATE OR REPLACE FUNCTION public.peer_partner_is_eligible(
  p_enrollment_id uuid,
  p_partner_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.peer_partner_enrollment(p_enrollment_id, p_partner_user_id) IS NOT NULL;
$$;

COMMENT ON FUNCTION public.peer_partner_is_eligible(uuid, uuid) IS
  'Whether p_partner_user_id may be the other side of a Peer session booked by '
  'p_enrollment_id, under the same cohort rule as eligible_peer_partners(). '
  'Caller-agnostic so enforcement triggers can use it.';

REVOKE ALL ON FUNCTION public.peer_partner_is_eligible(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peer_partner_is_eligible(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Diagnostic: grants that can never produce a partner
-- ---------------------------------------------------------------------------
--
-- A grant is not self-maintaining. A cohort can be moved to another programme,
-- emptied, or pointed at a programme that does not run Peer, and the row stays
-- -- silently granting nothing. These are reported, never auto-deleted: the
-- Admin decided the grant, so the Admin removes it.

CREATE OR REPLACE FUNCTION public.peer_cohort_permission_issues()
RETURNS TABLE (
  permission_id uuid,
  source_cohort_id uuid,
  source_cohort_name text,
  allowed_peer_cohort_id uuid,
  allowed_cohort_name text,
  issue text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT g.id, g.source_cohort_id, sc.name, g.allowed_peer_cohort_id, ac.name,
    CASE
      WHEN sc.programme_id IS NULL OR ac.programme_id IS NULL
        THEN 'a cohort in the grant has no programme'
      WHEN sc.programme_id IS DISTINCT FROM ac.programme_id
        THEN 'cohorts belong to different programmes'
      WHEN NOT EXISTS (
        SELECT 1 FROM public.programme_modules pm
        WHERE pm.programme_id = sc.programme_id
          AND pm.module = 'peer_coaching'::public.programme_module_type
          AND pm.enabled)
        THEN 'the programme does not run Peer'
      WHEN NOT EXISTS (
        SELECT 1 FROM public.programme_enrollments pe
        JOIN public.profiles pr ON pr.id = pe.user_id
        WHERE pe.cohort_id = g.allowed_peer_cohort_id
          AND pe.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
          AND pr.peer_coaching_opt_in
          AND pr.status IN ('active'::public.user_status, 'reach_limit'::public.user_status))
        THEN 'the granted cohort has no eligible learner'
    END
  FROM public.peer_cohort_permissions g
  JOIN public.cohorts sc ON sc.id = g.source_cohort_id
  JOIN public.cohorts ac ON ac.id = g.allowed_peer_cohort_id
  WHERE sc.programme_id IS NULL OR ac.programme_id IS NULL
     OR sc.programme_id IS DISTINCT FROM ac.programme_id
     OR NOT EXISTS (
       SELECT 1 FROM public.programme_modules pm
       WHERE pm.programme_id = sc.programme_id
         AND pm.module = 'peer_coaching'::public.programme_module_type
         AND pm.enabled)
     OR NOT EXISTS (
       SELECT 1 FROM public.programme_enrollments pe
       JOIN public.profiles pr ON pr.id = pe.user_id
       WHERE pe.cohort_id = g.allowed_peer_cohort_id
         AND pe.status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
         AND pr.peer_coaching_opt_in
         AND pr.status IN ('active'::public.user_status, 'reach_limit'::public.user_status));
$$;

REVOKE ALL ON FUNCTION public.peer_cohort_permission_issues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peer_cohort_permission_issues() TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Verification
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- Compatibility must be refused by the DATABASE, not merely by the UI.
  BEGIN
    INSERT INTO public.peer_cohort_permissions (source_cohort_id, allowed_peer_cohort_id)
    SELECT a.id, b.id
    FROM public.cohorts a, public.cohorts b
    WHERE a.programme_id IS DISTINCT FROM b.programme_id
      AND a.programme_id IS NOT NULL AND b.programme_id IS NOT NULL
    LIMIT 1;
    -- Only reachable when such a pair exists AND the trigger let it through.
    IF FOUND THEN
      RAISE EXCEPTION 'Peer phase 2: a cross-programme cohort grant was accepted';
    END IF;
  EXCEPTION WHEN check_violation THEN
    NULL; -- expected
  END;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'eligible_peer_partners') THEN
    RAISE EXCEPTION 'Peer phase 2: eligible_peer_partners() is missing';
  END IF;

  RAISE NOTICE 'Peer phase 2: % cohort grants, % with issues',
    (SELECT count(*) FROM public.peer_cohort_permissions),
    (SELECT count(*) FROM public.peer_cohort_permission_issues());
END $$;
