-- ===========================================================================
-- P2 -- rule gaps and consistency (RULES_AUDIT.md, "P2")
--
--  11. A Coaching / Mentoring session can only attach to a requirement of its
--      enrollment's own programme, not merely its cohort (a cohort can
--      schedule several programmes; the calendar would ignore the session).
--  12. Follow-up actions:
--        a. deleting a goal that has actions is refused outright, with a clear
--           message (was ON DELETE SET NULL, which the action trigger then
--           rejected as "New post-session actions require a goal ...");
--        b. a new action's source session must be held or happening:
--           confirmed or completed. Pending, cancelled and rescheduled
--           sessions (Triad: proposed / cancelled) cannot source actions.
--           Confirmed is allowed on purpose: the Session Toolbox (GROW) lets a
--           coach capture commitments during a live session.
--  15. The sponsor's report-request list, its row policy and the organisation
--      "view own" policy also require the sponsor ROLE, like every other
--      sponsor surface (20260926200000).
--  16. The dormant non-canonical Training block in
--      canonical_enrollment_experience_base is removed. Its learning_breakdown
--      was always overwritten by canonical_learning_breakdown in
--      canonical_enrollment_experience, which still adds the key.
--
-- Function bodies below are the live definitions with only the marked lines
-- changed (each change is commented "20261001120000").
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 11. Attribution checks the programme as well as the cohort
-- ---------------------------------------------------------------------------
-- Checked on INSERT and whenever the requirement or enrollment changes -- not
-- on every UPDATE, so a legacy mis-attributed row can still be cancelled,
-- rated or completed (the cohort check keeps its previous behaviour).
CREATE OR REPLACE FUNCTION public.validate_coaching_session_requirement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_enrollment_cohort uuid;
  v_enrollment_programme uuid;
  v_req record;
BEGIN
  IF NEW.enrollment_id IS NULL THEN
    RETURN NEW;  -- validate_session_enrollment_booking already rejects this.
  END IF;

  SELECT e.cohort_id, e.programme_id INTO v_enrollment_cohort, v_enrollment_programme
  FROM public.programme_enrollments e WHERE e.id = NEW.enrollment_id;

  -- cohort_id is derived, never supplied.
  NEW.cohort_id := v_enrollment_cohort;

  IF NEW.cohort_requirement_id IS NOT NULL THEN
    SELECT d.id, d.cohort_id, d.programme_id, d.module INTO v_req
    FROM public.cohort_requirement_dates d WHERE d.id = NEW.cohort_requirement_id;

    IF v_req.id IS NULL THEN
      RAISE EXCEPTION 'Coaching requirement % does not exist', NEW.cohort_requirement_id
        USING ERRCODE = '23503';
    END IF;

    IF v_req.module <> 'coaching'::public.programme_module_type THEN
      RAISE EXCEPTION 'Session requirement % is not a coaching requirement (module=%)',
        NEW.cohort_requirement_id, v_req.module USING ERRCODE = '23514';
    END IF;

    IF v_req.cohort_id IS DISTINCT FROM v_enrollment_cohort THEN
      RAISE EXCEPTION 'Coaching requirement belongs to cohort %, enrollment belongs to cohort %',
        v_req.cohort_id, v_enrollment_cohort USING ERRCODE = '42501';
    END IF;

    -- 20261001120000: and to the enrollment's own programme.
    IF v_req.programme_id IS DISTINCT FROM v_enrollment_programme
       AND (TG_OP = 'INSERT'
            OR NEW.cohort_requirement_id IS DISTINCT FROM OLD.cohort_requirement_id
            OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id) THEN
      RAISE EXCEPTION 'Coaching requirement belongs to programme %, enrollment belongs to programme %',
        v_req.programme_id, v_enrollment_programme USING ERRCODE = '42501';
    END IF;
  END IF;

  -- The Coach must be in the cohort Coach pool. Checked on the session itself
  -- so a direct table write cannot bypass the booking function (section 34:
  -- not frontend-only, not RPC-only).
  --
  -- Only newly-created bookings, a Coach reassignment, or a revival back into
  -- a live state are gated. Updating an already-live session that predates the
  -- Coach pool -- cancelling it, rating it, marking it complete -- must not be
  -- blocked, or this migration would freeze the 22 confirmed sessions that
  -- exist when it runs. Those rows were created under the allowlist model and
  -- are grandfathered by the backfill in 20260920100000, not by an exemption.
  IF v_enrollment_cohort IS NOT NULL
     AND NEW.status IN ('pending_coach_approval', 'confirmed')
     AND (
       TG_OP = 'INSERT'
       OR NEW.coach_id IS DISTINCT FROM OLD.coach_id
       OR OLD.status NOT IN ('pending_coach_approval', 'confirmed')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.cohort_coaching_coach_pool(v_enrollment_cohort) p
       WHERE p.coach_id = NEW.coach_id
     ) THEN
    RAISE EXCEPTION 'Coach % is not in the Coach pool for cohort %', NEW.coach_id, v_enrollment_cohort
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_mentoring_session_requirement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_enrollment_cohort uuid;
  v_enrollment_programme uuid;
  v_req record;
BEGIN
  IF NEW.enrollment_id IS NULL THEN
    RETURN NEW;  -- validate_enrollment_activity already rejects this.
  END IF;

  SELECT e.cohort_id, e.programme_id INTO v_enrollment_cohort, v_enrollment_programme
  FROM public.programme_enrollments e WHERE e.id = NEW.enrollment_id;

  -- cohort_id is derived, never supplied.
  NEW.cohort_id := v_enrollment_cohort;

  -- A new session with no requirement stated takes the learner's next
  -- unfulfilled Mentoring requirement -- the same deterministic rule as the
  -- backfill, and the order the learner actually works through them.
  --
  -- Without this, every Mentoring session created by a path that does not yet
  -- name a requirement (today: the direct client insert, until the booking RPC
  -- lands) would score zero against canonical progress, because fulfilment is
  -- now requirement-attributed. Naming a requirement explicitly always wins;
  -- this only fills a gap, and never invents one where the cohort schedules no
  -- Mentoring or every requirement is already taken.
  IF TG_OP = 'INSERT'
     AND NEW.cohort_requirement_id IS NULL
     AND v_enrollment_cohort IS NOT NULL
     AND NEW.status IN ('pending_coach_approval', 'confirmed', 'completed') THEN
    SELECT d.id INTO NEW.cohort_requirement_id
    FROM public.cohort_requirement_dates d
    JOIN public.programme_enrollments e ON e.id = NEW.enrollment_id
    WHERE d.cohort_id = e.cohort_id
      AND d.programme_id = e.programme_id
      AND d.module = 'mentoring'::public.programme_module_type
      AND NOT EXISTS (
        SELECT 1 FROM public.mentoring_sessions s
        WHERE s.enrollment_id = NEW.enrollment_id
          AND s.cohort_requirement_id = d.id
          AND s.status IN ('pending_coach_approval', 'confirmed', 'completed')
          AND public.session_occupies_requirement(s.status, s.start_time, d.due_on)
      )
    ORDER BY d.ordinal
    LIMIT 1;
  END IF;

  IF NEW.cohort_requirement_id IS NOT NULL THEN
    SELECT d.id, d.cohort_id, d.programme_id, d.module INTO v_req
    FROM public.cohort_requirement_dates d WHERE d.id = NEW.cohort_requirement_id;

    IF v_req.id IS NULL THEN
      RAISE EXCEPTION 'Mentoring requirement % does not exist', NEW.cohort_requirement_id
        USING ERRCODE = '23503';
    END IF;
    IF v_req.module <> 'mentoring'::public.programme_module_type THEN
      RAISE EXCEPTION 'Session requirement % is not a mentoring requirement (module=%)',
        NEW.cohort_requirement_id, v_req.module USING ERRCODE = '23514';
    END IF;
    IF v_req.cohort_id IS DISTINCT FROM v_enrollment_cohort THEN
      RAISE EXCEPTION 'Mentoring requirement belongs to cohort %, enrollment belongs to cohort %',
        v_req.cohort_id, v_enrollment_cohort USING ERRCODE = '42501';
    END IF;
    -- 20261001120000: and to the enrollment's own programme.
    IF v_req.programme_id IS DISTINCT FROM v_enrollment_programme
       AND (TG_OP = 'INSERT'
            OR NEW.cohort_requirement_id IS DISTINCT FROM OLD.cohort_requirement_id
            OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id) THEN
      RAISE EXCEPTION 'Mentoring requirement belongs to programme %, enrollment belongs to programme %',
        v_req.programme_id, v_enrollment_programme USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 12a. A goal with follow-up actions cannot be deleted
-- ---------------------------------------------------------------------------
-- Goals are archived, not deleted, by the app. The guard gives the refusal a
-- readable message; the RESTRICT FK is the backstop.
CREATE OR REPLACE FUNCTION public.guard_goal_delete_with_actions()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.enrollment_actions a WHERE a.goal_id = OLD.id) THEN
    RAISE EXCEPTION 'Cannot delete a goal that has follow-up actions'
      USING ERRCODE = '23503', HINT = 'Archive the goal instead.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS guard_goal_delete_with_actions ON public.coachee_goals;
CREATE TRIGGER guard_goal_delete_with_actions
  BEFORE DELETE ON public.coachee_goals
  FOR EACH ROW EXECUTE FUNCTION public.guard_goal_delete_with_actions();

ALTER TABLE public.enrollment_actions
  DROP CONSTRAINT enrollment_actions_goal_id_fkey,
  ADD CONSTRAINT enrollment_actions_goal_id_fkey
    FOREIGN KEY (goal_id) REFERENCES public.coachee_goals(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- 12b. A new action's source session must be confirmed or completed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enrollment_activity_status(
  p_source_activity_type text, p_source_activity_id uuid
) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_source_activity_type
    WHEN 'coaching' THEN (SELECT s.status::text FROM public.sessions s WHERE s.id = p_source_activity_id)
    WHEN 'mentoring' THEN (SELECT s.status::text FROM public.mentoring_sessions s WHERE s.id = p_source_activity_id)
    WHEN 'peer_coaching' THEN (SELECT s.status::text FROM public.peer_sessions s WHERE s.id = p_source_activity_id)
    WHEN 'coachee_peer_coaching' THEN (SELECT s.status::text FROM public.coachee_peer_sessions s WHERE s.id = p_source_activity_id)
    WHEN 'triad' THEN (SELECT s.status FROM public.triad_sessions s WHERE s.id = p_source_activity_id)
  END;
$$;
REVOKE ALL ON FUNCTION public.enrollment_activity_status(text, uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.enrollment_activity_status(text, uuid) IS
  'The status of an action''s source activity (any of the five session kinds). Internal.';

CREATE OR REPLACE FUNCTION public.validate_enrollment_action()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  milestone public.coachee_milestones;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    new.enrollment_id IS DISTINCT FROM old.enrollment_id
    OR new.owner_user_id IS DISTINCT FROM old.owner_user_id
    OR new.source_activity_type IS DISTINCT FROM old.source_activity_type
    OR new.source_activity_id IS DISTINCT FROM old.source_activity_id
  ) THEN
    RAISE EXCEPTION 'Action enrollment, owner and source cannot be changed' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_enrollment_scope(new.enrollment_id, new.owner_user_id);

  -- Historical rows remain editable without invented metadata. Every insert,
  -- and every update of a row that already has metadata, must be complete.
  IF TG_OP = 'INSERT'
     OR old.goal_id IS NOT NULL
     OR old.due_date IS NOT NULL
     OR new.goal_id IS NOT NULL
     OR new.due_date IS NOT NULL THEN
    IF new.goal_id IS NULL OR new.due_date IS NULL THEN
      RAISE EXCEPTION 'New post-session actions require a goal and due date' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND (new.source_activity_type IS NULL OR new.source_activity_id IS NULL) THEN
    RAISE EXCEPTION 'New post-session actions require their source activity' USING ERRCODE = '23514';
  END IF;

  IF new.goal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.coachee_goals g
    WHERE g.id = new.goal_id AND g.enrollment_id = new.enrollment_id
  ) THEN
    RAISE EXCEPTION 'Action goal must belong to the action enrollment' USING ERRCODE = '42501';
  END IF;

  IF new.milestone_id IS NOT NULL THEN
    SELECT * INTO milestone
    FROM public.coachee_milestones
    WHERE id = new.milestone_id AND enrollment_id = new.enrollment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Action milestone must belong to the action enrollment' USING ERRCODE = '42501';
    END IF;
    IF milestone.goal_id IS DISTINCT FROM new.goal_id THEN
      RAISE EXCEPTION 'Action milestone must belong to the action goal' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF (new.source_activity_type IS NULL) <> (new.source_activity_id IS NULL) THEN
    RAISE EXCEPTION 'Action source activity type and ID must be provided together' USING ERRCODE = 'P0001';
  END IF;
  IF new.source_activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.enrollment_activity_participants(
      new.enrollment_id, new.source_activity_type, new.source_activity_id
    ) a
    WHERE a.learner_id = new.owner_user_id
  ) THEN
    RAISE EXCEPTION 'Action source must belong to the action enrollment' USING ERRCODE = '42501';
  END IF;
  -- 20261001120000: a NEW action needs a session that is happening or held.
  -- save_enrollment_activity_actions upserts every action on each save, and a
  -- BEFORE INSERT trigger fires even when the upsert resolves to an update,
  -- so only an id not yet stored counts as new: the existing actions of a
  -- session cancelled later stay editable.
  IF TG_OP = 'INSERT'
     AND new.source_activity_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.enrollment_actions x WHERE x.id = new.id)
     AND public.enrollment_activity_status(new.source_activity_type, new.source_activity_id)
         IS DISTINCT FROM 'confirmed'
     AND public.enrollment_activity_status(new.source_activity_type, new.source_activity_id)
         IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'Actions can only be added to a confirmed or completed session (status=%)',
      public.enrollment_activity_status(new.source_activity_type, new.source_activity_id)
      USING ERRCODE = '23514';
  END IF;
  IF nullif(btrim(new.title), '') IS NULL THEN
    RAISE EXCEPTION 'Action title is required' USING ERRCODE = 'P0001';
  END IF;
  RETURN new;
END
$function$;

-- ---------------------------------------------------------------------------
-- 15. Report requests and the organisation row need the sponsor role
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sponsor_list_report_requests()
 RETURNS SETOF sponsor_report_requests
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT r.* FROM public.sponsor_report_requests r
  JOIN public.sponsor_profiles sp ON sp.organization_id = r.organization_id
  WHERE sp.user_id = auth.uid()
    AND public.has_role(auth.uid(), 'sponsor'::public.app_role)  -- 20261001120000
  ORDER BY r.created_at DESC;
$function$;

DROP POLICY IF EXISTS sponsor_report_requests_sponsor_read ON public.sponsor_report_requests;
CREATE POLICY sponsor_report_requests_sponsor_read ON public.sponsor_report_requests
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'sponsor'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.sponsor_profiles sp
      WHERE sp.user_id = auth.uid() AND sp.organization_id = sponsor_report_requests.organization_id
    )
  );

DROP POLICY IF EXISTS "Organizations: sponsor view own" ON public.organizations;
CREATE POLICY "Organizations: sponsor view own" ON public.organizations
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'sponsor'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.sponsor_profiles sp
      WHERE sp.user_id = auth.uid() AND sp.organization_id = organizations.id
    )
  );

-- ---------------------------------------------------------------------------
-- 16. Remove the dormant non-canonical Training block
-- ---------------------------------------------------------------------------
-- learning_weeks / learning_items / learning_keys / learning counted a skill
-- card as done whenever completed_at existed, with no availability window,
-- and read training weeks without their stored requirement rows. Its only
-- output, learning_breakdown, was overwritten by canonical_learning_breakdown
-- in canonical_enrollment_experience. Removed, not fixed.
CREATE OR REPLACE FUNCTION public.canonical_enrollment_experience_base(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH progress AS (
    SELECT *
    FROM public.canonical_enrollment_progress(p_enrollment_id, p_as_of)
  ),
  eligible AS (
    SELECT
      p.enrollment_id,
      p.programme_id,
      p.cohort_id,
      p.programme_start_date
    FROM progress p
  ),
  schedule AS (
    SELECT
      e.enrollment_id,
      s.module,
      s.due_on,
      s.milestone_units,
      coalesce(tw.week_number, greatest(
        1,
        floor((s.due_on - e.programme_start_date)::numeric / 7)::integer + 1
      )) AS week_number
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_module_schedule(e.enrollment_id) s
    LEFT JOIN public.training_weeks tw ON tw.id = s.training_week_id
    WHERE s.due_on IS NOT NULL
  ),
  schedule_weeks AS (
    SELECT
      week_number,
      min(due_on) - 6 AS week_start,
      max(due_on) AS week_end,
      sum(milestone_units)::integer AS required_units
    FROM schedule
    GROUP BY week_number
  ),
  activity AS (
    SELECT
      e.enrollment_id,
      a.occurred_on,
      a.status,
      greatest(
        1,
        floor((a.occurred_on - e.programme_start_date)::numeric / 7)::integer + 1
      ) AS week_number
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_activity(e.enrollment_id) a
    WHERE a.occurred_on <= p_as_of
  ),
  weekly AS (
    SELECT
      sw.week_number,
      sw.week_start,
      sw.week_end,
      sw.required_units,
      least(
        sw.required_units,
        coalesce(sum(1) FILTER (WHERE a.status = 'completed'), 0)
      )::integer AS completed_units,
      coalesce(sum(1) FILTER (WHERE a.status = 'completed'), 0)::integer AS activity_units
    FROM schedule_weeks sw
    LEFT JOIN activity a ON a.week_number = sw.week_number
    GROUP BY sw.week_number, sw.week_start, sw.week_end, sw.required_units
  ),
  coaching AS (
    SELECT
      p.coaching_required_units AS required_units,
      p.coaching_completed_units AS completed_units,
      p.coaching_due_units AS due_units,
      p.coaching_booked_units AS booked_units,
      CASE
        WHEN p.coaching_required_units IS NULL OR p.coaching_required_units = 0 THEN NULL
        ELSE round(
          least(p.coaching_completed_units, p.coaching_required_units) * 100.0
          / p.coaching_required_units, 1
        )
      END AS utilisation_pct,
      (
        SELECT min(s.start_time)
        FROM public.sessions s
        WHERE s.enrollment_id = p.enrollment_id
          AND s.status IN ('pending_coach_approval', 'confirmed')
          AND s.start_time >= now()
      ) AS next_session_at
    FROM progress p
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM progress) THEN '{}'::jsonb
    ELSE jsonb_build_object(
      'weekly_participation',
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'week_number', w.week_number,
          'week_start', w.week_start,
          'week_end', w.week_end,
          'required_units', w.required_units,
          'due_units', CASE WHEN p_as_of >= w.week_end THEN w.required_units ELSE 0 END,
          'completed_units', w.completed_units,
          'activity_units', w.activity_units,
          'state', CASE
            WHEN p_as_of < w.week_start THEN 'upcoming'
            WHEN w.required_units > 0 AND w.completed_units >= w.required_units THEN 'completed'
            WHEN p_as_of <= w.week_end THEN 'current'
            ELSE 'overdue'
          END,
          'is_current', p_as_of >= w.week_start AND p_as_of <= w.week_end
        ) ORDER BY w.week_number)
        FROM weekly w
      ), '[]'::jsonb),
      -- 20261001120000: learning_breakdown is added by
      -- canonical_enrollment_experience (canonical_learning_breakdown).
      'coaching_utilisation',
      coalesce((SELECT to_jsonb(c) FROM coaching c), '{}'::jsonb)
    )
  END;
$function$;
