-- One quantity authority per module, and programme evidence that matches
-- canonical fulfilment (audit findings M2, T1, C6, C11, C12, G4).
--
-- Five separate leaks of the same principle, closed together because they are
-- the same principle:
--
--   M2  Mentoring quantity came from programme_modules.config.receive_limit
--       (falling back to programmes.mentoring_received_limit) while canonical
--       progress counted cohort Mentoring requirements. Two numbers, nothing
--       keeping them equal: a learner whose programme requires 3 could be
--       refused a booking because a stale receive_limit said 2.
--
--   T1  Triad quantity had the same duality via config.max_triads, enforced by
--       validate_triad_session_cap() and editable in the Admin programme form
--       right next to required_units.
--
--   C11 can_book_session()'s programme branch compared the requirement count
--       against EVERY live-or-completed session of the enrollment, including
--       pre-cutover sessions with no cohort_requirement_id -- the very rows
--       coaching_sessions_without_requirement() exists to report as
--       unattributable. Two legacy sessions could exhaust a two-requirement
--       programme without fulfilling either requirement.
--
--   C6  learner_session_history labelled Coaching and Mentoring rows as
--   G4  programme evidence from session_activity_attributions, which are
--       written on INSERT and know nothing about requirements. After the
--       requirement cutovers those rows are orphaned derived storage, so
--       "Your Sessions" called a session programme evidence while canonical
--       progress did not count it. requirement_unit_number was also populated
--       for Triads only, so a Coaching or Mentoring session had no unit label.
--
--   C12 Coaching confirmation was the one lifecycle step with no RPC: the
--       Edge Function wrote sessions.status with the service role, which
--       bypasses guard_session_protected_fields() entirely.
--
-- Nothing here changes what a module requires. It removes the second answer.

-- ---------------------------------------------------------------------------
-- 1. M2: Mentoring quantity is the cohort requirement count
-- ---------------------------------------------------------------------------
--
-- Mirrors what 20260920150000 did for Coaching. The signature is unchanged, so
-- the RLS policy, the cap trigger and the frontend pre-check keep calling the
-- same function.
--
-- get_mentoring_session_usage() is NOT dropped: the learner-facing screens use
-- it to show how much of their entitlement they have used, and the give-side
-- readers are genuine provider capacity. It simply stops being an authority on
-- how many Mentoring sessions the programme requires.

CREATE OR REPLACE FUNCTION public.can_book_mentoring_session_reason(
  p_mentee_id uuid,
  p_mentor_id uuid,
  p_enrollment_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  e public.programme_enrollments;
  cfg jsonb;
  required_units integer;
  used_count integer;
  mentor_enrollment uuid;
  given_limit integer;
  given_used integer;
BEGIN
  IF p_mentee_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN 'forbidden';
  END IF;

  SELECT * INTO e FROM public.programme_enrollments
  WHERE id = p_enrollment_id AND user_id = p_mentee_id;
  IF NOT FOUND
     OR e.status NOT IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status) THEN
    RETURN 'inactive';
  END IF;

  cfg := public.enrollment_module_config(p_enrollment_id, 'mentoring'::public.programme_module_type);
  IF cfg IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.programme_modules pm
    WHERE pm.programme_id = e.programme_id AND pm.module = 'mentoring' AND pm.enabled
  ) THEN
    RETURN 'module_access';
  END IF;

  -- WHO: the cohort mentor pool, which already requires an active mentor
  -- profile. The user-global mentoring_allowlist decides nothing.
  IF e.cohort_id IS NULL THEN
    RETURN 'no_cohort';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cohort_mentoring_mentor_pool(e.cohort_id) p
    WHERE p.mentor_user_id = p_mentor_id
  ) THEN
    RETURN 'not_in_cohort_pool';
  END IF;

  -- HOW MANY: the number of scheduled cohort Mentoring requirements, not a
  -- per-person entitlement. A learner may hold at most one live-or-completed
  -- session per requirement, which the partial unique index already
  -- guarantees; this is the aggregate form of the same rule.
  --
  -- Only requirement-attributed sessions consume the budget, for the same
  -- reason as Coaching in section 3 below: an unattributable historical
  -- session fulfils nothing, so it must not exhaust anything either.
  SELECT count(*)::integer INTO required_units
  FROM public.cohort_requirement_dates d
  WHERE d.cohort_id = e.cohort_id
    AND d.programme_id = e.programme_id
    AND d.module = 'mentoring'::public.programme_module_type;

  IF required_units = 0 THEN
    RETURN 'no_mentoring_requirement';
  END IF;

  SELECT count(*)::integer INTO used_count
  FROM public.mentoring_sessions s
  WHERE s.enrollment_id = p_enrollment_id
    AND s.cohort_requirement_id IS NOT NULL
    AND s.status IN ('pending_coach_approval', 'confirmed', 'completed');

  IF used_count >= required_units THEN
    RETURN 'received_limit_reached';
  END IF;

  -- Mentor delivery capacity is a genuinely different question -- how much the
  -- PROVIDER will take on, not how much the programme requires -- so it stays.
  SELECT id INTO mentor_enrollment FROM public.programme_enrollments
  WHERE user_id = p_mentor_id
    AND status IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status)
  LIMIT 1;
  IF mentor_enrollment IS NOT NULL THEN
    given_limit := public.programme_config_integer(
      public.enrollment_module_config(mentor_enrollment, 'mentoring'::public.programme_module_type),
      'give_limit');
  END IF;
  IF mentor_enrollment IS NULL OR given_limit IS NULL THEN
    given_limit := public.get_mentoring_given_limit(p_mentor_id);
  END IF;
  SELECT count(*)::integer INTO given_used FROM public.mentoring_sessions
  WHERE mentor_id = p_mentor_id
    AND status IN ('pending_coach_approval', 'confirmed', 'completed');
  IF given_limit IS NOT NULL AND given_used >= given_limit THEN
    RETURN 'given_limit_reached';
  END IF;

  RETURN 'ok';
END;
$function$;

COMMENT ON FUNCTION public.can_book_mentoring_session_reason(uuid, uuid, uuid) IS
  'Canonical Mentoring booking eligibility. WHO comes from cohort_mentors; HOW '
  'MANY from the cohort Mentoring requirement count. config.receive_limit is '
  'no longer consulted -- programme_modules.required_units, materialised as '
  'cohort_requirement_dates, is the only quantity authority.';

COMMENT ON FUNCTION public.get_mentoring_session_usage(uuid) IS
  'DISPLAY ONLY as of 2026-09-21. Reports how much of a legacy per-person '
  'Mentoring entitlement an enrollment has used. It is NOT the programme '
  'requirement: that is programme_modules.config.required_units via '
  'cohort_requirement_dates, and only that decides booking and completion.';

-- ---------------------------------------------------------------------------
-- 2. T1: Triad quantity is the cohort requirement count
-- ---------------------------------------------------------------------------
--
-- config.max_triads was a per-person cap on Triad SESSIONS, applied on top of
-- a model in which a learner can only ever be in one active group per
-- requirement and groups exist only for requirements. It could only ever
-- disagree with required_units -- and when it disagreed low, it blocked
-- learners from fulfilling requirements the same Admin screen told them to.
--
-- The trigger is removed; the function is retired rather than dropped so any
-- historical reference still resolves.

DROP TRIGGER IF EXISTS triad_sessions_validate_cap ON public.triad_sessions;

COMMENT ON FUNCTION public.validate_triad_session_cap() IS
  'RETIRED 2026-09-21. Enforced programme_modules.config.max_triads as a '
  'second Triad quantity authority alongside required_units. Triad quantity is '
  'the cohort Triad requirement count; membership is already limited to one '
  'active group per enrollment per requirement. No trigger calls it.';

-- ---------------------------------------------------------------------------
-- 3. C11: only requirement-attributed Coaching sessions consume the budget
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_book_session(
  p_coachee_id uuid,
  p_coach_id uuid,
  p_enrollment_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  e public.programme_enrollments;
  cfg jsonb;
  receive_limit integer;
  legacy_limit integer;
  used_count integer;
  required_units integer;
  is_programme_coaching boolean;
BEGIN
  IF p_coachee_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN false;
  END IF;

  SELECT * INTO e FROM public.programme_enrollments
  WHERE id = p_enrollment_id AND user_id = p_coachee_id;
  IF NOT FOUND
     OR e.status NOT IN ('active'::public.enrollment_status, 'at_risk'::public.enrollment_status) THEN
    RETURN false;
  END IF;

  cfg := public.enrollment_module_config(p_enrollment_id, 'coaching'::public.programme_module_type);
  IF cfg IS NULL OR (cfg->>'enabled') = 'false' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.programme_modules pm
      WHERE pm.programme_id = e.programme_id AND pm.module = 'coaching' AND pm.enabled
    ) THEN
      RETURN false;
    END IF;
  END IF;

  is_programme_coaching := e.cohort_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cohort_requirement_dates d
    WHERE d.cohort_id = e.cohort_id
      AND d.programme_id = e.programme_id
      AND d.module = 'coaching'::public.programme_module_type
  );

  IF is_programme_coaching THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cohort_coaching_coach_pool(e.cohort_id) p
      WHERE p.coach_id = p_coach_id
    ) THEN
      RETURN false;
    END IF;

    SELECT count(*)::integer INTO required_units
    FROM public.cohort_requirement_dates d
    WHERE d.cohort_id = e.cohort_id
      AND d.programme_id = e.programme_id
      AND d.module = 'coaching'::public.programme_module_type;

    -- Only sessions that actually hold a requirement count against the
    -- requirement budget. A pre-cutover session with no cohort_requirement_id
    -- fulfils nothing (coaching_sessions_without_requirement() reports exactly
    -- these), so it must not exhaust the allowance either.
    SELECT count(*)::integer INTO used_count
    FROM public.sessions s
    WHERE s.enrollment_id = p_enrollment_id
      AND s.cohort_requirement_id IS NOT NULL
      AND s.status IN ('pending_coach_approval', 'confirmed', 'completed');

    RETURN used_count < required_units;
  END IF;

  -- ---- Legacy path, unchanged: not programme Coaching. ----
  IF public.has_role(p_coachee_id, 'coach'::public.app_role) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.coach_as_coachee_allowlist a
      WHERE a.coach_user_id = p_coachee_id AND a.selectable_coach_id = p_coach_id
    ) THEN
      RETURN false;
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.coachee_coach_allowlist a
      WHERE a.coachee_id = p_coachee_id AND a.coach_id = p_coach_id AND a.removed_at IS NULL
    ) THEN
      RETURN false;
    END IF;
  END IF;

  receive_limit := public.programme_config_integer(cfg, 'receive_limit');
  SELECT coachee_session_limit INTO legacy_limit FROM public.programmes WHERE id = e.programme_id;
  receive_limit := COALESCE(receive_limit, legacy_limit);

  SELECT count(*)::integer INTO used_count FROM public.sessions
  WHERE enrollment_id = p_enrollment_id AND coachee_id = p_coachee_id
    AND status IN ('pending_coach_approval', 'confirmed', 'completed');

  RETURN receive_limit IS NULL OR used_count < receive_limit;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. C12: Coaching confirmation joins the lifecycle
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_coaching_session(
  p_session_id uuid,
  p_meeting_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_s record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  v_is_admin := public.has_role(v_actor, 'admin'::public.app_role);

  SELECT s.id, s.coach_id, s.status INTO v_s
  FROM public.sessions s WHERE s.id = p_session_id FOR UPDATE;

  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'Session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;
  -- The Coach accepts the request; the learner cannot accept on their behalf.
  IF NOT (v_is_admin OR v_actor = v_s.coach_id) THEN
    RAISE EXCEPTION 'Only the assigned Coach or an Admin may confirm a session'
      USING ERRCODE = '42501';
  END IF;
  IF v_s.status <> 'pending_coach_approval' THEN
    RAISE EXCEPTION 'Only a pending session can be confirmed (status=%)', v_s.status
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.session_transition', 'on', true);

  UPDATE public.sessions
     SET status = 'confirmed',
         confirmed_at = now(),
         meeting_url = coalesce(p_meeting_url, meeting_url)
   WHERE id = p_session_id;

  RETURN p_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_coaching_session(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_coaching_session(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.confirm_coaching_session(uuid, text) IS
  'THE writer of the Coaching pending -> confirmed transition. Confirmation was '
  'the one lifecycle step still performed by a service-role UPDATE in an Edge '
  'Function, which bypasses guard_session_protected_fields() entirely.';

-- ---------------------------------------------------------------------------
-- 5. C6 / G4: programme evidence means canonical fulfilment
-- ---------------------------------------------------------------------------
--
-- Coaching and Mentoring rows stop deriving is_programme_evidence from
-- session_activity_attributions. Those rows are written on INSERT, know
-- nothing about requirements, and for Coaching are no longer read by the
-- canonical spine at all -- so they were orphaned derived storage still acting
-- as a second answer.
--
-- The new rule is the canonical one: a session is programme evidence when it
-- is completed AND holds a cohort requirement. An unattributable historical
-- session stays visible in the learner's history, with
-- attributed_to_enrollment still reporting its raw attribution, but it is no
-- longer labelled as fulfilling a programme requirement -- because it does not.
--
-- requirement_unit_number is now populated for Coaching and Mentoring too, so
-- every requirement-bound session carries its "N".

CREATE OR REPLACE FUNCTION public.learner_session_history(
  p_enrollment_id uuid
)
RETURNS TABLE (
  session_key text,
  session_type text,
  source_table text,
  source_id uuid,
  module public.programme_module_type,
  participant_role text,
  title text,
  start_time timestamptz,
  status text,
  counterpart_names text[],
  attributed_to_enrollment boolean,
  is_programme_evidence boolean,
  requirement_unit_number integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT e.id AS enrollment_id, e.user_id, e.cohort_id
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
      AND e.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ), cohort_enrollments AS (
    SELECT pe.id
    FROM public.programme_enrollments pe
    JOIN me ON pe.cohort_id = me.cohort_id
  ), rows AS (
    SELECT 'coaching'::text AS session_type, 'sessions'::text AS source_table, s.id AS source_id,
      'coaching'::public.programme_module_type AS module, 'coachee'::text AS participant_role,
      s.topic AS title, s.start_time, s.status::text AS status,
      ARRAY[s.coach_id] AS counterpart_ids,
      s.cohort_requirement_id AS requirement_id
    FROM public.sessions s
    JOIN me ON s.enrollment_id = me.enrollment_id AND s.coachee_id = me.user_id

    UNION ALL
    SELECT 'peer_coaching', 'coachee_peer_sessions', cps.id, 'peer_coaching', 'receiver',
      cps.topic, cps.start_time, cps.status::text, ARRAY[cps.peer_provider_id], NULL::uuid
    FROM public.coachee_peer_sessions cps
    JOIN me ON cps.enrollment_id = me.enrollment_id AND cps.peer_receiver_id = me.user_id

    UNION ALL
    SELECT 'peer_coaching', 'coachee_peer_sessions', cps.id, 'peer_coaching', 'provider',
      cps.topic, cps.start_time, cps.status::text, ARRAY[cps.peer_receiver_id], NULL::uuid
    FROM public.coachee_peer_sessions cps
    JOIN me ON cps.peer_provider_id = me.user_id
    WHERE cps.enrollment_id IN (SELECT id FROM cohort_enrollments)

    UNION ALL
    SELECT 'peer_coaching', 'peer_sessions', ps.id, 'peer_coaching', 'receiver',
      ps.topic, ps.start_time, ps.status::text, ARRAY[ps.peer_coach_id], NULL::uuid
    FROM public.peer_sessions ps
    JOIN me ON ps.enrollment_id = me.enrollment_id AND ps.peer_coachee_id = me.user_id

    UNION ALL
    SELECT 'peer_coaching', 'peer_sessions', ps.id, 'peer_coaching', 'provider',
      ps.topic, ps.start_time, ps.status::text, ARRAY[ps.peer_coachee_id], NULL::uuid
    FROM public.peer_sessions ps
    JOIN me ON ps.peer_coach_id = me.user_id
    WHERE ps.enrollment_id IN (SELECT id FROM cohort_enrollments)

    UNION ALL
    SELECT 'mentoring', 'mentoring_sessions', ms.id, 'mentoring', 'mentee',
      ms.topic, ms.start_time, ms.status::text, ARRAY[ms.mentor_id],
      ms.cohort_requirement_id
    FROM public.mentoring_sessions ms
    JOIN me ON ms.enrollment_id = me.enrollment_id AND ms.mentee_id = me.user_id

    UNION ALL
    -- Triads: every member of the session's (historical) group owns the
    -- session (roles rotate, so there is no per-session role). The session
    -- is for its group's requirement ("Triad N"); no round, no week.
    SELECT 'triad', 'triad_sessions', ts.id, 'triads', 'participant',
      NULL::text, ts.scheduled_start_time, ts.status::text,
      coalesce(ARRAY(
        SELECT oe.user_id FROM public.triad_group_members om
        JOIN public.programme_enrollments oe ON oe.id = om.enrollment_id
        WHERE om.triad_group_id = ts.triad_group_id AND om.enrollment_id <> gm.enrollment_id
        ORDER BY om.member_order), ARRAY[]::uuid[]),
      g.cohort_requirement_date_id
    FROM public.triad_group_members gm
    JOIN me ON gm.enrollment_id = me.enrollment_id
    JOIN public.triad_groups g ON g.id = gm.triad_group_id
    JOIN public.triad_sessions ts ON ts.triad_group_id = gm.triad_group_id
  )
  SELECT
    r.session_type || ':' || r.source_table || ':' || r.source_id::text,
    r.session_type,
    r.source_table,
    r.source_id,
    r.module,
    r.participant_role,
    r.title,
    r.start_time,
    r.status,
    coalesce((
      SELECT array_agg(pr.full_name ORDER BY pr.full_name)
      FROM public.profiles pr
      WHERE pr.id = ANY (r.counterpart_ids)
    ), ARRAY[]::text[]),
    -- Raw attribution, kept as-is: it still answers "does this activity belong
    -- to my enrollment at all", which is a different question from fulfilment.
    EXISTS (
      SELECT 1 FROM public.session_activity_attributions a
      JOIN me ON a.enrollment_id = me.enrollment_id
      WHERE a.source_activity_id = r.source_id
    ),
    -- Programme evidence = canonical fulfilment. For the requirement-bound
    -- modules that is the session lifecycle plus a requirement link; for the
    -- others it remains the attribution, which is still their canonical source.
    CASE
      WHEN r.source_table IN ('sessions', 'mentoring_sessions')
        THEN r.status = 'completed' AND r.requirement_id IS NOT NULL
      ELSE r.status = 'completed' AND EXISTS (
        SELECT 1 FROM public.session_activity_attributions a
        JOIN me ON a.enrollment_id = me.enrollment_id
        WHERE a.source_activity_id = r.source_id
      )
    END,
    (SELECT d.ordinal FROM public.cohort_requirement_dates d WHERE d.id = r.requirement_id)
  FROM rows r
  ORDER BY r.start_time DESC NULLS LAST;
$$;

COMMENT ON FUNCTION public.learner_session_history(uuid) IS
  'The learner''s own session history. is_programme_evidence follows canonical '
  'fulfilment -- for Coaching and Mentoring, a completed session holding a '
  'cohort requirement -- never an orphaned activity attribution. '
  'requirement_unit_number is the "N" of that requirement.';

-- ---------------------------------------------------------------------------
-- 6. Verification
-- ---------------------------------------------------------------------------

DO $$
DECLARE n bigint; bad text;
BEGIN
  -- Exactly one quantity authority per module: no eligibility function may
  -- still read a per-person allowance.
  IF pg_get_functiondef('public.can_book_mentoring_session_reason(uuid,uuid,uuid)'::regprocedure)
       LIKE '%receive_limit%' THEN
    RAISE EXCEPTION 'Quantity authority: Mentoring eligibility still reads receive_limit';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'triad_sessions' AND NOT t.tgisinternal
      AND t.tgname = 'triad_sessions_validate_cap'
  ) THEN
    RAISE EXCEPTION 'Quantity authority: the max_triads cap trigger is still attached';
  END IF;

  -- Coaching eligibility must only count requirement-attributed sessions.
  IF pg_get_functiondef('public.can_book_session(uuid,uuid,uuid)'::regprocedure)
       !~ 's\.cohort_requirement_id IS NOT NULL' THEN
    RAISE EXCEPTION 'Quantity authority: Coaching eligibility still counts unattributed sessions';
  END IF;

  -- Programme evidence must not come from an attribution for the
  -- requirement-bound modules.
  IF pg_get_functiondef('public.learner_session_history(uuid)'::regprocedure)
       !~ 'r\.requirement_id IS NOT NULL' THEN
    RAISE EXCEPTION 'Evidence: session history does not follow canonical fulfilment';
  END IF;

  -- No completed, requirement-holding Coaching session may disagree with
  -- canonical fulfilment.
  SELECT count(*) INTO n
  FROM public.sessions s
  CROSS JOIN LATERAL public.canonical_coaching_requirement_fulfilment(s.enrollment_id) f
  WHERE s.status = 'completed'
    AND s.cohort_requirement_id IS NOT NULL
    AND f.requirement_id = s.cohort_requirement_id
    AND f.fulfilled_on IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Evidence: % completed Coaching sessions disagree with fulfilment', n;
  END IF;
END $$;
