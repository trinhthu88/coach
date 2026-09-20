-- ============================================================================
-- TRIAD REQUIREMENT-SPECIFIC GROUPS (forward correction; DEPLOYMENT 1b).
--
-- Deployment 1 (20260918185800 .. 20260918195000) is live in production with
-- cohort-level groups and completion = distinct completed sessions. The
-- agreed business rule is different:
--
--   EVERY REQUIRED TRIAD SESSION HAS ITS OWN GROUP ASSIGNMENT.
--
--   programme_modules ........ Triads required = N
--   cohort_requirement_dates . Triad unit 1..N, each with its deadline
--                              (THE Triad "round" — no other round object)
--   triad_groups ............. one group assignment FOR ONE requirement
--                              (cohort_requirement_date_id; cohort_id is kept
--                              and always equals the requirement's cohort)
--   triad_group_members ...... enrollments assigned to that requirement's group
--   triad_sessions ........... the actual session of that group
--   fulfilment ............... a completed session of a requirement's group
--                              fulfils THAT requirement, once
--   canonical progress ....... fulfilled requirements (capped at N) against
--                              each requirement's own deadline
--
-- A learner may be in different groups for Triad 1, 2, 3 …, but in at most
-- one active group per requirement. Extra sessions under one requirement are
-- raw activity only; they never fulfil another requirement.
--
-- Because deployment 1 is applied in production, this is a forward
-- migration (history is not rewritten). Every existing group is mapped to a
-- requirement by a deterministic rule; anything ambiguous stops the
-- deployment. Demo data that contradicts the rule is archived and reseeded.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Before-state (reported at the end).
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _rq_before_progress ON COMMIT DROP AS
SELECT e.id AS enrollment_id, p.required_units, p.completed_activity_units, p.completed_units,
  p.due_units, p.booked_units, p.overdue_units, p.pace_status
FROM public.programme_enrollments e
CROSS JOIN LATERAL public.canonical_module_progress(e.id, current_date) p
WHERE p.module = 'triads'::public.programme_module_type;

CREATE TEMP TABLE _rq_before_counts ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.triad_groups) AS groups,
  (SELECT count(*) FROM public.triad_group_members) AS members,
  (SELECT count(*) FROM public.triad_reflections) AS reflections;

CREATE TEMP TABLE _rq_before_members ON COMMIT DROP AS
SELECT m.triad_group_id, m.enrollment_id FROM public.triad_group_members m;

-- ----------------------------------------------------------------------------
-- 1. The requirement link.
-- ----------------------------------------------------------------------------
ALTER TABLE public.triad_groups
  ADD COLUMN cohort_requirement_date_id uuid REFERENCES public.cohort_requirement_dates(id) ON DELETE RESTRICT;
COMMENT ON COLUMN public.triad_groups.cohort_requirement_date_id IS
  'The cohort Triad requirement (unit N) this group was assigned for. The deadline, unit number, cohort and programme are the requirement''s; the group owns no date.';
COMMENT ON COLUMN public.triad_groups.cohort_id IS
  'Derived: always the cohort of cohort_requirement_date_id (kept for integrity checks and lookups; enforced by triad_guard_group). Never a scope of its own.';

-- ----------------------------------------------------------------------------
-- 2. Map every existing group to its requirement.
--    Rule: a group is for the member's next unfulfilled unit at the time the
--    group was formed — unit = 1 + the number of the member's EARLIER groups
--    (same cohort) that have a completed session. All members must agree,
--    and the unit must exist in the cohort's Triad schedule of the members'
--    programme. Anything else stops the deployment.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _rq_map ON COMMIT DROP AS
WITH member_units AS (
  SELECT g.id AS triad_group_id, g.cohort_id, e.programme_id, m.enrollment_id,
    1 + (SELECT count(*) FROM public.triad_group_members m2
         JOIN public.triad_groups g2 ON g2.id = m2.triad_group_id
         WHERE m2.enrollment_id = m.enrollment_id AND g2.id <> g.id AND g2.cohort_id = g.cohort_id
           AND (g2.created_at, g2.id) < (g.created_at, g.id)
           AND EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.triad_group_id = g2.id AND s.status = 'completed')) AS unit
  FROM public.triad_groups g
  JOIN public.triad_group_members m ON m.triad_group_id = g.id
  JOIN public.programme_enrollments e ON e.id = m.enrollment_id
)
SELECT mu.triad_group_id, min(mu.cohort_id::text)::uuid AS cohort_id,
  count(DISTINCT mu.programme_id) AS programmes, min(mu.programme_id::text)::uuid AS programme_id,
  min(mu.unit) AS min_unit, max(mu.unit) AS max_unit,
  (SELECT d.id FROM public.cohort_requirement_dates d
   WHERE d.cohort_id = min(mu.cohort_id::text)::uuid AND d.programme_id = min(mu.programme_id::text)::uuid
     AND d.module = 'triads'::public.programme_module_type AND d.ordinal = max(mu.unit)) AS cohort_requirement_date_id
FROM member_units mu
GROUP BY mu.triad_group_id;

DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s (units %s-%s, programmes %s)', m.triad_group_id, m.min_unit, m.max_unit, m.programmes), '; ') INTO bad
  FROM _rq_map m
  WHERE m.cohort_requirement_date_id IS NULL OR m.min_unit <> m.max_unit OR m.programmes <> 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad requirement groups: cannot map groups to one requirement: %', bad
      USING HINT = 'Review the listed groups (scripts/triad-cutover-readiness.sql) before deploying.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.triad_groups g WHERE NOT EXISTS (SELECT 1 FROM _rq_map m WHERE m.triad_group_id = g.id)) THEN
    RAISE EXCEPTION 'Triad requirement groups: groups without members cannot be mapped';
  END IF;
END $$;

-- The deferred group-size trigger and the group guard are not involved in a
-- plain column update; the guard below is replaced after the backfill.
ALTER TABLE public.triad_groups DISABLE TRIGGER triad_groups_guard;
UPDATE public.triad_groups g SET cohort_requirement_date_id = m.cohort_requirement_date_id
FROM _rq_map m WHERE m.triad_group_id = g.id;
ALTER TABLE public.triad_groups ENABLE TRIGGER triad_groups_guard;
ALTER TABLE public.triad_groups ALTER COLUMN cohort_requirement_date_id SET NOT NULL;
CREATE INDEX triad_groups_requirement_idx ON public.triad_groups(cohort_requirement_date_id, is_active);


-- ----------------------------------------------------------------------------
-- 3. Integrity: a group belongs to one requirement; its cohort is the
--    requirement's cohort; one active group per enrollment PER REQUIREMENT
--    (a learner is in different groups for Triad 1, 2, …); membership is
--    final once the group has a session.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.triad_validate_group_member()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  g public.triad_groups;
  req public.cohort_requirement_dates;
  e public.programme_enrollments;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Triad membership rows are not edited: remove and add a member instead' USING ERRCODE = '42501';
  END IF;
  -- An existing (group, enrollment) row: the unique constraint decides.
  IF EXISTS (SELECT 1 FROM public.triad_group_members x
             WHERE x.triad_group_id = NEW.triad_group_id AND x.enrollment_id = NEW.enrollment_id) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO g FROM public.triad_groups WHERE id = NEW.triad_group_id FOR UPDATE;
  SELECT * INTO req FROM public.cohort_requirement_dates WHERE id = g.cohort_requirement_date_id;
  SELECT * INTO e FROM public.programme_enrollments WHERE id = NEW.enrollment_id;
  -- Serialise membership changes per enrollment and requirement.
  PERFORM pg_advisory_xact_lock(hashtextextended('triad_member:' || NEW.enrollment_id::text || ':' || g.cohort_requirement_date_id::text, 0));

  IF EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.triad_group_id = g.id) THEN
    RAISE EXCEPTION 'Membership of a Triad group with sessions is final: close it and create a replacement group' USING ERRCODE = '42501';
  END IF;
  IF NOT g.is_active THEN
    RAISE EXCEPTION 'A closed Triad group cannot change membership' USING ERRCODE = '42501';
  END IF;
  IF e.cohort_id IS DISTINCT FROM req.cohort_id OR e.programme_id IS DISTINCT FROM req.programme_id THEN
    RAISE EXCEPTION 'Triad members must be enrolled in the requirement''s cohort and programme' USING ERRCODE = '42501';
  END IF;
  IF req.ordinal > public.triad_required_units_for_programme(req.programme_id) THEN
    RAISE EXCEPTION 'Triad % is beyond the programme''s required Triads', req.ordinal USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.triad_group_members o
    JOIN public.programme_enrollments oe ON oe.id = o.enrollment_id
    WHERE o.triad_group_id = NEW.triad_group_id AND o.id <> NEW.id AND oe.user_id = e.user_id
  ) THEN
    RAISE EXCEPTION 'A learner can appear only once in a Triad group' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.triad_group_members o
    JOIN public.triad_groups og ON og.id = o.triad_group_id
    WHERE o.enrollment_id = NEW.enrollment_id AND og.id <> g.id AND og.is_active
      AND og.cohort_requirement_date_id = g.cohort_requirement_date_id
  ) THEN
    RAISE EXCEPTION 'This learner already has an active group for Triad %', req.ordinal USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.triad_guard_group()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE req public.cohort_requirement_dates;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT public.triad_demo_reset_allows('triad_group', OLD.id) AND EXISTS (
      SELECT 1 FROM public.triad_sessions s
      WHERE s.triad_group_id = OLD.id
        AND (s.status = 'completed'
             OR EXISTS (SELECT 1 FROM public.triad_reflections r WHERE r.triad_session_id = s.id)
             OR EXISTS (SELECT 1 FROM public.goal_checkins gc WHERE gc.source_activity_type = 'triad' AND gc.source_activity_id = s.id))
    ) THEN
      RAISE EXCEPTION 'A Triad group with completed sessions or reflections is history and cannot be deleted' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO req FROM public.cohort_requirement_dates WHERE id = NEW.cohort_requirement_date_id;
  IF NOT FOUND OR req.module <> 'triads'::public.programme_module_type THEN
    RAISE EXCEPTION 'A Triad group is assigned for one cohort Triad requirement' USING ERRCODE = '23502';
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- The cohort is the requirement's; a different value is refused.
    IF NEW.cohort_id IS NOT NULL AND NEW.cohort_id <> req.cohort_id THEN
      RAISE EXCEPTION 'A Triad group''s cohort is its requirement''s cohort' USING ERRCODE = '42501';
    END IF;
    NEW.cohort_id := req.cohort_id;
    NEW.closed_at := CASE WHEN NEW.is_active THEN NULL ELSE coalesce(NEW.closed_at, now()) END;
    RETURN NEW;
  END IF;
  IF NEW.cohort_requirement_date_id IS DISTINCT FROM OLD.cohort_requirement_date_id
     OR NEW.cohort_id IS DISTINCT FROM OLD.cohort_id THEN
    RAISE EXCEPTION 'A Triad group''s requirement (and cohort) cannot change' USING ERRCODE = '42501';
  END IF;
  IF NOT NEW.is_active AND OLD.is_active THEN
    NEW.closed_at := now();
  ELSIF NEW.is_active AND NOT OLD.is_active THEN
    IF EXISTS (
      SELECT 1 FROM public.triad_group_members m
      JOIN public.triad_group_members o ON o.enrollment_id = m.enrollment_id AND o.triad_group_id <> m.triad_group_id
      JOIN public.triad_groups og ON og.id = o.triad_group_id
      WHERE m.triad_group_id = NEW.id AND og.is_active AND og.cohort_requirement_date_id = NEW.cohort_requirement_date_id
    ) THEN
      RAISE EXCEPTION 'A member already has another active group for this Triad' USING ERRCODE = '23505';
    END IF;
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END $$;

-- A requirement date that groups were assigned for cannot be removed (its
-- identity is referenced); editing its due date is always allowed.
CREATE OR REPLACE FUNCTION public.admin_save_cohort_requirement_dates_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.triad_groups g WHERE g.cohort_requirement_date_id = OLD.id) THEN
    RAISE EXCEPTION 'Triad % has assigned groups; its date can be changed but the requirement cannot be removed', OLD.ordinal
      USING ERRCODE = '22023';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER cohort_requirement_dates_keep_triad_groups
  BEFORE DELETE ON public.cohort_requirement_dates
  FOR EACH ROW WHEN (OLD.module = 'triads'::public.programme_module_type)
  EXECUTE FUNCTION public.admin_save_cohort_requirement_dates_guard();


-- ----------------------------------------------------------------------------
-- 4. Requirement identity survives schedule edits: "Regenerate schedule"
--    updates units in place instead of deleting and re-inserting them.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_cohort_requirement_dates(
  p_cohort_id uuid,
  p_items jsonb,
  p_regenerate boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.cohorts;
  item record;
  proposal record;
  saved integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can edit cohort requirement dates' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.cohorts WHERE id = p_cohort_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cohort not found' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Requirement dates must be a JSON array' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.crd_items (
    programme_id uuid, module public.programme_module_type, ordinal integer, due_on date
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.crd_items;

  INSERT INTO pg_temp.crd_items
  SELECT (x->>'programme_id')::uuid,
    (x->>'module')::public.programme_module_type,
    (x->>'ordinal')::integer,
    (x->>'due_on')::date
  FROM jsonb_array_elements(p_items) x;

  IF EXISTS (SELECT 1 FROM pg_temp.crd_items i
             WHERE i.programme_id IS NULL OR i.module IS NULL OR i.ordinal IS NULL OR i.ordinal < 1) THEN
    RAISE EXCEPTION 'Each requirement date needs a programme, module and unit number' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.crd_items i WHERE i.due_on IS NULL) THEN
    RAISE EXCEPTION 'Every requirement needs a due date' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.crd_items i GROUP BY i.programme_id, i.module, i.ordinal HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate requirement unit numbers' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.crd_items i
    WHERE i.programme_id NOT IN (SELECT sp.programme_id FROM public.cohort_scheduled_programmes(p_cohort_id) sp)
  ) THEN
    RAISE EXCEPTION 'Requirement dates must belong to the cohort''s programme' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.crd_items i
    WHERE i.module = 'training'::public.programme_module_type
       OR NOT EXISTS (
         SELECT 1 FROM public.programme_modules pm
         WHERE pm.programme_id = i.programme_id
           AND pm.module = i.module
           AND pm.enabled
           AND coalesce((pm.config->>'required')::boolean, false)
           AND coalesce(public.programme_config_integer(pm.config, 'required_units'), 0) > 0
       )
  ) THEN
    RAISE EXCEPTION 'Requirement dates must match the programme''s required modules' USING ERRCODE = '22023';
  END IF;
  IF c.start_date IS NOT NULL AND c.end_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_temp.crd_items i WHERE i.due_on < c.start_date OR i.due_on > c.end_date
  ) THEN
    RAISE EXCEPTION 'Requirement dates must fall within the cohort dates (% – %)', c.start_date, c.end_date
      USING ERRCODE = '22023';
  END IF;

  IF p_regenerate THEN
    -- Regenerate IN PLACE: a unit keeps its identity (Triad groups are
    -- assigned for it); only units no longer listed are removed (refused by
    -- cohort_requirement_dates_keep_triad_groups when groups exist for them).
    DELETE FROM public.cohort_requirement_dates d
    USING (SELECT DISTINCT i.programme_id, i.module FROM pg_temp.crd_items i) pairs
    WHERE d.cohort_id = p_cohort_id
      AND d.programme_id = pairs.programme_id
      AND d.module = pairs.module
      AND NOT EXISTS (SELECT 1 FROM pg_temp.crd_items i
                      WHERE i.programme_id = d.programme_id AND i.module = d.module AND i.ordinal = d.ordinal);

    INSERT INTO public.cohort_requirement_dates (
      cohort_id, programme_id, module, ordinal, due_on, units, training_week_id,
      generation_method, materialized_via, generated_due_on, is_overridden, updated_by
    )
    SELECT p_cohort_id, i.programme_id, i.module, i.ordinal, i.due_on,
      coalesce(p.units, 1), p.training_week_id,
      coalesce(p.generation_method, 'manual'), 'admin_regenerate', p.due_on,
      p.due_on IS DISTINCT FROM i.due_on, auth.uid()
    FROM pg_temp.crd_items i
    LEFT JOIN LATERAL (
      SELECT pr.* FROM public.cohort_requirement_proposal_internal(i.programme_id, p_cohort_id, c.start_date, c.end_date) pr
      WHERE pr.module = i.module AND pr.ordinal = i.ordinal
    ) p ON true
    ON CONFLICT (cohort_id, programme_id, module, ordinal) DO UPDATE
    SET due_on = EXCLUDED.due_on, units = EXCLUDED.units, training_week_id = EXCLUDED.training_week_id,
      generation_method = EXCLUDED.generation_method, materialized_via = EXCLUDED.materialized_via,
      generated_due_on = EXCLUDED.generated_due_on, is_overridden = EXCLUDED.is_overridden,
      updated_by = EXCLUDED.updated_by;
    GET DIAGNOSTICS saved = ROW_COUNT;
    RETURN saved;
  END IF;

  FOR item IN SELECT * FROM pg_temp.crd_items LOOP
    UPDATE public.cohort_requirement_dates d
    SET due_on = item.due_on,
      is_overridden = d.generated_due_on IS DISTINCT FROM item.due_on,
      updated_by = auth.uid()
    WHERE d.cohort_id = p_cohort_id
      AND d.programme_id = item.programme_id
      AND d.module = item.module
      AND d.ordinal = item.ordinal;

    IF NOT FOUND THEN
      -- A unit that has no date yet (e.g. required units increased): add it,
      -- recording the policy date it would have had.
      SELECT pr.* INTO proposal
      FROM public.cohort_requirement_proposal_internal(item.programme_id, p_cohort_id, c.start_date, c.end_date) pr
      WHERE pr.module = item.module AND pr.ordinal = item.ordinal;

      INSERT INTO public.cohort_requirement_dates (
        cohort_id, programme_id, module, ordinal, due_on, units, training_week_id,
        generation_method, materialized_via, generated_due_on, is_overridden, updated_by
      ) VALUES (
        p_cohort_id, item.programme_id, item.module, item.ordinal, item.due_on,
        coalesce(proposal.units, 1), proposal.training_week_id,
        coalesce(proposal.generation_method, 'manual'), 'admin_save', proposal.due_on,
        proposal.due_on IS DISTINCT FROM item.due_on, auth.uid()
      );
    END IF;
    saved := saved + 1;
  END LOOP;
  RETURN saved;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_cohort_requirement_dates(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_cohort_requirement_dates(uuid, jsonb, boolean) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5a. THE rule: one row per cohort Triad requirement of the enrollment.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_triad_requirement_fulfilment(p_enrollment_id uuid)
RETURNS TABLE (cohort_requirement_date_id uuid, unit_number integer, due_on date,
  fulfilled_on date, booked_on date, proposed_on date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.id, d.ordinal, d.due_on,
    min(ev.occurred_on) FILTER (WHERE ev.status = 'completed'),
    min(ev.occurred_on) FILTER (WHERE ev.status = 'confirmed'),
    min(ev.occurred_on) FILTER (WHERE ev.status = 'proposed')
  FROM public.programme_enrollments e
  JOIN public.cohort_requirement_dates d
    ON d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id
   AND d.module = 'triads'::public.programme_module_type
  LEFT JOIN LATERAL (
    -- Evidence of THIS enrollment on sessions of groups for THIS requirement.
    SELECT a.occurred_on, s.status
    FROM public.triad_groups g
    JOIN public.triad_group_members m ON m.triad_group_id = g.id AND m.enrollment_id = e.id
    JOIN public.triad_sessions s ON s.triad_group_id = g.id
    JOIN public.session_activity_attributions a
      ON a.source_activity_type = 'triad' AND a.source_activity_id = s.id AND a.enrollment_id = e.id
    WHERE g.cohort_requirement_date_id = d.id
  ) ev ON true
  WHERE e.id = p_enrollment_id
  GROUP BY d.id, d.ordinal, d.due_on;
$$;
COMMENT ON FUNCTION public.canonical_triad_requirement_fulfilment(uuid) IS
  'THE Triad completion rule: a completed Triad session fulfils the cohort Triad requirement of its group (once, on its first completed session date). Internal.';

-- ----------------------------------------------------------------------------
-- 5b. Activity: Triads contribute one row per requirement (with its due date).
-- ----------------------------------------------------------------------------
DROP FUNCTION public.sponsor_canonical_activity(uuid);
CREATE FUNCTION public.sponsor_canonical_activity(p_enrollment_id uuid)
 RETURNS TABLE(module programme_module_type, occurred_on date, status text, requirement_due_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed'), NULL::date
  FROM public.session_activity_attributions a
  LEFT JOIN public.sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'coaching'

  UNION ALL
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed'), NULL::date
  FROM public.session_activity_attributions a
  LEFT JOIN public.peer_sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'peer_coaching'

  UNION ALL
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed'), NULL::date
  FROM public.session_activity_attributions a
  LEFT JOIN public.coachee_peer_sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'peer_coaching'
    AND NOT EXISTS (
      SELECT 1 FROM public.peer_sessions existing_peer
      WHERE existing_peer.id = a.source_activity_id
    )

  UNION ALL
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed'), NULL::date
  FROM public.session_activity_attributions a
  LEFT JOIN public.mentoring_sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'mentoring'

  UNION ALL
  -- Triads: one row per cohort Triad requirement (fulfilled, else booked,
  -- else proposed), never one per session.
  SELECT 'triads'::public.programme_module_type,
    coalesce(f.fulfilled_on, f.booked_on, f.proposed_on),
    CASE WHEN f.fulfilled_on IS NOT NULL THEN 'completed'
         WHEN f.booked_on IS NOT NULL THEN 'confirmed'
         ELSE 'proposed' END,
    f.due_on
  FROM public.canonical_triad_requirement_fulfilment(p_enrollment_id) f
  WHERE coalesce(f.fulfilled_on, f.booked_on, f.proposed_on) IS NOT NULL

  UNION ALL
  SELECT a.module, a.occurred_on, 'completed', NULL::date
  FROM public.session_activity_attributions a
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type IN ('quiz', 'daily_prompt')

  UNION ALL
  SELECT 'training'::public.programme_module_type,
    i.completed_on,
    'completed',
    NULL::date
  FROM public.canonical_training_learning_items(p_enrollment_id, current_date) i
  WHERE i.completed_units > 0
    AND i.completed_on IS NOT NULL;
$function$;

-- ----------------------------------------------------------------------------
-- 5c. Progress: a requirement-bound unit counts toward "due" only once its own
--    requirement is due (an early unit 2 never hides an overdue unit 1).
--    Modules without requirement-bound activity are unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_module_progress(p_enrollment_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS TABLE(module programme_module_type, required_units integer, completed_activity_units integer, completed_units integer, due_units integer, booked_units integer, overdue_units integer, pace_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH schedule AS (
    SELECT * FROM public.sponsor_canonical_module_schedule(p_enrollment_id)
  ), modules AS (
    SELECT s.module,
      max(s.required_units)::integer AS required_units,
      coalesce(sum(s.milestone_units)
        FILTER (WHERE s.due_on <= p_as_of), 0)::integer AS due_units
    FROM schedule s
    GROUP BY s.module
  ), learning AS (
    SELECT *
    FROM public.canonical_training_learning_summary(p_enrollment_id, p_as_of)
  ), activity AS (
    SELECT *
    FROM public.sponsor_canonical_activity(p_enrollment_id)
  ), counts AS (
    SELECT m.module,
      count(a.occurred_on) FILTER (
        WHERE a.status = 'completed'
          AND a.occurred_on <= p_as_of
      )::integer AS completed_activity_units,
      -- Completed units whose own requirement is already due.
      count(a.occurred_on) FILTER (
        WHERE a.status = 'completed'
          AND a.occurred_on <= p_as_of
          AND (a.requirement_due_on IS NULL OR a.requirement_due_on <= p_as_of)
      )::integer AS completed_due_units,
      count(a.occurred_on) FILTER (
        WHERE a.status IN ('pending_coach_approval', 'confirmed')
          AND a.occurred_on >= p_as_of
      )::integer AS raw_booked_units
    FROM modules m
    LEFT JOIN activity a ON a.module = m.module
    GROUP BY m.module
  ), values AS (
    SELECT m.module, m.required_units,
      CASE WHEN m.module = 'training'
        THEN coalesce(l.completed_units, 0)
        ELSE coalesce(c.completed_activity_units, 0)
      END::integer AS completed_activity_units,
      CASE WHEN m.module = 'training'
        THEN coalesce(l.completed_units, 0)
        ELSE least(coalesce(c.completed_activity_units, 0), m.required_units)
      END::integer AS completed_units,
      CASE WHEN m.module = 'training'
        THEN coalesce(l.completed_units, 0)
        ELSE least(coalesce(c.completed_due_units, 0), m.required_units)
      END::integer AS completed_due_units,
      CASE WHEN m.module = 'training'
        THEN coalesce(l.due_units, 0)
        ELSE m.due_units
      END::integer AS due_units,
      CASE WHEN m.module = 'training' THEN 0
        ELSE least(
          coalesce(c.raw_booked_units, 0),
          greatest(m.required_units - least(coalesce(c.completed_activity_units, 0), m.required_units), 0)
        )
      END::integer AS booked_units,
      CASE WHEN m.module = 'training'
        THEN coalesce(l.overdue_units, 0)
        ELSE greatest(0, m.due_units - least(coalesce(c.completed_due_units, 0), m.due_units))
      END::integer AS overdue_units
    FROM modules m
    LEFT JOIN counts c ON c.module = m.module
    LEFT JOIN learning l ON m.module = 'training'
  )
  SELECT v.module, v.required_units, v.completed_activity_units,
    least(v.completed_units, v.required_units)::integer,
    v.due_units, v.booked_units, v.overdue_units,
    CASE
      WHEN v.required_units = 0 OR v.completed_units >= v.required_units THEN 'completed'
      WHEN v.due_units = 0 THEN 'not_yet_due'
      WHEN v.completed_due_units >= v.due_units THEN
        CASE WHEN v.completed_units > v.due_units THEN 'ahead' ELSE 'on_track' END
      WHEN v.completed_due_units + v.booked_units >= v.due_units THEN 'scheduled'
      ELSE 'behind'
    END
  FROM values v
  ORDER BY v.module;
$function$;

-- ----------------------------------------------------------------------------
-- 5d. Journeys: a requirement-bound unit counts only at checkpoints on or after
--    its own requirement's due date.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_enrollment_journey(p_enrollment_id uuid, p_as_of date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eligible AS (
    SELECT e.id, e.cohort_id
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
  ), schedule AS (
    SELECT e.id AS enrollment_id, s.module, s.required_units,
      s.due_on, s.milestone_units, s.training_week_id
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_module_schedule(e.id) s
    WHERE s.due_on IS NOT NULL
  ), activity AS (
    SELECT e.id AS enrollment_id, a.module, a.occurred_on, a.status, a.requirement_due_on
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_activity(e.id) a
  ), dates AS (
    SELECT s.due_on,
      string_agg(DISTINCT tw.title, ' · ' ORDER BY tw.title)
        FILTER (WHERE tw.title IS NOT NULL) AS training_label,
      to_jsonb(array_agg(DISTINCT s.module::text ORDER BY s.module::text)) AS module_scope
    FROM schedule s
    LEFT JOIN public.training_weeks tw ON tw.id = s.training_week_id
    GROUP BY s.due_on
  ), scoped_modules AS (
    SELECT d.due_on, e.id AS enrollment_id, s.module,
      least(max(s.required_units), sum(s.milestone_units))::integer AS required_units
    FROM dates d
    CROSS JOIN eligible e
    JOIN schedule s
      ON s.enrollment_id = e.id
     AND s.due_on <= d.due_on
    GROUP BY d.due_on, e.id, s.module
  ), leader_module_checkpoints AS (
    SELECT sm.due_on, sm.enrollment_id, sm.module, sm.required_units,
      count(a.occurred_on) FILTER (
        WHERE a.status = 'completed'
          AND a.occurred_on <= least(p_as_of, sm.due_on)
          AND (a.requirement_due_on IS NULL OR a.requirement_due_on <= sm.due_on)
      )::integer AS completed_units
    FROM scoped_modules sm
    LEFT JOIN activity a
      ON a.enrollment_id = sm.enrollment_id
     AND a.module = sm.module
    GROUP BY sm.due_on, sm.enrollment_id, sm.module, sm.required_units
  ), leader_checkpoints AS (
    SELECT d.due_on, e.id AS enrollment_id,
      coalesce(sum(l.required_units), 0)::integer AS required_units,
      coalesce(sum(least(l.completed_units, l.required_units)), 0)::integer AS completed_units
    FROM dates d
    CROSS JOIN eligible e
    LEFT JOIN leader_module_checkpoints l
      ON l.due_on = d.due_on
     AND l.enrollment_id = e.id
    GROUP BY d.due_on, e.id
  ), numbered AS (
    SELECT row_number() OVER (ORDER BY d.due_on)::integer AS checkpoint_number,
      d.due_on, d.training_label AS label, d.module_scope,
      lc.required_units, lc.completed_units
    FROM dates d
    JOIN leader_checkpoints lc ON lc.due_on = d.due_on
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'checkpoint_number', checkpoint_number,
    'due_on', due_on,
    'label', label,
    'module_scope', module_scope,
    'required_units', required_units,
    'completed_units', completed_units,
    'state', CASE
      WHEN p_as_of < due_on THEN 'upcoming'
      WHEN p_as_of = due_on THEN 'current'
      WHEN required_units > 0 AND completed_units >= required_units THEN 'completed'
      ELSE 'overdue'
    END
  ) ORDER BY due_on), '[]'::jsonb)
  FROM numbered;
$function$;

CREATE OR REPLACE FUNCTION public.get_sponsor_programme_journey(p_cohort_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH sponsor AS (
    SELECT sp.organization_id
    FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ), eligible AS (
    SELECT e.id, e.cohort_id
    FROM public.programme_enrollments e
    JOIN public.cohorts c ON c.id = e.cohort_id
    JOIN sponsor s ON s.organization_id = c.organization_id
    WHERE e.cohort_id = p_cohort_id
      AND (
        SELECT count(*)
        FROM public.programme_enrollments same_cohort
        WHERE same_cohort.cohort_id = e.cohort_id
      ) >= public.sponsor_min_leaders_for_distribution()
  ), schedule AS (
    SELECT e.id AS enrollment_id, s.module, s.required_units,
      s.due_on, s.milestone_units, s.training_week_id
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_module_schedule(e.id) s
    WHERE s.due_on IS NOT NULL
  ), activity AS (
    SELECT e.id AS enrollment_id, a.module, a.occurred_on, a.status, a.requirement_due_on
    FROM eligible e
    CROSS JOIN LATERAL public.sponsor_canonical_activity(e.id) a
  ), dates AS (
    SELECT s.due_on,
      string_agg(DISTINCT tw.title, ' · ' ORDER BY tw.title)
        FILTER (WHERE tw.title IS NOT NULL) AS training_label,
      string_agg(DISTINCT s.module::text, ' · ' ORDER BY s.module::text) AS module_label,
      to_jsonb(array_agg(DISTINCT s.module::text ORDER BY s.module::text)) AS module_scope
    FROM schedule s
    LEFT JOIN public.training_weeks tw ON tw.id = s.training_week_id
    GROUP BY s.due_on
  ), scoped_modules AS (
    SELECT d.due_on, e.id AS enrollment_id, s.module,
      least(max(s.required_units), sum(s.milestone_units))::integer AS required_units
    FROM dates d
    CROSS JOIN eligible e
    JOIN schedule s
      ON s.enrollment_id = e.id
     AND s.due_on <= d.due_on
    GROUP BY d.due_on, e.id, s.module
  ), leader_module_checkpoints AS (
    SELECT sm.due_on, sm.enrollment_id, sm.module, sm.required_units,
      count(a.occurred_on) FILTER (
        WHERE a.status = 'completed'
          AND a.occurred_on <= least(p_as_of, sm.due_on)
          AND (a.requirement_due_on IS NULL OR a.requirement_due_on <= sm.due_on)
      )::integer AS completed_units
    FROM scoped_modules sm
    LEFT JOIN activity a
      ON a.enrollment_id = sm.enrollment_id
     AND a.module = sm.module
    GROUP BY sm.due_on, sm.enrollment_id, sm.module, sm.required_units
  ), leader_checkpoints AS (
    SELECT d.due_on, e.id AS enrollment_id,
      coalesce(sum(l.required_units), 0)::integer AS required_units,
      coalesce(sum(least(l.completed_units, l.required_units)), 0)::integer AS completed_units
    FROM dates d
    CROSS JOIN eligible e
    LEFT JOIN leader_module_checkpoints l
      ON l.due_on = d.due_on
     AND l.enrollment_id = e.id
    GROUP BY d.due_on, e.id
  ), totals AS (
    SELECT d.due_on,
      d.training_label AS label,
      d.module_scope,
      sum(l.required_units)::integer AS required_units,
      sum(l.completed_units)::integer AS completed_units,
      count(*)::integer AS total_leaders,
      count(*) FILTER (
        WHERE l.required_units > 0
          AND l.completed_units >= l.required_units
      )::integer AS completed_leaders
    FROM dates d
    JOIN leader_checkpoints l ON l.due_on = d.due_on
    GROUP BY d.due_on, d.training_label, d.module_label, d.module_scope
  ), numbered AS (
    SELECT row_number() OVER (ORDER BY due_on)::integer AS checkpoint_number, *
    FROM totals
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'checkpoint_number', checkpoint_number,
    'due_on', due_on,
    'label', label,
    'module_scope', module_scope,
    'required_units', required_units,
    'completed_units', completed_units,
    'completed_leaders', completed_leaders,
    'total_leaders', total_leaders,
    'state', CASE
      WHEN p_as_of < due_on THEN 'upcoming'
      WHEN p_as_of = due_on THEN 'current'
      WHEN required_units > 0 AND completed_units >= required_units THEN 'completed'
      ELSE 'overdue'
    END
  ) ORDER BY due_on), '[]'::jsonb)
  FROM numbered;
$function$;



-- ----------------------------------------------------------------------------
-- 5e. The Triad projection every surface reads: requirement fulfilment,
--    capped, against each requirement's own deadline (canonical_module_progress
--    above), plus the raw session activity (distinct completed sessions of the
--    enrollment's groups — activity only, never a programme unit).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.canonical_triad_completion(uuid, date);
CREATE FUNCTION public.canonical_triad_completion(p_enrollment_id uuid, p_as_of date DEFAULT current_date)
RETURNS TABLE (
  enrollment_id uuid, programme_id uuid, cohort_id uuid,
  required_units integer,
  raw_completed_sessions integer,
  completed_by_as_of integer,
  completed_units integer,
  due_units integer,
  overdue_units integer,
  booked_units integer,
  pace_status text,
  next_due_on date,
  schedule jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH e AS (
    SELECT pe.id, pe.programme_id, pe.cohort_id FROM public.programme_enrollments pe WHERE pe.id = p_enrollment_id
  ), progress AS (
    SELECT p.* FROM public.canonical_module_progress(p_enrollment_id, p_as_of) p
    WHERE p.module = 'triads'::public.programme_module_type
  ), raw AS (
    SELECT count(DISTINCT s.id)::integer AS sessions
    FROM public.session_activity_attributions a
    JOIN public.triad_sessions s ON s.id = a.source_activity_id AND s.status = 'completed'
    WHERE a.enrollment_id = p_enrollment_id AND a.source_activity_type = 'triad' AND a.occurred_on <= p_as_of
  ), fulfil AS (
    SELECT f.*,
      (SELECT g.id FROM public.triad_groups g JOIN public.triad_group_members m ON m.triad_group_id = g.id
       WHERE g.cohort_requirement_date_id = f.cohort_requirement_date_id AND m.enrollment_id = p_enrollment_id
       ORDER BY g.is_active DESC, g.created_at DESC LIMIT 1) AS triad_group_id
    FROM public.canonical_triad_requirement_fulfilment(p_enrollment_id) f
  )
  SELECT e.id, e.programme_id, e.cohort_id,
    coalesce(p.required_units, 0),
    r.sessions,
    coalesce(p.completed_activity_units, 0),
    coalesce(p.completed_units, 0),
    coalesce(p.due_units, 0),
    coalesce(p.overdue_units, 0),
    coalesce(p.booked_units, 0),
    coalesce(p.pace_status, 'not_required'),
    (SELECT min(f.due_on) FROM fulfil f
     WHERE f.unit_number <= coalesce(p.required_units, 0)
       AND NOT coalesce(f.fulfilled_on <= p_as_of, false)),
    coalesce((SELECT jsonb_agg(jsonb_build_object(
        'milestone', f.unit_number,
        'cohort_requirement_date_id', f.cohort_requirement_date_id,
        'due_on', f.due_on,
        'training_week_id', (SELECT d.training_week_id FROM public.cohort_requirement_dates d WHERE d.id = f.cohort_requirement_date_id),
        'is_due', f.due_on <= p_as_of,
        'fulfilled', coalesce(f.fulfilled_on <= p_as_of, false),
        -- this requirement is fulfilled (by its own group's session), never cumulative
        'satisfied', coalesce(f.fulfilled_on <= p_as_of, false),
        'fulfilled_on', CASE WHEN f.fulfilled_on <= p_as_of THEN f.fulfilled_on END,
        'overdue', f.due_on <= p_as_of AND NOT coalesce(f.fulfilled_on <= p_as_of, false),
        'triad_group_id', f.triad_group_id)
      ORDER BY f.unit_number)
      FROM fulfil f WHERE f.unit_number <= coalesce(p.required_units, 0)), '[]'::jsonb)
  FROM e
  CROSS JOIN raw r
  LEFT JOIN progress p ON true;
$$;
COMMENT ON FUNCTION public.canonical_triad_completion(uuid, date) IS
  'THE Triad projection (from canonical_module_progress + canonical_triad_requirement_fulfilment): each cohort Triad requirement is fulfilled once by a completed session of ITS group; completed = fulfilled requirements capped at required; due / overdue per requirement deadline. raw_completed_sessions is activity only. Internal.';


-- ----------------------------------------------------------------------------
-- 6. Learner projections: every group of the learner, with its requirement.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.learner_triad_overview(uuid);
CREATE FUNCTION public.learner_triad_overview(p_enrollment_id uuid DEFAULT NULL)
RETURNS TABLE (enrollment_id uuid, triad_group_id uuid, cohort_requirement_date_id uuid, unit_number integer, due_on date,
  cohort_id uuid, group_language text, is_active boolean, closed_at timestamptz, created_at timestamptz,
  member_count integer, my_member_slot integer, sessions jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.enrollment_id, g.id, g.cohort_requirement_date_id, d.ordinal, d.due_on,
    g.cohort_id, g.group_language, g.is_active, g.closed_at, g.created_at,
    (SELECT count(*)::integer FROM public.triad_group_members x WHERE x.triad_group_id = g.id),
    m.member_order::integer,
    public.triad_group_sessions_internal(g.id, m.enrollment_id)
  FROM public.programme_enrollments e
  JOIN public.triad_group_members m ON m.enrollment_id = e.id
  JOIN public.triad_groups g ON g.id = m.triad_group_id
  JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id
  WHERE e.user_id = auth.uid()
    AND auth.uid() IS NOT NULL
    AND (p_enrollment_id IS NULL OR e.id = p_enrollment_id)
  ORDER BY d.ordinal, g.is_active DESC, g.created_at DESC;
$$;

-- A member proposes the group's session (or a replacement after a
-- cancellation). A requirement is fulfilled by ONE completed session, so a
-- group whose session is completed schedules no more programme sessions.
CREATE OR REPLACE FUNCTION public.learner_triad_schedule_session(p_group_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE me uuid := public.triad_member_enrollment_for_user(p_group_id, auth.uid()); session_id uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Only members of this Triad group can do this' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'A session needs a start before its end' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.triad_group_id = p_group_id AND s.status IN ('proposed', 'confirmed')) THEN
    RAISE EXCEPTION 'This group already has an open Triad session' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.triad_group_id = p_group_id AND s.status = 'completed') THEN
    RAISE EXCEPTION 'This group''s Triad is already completed' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.triad_sessions (triad_group_id, scheduled_start_time, scheduled_end_time, status)
  VALUES (p_group_id, p_start, p_end, 'proposed')
  RETURNING id INTO session_id;
  INSERT INTO public.triad_session_responses (triad_session_id, enrollment_id, response, responded_at)
  SELECT session_id, m.enrollment_id,
    CASE WHEN m.enrollment_id = me THEN 'accepted' ELSE 'pending' END,
    CASE WHEN m.enrollment_id = me THEN now() END
  FROM public.triad_group_members m WHERE m.triad_group_id = p_group_id;
  RETURN session_id;
END $$;

-- ----------------------------------------------------------------------------
-- 7. Per-requirement construction shared by Admin, reminders and assignment.
-- ----------------------------------------------------------------------------
-- One row per eligible-or-assigned enrollment of the requirement's cohort
-- (the requirement's programme): its active group for THIS requirement,
-- fulfilment, and the partners it had in the cohort's OTHER Triads.
CREATE OR REPLACE FUNCTION public.triad_requirement_learners_internal(p_cohort_requirement_date_id uuid, p_as_of date DEFAULT current_date)
RETURNS TABLE (cohort_requirement_date_id uuid, unit_number integer, due_on date, enrollment_id uuid, user_id uuid,
  full_name text, spoken_languages text[], enrollment_status public.enrollment_status, is_eligible boolean,
  triad_group_id uuid, open_session_status text, fulfilled boolean, fulfilled_on date, overdue boolean,
  prior_partner_enrollment_ids uuid[], prior_partner_names text[])
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH req AS (
    SELECT d.* FROM public.cohort_requirement_dates d
    WHERE d.id = p_cohort_requirement_date_id AND d.module = 'triads'::public.programme_module_type
  ), assigned AS (
    SELECT DISTINCT ON (m.enrollment_id) m.enrollment_id, g.id AS triad_group_id
    FROM req JOIN public.triad_groups g ON g.cohort_requirement_date_id = req.id AND g.is_active
    JOIN public.triad_group_members m ON m.triad_group_id = g.id
    ORDER BY m.enrollment_id, g.created_at DESC
  ), pop AS (
    SELECT e.* FROM req JOIN public.programme_enrollments e ON e.cohort_id = req.cohort_id AND e.programme_id = req.programme_id
    WHERE e.status IN ('active', 'at_risk', 'paused') OR e.id IN (SELECT enrollment_id FROM assigned)
  )
  SELECT req.id, req.ordinal, req.due_on, e.id, e.user_id, pr.full_name, coalesce(pr.spoken_languages, ARRAY[]::text[]),
    e.status, e.status IN ('active', 'at_risk', 'paused'),
    a.triad_group_id,
    (SELECT s.status FROM public.triad_sessions s WHERE s.triad_group_id = a.triad_group_id AND s.status IN ('proposed', 'confirmed') LIMIT 1),
    coalesce(f.fulfilled_on <= p_as_of, false),
    CASE WHEN f.fulfilled_on <= p_as_of THEN f.fulfilled_on END,
    req.due_on <= p_as_of AND NOT coalesce(f.fulfilled_on <= p_as_of, false),
    coalesce(pp.ids, ARRAY[]::uuid[]), coalesce(pp.names, ARRAY[]::text[])
  FROM req
  CROSS JOIN pop e
  JOIN public.profiles pr ON pr.id = e.user_id
  LEFT JOIN assigned a ON a.enrollment_id = e.id
  LEFT JOIN LATERAL (
    SELECT x.fulfilled_on FROM public.canonical_triad_requirement_fulfilment(e.id) x
    WHERE x.cohort_requirement_date_id = req.id
  ) f ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT om.enrollment_id) AS ids, array_agg(DISTINCT opr.full_name) AS names
    FROM public.triad_group_members mm
    JOIN public.triad_groups og ON og.id = mm.triad_group_id AND og.cohort_id = req.cohort_id
      AND og.cohort_requirement_date_id <> req.id
    JOIN public.triad_group_members om ON om.triad_group_id = og.id AND om.enrollment_id <> e.id
    JOIN public.programme_enrollments oe ON oe.id = om.enrollment_id
    JOIN public.profiles opr ON opr.id = oe.user_id
    WHERE mm.enrollment_id = e.id
  ) pp ON true
  ORDER BY pr.full_name, e.id;
$$;

-- Candidates for a requirement: eligible, not yet in an active group FOR
-- THIS requirement (a learner grouped for Triad 1 is a candidate for Triad 2).
CREATE OR REPLACE FUNCTION public.triad_requirement_candidates_internal(p_cohort_requirement_date_id uuid)
RETURNS TABLE (enrollment_id uuid, user_id uuid, full_name text, spoken_languages text[],
  prior_partner_enrollment_ids uuid[], prior_partner_names text[])
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT l.enrollment_id, l.user_id, l.full_name, l.spoken_languages, l.prior_partner_enrollment_ids, l.prior_partner_names
  FROM public.triad_requirement_learners_internal(p_cohort_requirement_date_id, current_date) l
  WHERE l.is_eligible AND l.triad_group_id IS NULL
  ORDER BY l.full_name;
$$;

DROP FUNCTION IF EXISTS public.triad_cohort_candidates_internal(uuid);
DROP FUNCTION IF EXISTS public.admin_triad_create_group(uuid, uuid[], text);
DROP FUNCTION IF EXISTS public.triad_create_group_internal(uuid, uuid[], text, text, timestamptz, timestamptz);
CREATE FUNCTION public.triad_create_group_internal(
  p_cohort_requirement_date_id uuid, p_enrollment_ids uuid[], p_group_language text,
  p_assigned_by text, p_start timestamptz DEFAULT NULL, p_end timestamptz DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  req public.cohort_requirement_dates;
  group_id uuid;
  session_id uuid;
  n integer := coalesce(array_length(p_enrollment_ids, 1), 0);
BEGIN
  SELECT * INTO req FROM public.cohort_requirement_dates
  WHERE id = p_cohort_requirement_date_id AND module = 'triads'::public.programme_module_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Triad requirement not found' USING ERRCODE = 'P0002';
  END IF;
  IF n NOT BETWEEN 2 AND 3 OR (SELECT count(DISTINCT x) FROM unnest(p_enrollment_ids) x) <> n THEN
    RAISE EXCEPTION 'A Triad group needs 2 or 3 different learners' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_enrollment_ids) x
    LEFT JOIN public.programme_enrollments e ON e.id = x
    WHERE e.id IS NULL OR e.cohort_id IS DISTINCT FROM req.cohort_id OR e.programme_id IS DISTINCT FROM req.programme_id
       OR e.status NOT IN ('active', 'at_risk', 'paused')
  ) THEN
    RAISE EXCEPTION 'Triad members must be ongoing enrollments of this requirement''s cohort' USING ERRCODE = '42501';
  END IF;
  IF p_assigned_by NOT IN ('auto', 'admin') OR p_group_language NOT IN ('vi', 'en') THEN
    RAISE EXCEPTION 'Invalid assignment source or language' USING ERRCODE = '22023';
  END IF;
  IF (p_start IS NULL) <> (p_end IS NULL) OR p_end <= p_start THEN
    RAISE EXCEPTION 'A proposed time needs a start before its end' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.triad_groups (cohort_requirement_date_id, assigned_by, group_language)
  VALUES (p_cohort_requirement_date_id, p_assigned_by, p_group_language)
  RETURNING id INTO group_id;
  INSERT INTO public.triad_group_members (triad_group_id, enrollment_id, member_order)
  SELECT group_id, x.enrollment_id, x.ord FROM unnest(p_enrollment_ids) WITH ORDINALITY AS x(enrollment_id, ord);
  IF p_start IS NOT NULL THEN
    INSERT INTO public.triad_sessions (triad_group_id, scheduled_start_time, scheduled_end_time, status)
    VALUES (group_id, p_start, p_end, 'proposed')
    RETURNING id INTO session_id;
    INSERT INTO public.triad_session_responses (triad_session_id, enrollment_id)
    SELECT session_id, m.enrollment_id FROM public.triad_group_members m WHERE m.triad_group_id = group_id;
  END IF;
  RETURN group_id;
END $$;

DROP FUNCTION IF EXISTS public.triad_clear_unconfirmed_auto_groups_internal(uuid);
CREATE FUNCTION public.triad_clear_unconfirmed_auto_groups_internal(p_cohort_requirement_date_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE cleared integer;
BEGIN
  DELETE FROM public.triad_groups g
  WHERE g.cohort_requirement_date_id = p_cohort_requirement_date_id
    AND g.is_active
    AND g.assigned_by = 'auto'
    AND NOT EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.triad_group_id = g.id AND s.status <> 'proposed')
    AND NOT EXISTS (SELECT 1 FROM public.triad_sessions s JOIN public.triad_session_responses r ON r.triad_session_id = s.id
                    WHERE s.triad_group_id = g.id AND r.response <> 'pending')
    AND NOT EXISTS (SELECT 1 FROM public.triad_sessions s JOIN public.triad_alternative_proposals p ON p.triad_session_id = s.id
                    WHERE s.triad_group_id = g.id);
  GET DIAGNOSTICS cleared = ROW_COUNT;
  RETURN cleared;
END $$;

-- Reminder targets: per cohort Triad requirement and eligible enrollment.
DROP FUNCTION IF EXISTS public.triad_reminder_targets_internal(date, uuid);
CREATE FUNCTION public.triad_reminder_targets_internal(p_as_of date DEFAULT current_date, p_cohort_id uuid DEFAULT NULL)
RETURNS TABLE (cohort_id uuid, programme_id uuid, cohort_requirement_date_id uuid, milestone_number integer, due_on date,
  days_until_due integer, enrollment_id uuid, user_id uuid, triad_group_id uuid, open_session_status text,
  milestone_met boolean, milestone_overdue boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.cohort_id, d.programme_id, d.id, d.ordinal, d.due_on, (d.due_on - p_as_of)::integer,
    l.enrollment_id, l.user_id, l.triad_group_id, l.open_session_status, l.fulfilled, l.overdue
  FROM public.cohort_requirement_dates d
  CROSS JOIN LATERAL public.triad_requirement_learners_internal(d.id, p_as_of) l
  WHERE d.module = 'triads'::public.programme_module_type
    AND (p_cohort_id IS NULL OR d.cohort_id = p_cohort_id)
    AND d.ordinal <= public.triad_required_units_for_programme(d.programme_id)
    AND l.is_eligible;
$$;

-- Cohort learners (Admin progress table): canonical completion + the group
-- per requirement.
DROP FUNCTION IF EXISTS public.admin_cohort_triad_learners(uuid, date);
DROP FUNCTION IF EXISTS public.triad_cohort_learners_internal(uuid, date);
CREATE FUNCTION public.triad_cohort_learners_internal(p_cohort_id uuid, p_as_of date DEFAULT current_date)
RETURNS TABLE (enrollment_id uuid, user_id uuid, full_name text, spoken_languages text[], programme_id uuid,
  enrollment_status public.enrollment_status, is_eligible boolean,
  required_units integer, raw_completed_sessions integer, completed_units integer, due_units integer,
  overdue_units integer, next_due_on date, requirements jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.user_id, pr.full_name, coalesce(pr.spoken_languages, ARRAY[]::text[]), e.programme_id,
    e.status, e.status IN ('active', 'at_risk', 'paused'),
    c.required_units, c.raw_completed_sessions, c.completed_units, c.due_units, c.overdue_units, c.next_due_on,
    c.schedule
  FROM public.programme_enrollments e
  JOIN public.profiles pr ON pr.id = e.user_id
  CROSS JOIN LATERAL public.canonical_triad_completion(e.id, p_as_of) c
  WHERE e.cohort_id = p_cohort_id
    AND public.triad_required_units_for_programme(e.programme_id) > 0
  ORDER BY pr.full_name, e.id;
$$;

-- ----------------------------------------------------------------------------
-- 8. Admin -> Cohort -> Triads: one block per requirement.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_cohort_triad_requirements(p_cohort_id uuid, p_as_of date DEFAULT current_date)
RETURNS TABLE (cohort_requirement_date_id uuid, programme_id uuid, unit_number integer, due_on date, required_units integer,
  eligible_enrollments integer, assigned_enrollments integer, fulfilled_enrollments integer, overdue_enrollments integer,
  active_groups integer, reflections_submitted integer, reflections_expected integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.triad_assert_admin();
  RETURN QUERY
  SELECT d.id, d.programme_id, d.ordinal, d.due_on, public.triad_required_units_for_programme(d.programme_id),
    st.eligible, st.assigned, st.fulfilled, st.overdue,
    (SELECT count(*)::integer FROM public.triad_groups g WHERE g.cohort_requirement_date_id = d.id AND g.is_active),
    rf.submitted, rf.expected
  FROM public.cohort_requirement_dates d
  CROSS JOIN LATERAL (
    SELECT count(*) FILTER (WHERE l.is_eligible)::integer AS eligible,
      count(*) FILTER (WHERE l.is_eligible AND l.triad_group_id IS NOT NULL)::integer AS assigned,
      count(*) FILTER (WHERE l.fulfilled)::integer AS fulfilled,
      count(*) FILTER (WHERE l.overdue AND l.is_eligible)::integer AS overdue
    FROM public.triad_requirement_learners_internal(d.id, p_as_of) l
  ) st
  CROSS JOIN LATERAL (
    SELECT count(r.id)::integer AS submitted, count(*)::integer AS expected
    FROM public.triad_groups g
    JOIN public.triad_sessions s ON s.triad_group_id = g.id AND s.status = 'completed'
    JOIN public.triad_group_members m ON m.triad_group_id = g.id
    LEFT JOIN public.triad_reflections r ON r.triad_session_id = s.id AND r.enrollment_id = m.enrollment_id
    WHERE g.cohort_requirement_date_id = d.id
  ) rf
  WHERE d.cohort_id = p_cohort_id AND d.module = 'triads'::public.programme_module_type
    AND d.ordinal <= public.triad_required_units_for_programme(d.programme_id)
  ORDER BY d.programme_id, d.ordinal;
END $$;

DROP FUNCTION IF EXISTS public.admin_cohort_triad_groups(uuid);
CREATE FUNCTION public.admin_cohort_triad_groups(p_cohort_id uuid)
RETURNS TABLE (triad_group_id uuid, cohort_requirement_date_id uuid, unit_number integer, assigned_by text, group_language text,
  is_active boolean, created_at timestamptz, closed_at timestamptz, members jsonb, sessions jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.triad_assert_admin();
  RETURN QUERY
  SELECT g.id, g.cohort_requirement_date_id, d.ordinal, g.assigned_by, g.group_language, g.is_active, g.created_at, g.closed_at,
    coalesce((SELECT jsonb_agg(jsonb_build_object('enrollment_id', m.enrollment_id, 'user_id', e.user_id,
                'full_name', pr.full_name, 'member_order', m.member_order) ORDER BY m.member_order)
              FROM public.triad_group_members m
              JOIN public.programme_enrollments e ON e.id = m.enrollment_id
              JOIN public.profiles pr ON pr.id = e.user_id
              WHERE m.triad_group_id = g.id), '[]'::jsonb),
    public.triad_group_sessions_internal(g.id, NULL)
  FROM public.triad_groups g
  JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id
  WHERE g.cohort_id = p_cohort_id
  ORDER BY d.ordinal, g.is_active DESC, g.created_at;
END $$;

CREATE FUNCTION public.admin_cohort_triad_learners(p_cohort_id uuid, p_as_of date DEFAULT current_date)
RETURNS TABLE (enrollment_id uuid, user_id uuid, full_name text, spoken_languages text[], programme_id uuid,
  enrollment_status public.enrollment_status, is_eligible boolean,
  required_units integer, raw_completed_sessions integer, completed_units integer, due_units integer,
  overdue_units integer, next_due_on date, requirements jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.triad_assert_admin();
  RETURN QUERY SELECT * FROM public.triad_cohort_learners_internal(p_cohort_id, p_as_of);
END $$;

CREATE OR REPLACE FUNCTION public.admin_triad_requirement_candidates(p_cohort_requirement_date_id uuid)
RETURNS TABLE (enrollment_id uuid, user_id uuid, full_name text, spoken_languages text[],
  prior_partner_enrollment_ids uuid[], prior_partner_names text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.triad_assert_admin();
  RETURN QUERY SELECT * FROM public.triad_requirement_candidates_internal(p_cohort_requirement_date_id);
END $$;

CREATE FUNCTION public.admin_triad_create_group(p_cohort_requirement_date_id uuid, p_enrollment_ids uuid[], p_group_language text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.triad_assert_admin();
  RETURN public.triad_create_group_internal(p_cohort_requirement_date_id, p_enrollment_ids, p_group_language, 'admin');
END $$;

CREATE OR REPLACE FUNCTION public.admin_triad_change_member(p_group_id uuid, p_remove_enrollment_id uuid DEFAULT NULL, p_add_enrollment_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE g public.triad_groups; slot smallint;
BEGIN
  PERFORM public.triad_assert_admin();
  SELECT * INTO g FROM public.triad_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Triad group not found' USING ERRCODE = 'P0002'; END IF;
  IF p_add_enrollment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.triad_requirement_candidates_internal(g.cohort_requirement_date_id) c WHERE c.enrollment_id = p_add_enrollment_id
  ) THEN
    RAISE EXCEPTION 'The new member must be an eligible learner of this cohort not yet grouped for this Triad' USING ERRCODE = '42501';
  END IF;
  IF p_remove_enrollment_id IS NOT NULL THEN
    DELETE FROM public.triad_group_members WHERE triad_group_id = p_group_id AND enrollment_id = p_remove_enrollment_id
    RETURNING member_order INTO slot;
    IF slot IS NULL THEN RAISE EXCEPTION 'That learner is not in this group' USING ERRCODE = 'P0002'; END IF;
  END IF;
  IF p_add_enrollment_id IS NOT NULL THEN
    slot := coalesce(slot, (SELECT min(x) FROM generate_series(1, 3) x
                            WHERE x NOT IN (SELECT member_order FROM public.triad_group_members WHERE triad_group_id = p_group_id)));
    INSERT INTO public.triad_group_members (triad_group_id, enrollment_id, member_order)
    VALUES (p_group_id, p_add_enrollment_id, slot);
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 9. Your Sessions / reflections: a Triad session is labelled by its group's
--    requirement ("Triad N").
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.learner_session_history(uuid);
CREATE FUNCTION public.learner_session_history(
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
      ARRAY[s.coach_id] AS counterpart_ids
    FROM public.sessions s
    JOIN me ON s.enrollment_id = me.enrollment_id AND s.coachee_id = me.user_id

    UNION ALL
    SELECT 'peer_coaching', 'coachee_peer_sessions', cps.id, 'peer_coaching', 'receiver',
      cps.topic, cps.start_time, cps.status::text, ARRAY[cps.peer_provider_id]
    FROM public.coachee_peer_sessions cps
    JOIN me ON cps.enrollment_id = me.enrollment_id AND cps.peer_receiver_id = me.user_id

    UNION ALL
    SELECT 'peer_coaching', 'coachee_peer_sessions', cps.id, 'peer_coaching', 'provider',
      cps.topic, cps.start_time, cps.status::text, ARRAY[cps.peer_receiver_id]
    FROM public.coachee_peer_sessions cps
    JOIN me ON cps.peer_provider_id = me.user_id
    WHERE cps.enrollment_id IN (SELECT id FROM cohort_enrollments)

    UNION ALL
    SELECT 'peer_coaching', 'peer_sessions', ps.id, 'peer_coaching', 'receiver',
      ps.topic, ps.start_time, ps.status::text, ARRAY[ps.peer_coach_id]
    FROM public.peer_sessions ps
    JOIN me ON ps.enrollment_id = me.enrollment_id AND ps.peer_coachee_id = me.user_id

    UNION ALL
    SELECT 'peer_coaching', 'peer_sessions', ps.id, 'peer_coaching', 'provider',
      ps.topic, ps.start_time, ps.status::text, ARRAY[ps.peer_coachee_id]
    FROM public.peer_sessions ps
    JOIN me ON ps.peer_coach_id = me.user_id
    WHERE ps.enrollment_id IN (SELECT id FROM cohort_enrollments)

    UNION ALL
    SELECT 'mentoring', 'mentoring_sessions', ms.id, 'mentoring', 'mentee',
      ms.topic, ms.start_time, ms.status::text, ARRAY[ms.mentor_id]
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
        ORDER BY om.member_order), ARRAY[]::uuid[])
    FROM public.triad_group_members gm
    JOIN me ON gm.enrollment_id = me.enrollment_id
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
    EXISTS (
      SELECT 1 FROM public.session_activity_attributions a
      JOIN me ON a.enrollment_id = me.enrollment_id
      WHERE a.source_activity_id = r.source_id
    ),
    r.status = 'completed' AND EXISTS (
      SELECT 1 FROM public.session_activity_attributions a
      JOIN me ON a.enrollment_id = me.enrollment_id
      WHERE a.source_activity_id = r.source_id
    ),
    CASE WHEN r.source_table = 'triad_sessions' THEN (
      SELECT d.ordinal FROM public.triad_sessions ts
      JOIN public.triad_groups g ON g.id = ts.triad_group_id
      JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id
      WHERE ts.id = r.source_id) END
  FROM rows r
  ORDER BY r.start_time DESC NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION public.learner_reflection_feed(
  p_enrollment_id uuid
)
RETURNS TABLE (
  reflection_key text,
  source_type text,
  source_table text,
  source_id uuid,
  module public.programme_module_type,
  occurred_at timestamptz,
  title text,
  body text,
  details jsonb,
  rating numeric,
  previous_rating numeric,
  linked_session_table text,
  linked_session_id uuid,
  linked_goal_id uuid,
  linked_activity_id uuid,
  is_private boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT e.id AS enrollment_id, e.user_id
    FROM public.programme_enrollments e
    WHERE e.id = p_enrollment_id
      AND e.user_id = auth.uid()
      AND auth.uid() IS NOT NULL
  ), feed AS (
    -- Coaching: the learner's own session reflection ("Client reflection").
    SELECT 'coaching_session_reflection'::text AS source_type, 'sessions'::text AS source_table, s.id AS source_id,
      'coaching'::public.programme_module_type AS module, s.start_time AS occurred_at, s.topic AS title,
      btrim(s.coachee_notes) AS body, NULL::jsonb AS details, NULL::numeric AS rating, NULL::numeric AS previous_rating,
      'sessions'::text AS linked_session_table, s.id AS linked_session_id, NULL::uuid AS linked_goal_id,
      s.id AS linked_activity_id, false AS is_private
    FROM public.sessions s
    JOIN me ON s.enrollment_id = me.enrollment_id AND s.coachee_id = me.user_id
    WHERE nullif(btrim(s.coachee_notes), '') IS NOT NULL

    UNION ALL
    SELECT 'coaching_session_rating', 'sessions', s.id, 'coaching', coalesce(s.coachee_rated_at, s.start_time), s.topic,
      btrim(s.coachee_rating_comment), NULL, s.coachee_rating, NULL,
      'sessions', s.id, NULL, s.id, false
    FROM public.sessions s
    JOIN me ON s.enrollment_id = me.enrollment_id AND s.coachee_id = me.user_id
    WHERE nullif(btrim(s.coachee_rating_comment), '') IS NOT NULL

    -- Peer practice (coachee-to-coachee): the receiver's own notes/comment.
    UNION ALL
    SELECT 'peer_session_reflection', 'coachee_peer_sessions', cps.id, 'peer_coaching', cps.start_time, cps.topic,
      btrim(cps.receiver_notes), NULL, NULL, NULL,
      'coachee_peer_sessions', cps.id, NULL, cps.id, false
    FROM public.coachee_peer_sessions cps
    JOIN me ON cps.enrollment_id = me.enrollment_id AND cps.peer_receiver_id = me.user_id
    WHERE nullif(btrim(cps.receiver_notes), '') IS NOT NULL

    UNION ALL
    SELECT 'peer_session_rating', 'coachee_peer_sessions', cps.id, 'peer_coaching', coalesce(cps.receiver_rated_at, cps.start_time), cps.topic,
      btrim(cps.receiver_rating_comment), NULL, cps.receiver_rating, NULL,
      'coachee_peer_sessions', cps.id, NULL, cps.id, false
    FROM public.coachee_peer_sessions cps
    JOIN me ON cps.enrollment_id = me.enrollment_id AND cps.peer_receiver_id = me.user_id
    WHERE nullif(btrim(cps.receiver_rating_comment), '') IS NOT NULL

    -- Peer coaching (coach-to-coach, when a coach is the enrolled learner).
    UNION ALL
    SELECT 'peer_session_reflection', 'peer_sessions', ps.id, 'peer_coaching', ps.start_time, ps.topic,
      btrim(ps.coachee_notes), NULL, NULL, NULL,
      'peer_sessions', ps.id, NULL, ps.id, false
    FROM public.peer_sessions ps
    JOIN me ON ps.enrollment_id = me.enrollment_id AND ps.peer_coachee_id = me.user_id
    WHERE nullif(btrim(ps.coachee_notes), '') IS NOT NULL

    UNION ALL
    SELECT 'peer_session_rating', 'peer_sessions', ps.id, 'peer_coaching', coalesce(ps.coachee_rated_at, ps.start_time), ps.topic,
      btrim(ps.coachee_rating_comment), NULL, ps.coachee_rating, NULL,
      'peer_sessions', ps.id, NULL, ps.id, false
    FROM public.peer_sessions ps
    JOIN me ON ps.enrollment_id = me.enrollment_id AND ps.peer_coachee_id = me.user_id
    WHERE nullif(btrim(ps.coachee_rating_comment), '') IS NOT NULL

    -- Mentoring: the mentee's own session notes.
    UNION ALL
    SELECT 'mentoring_session_reflection', 'mentoring_sessions', ms.id, 'mentoring', ms.start_time, ms.topic,
      btrim(ms.mentee_notes), NULL, NULL, NULL,
      'mentoring_sessions', ms.id, NULL, ms.id, false
    FROM public.mentoring_sessions ms
    JOIN me ON ms.enrollment_id = me.enrollment_id AND ms.mentee_id = me.user_id
    WHERE nullif(btrim(ms.mentee_notes), '') IS NOT NULL

    -- Triads: the learner's own post-session reflection answers (one
    -- submission per session and enrollment; answers per stable question).
    UNION ALL
    SELECT 'triad_reflection', 'triad_reflections', trf.id, 'triads', trf.submitted_at, NULL::text,
      ans.body,
      jsonb_strip_nulls(jsonb_build_object('answers', ans.answers,
        'session_start_time', ts.scheduled_start_time, 'triad_group_id', ts.triad_group_id,
        'requirement_unit', (SELECT d.ordinal FROM public.triad_groups g
                             JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id
                             WHERE g.id = ts.triad_group_id))),
      trf.satisfaction_rating::numeric, NULL,
      'triad_sessions', trf.triad_session_id, NULL, trf.triad_session_id, false
    FROM public.triad_reflections trf
    JOIN me ON trf.enrollment_id = me.enrollment_id
    CROSS JOIN LATERAL (
      SELECT string_agg(btrim(a.answer_text), E'\n\n' ORDER BY q.display_order, q.id) AS body,
        jsonb_agg(jsonb_build_object(
          'question_id', q.id, 'question_key', q.question_key, 'section', q.section,
          'question', q.label, 'question_vi', q.label_vi, 'answer', btrim(a.answer_text))
          ORDER BY q.display_order, q.id) AS answers
      FROM public.triad_reflection_answers a
      JOIN public.triad_reflection_questions q ON q.id = a.question_id
      WHERE a.triad_reflection_id = trf.id AND nullif(btrim(a.answer_text), '') IS NOT NULL
    ) ans
    LEFT JOIN public.triad_sessions ts ON ts.id = trf.triad_session_id
    WHERE ans.body IS NOT NULL

    -- Goal check-ins the learner wrote, with their comment.
    UNION ALL
    SELECT 'goal_checkin', 'goal_checkins', gc.id, NULL, gc.created_at, g.title,
      btrim(gc.note), jsonb_build_object('source_activity_type', gc.source_activity_type),
      gc.new_rating::numeric, gc.previous_rating::numeric,
      CASE gc.source_activity_type
        WHEN 'coaching' THEN 'sessions'
        WHEN 'mentoring' THEN 'mentoring_sessions'
        WHEN 'peer_coaching' THEN (
          SELECT CASE WHEN EXISTS (SELECT 1 FROM public.coachee_peer_sessions x WHERE x.id = gc.source_activity_id)
            THEN 'coachee_peer_sessions' ELSE 'peer_sessions' END)
        WHEN 'triad' THEN 'triad_sessions'
        ELSE NULL
      END,
      CASE WHEN gc.source_activity_type IN ('coaching', 'mentoring', 'peer_coaching', 'triad') THEN gc.source_activity_id END,
      gc.goal_id, gc.source_activity_id, false
    FROM public.goal_checkins gc
    JOIN me ON gc.enrollment_id = me.enrollment_id AND gc.actor_user_id = me.user_id
    JOIN public.coachee_goals g ON g.id = gc.goal_id
    WHERE nullif(btrim(gc.note), '') IS NOT NULL

    -- Training / learning reflection prompt answers.
    UNION ALL
    SELECT 'training_reflection', 'reflection_submissions', rs.id, 'training', rs.submitted_at, pr.title,
      string_agg(btrim(ra.answer_text), E'\n\n' ORDER BY rq.sort_order, rq.id),
      jsonb_build_object(
        'answers', jsonb_agg(jsonb_build_object('question', rq.question_text, 'answer', btrim(ra.answer_text)) ORDER BY rq.sort_order, rq.id),
        'confidence_score', rs.confidence_score,
        'reflection_number', pr.reflection_number),
      NULL, NULL,
      NULL, NULL, NULL, rs.reflection_id, false
    FROM public.reflection_submissions rs
    JOIN me ON rs.enrollment_id = me.enrollment_id AND rs.user_id = me.user_id
    JOIN public.programme_reflections pr ON pr.id = rs.reflection_id
    JOIN public.reflection_answers ra ON ra.submission_id = rs.id
    JOIN public.reflection_questions rq ON rq.id = ra.question_id
    WHERE nullif(btrim(ra.answer_text), '') IS NOT NULL
    GROUP BY rs.id, rs.submitted_at, rs.confidence_score, rs.reflection_id, pr.title, pr.reflection_number

    UNION ALL
    SELECT 'quiz_reflection', 'assignment_submissions', asub.id, 'training', asub.submitted_at, a.title,
      btrim(asub.reflection_text), NULL, NULL, NULL,
      NULL, NULL, NULL, asub.assignment_id, false
    FROM public.assignment_submissions asub
    JOIN me ON asub.enrollment_id = me.enrollment_id AND asub.user_id = me.user_id
    JOIN public.assignments a ON a.id = asub.assignment_id
    WHERE nullif(btrim(asub.reflection_text), '') IS NOT NULL

    UNION ALL
    SELECT 'daily_prompt_response', 'daily_prompt_responses', dpr.id, 'training', coalesce(dpr.responded_at, dpr.created_at), dp.prompt_text,
      btrim(dpr.response_text), jsonb_strip_nulls(jsonb_build_object('confidence_score', dpr.confidence_score)), NULL, NULL,
      NULL, NULL, NULL, dpr.daily_prompt_id, false
    FROM public.daily_prompt_responses dpr
    JOIN me ON dpr.enrollment_id = me.enrollment_id AND dpr.user_id = me.user_id
    JOIN public.daily_prompts dp ON dp.id = dpr.daily_prompt_id
    WHERE nullif(btrim(dpr.response_text), '') IS NOT NULL

    -- Explicit My Journey reflections (private to the learner).
    UNION ALL
    SELECT 'journey_reflection', 'coachee_reflections', cr.id, NULL, cr.created_at, NULL,
      btrim(cr.body), jsonb_strip_nulls(jsonb_build_object('mood', nullif(btrim(cr.mood), ''))), NULL, NULL,
      NULL, NULL, NULL, NULL, true
    FROM public.coachee_reflections cr
    JOIN me ON cr.enrollment_id = me.enrollment_id AND cr.coachee_id = me.user_id
    WHERE nullif(btrim(cr.body), '') IS NOT NULL
  )
  SELECT f.source_type || ':' || f.source_id::text,
    f.source_type, f.source_table, f.source_id, f.module, f.occurred_at, f.title, f.body, f.details,
    f.rating, f.previous_rating, f.linked_session_table, f.linked_session_id, f.linked_goal_id,
    f.linked_activity_id, f.is_private
  FROM feed f
  ORDER BY f.occurred_at DESC NULLS LAST, f.source_type, f.source_id;
$$;

-- ----------------------------------------------------------------------------
-- 10. Demo data (Clariva Demo Organization; production only — a no-op where
--     the out-of-band demo system does not exist).
--
--     The demo seeded ONE group per learner and put both Triad sessions in
--     it. Under the requirement model every required Triad has its own
--     group assignment, so the demo becomes:
--       groups 1-7  .. Triad 1 (C: completed 16 Feb 2026; D: completed
--                      3 Mar 2025) — unchanged, session id g*10+1
--       groups 8-14 .. Triad 2, members rotated so nobody repeats a Triad 1
--                      partner (C: confirmed 20 Apr 2026; D: completed
--                      2 Jun 2025), session id (g-7)*10+2 (the same 14
--                      registered session ids as before)
--     The four C "session 2" rows that sit in Triad 1 groups (confirmed,
--     20 Apr) are archived and removed; the same ids are then seeded in the
--     Triad 2 groups. The registry gains 7 group rows: 1743 -> 1750.
-- ----------------------------------------------------------------------------
DO $demo_requirements$
DECLARE
  fixed_org constant uuid := 'c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01';
  def text;
  patched text;
  gen bigint;
  fn text;
  pair text[];
  replacements text[][];
BEGIN
  IF to_regclass('public.demo_resource_registry') IS NULL
     OR to_regprocedure('public.demo_apply_batch_3(uuid)') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE $seed_def$
CREATE OR REPLACE FUNCTION public.demo_seed_triads(p_generation bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  e record;
  group_no integer;
  unit integer;
  base_group integer;
  slot integer;
  first_serial integer;
  n_groups integer;
  group_id uuid;
  session_id uuid;
  requirement_id uuid;
  members uuid[];
  cohort uuid;
  programme uuid;
  activity_start timestamptz;
  is_historical boolean;
BEGIN
  -- Triad 1: groups 1-4 (Cohort C, leaders 19-30), 5-7 (Cohort D, 31-39).
  -- Triad 2: groups 8-11 (C) and 12-14 (D); member in slot s of Triad 2
  -- group k comes from Triad 1 group (k + s - 1) mod n, a Latin-square
  -- rotation, so no pair of learners repeats.
  FOR group_no IN 1..14 LOOP
    unit := CASE WHEN group_no <= 7 THEN 1 ELSE 2 END;
    base_group := CASE WHEN group_no <= 7 THEN group_no ELSE group_no - 7 END;
    is_historical := base_group >= 5;
    n_groups := CASE WHEN is_historical THEN 3 ELSE 4 END;
    first_serial := CASE WHEN is_historical THEN 31 ELSE 19 END;
    members := ARRAY[]::uuid[];
    FOR slot IN 1..3 LOOP
      SELECT * INTO e FROM public.demo_batch_2_leader(
        first_serial
        + 3 * CASE WHEN unit = 1 THEN (base_group - CASE WHEN is_historical THEN 5 ELSE 1 END)
                   ELSE ((base_group - CASE WHEN is_historical THEN 5 ELSE 1 END) + slot - 1) % n_groups END
        + (slot - 1));
      members := members || e.enrollment_id;
      cohort := e.cohort_id;
      programme := e.programme_id;
    END LOOP;

    SELECT d.id INTO requirement_id FROM public.cohort_requirement_dates d
    WHERE d.cohort_id = cohort AND d.programme_id = programme
      AND d.module = 'triads'::public.programme_module_type AND d.ordinal = unit;
    IF requirement_id IS NULL THEN
      RAISE EXCEPTION 'Demo Triad %: the cohort has no Triad % requirement date', group_no, unit;
    END IF;

    group_id := public.demo_batch_3_id('triad_group', group_no);
    INSERT INTO public.triad_groups (id, cohort_requirement_date_id, is_active, assigned_by, group_language)
    VALUES (group_id, requirement_id, true, 'admin', 'en')
    ON CONFLICT (id) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM public.triad_groups g WHERE g.id = group_id AND g.cohort_requirement_date_id = requirement_id) THEN
      RAISE EXCEPTION 'Demo Triad group % exists for another requirement', group_no;
    END IF;
    INSERT INTO public.triad_group_members (triad_group_id, enrollment_id, member_order)
    SELECT group_id, m.enrollment_id, m.ord
    FROM unnest(members) WITH ORDINALITY AS m(enrollment_id, ord)
    WHERE NOT EXISTS (SELECT 1 FROM public.triad_group_members x
                      WHERE x.triad_group_id = group_id AND x.enrollment_id = m.enrollment_id);
    PERFORM public.demo_batch_3_register_resource('triad_group', group_id, p_generation);

    session_id := public.demo_batch_3_id('triad_session', base_group * 10 + unit);
    activity_start := CASE
      WHEN is_historical AND unit = 1 THEN TIMESTAMPTZ '2025-03-03 10:00:00+07'
      WHEN is_historical THEN TIMESTAMPTZ '2025-06-02 10:00:00+07'
      WHEN unit = 1 THEN TIMESTAMPTZ '2026-02-16 10:00:00+07'
      ELSE TIMESTAMPTZ '2026-04-20 10:00:00+07' END;
    IF EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.id = session_id AND s.triad_group_id <> group_id) THEN
      RAISE EXCEPTION 'Demo Triad session % belongs to another group', session_id;
    END IF;
    -- A completed session is final history: it is only ever inserted.
    INSERT INTO public.triad_sessions (id, triad_group_id, scheduled_start_time, scheduled_end_time, status)
    SELECT session_id, group_id, activity_start, activity_start + INTERVAL '60 minutes',
      CASE WHEN is_historical OR unit = 1 THEN 'completed' ELSE 'confirmed' END
    WHERE NOT EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.id = session_id);
    INSERT INTO public.triad_session_responses (triad_session_id, enrollment_id, response, responded_at)
    SELECT session_id, m, 'accepted', activity_start - INTERVAL '7 days'
    FROM unnest(members) AS m
    ON CONFLICT (triad_session_id, enrollment_id) DO NOTHING;
    PERFORM public.demo_batch_3_register_resource('triad_session', session_id, p_generation);
  END LOOP;
END;
$function$
$seed_def$;
  REVOKE ALL ON FUNCTION public.demo_seed_triads(bigint) FROM PUBLIC, anon, authenticated;

  -- The generator and its checks: every replaced fragment must be found
  -- exactly once, or the deployment stops (the live definitions drifted).
  replacements := ARRAY[
    ['demo_apply_batch_3(uuid)', 'triadGroups'', 7,', 'triadGroups'', 14,'],
    ['demo_apply_batch_3(uuid)', 'ownershipResources'', 1522', 'ownershipResources'', 1529'],
    ['demo_validate_batch_3_ownership()', 'expected_count integer := 1522;', 'expected_count integer := 1529;'],
    ['demo_apply_batch_4(uuid)', 'IF final_count <> 1743 THEN', 'IF final_count <> 1750 THEN'],
    ['demo_apply_batch_4(uuid)', 'expected 1743'',', 'expected 1750'','],
    ['demo_apply_batch_4(uuid)', 'ownershipResourcesBefore'', 1743,', 'ownershipResourcesBefore'', 1750,'],
    ['demo_delete_batch_4_owned_resources(uuid)', 'deletedOwnershipResources'', 1743,', 'deletedOwnershipResources'', 1750,'],
    ['demo_validate_batch_4_ownership()', 'expected_count integer := 1743;', 'expected_count integer := 1750;'],
    ['demo_assert_batch_3_collisions()',
     E'  FOR i IN 1..7 LOOP\n    expected_id := public.demo_batch_3_id(''triad_group'', i);',
     E'  FOR i IN 1..14 LOOP\n    expected_id := public.demo_batch_3_id(''triad_group'', i);'],
    ['demo_assert_batch_3_collisions()',
     E'    FOR n IN 1..2 LOOP\n      expected_id := public.demo_batch_3_id(''triad_session'', i * 10 + n);',
     E'    FOR n IN 1..(CASE WHEN i <= 7 THEN 2 ELSE 0 END) LOOP\n      expected_id := public.demo_batch_3_id(''triad_session'', i * 10 + n);']
  ];
  FOREACH pair SLICE 1 IN ARRAY replacements LOOP
    IF to_regprocedure('public.' || pair[1]) IS NULL THEN
      RAISE EXCEPTION 'Triad requirement groups: demo function % is missing', pair[1];
    END IF;
    def := pg_get_functiondef(('public.' || pair[1])::regprocedure);
    IF (length(def) - length(replace(def, pair[2], ''))) / length(pair[2]) <> 1 THEN
      RAISE EXCEPTION 'Triad requirement groups: demo function % does not contain "%" exactly once', pair[1], pair[2];
    END IF;
    EXECUTE replace(def, pair[2], pair[3]);
  END LOOP;

  -- The Triad block of demo_apply_batch_3 becomes the requirement seed.
  def := pg_get_functiondef('public.demo_apply_batch_3(uuid)'::regprocedure);
  patched := regexp_replace(def,
    '  -- Seven deterministic cohort Triad groups:.*?(  -- One neutral enrollment-level goal)',
    E'  -- Triad groups: one group per learner per required Triad\n  -- (demo_seed_triads).\n  PERFORM public.demo_seed_triads(registry_generation);\n\n\\1');
  IF patched = def THEN
    RAISE EXCEPTION 'Triad requirement groups: demo_apply_batch_3 Triad block not found';
  END IF;
  EXECUTE patched;

  -- Current demo data: archive + remove the second sessions that sit in
  -- Triad 1 groups, then seed the Triad 2 groups (same registry generation
  -- as the existing demo Triad rows).
  SELECT r.generation INTO gen FROM public.demo_resource_registry r
  WHERE r.organization_id = fixed_org AND r.resource_type = 'triad_group'
    AND r.resource_id = public.demo_batch_3_id('triad_group', 1);
  IF gen IS NULL THEN
    RETURN; -- demo organisation not provisioned: the next provision seeds it
  END IF;

  PERFORM set_config('clariva.demo_reset', 'on', true);
  INSERT INTO public.triad_cutover_archive (object_name, record_id, payload, migration_id)
  SELECT 'requirement_groups.triad_sessions', s.id,
    to_jsonb(s) || jsonb_build_object('responses',
      (SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM public.triad_session_responses r WHERE r.triad_session_id = s.id),
      'reason', 'demo: Triad 2 session moved to its own Triad 2 group'),
    '20260919120000_triad_requirement_groups'
  FROM public.triad_sessions s
  WHERE s.id IN (SELECT public.demo_batch_3_id('triad_session', g * 10 + 2) FROM generate_series(1, 7) g)
    AND s.triad_group_id IN (SELECT public.demo_batch_3_id('triad_group', g) FROM generate_series(1, 7) g)
  ON CONFLICT (object_name, record_id) DO NOTHING;
  DELETE FROM public.triad_sessions s
  WHERE s.id IN (SELECT public.demo_batch_3_id('triad_session', g * 10 + 2) FROM generate_series(1, 7) g)
    AND s.triad_group_id IN (SELECT public.demo_batch_3_id('triad_group', g) FROM generate_series(1, 7) g);
  PERFORM public.demo_seed_triads(gen);
  PERFORM set_config('clariva.demo_reset', 'off', true);
END
$demo_requirements$;

-- ----------------------------------------------------------------------------
-- 11. Function access (re-created functions start with default grants).
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.canonical_triad_requirement_fulfilment(uuid),
  public.sponsor_canonical_activity(uuid),
  public.canonical_triad_completion(uuid, date),
  public.admin_save_cohort_requirement_dates_guard(),
  public.triad_requirement_learners_internal(uuid, date),
  public.triad_requirement_candidates_internal(uuid),
  public.triad_create_group_internal(uuid, uuid[], text, text, timestamptz, timestamptz),
  public.triad_clear_unconfirmed_auto_groups_internal(uuid),
  public.triad_reminder_targets_internal(date, uuid),
  public.triad_cohort_learners_internal(uuid, date)
FROM PUBLIC, anon, authenticated;

-- The auto-assign / reminder Edge Functions run as service_role.
GRANT EXECUTE ON FUNCTION
  public.canonical_triad_requirement_fulfilment(uuid),
  public.sponsor_canonical_activity(uuid),
  public.canonical_triad_completion(uuid, date),
  public.triad_requirement_learners_internal(uuid, date),
  public.triad_requirement_candidates_internal(uuid),
  public.triad_create_group_internal(uuid, uuid[], text, text, timestamptz, timestamptz),
  public.triad_clear_unconfirmed_auto_groups_internal(uuid),
  public.triad_reminder_targets_internal(date, uuid),
  public.triad_cohort_learners_internal(uuid, date)
TO service_role;

REVOKE ALL ON FUNCTION
  public.learner_triad_overview(uuid),
  public.learner_session_history(uuid),
  public.admin_cohort_triad_requirements(uuid, date),
  public.admin_cohort_triad_groups(uuid),
  public.admin_cohort_triad_learners(uuid, date),
  public.admin_triad_requirement_candidates(uuid),
  public.admin_triad_create_group(uuid, uuid[], text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.learner_triad_overview(uuid),
  public.learner_session_history(uuid),
  public.admin_cohort_triad_requirements(uuid, date),
  public.admin_cohort_triad_groups(uuid),
  public.admin_cohort_triad_learners(uuid, date),
  public.admin_triad_requirement_candidates(uuid),
  public.admin_triad_create_group(uuid, uuid[], text)
TO authenticated;

-- ----------------------------------------------------------------------------
-- 12. Verification. Anything unexpected stops the deployment.
-- ----------------------------------------------------------------------------
DO $$
DECLARE bad text; n bigint; demo_enrollments uuid[] := ARRAY[]::uuid[];
BEGIN
  -- Every group: a Triad requirement of its own cohort, 2-3 members, all
  -- enrolled in the requirement's cohort and programme.
  SELECT string_agg(g.id::text, ', ') INTO bad
  FROM public.triad_groups g
  LEFT JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id
  WHERE d.id IS NULL OR d.module <> 'triads'::public.programme_module_type OR d.cohort_id <> g.cohort_id
     OR (SELECT count(*) FROM public.triad_group_members m WHERE m.triad_group_id = g.id) NOT BETWEEN 2 AND 3
     OR EXISTS (SELECT 1 FROM public.triad_group_members m JOIN public.programme_enrollments e ON e.id = m.enrollment_id
                WHERE m.triad_group_id = g.id
                  AND (e.cohort_id IS DISTINCT FROM d.cohort_id OR e.programme_id IS DISTINCT FROM d.programme_id));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Triad requirement groups verification: invalid groups: %', bad; END IF;

  -- One active group per enrollment per requirement.
  SELECT string_agg(x.enrollment_id::text || ' (Triad ' || x.ordinal || ')', ', ') INTO bad FROM (
    SELECT m.enrollment_id, d.ordinal FROM public.triad_group_members m
    JOIN public.triad_groups g ON g.id = m.triad_group_id AND g.is_active
    JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id
    GROUP BY m.enrollment_id, g.cohort_requirement_date_id, d.ordinal HAVING count(*) > 1) x;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad requirement groups verification: several active groups for one requirement: %', bad;
  END IF;

  -- No member, reflection or real group lost.
  IF (SELECT reflections FROM _rq_before_counts) <> (SELECT count(*) FROM public.triad_reflections) THEN
    RAISE EXCEPTION 'Triad requirement groups verification: reflection count changed';
  END IF;
  IF to_regclass('public.demo_resource_registry') IS NOT NULL THEN
    EXECUTE $q$SELECT coalesce(array_agg(resource_id), ARRAY[]::uuid[]) FROM public.demo_resource_registry
               WHERE resource_type = 'enrollment'$q$ INTO demo_enrollments;
  END IF;
  SELECT count(*) INTO n FROM _rq_before_members b
  WHERE NOT EXISTS (SELECT 1 FROM public.triad_group_members m
                    WHERE m.triad_group_id = b.triad_group_id AND m.enrollment_id = b.enrollment_id);
  IF n > 0 THEN RAISE EXCEPTION 'Triad requirement groups verification: % memberships lost', n; END IF;

  -- The projection every surface reads equals canonical progress.
  SELECT count(*) INTO n
  FROM public.programme_enrollments e
  JOIN LATERAL (SELECT * FROM public.canonical_module_progress(e.id, current_date) p
                WHERE p.module = 'triads'::public.programme_module_type) p ON true
  CROSS JOIN LATERAL public.canonical_triad_completion(e.id, current_date) c
  WHERE row(c.required_units, c.completed_by_as_of, c.completed_units, c.due_units, c.overdue_units, c.booked_units, c.pace_status)
        IS DISTINCT FROM row(p.required_units, p.completed_activity_units, p.completed_units, p.due_units, p.overdue_units, p.booked_units, p.pace_status);
  IF n > 0 THEN RAISE EXCEPTION 'Triad requirement groups verification: % completion projections differ from canonical progress', n; END IF;

  -- Progress of real (non-demo) learners must not change: every existing
  -- real group maps to the requirement it fulfilled / will fulfil. Demo
  -- changes are expected (Triad 2 groups) and reported.
  SELECT string_agg(b.enrollment_id::text, ', ') INTO bad
  FROM _rq_before_progress b
  JOIN LATERAL (SELECT * FROM public.canonical_module_progress(b.enrollment_id, current_date) p
                WHERE p.module = 'triads'::public.programme_module_type) a ON true
  WHERE row(b.required_units, b.completed_units, b.due_units, b.overdue_units)
        IS DISTINCT FROM row(a.required_units, a.completed_units, a.due_units, a.overdue_units)
    AND b.enrollment_id <> ALL (demo_enrollments);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad requirement groups verification: Triad progress changed for real enrollments %', bad
      USING HINT = 'Review these learners'' groups before deploying.';
  END IF;
  SELECT count(*) INTO n
  FROM _rq_before_progress b
  JOIN LATERAL (SELECT * FROM public.canonical_module_progress(b.enrollment_id, current_date) p
                WHERE p.module = 'triads'::public.programme_module_type) a ON true
  WHERE row(b.completed_units, b.due_units, b.overdue_units) IS DISTINCT FROM row(a.completed_units, a.due_units, a.overdue_units);
  IF n > 0 THEN RAISE NOTICE 'Triad requirement groups: Triad progress changed for % demo enrollment(s) (Triad 2 groups seeded)', n; END IF;
  RAISE NOTICE 'Triad requirement groups: % group(s) mapped (% before), % Triad 2+ group(s)',
    (SELECT count(*) FROM _rq_map), (SELECT groups FROM _rq_before_counts),
    (SELECT count(*) FROM public.triad_groups g JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id WHERE d.ordinal > 1);
END $$;

-- Final state: no live function reads a retired Triad field, and the
-- cohort-scoped assignment functions are gone.
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO offenders
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND p.proname NOT IN ('triad_is_seed_identifier')
    AND pg_get_functiondef(p.oid) ~ '(coach|coachee|observer)_enrollment_id|member_[123]_(id|response)|enrollment_[123]_id|[a-z]\.(learned|will_use)_as_(coach|coachee|observer)|completion_deadline|programme_triad_rounds|public\.triad_rounds|triad_round_id|cohort_triad_operations';
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Triad requirement groups: functions still read retired Triad fields: %', offenders;
  END IF;
  IF to_regprocedure('public.triad_cohort_candidates_internal(uuid)') IS NOT NULL
     OR to_regprocedure('public.admin_cohort_triad_requirement(uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_triad_create_group'
                    AND pg_get_function_identity_arguments(oid) LIKE 'p_cohort_requirement_date_id uuid,%') THEN
    RAISE EXCEPTION 'Triad requirement groups: cohort-scoped assignment functions remain';
  END IF;
END $$;
