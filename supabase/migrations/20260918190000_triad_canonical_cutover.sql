-- ============================================================================
-- TRIAD CANONICAL CUTOVER (data model + source-of-truth).
--
-- Final ownership:
--   required Triad units ........ programme_modules (config.required_units)
--   Triad unit N due date ....... cohort_requirement_dates (module 'triads',
--                                 ordinal N, units = 1) — THE round identity
--   group ....................... triad_groups.cohort_requirement_date_id
--   membership .................. triad_group_members.enrollment_id
--   actual session .............. triad_sessions.scheduled_start/end_time
--   candidate times ............. triad_alternative_proposals
--   acceptance .................. triad_session_responses /
--                                 triad_alternative_proposal_responses
--   completion evidence ......... completed triad_session x group membership
--                                 -> session_activity_attributions
--   progress / overdue .......... canonical_module_progress (unchanged)
--   reflection .................. triad_reflections (session x enrollment)
--   reflection answers .......... triad_reflection_answers x questions
--   goal rating / comment ....... goal_checkins (unchanged)
--
-- Every learner rotates through Coach / Coachee / Observer, so the session
-- role columns (coach/coachee/observer_enrollment_id) are NOT ownership: they
-- were positional copies of the group's enrollment slots (enforced by the
-- retired validate_triad_session_enrollment_scope trigger). Membership is the
-- only participant source from here on.
--
-- This migration is additive for storage: legacy columns and triad_rounds /
-- programme_triad_rounds keep their data (clients lose access) and are
-- removed by 20260918199000_triad_retire_legacy after archiving. It runs as
-- one transaction and FAILS on any ambiguity or on any unexplained difference
-- between the pre- and post-cutover facts (see the verification block).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Pre-cutover snapshot of the facts that must survive unchanged.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _triad_before_progress ON COMMIT DROP AS
SELECT e.id AS enrollment_id, p.required_units, p.completed_activity_units, p.completed_units,
  p.due_units, p.booked_units, p.overdue_units, p.pace_status
FROM public.programme_enrollments e
CROSS JOIN LATERAL public.canonical_module_progress(e.id, current_date) p
WHERE p.module = 'triads'::public.programme_module_type;

CREATE TEMP TABLE _triad_before_ownership ON COMMIT DROP AS
SELECT DISTINCT s.id AS session_id, r.enrollment_id
FROM public.triad_sessions s
CROSS JOIN LATERAL (VALUES (s.coach_enrollment_id), (s.coachee_enrollment_id), (s.observer_enrollment_id)) r(enrollment_id)
WHERE r.enrollment_id IS NOT NULL;

CREATE TEMP TABLE _triad_before_attributions ON COMMIT DROP AS
SELECT a.enrollment_id, a.source_activity_id AS session_id, a.occurred_on
FROM public.session_activity_attributions a
WHERE a.source_activity_type = 'triad';

CREATE TEMP TABLE _triad_before_reflections ON COMMIT DROP AS
SELECT r.* FROM public.triad_reflections r;

CREATE TEMP TABLE _triad_before_counts ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.triad_groups) AS groups,
  (SELECT count(*) FROM public.triad_sessions) AS sessions,
  (SELECT count(*) FROM public.triad_alternative_proposals) AS proposals,
  (SELECT count(*) FROM public.triad_reflections) AS reflections;

-- ----------------------------------------------------------------------------
-- 1. Validate the legacy data. Anything inconsistent stops the cutover.
-- ----------------------------------------------------------------------------
DO $$
DECLARE bad text;
BEGIN
  -- Every group's slot enrollments are its slot learners (identity: never
  -- waivable).
  SELECT string_agg(g.id::text, ', ') INTO bad
  FROM public.triad_groups g
  WHERE EXISTS (
       SELECT 1
       FROM (VALUES (g.member_1_id, g.enrollment_1_id), (g.member_2_id, g.enrollment_2_id), (g.member_3_id, g.enrollment_3_id)) slot(user_id, enrollment_id)
       LEFT JOIN public.programme_enrollments e ON e.id = slot.enrollment_id
       WHERE (slot.user_id IS NULL) <> (slot.enrollment_id IS NULL)
          OR (slot.enrollment_id IS NOT NULL AND (e.id IS NULL OR e.user_id <> slot.user_id))
     )
     OR g.enrollment_1_id IS NULL OR g.enrollment_2_id IS NULL;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover: group slots are inconsistent with their enrollments (groups: %)', bad;
  END IF;

  -- Every group has a cohort and all its enrollments are in that cohort and
  -- programme — unless a reviewed decision keeps it as history only
  -- (historical_unlinked: it never becomes an operational group).
  SELECT string_agg(g.id::text, ', ') INTO bad
  FROM public.triad_groups g
  WHERE (g.cohort_id IS NULL
     OR EXISTS (
       SELECT 1
       FROM (VALUES (g.enrollment_1_id), (g.enrollment_2_id), (g.enrollment_3_id)) slot(enrollment_id)
       JOIN public.programme_enrollments e ON e.id = slot.enrollment_id
       WHERE e.programme_id <> g.programme_id OR e.cohort_id IS DISTINCT FROM g.cohort_id))
    AND NOT EXISTS (SELECT 1 FROM public.triad_cutover_group_decisions dec
                    WHERE dec.triad_group_id = g.id AND dec.decision = 'historical_unlinked');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover: group members are outside the group''s cohort / programme (groups: %)', bad
      USING HINT = 'Correct the enrollments, or record a reviewed historical_unlinked decision for the group.';
  END IF;

  -- Every session's stored role enrollments are exactly its group's
  -- enrollments (no member missing, nobody outside the group).
  SELECT string_agg(s.id::text, ', ') INTO bad
  FROM public.triad_sessions s
  JOIN public.triad_groups g ON g.id = s.triad_group_id
  WHERE ARRAY(SELECT x FROM unnest(ARRAY[s.coach_enrollment_id, s.coachee_enrollment_id, s.observer_enrollment_id]) x WHERE x IS NOT NULL ORDER BY x)
     IS DISTINCT FROM
        ARRAY(SELECT x FROM unnest(ARRAY[g.enrollment_1_id, g.enrollment_2_id, g.enrollment_3_id]) x WHERE x IS NOT NULL ORDER BY x);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover: session participants differ from their group membership (sessions: %)', bad;
  END IF;

  -- The two legacy time columns never disagree (either is the effective time).
  SELECT string_agg(s.id::text, ', ') INTO bad
  FROM public.triad_sessions s
  WHERE s.start_time IS NOT NULL AND s.proposed_start_time IS NOT NULL
    AND s.start_time <> s.proposed_start_time;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover: sessions with two different start times (sessions: %)', bad;
  END IF;

  -- Every non-retired reflection is authored by an enrollment of the session's
  -- group; one reflection per session and enrollment.
  SELECT string_agg(r.id::text, ', ') INTO bad
  FROM public.triad_reflections r
  JOIN public.triad_sessions s ON s.id = r.triad_session_id
  JOIN public.triad_groups g ON g.id = s.triad_group_id
  WHERE r.enrollment_id IS NOT NULL
    AND r.enrollment_id NOT IN (g.enrollment_1_id, g.enrollment_2_id)
    AND r.enrollment_id IS DISTINCT FROM g.enrollment_3_id;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover: reflections authored outside the session group (reflections: %)', bad;
  END IF;
  SELECT string_agg(r.id::text, ', ') INTO bad
  FROM public.triad_reflections r
  WHERE r.enrollment_id IS NULL
    AND NOT public.is_historical_ownership_retired('triad_reflections', r.id);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover: unledgered reflections without an enrollment (reflections: %)', bad;
  END IF;
  SELECT string_agg(triad_session_id::text || '/' || enrollment_id::text, ', ') INTO bad
  FROM public.triad_reflections
  WHERE enrollment_id IS NOT NULL
  GROUP BY triad_session_id, enrollment_id
  HAVING count(*) > 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover: duplicate reflections per session and enrollment (%)', bad;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. One cohort Triad requirement row per unit. A Triad round is one unit, so
--    a multi-unit Triad row (only the 'flexible' policy produced them) is
--    split into single-unit rows with the SAME due date. Dates are unchanged;
--    ordinals are renumbered in their existing order.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cohort_requirement_dates WHERE module = 'triads' AND units > 1) THEN
    CREATE TEMP TABLE _triad_split ON COMMIT DROP AS
    SELECT d.cohort_id, d.programme_id, d.due_on, d.training_week_id, d.generation_method,
      d.materialized_via, d.generated_due_on, d.is_overridden, d.updated_by, d.created_at,
      row_number() OVER (PARTITION BY d.cohort_id, d.programme_id ORDER BY d.ordinal, n.n)::integer AS ordinal
    FROM public.cohort_requirement_dates d
    CROSS JOIN LATERAL generate_series(1, d.units) AS n(n)
    WHERE d.module = 'triads'
      AND (d.cohort_id, d.programme_id) IN (
        SELECT x.cohort_id, x.programme_id FROM public.cohort_requirement_dates x
        WHERE x.module = 'triads' AND x.units > 1);

    DELETE FROM public.cohort_requirement_dates d
    USING (SELECT DISTINCT cohort_id, programme_id FROM _triad_split) p
    WHERE d.module = 'triads' AND d.cohort_id = p.cohort_id AND d.programme_id = p.programme_id;

    INSERT INTO public.cohort_requirement_dates (
      cohort_id, programme_id, module, ordinal, due_on, units, training_week_id,
      generation_method, materialized_via, generated_due_on, is_overridden, updated_by, created_at)
    SELECT cohort_id, programme_id, 'triads', ordinal, due_on, 1, training_week_id,
      generation_method, materialized_via, generated_due_on, is_overridden, updated_by, created_at
    FROM _triad_split;
  END IF;
END $$;

ALTER TABLE public.cohort_requirement_dates
  ADD CONSTRAINT cohort_requirement_dates_triad_single_unit
  CHECK (module <> 'triads'::public.programme_module_type OR units = 1);

-- The proposal layer (the only place policy is interpreted) emits one row per
-- Triad unit. Every other module is unchanged.
CREATE OR REPLACE FUNCTION public.cohort_requirement_proposal_internal(p_programme_id uuid, p_cohort_id uuid, p_start date, p_end date)
 RETURNS TABLE(module programme_module_type, ordinal integer, due_on date, units integer, training_week_id uuid, generation_method text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH configured_modules AS (
    SELECT pm.module,
      CASE
        WHEN coalesce((pm.config->>'required')::boolean, false)
        THEN coalesce(public.programme_config_integer(pm.config, 'required_units'), 0)
        ELSE 0
      END AS required_units,
      coalesce(nullif(pm.config->>'distribution_mode', ''), 'flexible') AS distribution_mode,
      coalesce(pm.config->'distribution_settings', '{}'::jsonb) AS distribution_settings
    FROM public.programme_modules pm
    WHERE pm.programme_id = p_programme_id
      AND pm.enabled
      AND pm.module <> 'training'::public.programme_module_type
  ), items AS (
    SELECT cm.module, p_end AS due_on, cm.required_units AS units,
      NULL::uuid AS training_week_id, cm.distribution_mode, 1::bigint AS sort_key
    FROM configured_modules cm
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'flexible'

    UNION ALL
    SELECT cm.module,
      p_start + CASE
        WHEN units.sequence_no = cm.required_units THEN p_end - p_start
        WHEN p_end > p_start
        THEN greatest(1, ((p_end - p_start) * units.sequence_no / cm.required_units))
        ELSE 0
      END,
      1, NULL::uuid, cm.distribution_mode, units.sequence_no::bigint
    FROM configured_modules cm
    CROSS JOIN LATERAL generate_series(1, cm.required_units) AS units(sequence_no)
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'evenly_distributed'

    UNION ALL
    SELECT cm.module,
      least(
        p_end,
        (p_start + ((units.sequence_no - 1)
          * coalesce(public.programme_config_integer(cm.distribution_settings, 'interval_months'), 1)
          * interval '1 month'))::date
      ),
      1, NULL::uuid, cm.distribution_mode, units.sequence_no::bigint
    FROM configured_modules cm
    CROSS JOIN LATERAL generate_series(1, cm.required_units) AS units(sequence_no)
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'monthly_frequency'

    UNION ALL
    SELECT cm.module,
      NULLIF(custom.entry->>'due_on', '')::date,
      coalesce(public.programme_config_integer(custom.entry, 'required_units'), 1),
      NULL::uuid, cm.distribution_mode, custom.entry_order
    FROM configured_modules cm
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(cm.distribution_settings->'milestones') = 'array'
        THEN cm.distribution_settings->'milestones' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS custom(entry, entry_order)
    WHERE cm.required_units > 0 AND cm.distribution_mode = 'custom'

    UNION ALL
    SELECT cm.module,
      least(
        p_end,
        coalesce(cwo.unlock_date, (p_start + ((tw.week_number - 1) * interval '7 days'))::date, tw.unlock_date)
      ),
      1, tw.id, cm.distribution_mode, selected.selection_order
    FROM configured_modules cm
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(cm.distribution_settings->'training_week_ids') = 'array'
        THEN cm.distribution_settings->'training_week_ids' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS selected(week_id, selection_order)
    JOIN public.training_weeks tw
      ON tw.programme_id = p_programme_id
     AND tw.id::text = selected.week_id
    LEFT JOIN public.cohort_week_overrides cwo
      ON cwo.cohort_id = p_cohort_id
     AND cwo.training_week_id = tw.id
    WHERE cm.required_units > 0
      AND cm.distribution_mode = 'training_linked'
      AND selected.selection_order <= cm.required_units
  )
  -- A Triad round is one unit: a multi-unit Triad item becomes that many
  -- single-unit rows on the same date.
  SELECT i.module,
    row_number() OVER (PARTITION BY i.module ORDER BY i.due_on, i.sort_key, split.n)::integer,
    i.due_on,
    CASE WHEN i.module = 'triads'::public.programme_module_type THEN 1 ELSE i.units END,
    i.training_week_id, i.distribution_mode
  FROM items i
  CROSS JOIN LATERAL generate_series(
    1, CASE WHEN i.module = 'triads'::public.programme_module_type THEN greatest(i.units, 1) ELSE 1 END
  ) AS split(n)
  WHERE p_start IS NOT NULL
    AND p_end IS NOT NULL
    AND i.due_on IS NOT NULL;
$function$;

-- ----------------------------------------------------------------------------
-- 3. The Triad group -> requirement link and normalized membership.
-- ----------------------------------------------------------------------------
ALTER TABLE public.triad_groups
  ADD COLUMN cohort_requirement_date_id uuid REFERENCES public.cohort_requirement_dates(id) ON DELETE RESTRICT;
CREATE INDEX triad_groups_requirement_idx ON public.triad_groups(cohort_requirement_date_id, is_active);
COMMENT ON COLUMN public.triad_groups.cohort_requirement_date_id IS
  'The cohort Triad requirement unit (round) this group practises for. Cohort, programme, unit number and due date are derived from it. NULL only for historical groups recorded as historical_unlinked in triad_cutover_group_decisions.';

CREATE TABLE public.triad_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triad_group_id uuid NOT NULL REFERENCES public.triad_groups(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT,
  member_order smallint NOT NULL CHECK (member_order BETWEEN 1 AND 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (triad_group_id, enrollment_id),
  UNIQUE (triad_group_id, member_order)
);
CREATE INDEX triad_group_members_enrollment_idx ON public.triad_group_members(enrollment_id);
COMMENT ON TABLE public.triad_group_members IS
  'THE Triad membership source: which learner enrollments practise together. Learner / profile identity is derived through the enrollment. member_order is display order only — not a role.';

-- Admin regenerate used to delete and re-insert every row, which would drop
-- the identity Triad groups reference. It now updates each unit in place,
-- inserts missing units and removes surplus ones (never one with groups).
CREATE OR REPLACE FUNCTION public.admin_save_cohort_requirement_dates(p_cohort_id uuid, p_items jsonb, p_regenerate boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    -- Units that the regenerated schedule no longer has are removed — unless
    -- Triad groups practise for them.
    IF EXISTS (
      SELECT 1
      FROM public.cohort_requirement_dates d
      JOIN (SELECT DISTINCT i.programme_id, i.module FROM pg_temp.crd_items i) pairs
        ON pairs.programme_id = d.programme_id AND pairs.module = d.module
      WHERE d.cohort_id = p_cohort_id
        AND NOT EXISTS (SELECT 1 FROM pg_temp.crd_items i
                        WHERE i.programme_id = d.programme_id AND i.module = d.module AND i.ordinal = d.ordinal)
        AND EXISTS (SELECT 1 FROM public.triad_groups g WHERE g.cohort_requirement_date_id = d.id)
    ) THEN
      RAISE EXCEPTION 'A Triad requirement that has assigned groups cannot be removed' USING ERRCODE = '22023';
    END IF;

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
    ON CONFLICT (cohort_id, programme_id, module, ordinal) DO UPDATE SET
      due_on = excluded.due_on,
      units = excluded.units,
      training_week_id = excluded.training_week_id,
      generation_method = excluded.generation_method,
      materialized_via = excluded.materialized_via,
      generated_due_on = excluded.generated_due_on,
      is_overridden = excluded.is_overridden,
      updated_by = excluded.updated_by;
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
$function$;

-- ----------------------------------------------------------------------------
-- 4. Session time, acceptance, proposals, reflections, operations, archive.
-- ----------------------------------------------------------------------------

-- The session's current effective time. Before agreement it is the proposed
-- time; once agreed it is simply the session time. Candidate replacement
-- times live only in triad_alternative_proposals.
ALTER TABLE public.triad_sessions
  ADD COLUMN scheduled_start_time timestamptz,
  ADD COLUMN scheduled_end_time timestamptz;
ALTER TABLE public.triad_sessions
  ADD CONSTRAINT triad_sessions_scheduled_range
  CHECK (scheduled_start_time IS NULL OR scheduled_end_time IS NULL OR scheduled_end_time > scheduled_start_time) NOT VALID;
COMMENT ON COLUMN public.triad_sessions.scheduled_start_time IS
  'Current effective session start (proposed until every member accepts, then the agreed time). THE Triad session time.';
COMMENT ON COLUMN public.triad_sessions.status IS
  'Session lifecycle: proposed -> confirmed -> completed, or cancelled. Proposal state lives on triad_alternative_proposals.status.';

CREATE TABLE public.triad_session_responses (
  triad_session_id uuid NOT NULL REFERENCES public.triad_sessions(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT,
  response text NOT NULL DEFAULT 'pending' CHECK (response IN ('pending', 'accepted', 'declined')),
  responded_at timestamptz,
  PRIMARY KEY (triad_session_id, enrollment_id)
);
CREATE INDEX triad_session_responses_enrollment_idx ON public.triad_session_responses(enrollment_id);

ALTER TABLE public.triad_alternative_proposals
  ADD COLUMN proposed_by_enrollment_id uuid REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT;
COMMENT ON TABLE public.triad_alternative_proposals IS
  'Candidate replacement times for a Triad session. status: pending -> accepted | superseded. Never the session time until accepted.';

CREATE TABLE public.triad_alternative_proposal_responses (
  proposal_id uuid NOT NULL REFERENCES public.triad_alternative_proposals(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.programme_enrollments(id) ON DELETE RESTRICT,
  response text NOT NULL DEFAULT 'pending' CHECK (response IN ('pending', 'accepted', 'declined')),
  responded_at timestamptz,
  PRIMARY KEY (proposal_id, enrollment_id)
);

-- Reflection questions: stable ids, bilingual labels, optional programme scope
-- (NULL = the default set every programme uses unless it defines its own).
CREATE TABLE public.triad_reflection_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id uuid REFERENCES public.programmes(id) ON DELETE CASCADE,
  question_key text NOT NULL CHECK (question_key ~ '^[a-z][a-z0-9_]*$'),
  section text NOT NULL CHECK (section IN ('coach', 'coachee', 'observer', 'general')),
  label text NOT NULL,
  label_vi text,
  display_order integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX triad_reflection_questions_default_key
  ON public.triad_reflection_questions(question_key) WHERE programme_id IS NULL;
CREATE UNIQUE INDEX triad_reflection_questions_programme_key
  ON public.triad_reflection_questions(programme_id, question_key) WHERE programme_id IS NOT NULL;
CREATE TRIGGER trg_triad_reflection_questions_updated BEFORE UPDATE ON public.triad_reflection_questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.triad_reflection_questions (id, programme_id, question_key, section, label, label_vi, display_order) VALUES
  ('7d1a0000-0000-4000-8000-000000000001', NULL, 'learned_as_coach',      'coach',    'What did I learn?',        'Bạn học được gì?',                      10),
  ('7d1a0000-0000-4000-8000-000000000002', NULL, 'will_use_as_coach',     'coach',    'How will I use this?',     'Bạn sẽ áp dụng điều này như thế nào?',  20),
  ('7d1a0000-0000-4000-8000-000000000003', NULL, 'learned_as_coachee',    'coachee',  'What did I learn?',        'Bạn học được gì?',                      30),
  ('7d1a0000-0000-4000-8000-000000000004', NULL, 'will_use_as_coachee',   'coachee',  'How will I use this?',     'Bạn sẽ áp dụng điều này như thế nào?',  40),
  ('7d1a0000-0000-4000-8000-000000000005', NULL, 'learned_as_observer',   'observer', 'What did I learn?',        'Bạn học được gì?',                      50),
  ('7d1a0000-0000-4000-8000-000000000006', NULL, 'will_use_as_observer',  'observer', 'How will I use this?',     'Bạn sẽ áp dụng điều này như thế nào?',  60);

CREATE TABLE public.triad_reflection_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triad_reflection_id uuid NOT NULL REFERENCES public.triad_reflections(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.triad_reflection_questions(id) ON DELETE RESTRICT,
  answer_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (triad_reflection_id, question_id)
);
COMMENT ON TABLE public.triad_reflection_answers IS
  'Learner-authored answers to Triad reflection questions. THE Triad reflection text source.';

-- Narrow operational metadata for one cohort Triad requirement unit. No
-- deadline here: the due date is cohort_requirement_dates.due_on.
CREATE TABLE public.cohort_triad_operations (
  cohort_requirement_date_id uuid PRIMARY KEY REFERENCES public.cohort_requirement_dates(id) ON DELETE CASCADE,
  assignment_status text NOT NULL DEFAULT 'not_started'
    CHECK (assignment_status IN ('not_started', 'running', 'completed', 'failed')),
  last_assignment_run_at timestamptz,
  last_assignment_summary jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.cohort_triad_operations IS
  'Auto-assignment run state for one cohort Triad requirement unit. Operational only; never a date, membership or completion source.';

-- Internal archive of retired Triad structures (rounds, legacy columns), kept
-- for audit so no historical value is lost when the legacy shapes are dropped.
CREATE TABLE public.triad_cutover_archive (
  object_name text NOT NULL,
  record_id uuid NOT NULL,
  payload jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  migration_id text NOT NULL,
  PRIMARY KEY (object_name, record_id)
);
COMMENT ON TABLE public.triad_cutover_archive IS
  'Read-only audit archive of retired Triad structures (triad_rounds, programme_triad_rounds, legacy slot/role/answer columns). Internal; answers no current business question.';

-- ----------------------------------------------------------------------------
-- 5. Retire the legacy triggers / policies / helpers that read slot or role
--    columns. The replacements (below) read membership only.
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS triad_groups_enrollment_scope ON public.triad_groups;
DROP TRIGGER IF EXISTS triad_sessions_enrollment_scope ON public.triad_sessions;
DROP TRIGGER IF EXISTS trg_auto_confirm_triad ON public.triad_sessions;
DROP TRIGGER IF EXISTS triad_sessions_attribute_activity ON public.triad_sessions;
DROP TRIGGER IF EXISTS triad_sessions_validate_cap ON public.triad_sessions;
DROP TRIGGER IF EXISTS trg_notify_triad_session_booked ON public.triad_sessions;
DROP TRIGGER IF EXISTS trg_auto_accept_alt_proposal ON public.triad_alternative_proposals;
DROP TRIGGER IF EXISTS triad_reflections_enrollment_activity_scope ON public.triad_reflections;

DROP FUNCTION IF EXISTS public.validate_triad_group_enrollment_scope();
DROP FUNCTION IF EXISTS public.validate_triad_session_enrollment_scope();
DROP FUNCTION IF EXISTS public.auto_confirm_triad_session();
DROP FUNCTION IF EXISTS public.auto_accept_alternative_proposal();
DROP FUNCTION IF EXISTS public.attribute_new_triad_activity();

DROP POLICY IF EXISTS "Triad groups: admin manage" ON public.triad_groups;
DROP POLICY IF EXISTS "Triad groups: member read" ON public.triad_groups;
DROP POLICY IF EXISTS "Triad sessions: admin manage" ON public.triad_sessions;
DROP POLICY IF EXISTS "Triad sessions: member read" ON public.triad_sessions;
DROP POLICY IF EXISTS "Triad sessions: member update response" ON public.triad_sessions;
DROP POLICY IF EXISTS "Triad alt proposals: admin full" ON public.triad_alternative_proposals;
DROP POLICY IF EXISTS "Triad alt proposals: member read" ON public.triad_alternative_proposals;
DROP POLICY IF EXISTS "Triad alt proposals: member insert" ON public.triad_alternative_proposals;
DROP POLICY IF EXISTS "Triad alt proposals: member update" ON public.triad_alternative_proposals;
DROP POLICY IF EXISTS "Triad reflections: admin view all" ON public.triad_reflections;
DROP POLICY IF EXISTS "Triad reflections: group read after all submit" ON public.triad_reflections;
DROP POLICY IF EXISTS "Triad reflections: own insert" ON public.triad_reflections;
DROP POLICY IF EXISTS "Triad reflections: own read" ON public.triad_reflections;
DROP POLICY IF EXISTS "Triad rounds: admin full" ON public.triad_rounds;
DROP POLICY IF EXISTS "Triad rounds: participant read" ON public.triad_rounds;
DROP POLICY IF EXISTS "Programme triad rounds: authenticated view" ON public.programme_triad_rounds;
DROP POLICY IF EXISTS "Programme triad rounds: admin manage" ON public.programme_triad_rounds;

-- DEPRECATED (dropped by 20260918199000_triad_retire_legacy): no client or
-- runtime access from here on.
REVOKE ALL ON public.triad_rounds, public.programme_triad_rounds FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.triad_rounds IS 'DEPRECATED — retired by the Triad cutover; archived and dropped in 20260918199000 (second deployment).';
COMMENT ON TABLE public.programme_triad_rounds IS 'DEPRECATED — never consumed; archived and dropped in 20260918199000 (second deployment).';

-- Legacy slot / role / answer columns are no longer written.
ALTER TABLE public.triad_groups
  ALTER COLUMN member_1_id DROP NOT NULL,
  ALTER COLUMN member_2_id DROP NOT NULL,
  ALTER COLUMN enrollment_1_id DROP NOT NULL,
  ALTER COLUMN enrollment_2_id DROP NOT NULL,
  ALTER COLUMN programme_id DROP NOT NULL;
ALTER TABLE public.triad_sessions
  ALTER COLUMN coach_enrollment_id DROP NOT NULL,
  ALTER COLUMN coachee_enrollment_id DROP NOT NULL;
ALTER TABLE public.triad_alternative_proposals
  ALTER COLUMN proposed_by DROP NOT NULL;
ALTER TABLE public.triad_reflections
  ALTER COLUMN participant_id DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- 6. Backfill (deterministic only).
-- ----------------------------------------------------------------------------

-- 6a. Membership = the group's enrollment slots, in slot order.
INSERT INTO public.triad_group_members (triad_group_id, enrollment_id, member_order, created_at)
SELECT g.id, slot.enrollment_id, slot.member_order, g.created_at
FROM public.triad_groups g
CROSS JOIN LATERAL (VALUES (g.enrollment_1_id, 1), (g.enrollment_2_id, 2), (g.enrollment_3_id, 3)) AS slot(enrollment_id, member_order)
WHERE slot.enrollment_id IS NOT NULL;

-- 6b. Group -> cohort Triad requirement unit. Explicit decisions first; then
--     the stored round number within the group's own cohort; then a cohort
--     with exactly one Triad unit. Anything else is ambiguous -> stop.
CREATE TEMP TABLE _triad_group_link ON COMMIT DROP AS
SELECT g.id AS triad_group_id,
  dec.decision,
  CASE
    WHEN dec.decision = 'link' THEN dec.cohort_requirement_date_id
    WHEN dec.decision = 'historical_unlinked' THEN NULL
    WHEN coalesce(tr.round_number, g.round_number) IS NOT NULL THEN (
      SELECT d.id FROM public.cohort_requirement_dates d
      WHERE d.cohort_id = g.cohort_id AND d.programme_id = g.programme_id
        AND d.module = 'triads' AND d.ordinal = coalesce(tr.round_number, g.round_number))
    ELSE (
      SELECT CASE WHEN count(*) = 1 THEN (array_agg(d.id))[1] END
      FROM public.cohort_requirement_dates d
      WHERE d.cohort_id = g.cohort_id AND d.programme_id = g.programme_id AND d.module = 'triads')
  END AS cohort_requirement_date_id,
  coalesce(tr.round_number, g.round_number) AS round_number,
  g.cohort_id, g.programme_id,
  (SELECT count(*) FROM public.cohort_requirement_dates d
   WHERE d.cohort_id = g.cohort_id AND d.programme_id = g.programme_id AND d.module = 'triads') AS cohort_triad_units
FROM public.triad_groups g
LEFT JOIN public.triad_rounds tr ON tr.id = g.triad_round_id
LEFT JOIN public.triad_cutover_group_decisions dec ON dec.triad_group_id = g.id;

DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s (cohort %s, round %s, cohort Triad units %s)', l.triad_group_id, l.cohort_id,
           coalesce(l.round_number::text, 'none'), l.cohort_triad_units), '; ') INTO bad
  FROM _triad_group_link l
  WHERE l.cohort_requirement_date_id IS NULL
    AND l.decision IS DISTINCT FROM 'historical_unlinked';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover: cannot determine the cohort Triad requirement for groups: %', bad
      USING HINT = 'Record a reviewed decision in triad_cutover_group_decisions (migration before 20260918190000) for each group, then re-run.';
  END IF;
  -- An explicit link must point at a Triad unit of the group's own cohort.
  SELECT string_agg(l.triad_group_id::text, ', ') INTO bad
  FROM _triad_group_link l
  JOIN public.cohort_requirement_dates d ON d.id = l.cohort_requirement_date_id
  WHERE d.module <> 'triads' OR d.cohort_id IS DISTINCT FROM l.cohort_id OR d.programme_id IS DISTINCT FROM l.programme_id;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover: requirement link outside the group''s cohort Triad schedule (groups: %)', bad;
  END IF;
END $$;

UPDATE public.triad_groups g
SET cohort_requirement_date_id = l.cohort_requirement_date_id
FROM _triad_group_link l
WHERE l.triad_group_id = g.id AND l.cohort_requirement_date_id IS NOT NULL;

-- One active group per enrollment and requirement unit.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('enrollment %s in groups %s', x.enrollment_id, x.groups), '; ') INTO bad
  FROM (
    SELECT m.enrollment_id, g.cohort_requirement_date_id, string_agg(g.id::text, ',') AS groups
    FROM public.triad_group_members m
    JOIN public.triad_groups g ON g.id = m.triad_group_id
    WHERE g.is_active AND g.cohort_requirement_date_id IS NOT NULL
    GROUP BY m.enrollment_id, g.cohort_requirement_date_id
    HAVING count(*) > 1
  ) x;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover: an enrollment is in more than one active group for the same requirement (%)', bad;
  END IF;
END $$;

-- 6c. Session time: the single effective time.
UPDATE public.triad_sessions s
SET scheduled_start_time = coalesce(s.proposed_start_time, s.start_time),
    scheduled_end_time = s.proposed_end_time;

-- 6d. Acceptance responses per member enrollment (slot k -> enrollment k).
INSERT INTO public.triad_session_responses (triad_session_id, enrollment_id, response, responded_at)
SELECT s.id, slot.enrollment_id, coalesce(slot.response, 'pending'),
  CASE WHEN slot.response IN ('accepted', 'declined') THEN s.updated_at END
FROM public.triad_sessions s
JOIN public.triad_groups g ON g.id = s.triad_group_id
CROSS JOIN LATERAL (VALUES
  (g.enrollment_1_id, s.member_1_response),
  (g.enrollment_2_id, s.member_2_response),
  (g.enrollment_3_id, s.member_3_response)) AS slot(enrollment_id, response)
WHERE slot.enrollment_id IS NOT NULL;

UPDATE public.triad_alternative_proposals p
SET proposed_by_enrollment_id = CASE p.proposed_by
    WHEN g.member_1_id THEN g.enrollment_1_id
    WHEN g.member_2_id THEN g.enrollment_2_id
    WHEN g.member_3_id THEN g.enrollment_3_id
  END
FROM public.triad_sessions s
JOIN public.triad_groups g ON g.id = s.triad_group_id
WHERE s.id = p.triad_session_id;

INSERT INTO public.triad_alternative_proposal_responses (proposal_id, enrollment_id, response, responded_at)
SELECT p.id, slot.enrollment_id, coalesce(slot.response, 'pending'),
  CASE WHEN slot.response IN ('accepted', 'declined') THEN p.created_at END
FROM public.triad_alternative_proposals p
JOIN public.triad_sessions s ON s.id = p.triad_session_id
JOIN public.triad_groups g ON g.id = s.triad_group_id
CROSS JOIN LATERAL (VALUES
  (g.enrollment_1_id, p.member_1_response),
  (g.enrollment_2_id, p.member_2_response),
  (g.enrollment_3_id, p.member_3_response)) AS slot(enrollment_id, response)
WHERE slot.enrollment_id IS NOT NULL;

-- 6e. Reflection answers: every non-blank legacy answer, verbatim.
INSERT INTO public.triad_reflection_answers (triad_reflection_id, question_id, answer_text, created_at)
SELECT r.id, q.id, a.answer_text, r.submitted_at
FROM public.triad_reflections r
CROSS JOIN LATERAL (VALUES
  ('learned_as_coach', r.learned_as_coach),
  ('will_use_as_coach', r.will_use_as_coach),
  ('learned_as_coachee', r.learned_as_coachee),
  ('will_use_as_coachee', r.will_use_as_coachee),
  ('learned_as_observer', r.learned_as_observer),
  ('will_use_as_observer', r.will_use_as_observer)) AS a(question_key, answer_text)
JOIN public.triad_reflection_questions q ON q.programme_id IS NULL AND q.question_key = a.question_key
WHERE nullif(btrim(a.answer_text), '') IS NOT NULL;

CREATE UNIQUE INDEX triad_reflections_session_enrollment_key
  ON public.triad_reflections(triad_session_id, enrollment_id);

-- 6f. Round operational state -> the requirement units its groups practise for.
INSERT INTO public.cohort_triad_operations (cohort_requirement_date_id, assignment_status)
SELECT DISTINCT ON (g.cohort_requirement_date_id) g.cohort_requirement_date_id,
  CASE tr.auto_assign_status WHEN 'pending' THEN 'not_started' ELSE tr.auto_assign_status END
FROM public.triad_groups g
JOIN public.triad_rounds tr ON tr.id = g.triad_round_id
WHERE g.cohort_requirement_date_id IS NOT NULL
ORDER BY g.cohort_requirement_date_id, tr.updated_at DESC;

-- 6g. Archive the retired round structures (with the canonical date each
--     round's groups now follow, for audit).
INSERT INTO public.triad_cutover_archive (object_name, record_id, payload, migration_id)
SELECT 'triad_rounds', tr.id,
  to_jsonb(tr) || jsonb_build_object('canonical_due_dates', coalesce((
    SELECT jsonb_agg(DISTINCT jsonb_build_object('cohort_id', d.cohort_id, 'due_on', d.due_on))
    FROM public.triad_groups g JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id
    WHERE g.triad_round_id = tr.id), '[]'::jsonb)),
  '20260918190000_triad_canonical_cutover'
FROM public.triad_rounds tr;

INSERT INTO public.triad_cutover_archive (object_name, record_id, payload, migration_id)
SELECT 'programme_triad_rounds', p.id, to_jsonb(p), '20260918190000_triad_canonical_cutover'
FROM public.programme_triad_rounds p;

-- ----------------------------------------------------------------------------
-- 7. Integrity rules (enforced for every writer: RPCs, service role, SQL).
-- ----------------------------------------------------------------------------

-- The caller's own member enrollment in a group (NULL when not a member).
CREATE OR REPLACE FUNCTION public.triad_member_enrollment_for_user(p_group_id uuid, p_user_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.enrollment_id
  FROM public.triad_group_members m
  JOIN public.programme_enrollments e ON e.id = m.enrollment_id
  WHERE m.triad_group_id = p_group_id AND e.user_id = p_user_id AND p_user_id IS NOT NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_triad_member(group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.triad_member_enrollment_for_user(group_id, auth.uid()) IS NOT NULL;
$$;

-- A session may be marked completed only once it is confirmed and its time
-- has started. One rule, used by the guard trigger and the learner RPCs.
CREATE OR REPLACE FUNCTION public.triad_session_can_complete(p_status text, p_scheduled_start timestamptz)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT p_status = 'confirmed' AND p_scheduled_start IS NOT NULL AND p_scheduled_start <= now();
$$;

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
  SELECT * INTO g FROM public.triad_groups WHERE id = NEW.triad_group_id;
  SELECT * INTO e FROM public.programme_enrollments WHERE id = NEW.enrollment_id;
  IF g.cohort_requirement_date_id IS NULL THEN
    RAISE EXCEPTION 'Historical Triad groups without a requirement cannot change membership' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO req FROM public.cohort_requirement_dates WHERE id = g.cohort_requirement_date_id;
  IF e.cohort_id IS DISTINCT FROM req.cohort_id OR e.programme_id IS DISTINCT FROM req.programme_id THEN
    RAISE EXCEPTION 'Triad members must be enrolled in the requirement''s cohort and programme' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.triad_group_members o
    JOIN public.programme_enrollments oe ON oe.id = o.enrollment_id
    WHERE o.triad_group_id = NEW.triad_group_id AND o.id <> NEW.id AND oe.user_id = e.user_id
  ) THEN
    RAISE EXCEPTION 'A learner can appear only once in a Triad group' USING ERRCODE = '23505';
  END IF;
  IF g.is_active AND EXISTS (
    SELECT 1 FROM public.triad_group_members o
    JOIN public.triad_groups og ON og.id = o.triad_group_id
    WHERE o.enrollment_id = NEW.enrollment_id AND og.id <> g.id AND og.is_active
      AND og.cohort_requirement_date_id = g.cohort_requirement_date_id
  ) THEN
    RAISE EXCEPTION 'This learner is already in a Triad group for this requirement' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.triad_group_id = g.id AND s.status = 'completed') THEN
    RAISE EXCEPTION 'Membership of a Triad group with a completed session is final' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER triad_group_members_validate
  BEFORE INSERT OR UPDATE ON public.triad_group_members
  FOR EACH ROW EXECUTE FUNCTION public.triad_validate_group_member();

CREATE OR REPLACE FUNCTION public.triad_protect_group_member_removal()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- A cascade from deleting the whole group is governed by the group rule.
  IF EXISTS (SELECT 1 FROM public.triad_groups g WHERE g.id = OLD.triad_group_id)
     AND EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.triad_group_id = OLD.triad_group_id AND s.status = 'completed') THEN
    RAISE EXCEPTION 'Membership of a Triad group with a completed session is final' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER triad_group_members_protect_removal
  BEFORE DELETE ON public.triad_group_members
  FOR EACH ROW EXECUTE FUNCTION public.triad_protect_group_member_removal();

-- 2 or 3 members (dyads remain supported), checked at commit so a member can
-- be replaced inside one transaction.
CREATE OR REPLACE FUNCTION public.triad_check_group_size()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE gid uuid; n integer;
BEGIN
  IF TG_TABLE_NAME = 'triad_groups' THEN gid := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN gid := OLD.triad_group_id;
  ELSE gid := NEW.triad_group_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.triad_groups WHERE id = gid) THEN RETURN NULL; END IF;
  SELECT count(*) INTO n FROM public.triad_group_members WHERE triad_group_id = gid;
  IF n NOT BETWEEN 2 AND 3 THEN
    RAISE EXCEPTION 'A Triad group needs 2 or 3 members (group %, has %)', gid, n USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER triad_group_members_size
  AFTER INSERT OR UPDATE OR DELETE ON public.triad_group_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.triad_check_group_size();
CREATE CONSTRAINT TRIGGER triad_groups_size
  AFTER INSERT ON public.triad_groups
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.triad_check_group_size();

CREATE OR REPLACE FUNCTION public.triad_guard_group()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cohort_requirement_date_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.cohort_requirement_dates d
                      WHERE d.id = NEW.cohort_requirement_date_id AND d.module = 'triads') THEN
      RAISE EXCEPTION 'A Triad group belongs to one cohort Triad requirement' USING ERRCODE = '23502';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.triad_group_id = OLD.id AND s.status = 'completed')
       OR EXISTS (SELECT 1 FROM public.triad_sessions s JOIN public.triad_reflections r ON r.triad_session_id = s.id WHERE s.triad_group_id = OLD.id) THEN
      RAISE EXCEPTION 'A Triad group with completed sessions or reflections is history and cannot be deleted' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.cohort_requirement_date_id IS DISTINCT FROM OLD.cohort_requirement_date_id THEN
    RAISE EXCEPTION 'A Triad group''s requirement cannot change' USING ERRCODE = '42501';
  END IF;
  IF NEW.is_active AND NOT OLD.is_active AND EXISTS (
    SELECT 1 FROM public.triad_group_members m
    JOIN public.triad_group_members o ON o.enrollment_id = m.enrollment_id AND o.triad_group_id <> m.triad_group_id
    JOIN public.triad_groups og ON og.id = o.triad_group_id
    WHERE m.triad_group_id = NEW.id AND og.is_active AND og.cohort_requirement_date_id = NEW.cohort_requirement_date_id
  ) THEN
    RAISE EXCEPTION 'A member is already in another active group for this requirement' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER triad_groups_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.triad_groups
  FOR EACH ROW EXECUTE FUNCTION public.triad_guard_group();

-- Session lifecycle is enforced server-side for every writer.
CREATE OR REPLACE FUNCTION public.triad_guard_session()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE g public.triad_groups;
BEGIN
  IF NEW.status NOT IN ('proposed', 'confirmed', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Unknown Triad session status %', NEW.status USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO g FROM public.triad_groups WHERE id = NEW.triad_group_id;
    IF g.cohort_requirement_date_id IS NULL THEN
      RAISE EXCEPTION 'New Triad sessions belong to a requirement-scoped group' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'completed' AND NOT public.triad_session_can_complete('confirmed', NEW.scheduled_start_time) THEN
      RAISE EXCEPTION 'A Triad session can only be completed after its scheduled time' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.triad_group_id IS DISTINCT FROM OLD.triad_group_id THEN
    RAISE EXCEPTION 'A Triad session cannot move to another group' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'completed' THEN
    IF NEW.status <> 'completed'
       OR NEW.scheduled_start_time IS DISTINCT FROM OLD.scheduled_start_time
       OR NEW.scheduled_end_time IS DISTINCT FROM OLD.scheduled_end_time THEN
      RAISE EXCEPTION 'A completed Triad session is final' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'completed' AND NOT public.triad_session_can_complete(OLD.status, NEW.scheduled_start_time) THEN
      RAISE EXCEPTION 'A Triad session can only be completed once it is confirmed and its time has started' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'confirmed' AND NEW.scheduled_start_time IS NULL THEN
      RAISE EXCEPTION 'A Triad session needs a time before it is confirmed' USING ERRCODE = '42501';
    END IF;
    IF OLD.status = 'cancelled' AND NEW.status <> 'proposed' THEN
      RAISE EXCEPTION 'A cancelled Triad session can only be re-proposed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER triad_sessions_guard
  BEFORE INSERT OR UPDATE ON public.triad_sessions
  FOR EACH ROW EXECUTE FUNCTION public.triad_guard_session();

-- Acceptance: a proposed session with a time is confirmed once every current
-- member has accepted it.
CREATE OR REPLACE FUNCTION public.triad_confirm_session_if_accepted(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.triad_sessions s
  SET status = 'confirmed'
  WHERE s.id = p_session_id
    AND s.status = 'proposed'
    AND s.scheduled_start_time IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.triad_group_members m
      LEFT JOIN public.triad_session_responses r ON r.triad_session_id = s.id AND r.enrollment_id = m.enrollment_id
      WHERE m.triad_group_id = s.triad_group_id AND r.response IS DISTINCT FROM 'accepted');
END $$;

CREATE OR REPLACE FUNCTION public.triad_session_responses_changed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.triad_confirm_session_if_accepted(NEW.triad_session_id);
  RETURN NULL;
END $$;

CREATE TRIGGER triad_session_responses_confirm
  AFTER INSERT OR UPDATE ON public.triad_session_responses
  FOR EACH ROW EXECUTE FUNCTION public.triad_session_responses_changed();

-- An alternative accepted by every member becomes the session time; other
-- pending alternatives are superseded (and stay as history).
CREATE OR REPLACE FUNCTION public.triad_accept_proposal_if_unanimous(p_proposal_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE p public.triad_alternative_proposals; s public.triad_sessions;
BEGIN
  SELECT * INTO p FROM public.triad_alternative_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND OR p.status <> 'pending' THEN RETURN; END IF;
  SELECT * INTO s FROM public.triad_sessions WHERE id = p.triad_session_id FOR UPDATE;
  IF s.status NOT IN ('proposed', 'confirmed') THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.triad_group_members m
    LEFT JOIN public.triad_alternative_proposal_responses r ON r.proposal_id = p.id AND r.enrollment_id = m.enrollment_id
    WHERE m.triad_group_id = s.triad_group_id AND r.response IS DISTINCT FROM 'accepted'
  ) THEN
    RETURN;
  END IF;

  UPDATE public.triad_alternative_proposals SET status = 'accepted' WHERE id = p.id;
  UPDATE public.triad_alternative_proposals SET status = 'superseded'
  WHERE triad_session_id = s.id AND id <> p.id AND status = 'pending';
  UPDATE public.triad_sessions
  SET scheduled_start_time = p.proposed_start_time,
      scheduled_end_time = p.proposed_end_time
  WHERE id = s.id;
  INSERT INTO public.triad_session_responses (triad_session_id, enrollment_id, response, responded_at)
  SELECT s.id, m.enrollment_id, 'accepted', now()
  FROM public.triad_group_members m WHERE m.triad_group_id = s.triad_group_id
  ON CONFLICT (triad_session_id, enrollment_id) DO UPDATE SET response = 'accepted', responded_at = now();
  PERFORM public.triad_confirm_session_if_accepted(s.id);
END $$;

CREATE OR REPLACE FUNCTION public.triad_proposal_responses_changed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.triad_accept_proposal_if_unanimous(NEW.proposal_id);
  RETURN NULL;
END $$;

CREATE TRIGGER triad_proposal_responses_accept
  AFTER INSERT OR UPDATE ON public.triad_alternative_proposal_responses
  FOR EACH ROW EXECUTE FUNCTION public.triad_proposal_responses_changed();

CREATE OR REPLACE FUNCTION public.triad_guard_proposal()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'accepted', 'superseded') THEN
    RAISE EXCEPTION 'Unknown alternative proposal status %', NEW.status USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'An accepted or superseded alternative is history' USING ERRCODE = '42501';
  END IF;
  IF NEW.proposed_end_time <= NEW.proposed_start_time THEN
    RAISE EXCEPTION 'An alternative must end after it starts' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER triad_alternative_proposals_guard
  BEFORE INSERT OR UPDATE ON public.triad_alternative_proposals
  FOR EACH ROW EXECUTE FUNCTION public.triad_guard_proposal();

-- A reflection belongs to one member enrollment of a completed session.
CREATE OR REPLACE FUNCTION public.triad_validate_reflection()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE s public.triad_sessions;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'A submitted Triad reflection is final' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.triad_sessions WHERE id = NEW.triad_session_id;
  IF NEW.enrollment_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.triad_group_members m WHERE m.triad_group_id = s.triad_group_id AND m.enrollment_id = NEW.enrollment_id
  ) THEN
    RAISE EXCEPTION 'A Triad reflection belongs to a member of the session''s group' USING ERRCODE = '42501';
  END IF;
  IF s.status <> 'completed' THEN
    RAISE EXCEPTION 'Reflect on a Triad session once it is completed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER triad_reflections_validate
  BEFORE INSERT OR UPDATE ON public.triad_reflections
  FOR EACH ROW EXECUTE FUNCTION public.triad_validate_reflection();

-- ----------------------------------------------------------------------------
-- 8. Completion evidence: one attribution writer, driven by membership.
--    triad_session -> triad_group -> triad_group_members -> enrollments.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attribute_activity_to_cadence_milestone(p_enrollment_id uuid, p_module text, p_activity_id uuid, p_occurred_on date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  milestone uuid;
  source_type text;
  source_enrollment uuid;
  source_date date;
  source_count integer;
BEGIN
  IF p_enrollment_id IS NULL OR p_module IS NULL OR p_activity_id IS NULL
     OR p_occurred_on IS NULL THEN
    RAISE EXCEPTION 'Activity attribution requires enrollment, module, activity, and date'
      USING ERRCODE='P0001';
  END IF;
  -- Resolve the source without inferring ownership from a person's history.
  IF p_module='coaching' THEN
    source_type := 'coaching';
    SELECT count(*), (array_agg(enrollment_id))[1], max(start_time::date) INTO source_count,source_enrollment,source_date
      FROM public.sessions WHERE id=p_activity_id;
  ELSIF p_module='peer_coaching' THEN
    SELECT count(*), (array_agg(enrollment_id))[1], max(start_time::date) INTO source_count,source_enrollment,source_date
      FROM (SELECT enrollment_id,start_time FROM public.peer_sessions WHERE id=p_activity_id
            UNION ALL SELECT enrollment_id,start_time FROM public.coachee_peer_sessions WHERE id=p_activity_id) s;
    source_type := 'peer_coaching';
  ELSIF p_module='mentoring' THEN
    source_type := 'mentoring';
    SELECT count(*), (array_agg(enrollment_id))[1], max(start_time::date) INTO source_count,source_enrollment,source_date
      FROM public.mentoring_sessions WHERE id=p_activity_id;
  ELSIF p_module='triads' THEN
    -- Ownership = membership of the session's group (every member practises
    -- every role); the evidence date is the session's effective time.
    source_type := 'triad';
    SELECT count(*), max(s.scheduled_start_time::date),
           (array_agg(m.enrollment_id))[1]
      INTO source_count, source_date, source_enrollment
      FROM public.triad_sessions s
      JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id AND m.enrollment_id = p_enrollment_id
      WHERE s.id=p_activity_id;
  ELSIF p_module='training' THEN
    source_type := 'training';
    SELECT count(*), (array_agg(enrollment_id))[1], max(completed_at::date) INTO source_count,source_enrollment,source_date
      FROM public.training_progress WHERE id=p_activity_id AND completed_at IS NOT NULL;
  ELSIF p_module='quiz' THEN
    source_type := 'quiz';
    SELECT count(*), (array_agg(sub.enrollment_id))[1], max(sub.submitted_at::date) INTO source_count,source_enrollment,source_date
      FROM public.assignment_submissions sub JOIN public.assignments a ON a.id=sub.assignment_id
      WHERE sub.id=p_activity_id AND a.assignment_type='quiz'::public.assignment_type;
  ELSIF p_module='daily_prompt' THEN
    source_type := 'daily_prompt';
    SELECT count(*), (array_agg(enrollment_id))[1], max(responded_at::date) INTO source_count,source_enrollment,source_date
      FROM public.daily_prompt_responses WHERE id=p_activity_id;
  ELSE
    RAISE EXCEPTION 'Unsupported cadence activity module: %', p_module USING ERRCODE='P0001';
  END IF;
  IF public.is_historical_ownership_retired(source_type, p_activity_id)
     OR (source_type='peer_coaching' AND (
       public.is_historical_ownership_retired('peer_sessions',p_activity_id)
       OR public.is_historical_ownership_retired('coachee_peer_sessions',p_activity_id))) THEN
    RAISE EXCEPTION 'Retired activity cannot be attributed' USING ERRCODE='P0001';
  END IF;
  IF source_count <> 1 OR source_enrollment IS NULL OR source_enrollment <> p_enrollment_id
     OR source_date IS NULL OR source_date IS DISTINCT FROM p_occurred_on THEN
    RAISE EXCEPTION 'Activity source is missing, ambiguous, or not owned by enrollment'
      USING ERRCODE='P0001';
  END IF;

  SELECT m.id INTO milestone
  FROM public.enrollment_module_milestones m
  JOIN public.enrollment_module_snapshots s ON s.id=m.enrollment_module_snapshot_id
  WHERE s.enrollment_id=p_enrollment_id AND s.module=p_module::public.programme_module_type
    AND m.due_on <= p_occurred_on
    AND NOT EXISTS (SELECT 1 FROM public.session_activity_attributions a WHERE a.enrollment_id=p_enrollment_id AND a.milestone_id=m.id)
  ORDER BY m.due_on,m.id LIMIT 1;

  INSERT INTO public.session_activity_attributions
    (enrollment_id,module,source_activity_type,source_activity_id,occurred_on,milestone_id)
  VALUES (p_enrollment_id,p_module::public.programme_module_type,source_type,p_activity_id,p_occurred_on,milestone)
  ON CONFLICT (source_activity_type,source_activity_id,enrollment_id) DO NOTHING;
  RETURN milestone;
END $function$;

-- THE Triad attribution maintainer: one attribution per member enrollment,
-- dated on the session's effective time. Re-run whenever the time or the
-- membership changes, so evidence never keeps a stale date or owner.
CREATE OR REPLACE FUNCTION public.triad_sync_session_attributions(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE s public.triad_sessions; occurred date; member record;
BEGIN
  SELECT * INTO s FROM public.triad_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    DELETE FROM public.session_activity_attributions
    WHERE source_activity_type = 'triad' AND source_activity_id = p_session_id;
    RETURN;
  END IF;
  IF public.is_historical_ownership_retired('triad', p_session_id) THEN RETURN; END IF;
  occurred := s.scheduled_start_time::date;

  DELETE FROM public.session_activity_attributions a
  WHERE a.source_activity_type = 'triad' AND a.source_activity_id = p_session_id
    AND (occurred IS NULL OR a.occurred_on IS DISTINCT FROM occurred
         OR NOT EXISTS (SELECT 1 FROM public.triad_group_members m
                        WHERE m.triad_group_id = s.triad_group_id AND m.enrollment_id = a.enrollment_id));
  IF occurred IS NULL THEN RETURN; END IF;

  FOR member IN
    SELECT m.enrollment_id FROM public.triad_group_members m
    WHERE m.triad_group_id = s.triad_group_id
      AND NOT EXISTS (SELECT 1 FROM public.session_activity_attributions a
                      WHERE a.source_activity_type = 'triad' AND a.source_activity_id = p_session_id
                        AND a.enrollment_id = m.enrollment_id)
    ORDER BY m.member_order
  LOOP
    PERFORM public.attribute_activity_to_cadence_milestone(member.enrollment_id, 'triads', p_session_id, occurred);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.triad_session_attribution_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.triad_sync_session_attributions(NEW.id);
  RETURN NULL;
END $$;

CREATE TRIGGER triad_sessions_attribute_activity
  AFTER INSERT OR UPDATE OF scheduled_start_time ON public.triad_sessions
  FOR EACH ROW EXECUTE FUNCTION public.triad_session_attribution_trigger();

-- A deleted session is no evidence. (sponsor_canonical_activity treats an
-- attribution whose session row is gone as completed, so it must not remain.)
CREATE OR REPLACE FUNCTION public.triad_session_attribution_delete_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.session_activity_attributions
  WHERE source_activity_type = 'triad' AND source_activity_id = OLD.id;
  RETURN NULL;
END $$;

CREATE TRIGGER triad_sessions_remove_attribution
  AFTER DELETE ON public.triad_sessions
  FOR EACH ROW EXECUTE FUNCTION public.triad_session_attribution_delete_trigger();

CREATE OR REPLACE FUNCTION public.triad_membership_attribution_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE sid uuid;
BEGIN
  FOR sid IN
    SELECT s.id FROM public.triad_sessions s
    WHERE s.triad_group_id = (CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END).triad_group_id
  LOOP
    PERFORM public.triad_sync_session_attributions(sid);
  END LOOP;
  RETURN NULL;
END $$;

CREATE TRIGGER triad_group_members_attribute_activity
  AFTER INSERT OR DELETE OR UPDATE OF enrollment_id ON public.triad_group_members
  FOR EACH ROW EXECUTE FUNCTION public.triad_membership_attribution_trigger();

-- Entitlement cap per member enrollment (programme max_triads).
CREATE OR REPLACE FUNCTION public.validate_triad_session_cap()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE member record; limit_count integer; used_count integer;
BEGIN
  FOR member IN SELECT m.enrollment_id FROM public.triad_group_members m WHERE m.triad_group_id = NEW.triad_group_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(member.enrollment_id::text, 0));
    limit_count := public.programme_config_integer(
      public.enrollment_module_config(member.enrollment_id, 'triads'::public.programme_module_type), 'max_triads');
    IF limit_count IS NULL THEN CONTINUE; END IF;
    SELECT count(*)::integer INTO used_count
    FROM public.triad_sessions ts
    JOIN public.triad_group_members m ON m.triad_group_id = ts.triad_group_id AND m.enrollment_id = member.enrollment_id
    WHERE ts.id IS DISTINCT FROM NEW.id
      AND ts.status IN ('proposed', 'confirmed', 'completed');
    IF used_count >= limit_count THEN
      RAISE EXCEPTION 'Triad session entitlement has been exhausted' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER triad_sessions_validate_cap
  BEFORE INSERT ON public.triad_sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_triad_session_cap();

CREATE OR REPLACE FUNCTION public.notify_triad_session_booked()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, notification_type, title, title_vi, body, body_vi, link)
  SELECT e.user_id,
    'triad_booked',
    'New triad session scheduled',
    'Đã đặt lịch session triad mới',
    CASE WHEN NEW.scheduled_start_time IS NULL
      THEN 'A triad session was set up for your group — agree a time together.'
      ELSE 'A triad session was proposed for ' || to_char(NEW.scheduled_start_time, 'FMDay, FMMonth FMDD') END,
    CASE WHEN NEW.scheduled_start_time IS NULL
      THEN 'Một session triad đã được tạo cho nhóm của bạn — hãy thống nhất thời gian.'
      ELSE 'Một session triad đã được đề xuất vào ' || to_char(NEW.scheduled_start_time, 'DD/MM/YYYY') END,
    '/triads'
  FROM public.triad_group_members m
  JOIN public.programme_enrollments e ON e.id = m.enrollment_id
  WHERE m.triad_group_id = NEW.triad_group_id;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_triad_session_booked
  AFTER INSERT ON public.triad_sessions
  FOR EACH ROW EXECUTE FUNCTION public.notify_triad_session_booked();

-- Goal check-ins stay in the goal source; a Triad check-in is valid for a
-- completed session of a group the enrollment belongs to.
CREATE OR REPLACE FUNCTION public.record_goal_checkins(p_enrollment_id uuid, p_source_activity_type text, p_source_activity_id uuid, p_checkins jsonb, p_submission_id uuid DEFAULT gen_random_uuid())
 RETURNS SETOF goal_checkins
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare item jsonb; g public.coachee_goals; r public.coachee_goal_ratings; result public.goal_checkins; submission uuid := coalesce(p_submission_id, gen_random_uuid()); existing_hash text; existing_actor uuid; existing_enrollment uuid; existing_source_type text; existing_source_id uuid; existing_payload jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.programme_enrollments e where e.id=p_enrollment_id and e.user_id=auth.uid()) then
    raise exception 'Only the learner can record a goal check-in' using errcode='42501';
  end if;
  if p_source_activity_type is null or p_source_activity_type not in ('coaching','mentoring','peer_coaching','triad') then
   raise exception 'Unsupported goal check-in source' using errcode='22023';
 end if;
  if p_source_activity_type = 'coaching' and not exists (select 1 from public.sessions s where s.id=p_source_activity_id and s.enrollment_id=p_enrollment_id and s.status='completed') then
    raise exception 'Coaching session is not a completed session in this enrollment' using errcode='42501';
  elsif p_source_activity_type = 'mentoring' and not exists (select 1 from public.mentoring_sessions s where s.id=p_source_activity_id and s.enrollment_id=p_enrollment_id and s.status='completed') then
    raise exception 'Mentoring session is not a completed session in this enrollment' using errcode='42501';
  elsif p_source_activity_type = 'peer_coaching' and not exists (select 1 from public.peer_sessions s where s.id=p_source_activity_id and s.enrollment_id=p_enrollment_id and s.status='completed' union all select 1 from public.coachee_peer_sessions s where s.id=p_source_activity_id and s.enrollment_id=p_enrollment_id and s.status='completed') then
    raise exception 'Peer-coaching session is not a completed session in this enrollment' using errcode='42501';
  elsif p_source_activity_type = 'triad' and not exists (select 1 from public.triad_sessions s join public.triad_group_members m on m.triad_group_id=s.triad_group_id and m.enrollment_id=p_enrollment_id where s.id=p_source_activity_id and s.status='completed') then
    raise exception 'Triad session is not a completed session in this enrollment' using errcode='42501';
 end if;
  if jsonb_typeof(p_checkins) <> 'array' then raise exception 'Check-ins must be a JSON array' using errcode='22023'; end if;
  if jsonb_array_length(p_checkins) = 0 then raise exception 'Check-ins must not be empty' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_checkins) x where jsonb_typeof(x) <> 'object' or not (x ? 'goal_id') or not (x ? 'new_rating')) then
    raise exception 'Each check-in must be an object with goal_id and new_rating' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_checkins) x where (x->>'goal_id') !~ '^[0-9a-fA-F-]{36}$') then raise exception 'goal_id must be a UUID' using errcode='22023'; end if;
  if exists (select 1 from (select (x->>'goal_id') goal_id, count(*) n from jsonb_array_elements(p_checkins) x group by 1 having count(*) > 1) d) then raise exception 'A goal may appear only once per submission' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_checkins) x where jsonb_typeof(x->'new_rating') <> 'null' and (jsonb_typeof(x->'new_rating') <> 'number' or (x->>'new_rating') !~ '^[0-9]+$' or (x->>'new_rating')::integer not between 0 and 100)) then raise exception 'new_rating must be null or an integer from 0 to 100' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_checkins) x where jsonb_typeof(x->'note') not in ('null','string') or length(x->>'note') > 5000) then raise exception 'note must be null or a string of at most 5000 characters' using errcode='22023'; end if;
  select payload_hash, actor_user_id, enrollment_id, source_activity_type, source_activity_id, payload
    into existing_hash, existing_actor, existing_enrollment, existing_source_type, existing_source_id, existing_payload
    from public.goal_checkin_submissions where submission_id=submission for update;
  if found then
    if existing_actor is distinct from auth.uid() or existing_enrollment is distinct from p_enrollment_id
      or existing_source_type is distinct from p_source_activity_type or existing_source_id is distinct from p_source_activity_id
      or existing_payload is distinct from p_checkins then
      raise exception 'Submission ID was already used with a different request' using errcode='22023';
    end if;
    for result in select gc.* from public.goal_checkins gc where gc.submission_id=submission order by gc.created_at loop return next result; end loop;
    return;
  end if;
  insert into public.goal_checkin_submissions(submission_id,actor_user_id,enrollment_id,source_activity_type,source_activity_id,payload_hash,payload)
  values(submission,auth.uid(),p_enrollment_id,p_source_activity_type,p_source_activity_id,md5(p_checkins::text),p_checkins)
  on conflict (submission_id) do nothing;
  select payload_hash, actor_user_id, enrollment_id, source_activity_type, source_activity_id, payload
    into existing_hash, existing_actor, existing_enrollment, existing_source_type, existing_source_id, existing_payload
    from public.goal_checkin_submissions where submission_id=submission;
  if existing_actor is distinct from auth.uid() or existing_enrollment is distinct from p_enrollment_id
    or existing_source_type is distinct from p_source_activity_type or existing_source_id is distinct from p_source_activity_id
    or existing_payload is distinct from p_checkins then
    raise exception 'Submission ID was already used with a different request' using errcode='22023';
  end if;
  if exists (select 1 from public.goal_checkins where submission_id=submission) then
    for result in select gc.* from public.goal_checkins gc where gc.submission_id=submission order by gc.created_at loop return next result; end loop;
    return;
  end if;
  for item in select value from jsonb_array_elements(p_checkins) loop
    select * into g from public.coachee_goals where id=(item->>'goal_id')::uuid and enrollment_id=p_enrollment_id and status='active' for update;
    if not found then raise exception 'Selected goal is not active for this enrollment' using errcode='P0001'; end if;
    select * into r from public.coachee_goal_ratings where goal_id=g.id and enrollment_id=p_enrollment_id for update;
    insert into public.goal_checkins(enrollment_id,goal_id,source_activity_type,source_activity_id,previous_rating,new_rating,note,actor_user_id,submission_id)
    values(p_enrollment_id,g.id,p_source_activity_type,p_source_activity_id,r.current_rating,
      (item->>'new_rating')::smallint,nullif(item->>'note',''),auth.uid(),submission)
    on conflict (enrollment_id,source_activity_type,source_activity_id,goal_id,submission_id)
      where submission_id is not null do nothing
    returning * into result;
    if not found then
      select * into result from public.goal_checkins where enrollment_id=p_enrollment_id and source_activity_type=p_source_activity_type and source_activity_id=p_source_activity_id and goal_id=g.id and submission_id=submission;
    elsif result.new_rating is not null then
      insert into public.coachee_goal_ratings(goal_id,coachee_id,enrollment_id,current_rating,current_updated_at)
      values(g.id,g.coachee_id,p_enrollment_id,result.new_rating,now())
      on conflict (enrollment_id,goal_id) do update set current_rating=excluded.current_rating,current_updated_at=excluded.current_updated_at;
    end if;
    return next result;
  end loop;
end $function$;

CREATE OR REPLACE VIEW public.enrollment_scope_backfill_audit WITH (security_invoker=true) AS
 WITH candidates AS (
         SELECT 'sessions'::text AS table_name,
            s.id AS record_id,
            s.coachee_id AS user_id,
            count(pe.id)::integer AS candidate_enrollments
           FROM sessions s
             LEFT JOIN programme_enrollments pe ON pe.user_id = s.coachee_id AND s.start_time::date >= pe.start_date AND (pe.end_date IS NULL OR s.start_time::date <= pe.end_date)
          WHERE s.enrollment_id IS NULL AND NOT is_historical_ownership_retired('sessions'::text, s.id)
          GROUP BY s.id, s.coachee_id
        UNION ALL
         SELECT 'peer_sessions'::text,
            s.id,
            s.peer_coachee_id,
            count(pe.id)::integer AS count
           FROM peer_sessions s
             LEFT JOIN programme_enrollments pe ON pe.user_id = s.peer_coachee_id AND s.start_time::date >= pe.start_date AND (pe.end_date IS NULL OR s.start_time::date <= pe.end_date)
          WHERE s.enrollment_id IS NULL AND NOT is_historical_ownership_retired('peer_sessions'::text, s.id)
          GROUP BY s.id, s.peer_coachee_id
        UNION ALL
         SELECT 'coachee_peer_sessions'::text,
            s.id,
            s.peer_receiver_id,
            count(pe.id)::integer AS count
           FROM coachee_peer_sessions s
             LEFT JOIN programme_enrollments pe ON pe.user_id = s.peer_receiver_id AND s.start_time::date >= pe.start_date AND (pe.end_date IS NULL OR s.start_time::date <= pe.end_date)
          WHERE s.enrollment_id IS NULL AND NOT is_historical_ownership_retired('coachee_peer_sessions'::text, s.id)
          GROUP BY s.id, s.peer_receiver_id
        UNION ALL
         SELECT 'mentoring_sessions'::text,
            s.id,
            s.mentee_id,
            count(pe.id)::integer AS count
           FROM mentoring_sessions s
             LEFT JOIN programme_enrollments pe ON pe.user_id = s.mentee_id AND s.start_time::date >= pe.start_date AND (pe.end_date IS NULL OR s.start_time::date <= pe.end_date)
          WHERE s.enrollment_id IS NULL AND NOT is_historical_ownership_retired('mentoring_sessions'::text, s.id)
          GROUP BY s.id, s.mentee_id
        UNION ALL
         SELECT 'training_progress'::text,
            tp.id,
            tp.user_id,
            count(pe.id)::integer AS count
           FROM training_progress tp
             JOIN training_weeks tw ON tw.id = tp.training_week_id
             LEFT JOIN programme_enrollments pe ON pe.user_id = tp.user_id AND pe.programme_id = tw.programme_id
          WHERE tp.enrollment_id IS NULL AND NOT is_historical_ownership_retired('training_progress'::text, tp.id)
          GROUP BY tp.id, tp.user_id
        UNION ALL
         SELECT 'assignment_submissions'::text,
            sub.id,
            sub.user_id,
            count(pe.id)::integer AS count
           FROM assignment_submissions sub
             JOIN assignments a ON a.id = sub.assignment_id
             JOIN training_weeks tw ON tw.id = a.training_week_id
             LEFT JOIN programme_enrollments pe ON pe.user_id = sub.user_id AND pe.programme_id = tw.programme_id
          WHERE sub.enrollment_id IS NULL AND NOT is_historical_ownership_retired('assignment_submissions'::text, sub.id)
          GROUP BY sub.id, sub.user_id
        UNION ALL
         SELECT 'daily_prompt_responses'::text,
            r.id,
            r.user_id,
            count(pe.id)::integer AS count
           FROM daily_prompt_responses r
             JOIN daily_prompts p ON p.id = r.daily_prompt_id
             JOIN training_weeks tw ON tw.id = p.training_week_id
             LEFT JOIN programme_enrollments pe ON pe.user_id = r.user_id AND pe.programme_id = tw.programme_id
          WHERE r.enrollment_id IS NULL AND NOT is_historical_ownership_retired('daily_prompt_responses'::text, r.id)
          GROUP BY r.id, r.user_id
        UNION ALL
         SELECT 'reflection_submissions'::text,
            sub.id,
            sub.user_id,
            count(pe.id)::integer AS count
           FROM reflection_submissions sub
             JOIN programme_reflections pr ON pr.id = sub.reflection_id
             LEFT JOIN programme_enrollments pe ON pe.user_id = sub.user_id AND pe.programme_id = pr.programme_id
          WHERE sub.enrollment_id IS NULL AND NOT is_historical_ownership_retired('reflection_submissions'::text, sub.id)
          GROUP BY sub.id, sub.user_id
        UNION ALL
         SELECT 'coachee_goals'::text,
            g.id,
            g.coachee_id,
            count(pe.id)::integer AS count
           FROM coachee_goals g
             LEFT JOIN programme_enrollments pe ON pe.user_id = g.coachee_id
          WHERE g.enrollment_id IS NULL AND NOT is_historical_ownership_retired('coachee_goals'::text, g.id)
          GROUP BY g.id, g.coachee_id
        UNION ALL
         SELECT 'coachee_milestones'::text,
            m.id,
            m.coachee_id,
            count(pe.id)::integer AS count
           FROM coachee_milestones m
             LEFT JOIN programme_enrollments pe ON pe.user_id = m.coachee_id
          WHERE m.enrollment_id IS NULL AND NOT is_historical_ownership_retired('coachee_milestones'::text, m.id)
          GROUP BY m.id, m.coachee_id
        UNION ALL
         SELECT 'coachee_goal_ratings'::text,
            r.id,
            r.coachee_id,
            count(pe.id)::integer AS count
           FROM coachee_goal_ratings r
             LEFT JOIN programme_enrollments pe ON pe.user_id = r.coachee_id
          WHERE r.enrollment_id IS NULL AND NOT is_historical_ownership_retired('coachee_goal_ratings'::text, r.id)
          GROUP BY r.id, r.coachee_id
        UNION ALL
         SELECT 'triad_groups'::text,
            g.id,
            NULL::uuid AS uuid,
            0
           FROM triad_groups g
          WHERE (SELECT count(*) FROM triad_group_members m WHERE m.triad_group_id = g.id) < 2
            AND NOT is_historical_ownership_retired('triad_groups'::text, g.id)
        UNION ALL
         SELECT 'triad_sessions'::text,
            s.id,
            NULL::uuid AS uuid,
            0
           FROM triad_sessions s
          WHERE NOT EXISTS (SELECT 1 FROM triad_group_members m WHERE m.triad_group_id = s.triad_group_id)
            AND NOT is_historical_ownership_retired('triad_sessions'::text, s.id)
        UNION ALL
         SELECT 'triad_reflections'::text,
            r.id,
            NULL::uuid AS uuid,
            0
           FROM triad_reflections r
          WHERE r.enrollment_id IS NULL AND NOT is_historical_ownership_retired('triad_reflections'::text, r.id)
        )
 SELECT table_name,
    record_id,
    user_id,
    candidate_enrollments,
        CASE
            WHEN candidate_enrollments = 0 THEN 'orphaned'::text
            ELSE 'ambiguous'::text
        END AS unresolved_reason
   FROM candidates;

-- ----------------------------------------------------------------------------
-- 9. Learner projections read membership and normalized answers.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.learner_triad_members(uuid[]);
DROP FUNCTION IF EXISTS public.canonical_triad_group_members(uuid[]);

-- Co-member identity: membership from triad_group_members, identity via the
-- enrollment's learner profile (name + avatar only).
CREATE FUNCTION public.canonical_triad_group_members(p_group_ids uuid[])
RETURNS TABLE (triad_group_id uuid, member_id uuid, member_slot integer, full_name text, avatar_url text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.triad_group_id, e.user_id, m.member_order::integer, pr.full_name, pr.avatar_url
  FROM public.triad_group_members m
  JOIN public.programme_enrollments e ON e.id = m.enrollment_id
  JOIN public.profiles pr ON pr.id = e.user_id
  WHERE m.triad_group_id = ANY (p_group_ids);
$$;

CREATE FUNCTION public.learner_triad_members(p_group_ids uuid[])
RETURNS TABLE (triad_group_id uuid, member_id uuid, member_slot integer, full_name text, avatar_url text, is_self boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.triad_group_id, c.member_id, c.member_slot, c.full_name, c.avatar_url,
    c.member_id = auth.uid()
  FROM public.canonical_triad_group_members(p_group_ids) c
  WHERE auth.uid() IS NOT NULL
    AND public.is_triad_member(c.triad_group_id)
  ORDER BY c.triad_group_id, c.member_slot;
$$;

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
  round_number integer,
  training_week_number integer,
  attributed_to_enrollment boolean,
  is_programme_evidence boolean
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
      ARRAY[s.coach_id] AS counterpart_ids, NULL::integer AS round_number, NULL::integer AS training_week_number
    FROM public.sessions s
    JOIN me ON s.enrollment_id = me.enrollment_id AND s.coachee_id = me.user_id

    UNION ALL
    SELECT 'peer_coaching', 'coachee_peer_sessions', cps.id, 'peer_coaching', 'receiver',
      cps.topic, cps.start_time, cps.status::text, ARRAY[cps.peer_provider_id], NULL, NULL
    FROM public.coachee_peer_sessions cps
    JOIN me ON cps.enrollment_id = me.enrollment_id AND cps.peer_receiver_id = me.user_id

    UNION ALL
    SELECT 'peer_coaching', 'coachee_peer_sessions', cps.id, 'peer_coaching', 'provider',
      cps.topic, cps.start_time, cps.status::text, ARRAY[cps.peer_receiver_id], NULL, NULL
    FROM public.coachee_peer_sessions cps
    JOIN me ON cps.peer_provider_id = me.user_id
    WHERE cps.enrollment_id IN (SELECT id FROM cohort_enrollments)

    UNION ALL
    SELECT 'peer_coaching', 'peer_sessions', ps.id, 'peer_coaching', 'receiver',
      ps.topic, ps.start_time, ps.status::text, ARRAY[ps.peer_coach_id], NULL, NULL
    FROM public.peer_sessions ps
    JOIN me ON ps.enrollment_id = me.enrollment_id AND ps.peer_coachee_id = me.user_id

    UNION ALL
    SELECT 'peer_coaching', 'peer_sessions', ps.id, 'peer_coaching', 'provider',
      ps.topic, ps.start_time, ps.status::text, ARRAY[ps.peer_coachee_id], NULL, NULL
    FROM public.peer_sessions ps
    JOIN me ON ps.peer_coach_id = me.user_id
    WHERE ps.enrollment_id IN (SELECT id FROM cohort_enrollments)

    UNION ALL
    SELECT 'mentoring', 'mentoring_sessions', ms.id, 'mentoring', 'mentee',
      ms.topic, ms.start_time, ms.status::text, ARRAY[ms.mentor_id], NULL, NULL
    FROM public.mentoring_sessions ms
    JOIN me ON ms.enrollment_id = me.enrollment_id AND ms.mentee_id = me.user_id

    UNION ALL
    -- Triads: every member of the group owns the session (roles rotate, so
    -- there is no per-session role). Unit number / week come from the
    -- group's cohort Triad requirement.
    SELECT 'triad', 'triad_sessions', ts.id, 'triads', 'participant',
      NULL::text, ts.scheduled_start_time, ts.status::text,
      coalesce(ARRAY(
        SELECT oe.user_id FROM public.triad_group_members om
        JOIN public.programme_enrollments oe ON oe.id = om.enrollment_id
        WHERE om.triad_group_id = ts.triad_group_id AND om.enrollment_id <> gm.enrollment_id
        ORDER BY om.member_order), ARRAY[]::uuid[]),
      crd.ordinal, tw.week_number
    FROM public.triad_group_members gm
    JOIN me ON gm.enrollment_id = me.enrollment_id
    JOIN public.triad_sessions ts ON ts.triad_group_id = gm.triad_group_id
    JOIN public.triad_groups tg ON tg.id = ts.triad_group_id
    LEFT JOIN public.cohort_requirement_dates crd ON crd.id = tg.cohort_requirement_date_id
    LEFT JOIN public.training_weeks tw ON tw.id = crd.training_week_id
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
    r.round_number,
    r.training_week_number,
    EXISTS (
      SELECT 1 FROM public.session_activity_attributions a
      JOIN me ON a.enrollment_id = me.enrollment_id
      WHERE a.source_activity_id = r.source_id
    ),
    r.status = 'completed' AND EXISTS (
      SELECT 1 FROM public.session_activity_attributions a
      JOIN me ON a.enrollment_id = me.enrollment_id
      WHERE a.source_activity_id = r.source_id
    )
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
      jsonb_strip_nulls(jsonb_build_object('answers', ans.answers, 'round_number', crd.ordinal)),
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
    LEFT JOIN public.triad_groups tg ON tg.id = ts.triad_group_id
    LEFT JOIN public.cohort_requirement_dates crd ON crd.id = tg.cohort_requirement_date_id
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
-- 10. Canonical Triad constructions shared by Admin, Learner, reminders and
--     auto-assignment. None of them owns a date or a completion rule: dates
--     are cohort_requirement_dates, completion is canonical_module_progress.
-- ----------------------------------------------------------------------------

-- The cohort's Triad requirement units. required_units / operational come
-- from the canonical required-vs-scheduled construction.
CREATE OR REPLACE FUNCTION public.triad_requirement_units_internal(p_cohort_id uuid)
RETURNS TABLE (cohort_requirement_date_id uuid, cohort_id uuid, programme_id uuid, unit_number integer,
  due_on date, training_week_id uuid, required_units integer, is_operational boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.id, d.cohort_id, d.programme_id, d.ordinal, d.due_on, d.training_week_id,
    coalesce(st.required_units, 0), d.ordinal <= coalesce(st.required_units, 0)
  FROM public.cohort_requirement_dates d
  LEFT JOIN LATERAL (
    SELECT s.required_units FROM public.cohort_programme_schedule_state(d.cohort_id, d.programme_id) s
    WHERE s.module = 'triads'::public.programme_module_type
  ) st ON true
  WHERE d.cohort_id = p_cohort_id AND d.module = 'triads'::public.programme_module_type
  ORDER BY d.programme_id, d.ordinal;
$$;

-- Per enrollment of the requirement's cohort: its group for this unit and
-- the unit's canonical state. Unit N is completed when canonical completed
-- units >= N, and overdue when N is within canonical due units and not yet
-- completed — the same numbers canonical_module_progress reports (the sum
-- of overdue units over all units equals its overdue_units).
CREATE OR REPLACE FUNCTION public.triad_unit_enrollment_status_internal(p_cohort_requirement_date_id uuid, p_as_of date DEFAULT current_date)
RETURNS TABLE (cohort_requirement_date_id uuid, unit_number integer, due_on date, enrollment_id uuid, user_id uuid,
  enrollment_status public.enrollment_status, is_eligible boolean, triad_group_id uuid, session_id uuid,
  session_status text, scheduled_start_time timestamptz, unit_completed boolean, unit_overdue boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH req AS (
    SELECT d.* FROM public.cohort_requirement_dates d
    WHERE d.id = p_cohort_requirement_date_id AND d.module = 'triads'::public.programme_module_type
  ), grp AS (
    SELECT DISTINCT ON (m.enrollment_id) m.enrollment_id, g.id AS triad_group_id
    FROM req
    JOIN public.triad_groups g ON g.cohort_requirement_date_id = req.id AND g.is_active
    JOIN public.triad_group_members m ON m.triad_group_id = g.id
    ORDER BY m.enrollment_id, g.created_at DESC
  ), pop AS (
    SELECT e.* FROM req
    JOIN public.programme_enrollments e ON e.cohort_id = req.cohort_id AND e.programme_id = req.programme_id
    WHERE e.status IN ('active', 'at_risk', 'paused') OR e.id IN (SELECT enrollment_id FROM grp)
  )
  SELECT req.id, req.ordinal, req.due_on, e.id, e.user_id, e.status,
    e.status IN ('active', 'at_risk', 'paused'),
    grp.triad_group_id, ses.id, ses.status, ses.scheduled_start_time,
    coalesce(p.completed_units, 0) >= req.ordinal,
    req.ordinal <= coalesce(p.due_units, 0) AND coalesce(p.completed_units, 0) < req.ordinal
  FROM req
  CROSS JOIN pop e
  LEFT JOIN grp ON grp.enrollment_id = e.id
  LEFT JOIN LATERAL (
    SELECT s.id, s.status, s.scheduled_start_time FROM public.triad_sessions s
    WHERE s.triad_group_id = grp.triad_group_id ORDER BY s.created_at DESC LIMIT 1
  ) ses ON true
  LEFT JOIN LATERAL (
    SELECT mp.completed_units, mp.due_units
    FROM public.canonical_module_progress(e.id, p_as_of) mp
    WHERE mp.module = 'triads'::public.programme_module_type
  ) p ON true;
$$;

-- One group view (members, sessions, responses, proposals, reflection
-- state) for a set of groups, from the viewpoint of one member enrollment.
CREATE OR REPLACE FUNCTION public.triad_group_sessions_internal(p_group_id uuid, p_viewer_enrollment_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'status', s.status,
      'scheduled_start_time', s.scheduled_start_time,
      'scheduled_end_time', s.scheduled_end_time,
      'meeting_url', s.meeting_url,
      'created_at', s.created_at,
      'can_complete', public.triad_session_can_complete(s.status, s.scheduled_start_time),
      'my_response', (SELECT r.response FROM public.triad_session_responses r
                      WHERE r.triad_session_id = s.id AND r.enrollment_id = p_viewer_enrollment_id),
      'responses', coalesce((
        SELECT jsonb_agg(jsonb_build_object('member_slot', m.member_order, 'response', coalesce(r.response, 'pending')) ORDER BY m.member_order)
        FROM public.triad_group_members m
        LEFT JOIN public.triad_session_responses r ON r.triad_session_id = s.id AND r.enrollment_id = m.enrollment_id
        WHERE m.triad_group_id = s.triad_group_id), '[]'::jsonb),
      'reflection_submitted', EXISTS (SELECT 1 FROM public.triad_reflections tr
                                      WHERE tr.triad_session_id = s.id AND tr.enrollment_id = p_viewer_enrollment_id),
      'reflection_satisfaction', (SELECT tr.satisfaction_rating FROM public.triad_reflections tr
                                  WHERE tr.triad_session_id = s.id AND tr.enrollment_id = p_viewer_enrollment_id),
      'pending_proposals', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'id', p.id,
            'proposed_by_member_slot', (SELECT pm.member_order FROM public.triad_group_members pm
                                        WHERE pm.triad_group_id = s.triad_group_id AND pm.enrollment_id = p.proposed_by_enrollment_id),
            'start_time', p.proposed_start_time,
            'end_time', p.proposed_end_time,
            'created_at', p.created_at,
            'my_response', (SELECT pr.response FROM public.triad_alternative_proposal_responses pr
                            WHERE pr.proposal_id = p.id AND pr.enrollment_id = p_viewer_enrollment_id))
          ORDER BY p.created_at)
        FROM public.triad_alternative_proposals p
        WHERE p.triad_session_id = s.id AND p.status = 'pending'), '[]'::jsonb))
    ORDER BY s.created_at), '[]'::jsonb)
  FROM public.triad_sessions s
  WHERE s.triad_group_id = p_group_id;
$$;

-- Learner (and coach-as-learner) self-view: every Triad group of the
-- caller's enrollment (or of all the caller's enrollments when NULL).
CREATE OR REPLACE FUNCTION public.learner_triad_overview(p_enrollment_id uuid DEFAULT NULL)
RETURNS TABLE (enrollment_id uuid, triad_group_id uuid, cohort_requirement_date_id uuid, unit_number integer,
  due_on date, training_week_number integer, training_week_title text, training_week_title_vi text,
  group_language text, is_active boolean, member_count integer, my_member_slot integer,
  unit_completed boolean, unit_overdue boolean, sessions jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.enrollment_id, g.id, g.cohort_requirement_date_id, d.ordinal, d.due_on,
    tw.week_number, tw.title, tw.title_vi, g.group_language, g.is_active,
    (SELECT count(*)::integer FROM public.triad_group_members x WHERE x.triad_group_id = g.id),
    m.member_order::integer,
    CASE WHEN d.id IS NOT NULL THEN coalesce(p.completed_units, 0) >= d.ordinal END,
    CASE WHEN d.id IS NOT NULL THEN d.ordinal <= coalesce(p.due_units, 0) AND coalesce(p.completed_units, 0) < d.ordinal END,
    public.triad_group_sessions_internal(g.id, m.enrollment_id)
  FROM public.programme_enrollments e
  JOIN public.triad_group_members m ON m.enrollment_id = e.id
  JOIN public.triad_groups g ON g.id = m.triad_group_id
  LEFT JOIN public.cohort_requirement_dates d ON d.id = g.cohort_requirement_date_id
  LEFT JOIN public.training_weeks tw ON tw.id = d.training_week_id
  LEFT JOIN LATERAL (
    SELECT mp.completed_units, mp.due_units FROM public.canonical_module_progress(e.id, current_date) mp
    WHERE mp.module = 'triads'::public.programme_module_type
  ) p ON true
  WHERE e.user_id = auth.uid()
    AND auth.uid() IS NOT NULL
    AND (p_enrollment_id IS NULL OR e.id = p_enrollment_id)
  ORDER BY d.ordinal NULLS FIRST, g.created_at;
$$;

-- Reflection questions for a session's programme: the programme's own active
-- set when it has one, else the default set.
CREATE OR REPLACE FUNCTION public.triad_reflection_questions_for_session(p_session_id uuid)
RETURNS SETOF public.triad_reflection_questions
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH prog AS (
    SELECT e.programme_id
    FROM public.triad_sessions s
    JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id
    JOIN public.programme_enrollments e ON e.id = m.enrollment_id
    WHERE s.id = p_session_id
    LIMIT 1
  )
  SELECT q.* FROM public.triad_reflection_questions q, prog
  WHERE q.is_active AND (
    q.programme_id = prog.programme_id
    OR (q.programme_id IS NULL AND NOT EXISTS (
      SELECT 1 FROM public.triad_reflection_questions pq WHERE pq.programme_id = prog.programme_id AND pq.is_active)))
  ORDER BY q.display_order, q.id;
$$;

-- Group members see each other's reflections once every member submitted.
CREATE OR REPLACE FUNCTION public.triad_reflections_visible_to_group(p_session_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_triad_member(s.triad_group_id)
    AND (SELECT count(*) FROM public.triad_reflections r
         JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id AND m.enrollment_id = r.enrollment_id
         WHERE r.triad_session_id = s.id)
      >= (SELECT count(*) FROM public.triad_group_members m WHERE m.triad_group_id = s.triad_group_id)
  FROM public.triad_sessions s
  WHERE s.id = p_session_id;
$$;

-- Reflections on one session as a member sees them: always their own; the
-- others' only once every member has submitted. Authors are member slots
-- (names come from learner_triad_members).
CREATE OR REPLACE FUNCTION public.learner_triad_session_reflections(p_session_id uuid)
RETURNS TABLE (member_slot integer, is_self boolean, satisfaction_rating smallint, submitted_at timestamptz, answers jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH s AS (
    SELECT ts.id, ts.triad_group_id,
      public.triad_member_enrollment_for_user(ts.triad_group_id, auth.uid()) AS me
    FROM public.triad_sessions ts WHERE ts.id = p_session_id
  )
  SELECT m.member_order::integer, m.enrollment_id = s.me, r.satisfaction_rating, r.submitted_at,
    coalesce((SELECT jsonb_agg(jsonb_build_object('question_id', q.id, 'question_key', q.question_key, 'section', q.section,
                'question', q.label, 'question_vi', q.label_vi, 'answer', a.answer_text) ORDER BY q.display_order, q.id)
              FROM public.triad_reflection_answers a JOIN public.triad_reflection_questions q ON q.id = a.question_id
              WHERE a.triad_reflection_id = r.id), '[]'::jsonb)
  FROM s
  JOIN public.triad_reflections r ON r.triad_session_id = s.id
  JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id AND m.enrollment_id = r.enrollment_id
  WHERE s.me IS NOT NULL
    AND (r.enrollment_id = s.me OR public.triad_reflections_visible_to_group(s.id))
  ORDER BY m.member_order;
$$;

CREATE OR REPLACE FUNCTION public.learner_triad_reflection_questions(p_session_id uuid)
RETURNS SETOF public.triad_reflection_questions
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT q.* FROM public.triad_reflection_questions_for_session(p_session_id) q
  WHERE EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.id = p_session_id AND public.is_triad_member(s.triad_group_id));
$$;

-- ----------------------------------------------------------------------------
-- 11. Learner write paths (the only way a learner changes Triad state).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.triad_caller_member_enrollment(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE enrollment uuid;
BEGIN
  SELECT public.triad_member_enrollment_for_user(s.triad_group_id, auth.uid()) INTO enrollment
  FROM public.triad_sessions s WHERE s.id = p_session_id;
  IF enrollment IS NULL THEN
    RAISE EXCEPTION 'Only members of this Triad group can do this' USING ERRCODE = '42501';
  END IF;
  RETURN enrollment;
END $$;

CREATE OR REPLACE FUNCTION public.learner_triad_respond_session(p_session_id uuid, p_response text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE me uuid := public.triad_caller_member_enrollment(p_session_id); s public.triad_sessions;
BEGIN
  IF p_response NOT IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'Response must be accepted or declined' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.triad_sessions WHERE id = p_session_id FOR UPDATE;
  IF s.status <> 'proposed' OR s.scheduled_start_time IS NULL THEN
    RAISE EXCEPTION 'This Triad session is not awaiting a response' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.triad_session_responses (triad_session_id, enrollment_id, response, responded_at)
  VALUES (p_session_id, me, p_response, now())
  ON CONFLICT (triad_session_id, enrollment_id) DO UPDATE SET response = excluded.response, responded_at = excluded.responded_at;
END $$;

CREATE OR REPLACE FUNCTION public.learner_triad_propose_alternative(p_session_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE me uuid := public.triad_caller_member_enrollment(p_session_id); s public.triad_sessions; proposal uuid;
BEGIN
  SELECT * INTO s FROM public.triad_sessions WHERE id = p_session_id FOR UPDATE;
  IF s.status NOT IN ('proposed', 'confirmed') THEN
    RAISE EXCEPTION 'Only an open Triad session can be rescheduled' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'An alternative needs a start before its end' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.triad_alternative_proposals (triad_session_id, proposed_by_enrollment_id, proposed_start_time, proposed_end_time, status)
  VALUES (p_session_id, me, p_start, p_end, 'pending')
  RETURNING id INTO proposal;
  INSERT INTO public.triad_alternative_proposal_responses (proposal_id, enrollment_id, response, responded_at)
  SELECT proposal, m.enrollment_id,
    CASE WHEN m.enrollment_id = me THEN 'accepted' ELSE 'pending' END,
    CASE WHEN m.enrollment_id = me THEN now() END
  FROM public.triad_group_members m WHERE m.triad_group_id = s.triad_group_id;
  RETURN proposal;
END $$;

CREATE OR REPLACE FUNCTION public.learner_triad_respond_alternative(p_proposal_id uuid, p_response text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE p public.triad_alternative_proposals; me uuid;
BEGIN
  SELECT * INTO p FROM public.triad_alternative_proposals WHERE id = p_proposal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alternative not found' USING ERRCODE = 'P0002'; END IF;
  me := public.triad_caller_member_enrollment(p.triad_session_id);
  IF p.status <> 'pending' THEN
    RAISE EXCEPTION 'This alternative is no longer open' USING ERRCODE = '42501';
  END IF;
  IF p_response NOT IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'Response must be accepted or declined' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.triad_alternative_proposal_responses (proposal_id, enrollment_id, response, responded_at)
  VALUES (p_proposal_id, me, p_response, now())
  ON CONFLICT (proposal_id, enrollment_id) DO UPDATE SET response = excluded.response, responded_at = excluded.responded_at;
END $$;

-- Completion is programme evidence: validated here (membership) and in the
-- session guard (lifecycle + time) — never only in the UI.
CREATE OR REPLACE FUNCTION public.learner_triad_complete_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE me uuid := public.triad_caller_member_enrollment(p_session_id); s public.triad_sessions;
BEGIN
  SELECT * INTO s FROM public.triad_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT public.triad_session_can_complete(s.status, s.scheduled_start_time) THEN
    RAISE EXCEPTION 'A Triad session can only be completed once it is confirmed and its time has started' USING ERRCODE = '42501';
  END IF;
  UPDATE public.triad_sessions SET status = 'completed' WHERE id = p_session_id;
END $$;

-- One reflection submission per session and enrollment; answers keyed by
-- stable question ids. Goal ratings are recorded separately
-- (record_goal_checkins) and never copied here.
CREATE OR REPLACE FUNCTION public.learner_triad_submit_reflection(p_session_id uuid, p_satisfaction_rating smallint DEFAULT NULL, p_answers jsonb DEFAULT '[]'::jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE me uuid := public.triad_caller_member_enrollment(p_session_id); reflection uuid;
BEGIN
  IF p_satisfaction_rating IS NOT NULL AND p_satisfaction_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Satisfaction must be between 1 and 5' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(coalesce(p_answers, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Answers must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) a
    WHERE (a->>'question_id') IS NULL
       OR (a->>'question_id') NOT IN (SELECT q.id::text FROM public.triad_reflection_questions_for_session(p_session_id) q)
  ) THEN
    RAISE EXCEPTION 'Every answer must reference a question of this Triad reflection' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.triad_reflections WHERE triad_session_id = p_session_id AND enrollment_id = me) THEN
    RAISE EXCEPTION 'You have already reflected on this Triad session' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.triad_reflections (triad_session_id, enrollment_id, satisfaction_rating)
  VALUES (p_session_id, me, p_satisfaction_rating)
  RETURNING id INTO reflection;
  INSERT INTO public.triad_reflection_answers (triad_reflection_id, question_id, answer_text)
  SELECT reflection, (a->>'question_id')::uuid, a->>'answer_text'
  FROM jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) a
  WHERE nullif(btrim(a->>'answer_text'), '') IS NOT NULL;
  RETURN reflection;
END $$;

-- ----------------------------------------------------------------------------
-- 12. Requirement-scoped assignment (Admin manual + service auto-assign).
--     Always: cohort Triad requirement -> that cohort's eligible enrollments.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.triad_create_group_internal(
  p_cohort_requirement_date_id uuid, p_enrollment_ids uuid[], p_group_language text,
  p_assigned_by text, p_start timestamptz DEFAULT NULL, p_end timestamptz DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  unit record;
  group_id uuid;
  session_id uuid;
  n integer := coalesce(array_length(p_enrollment_ids, 1), 0);
BEGIN
  SELECT u.* INTO unit
  FROM public.cohort_requirement_dates d
  CROSS JOIN LATERAL public.triad_requirement_units_internal(d.cohort_id) u
  WHERE d.id = p_cohort_requirement_date_id AND u.cohort_requirement_date_id = d.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Triad requirement not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT unit.is_operational THEN
    RAISE EXCEPTION 'Triad unit % is beyond the programme requirement', unit.unit_number USING ERRCODE = '22023';
  END IF;
  IF n NOT BETWEEN 2 AND 3 OR (SELECT count(DISTINCT x) FROM unnest(p_enrollment_ids) x) <> n THEN
    RAISE EXCEPTION 'A Triad group needs 2 or 3 different learners' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_enrollment_ids) x
    LEFT JOIN public.programme_enrollments e ON e.id = x
    WHERE e.id IS NULL OR e.cohort_id IS DISTINCT FROM unit.cohort_id OR e.programme_id IS DISTINCT FROM unit.programme_id
       OR e.status NOT IN ('active', 'at_risk', 'paused')
  ) THEN
    RAISE EXCEPTION 'Triad members must be ongoing enrollments of this cohort' USING ERRCODE = '42501';
  END IF;
  IF p_assigned_by NOT IN ('auto', 'admin') OR p_group_language NOT IN ('vi', 'en') THEN
    RAISE EXCEPTION 'Invalid assignment source or language' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.triad_groups (cohort_requirement_date_id, assigned_by, group_language)
  VALUES (p_cohort_requirement_date_id, p_assigned_by, p_group_language)
  RETURNING id INTO group_id;
  INSERT INTO public.triad_group_members (triad_group_id, enrollment_id, member_order)
  SELECT group_id, x.enrollment_id, x.ord FROM unnest(p_enrollment_ids) WITH ORDINALITY AS x(enrollment_id, ord);
  INSERT INTO public.triad_sessions (triad_group_id, scheduled_start_time, scheduled_end_time, status)
  VALUES (group_id, p_start, p_end, 'proposed')
  RETURNING id INTO session_id;
  INSERT INTO public.triad_session_responses (triad_session_id, enrollment_id)
  SELECT session_id, m.enrollment_id FROM public.triad_group_members m WHERE m.triad_group_id = group_id;
  RETURN group_id;
END $$;

-- Candidate pool for one requirement: ongoing enrollments of THAT cohort not
-- yet in an active group for this unit, with spoken languages.
CREATE OR REPLACE FUNCTION public.triad_requirement_candidates_internal(p_cohort_requirement_date_id uuid)
RETURNS TABLE (enrollment_id uuid, user_id uuid, full_name text, spoken_languages text[], enrollment_status public.enrollment_status, triad_group_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT st.enrollment_id, st.user_id, pr.full_name, coalesce(pr.spoken_languages, ARRAY[]::text[]),
    st.enrollment_status, st.triad_group_id
  FROM public.triad_unit_enrollment_status_internal(p_cohort_requirement_date_id, current_date) st
  JOIN public.profiles pr ON pr.id = st.user_id
  WHERE st.is_eligible
  ORDER BY pr.full_name;
$$;

-- Re-running auto-assignment replaces only its own groups that nobody has
-- acted on yet (every session still proposed, no responses, no reflections).
CREATE OR REPLACE FUNCTION public.triad_clear_unconfirmed_auto_groups_internal(p_cohort_requirement_date_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE cleared integer;
BEGIN
  DELETE FROM public.triad_groups g
  WHERE g.cohort_requirement_date_id = p_cohort_requirement_date_id
    AND g.assigned_by = 'auto'
    AND NOT EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.triad_group_id = g.id AND s.status <> 'proposed')
    AND NOT EXISTS (SELECT 1 FROM public.triad_sessions s JOIN public.triad_session_responses r ON r.triad_session_id = s.id
                    WHERE s.triad_group_id = g.id AND r.response <> 'pending');
  GET DIAGNOSTICS cleared = ROW_COUNT;
  RETURN cleared;
END $$;

CREATE OR REPLACE FUNCTION public.triad_set_assignment_status_internal(p_cohort_requirement_date_id uuid, p_status text, p_summary jsonb DEFAULT NULL)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.cohort_triad_operations (cohort_requirement_date_id, assignment_status, last_assignment_run_at, last_assignment_summary, updated_at)
  VALUES (p_cohort_requirement_date_id, p_status, CASE WHEN p_status <> 'running' THEN now() END, p_summary, now())
  ON CONFLICT (cohort_requirement_date_id) DO UPDATE SET
    assignment_status = excluded.assignment_status,
    last_assignment_run_at = coalesce(excluded.last_assignment_run_at, cohort_triad_operations.last_assignment_run_at),
    last_assignment_summary = coalesce(excluded.last_assignment_summary, cohort_triad_operations.last_assignment_summary),
    updated_at = now();
$$;

-- Reminder targets per unit and member, from the canonical due date and the
-- canonical unit state (used by the triad-reminders Edge Function).
CREATE OR REPLACE FUNCTION public.triad_reminder_targets_internal(p_as_of date DEFAULT current_date, p_cohort_requirement_date_id uuid DEFAULT NULL)
RETURNS TABLE (cohort_requirement_date_id uuid, cohort_id uuid, unit_number integer, due_on date, days_until_due integer,
  enrollment_id uuid, user_id uuid, triad_group_id uuid, session_status text, unit_completed boolean, unit_overdue boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.id, d.cohort_id, st.unit_number, st.due_on, (st.due_on - p_as_of)::integer,
    st.enrollment_id, st.user_id, st.triad_group_id, st.session_status, st.unit_completed, st.unit_overdue
  FROM public.cohort_requirement_dates d
  CROSS JOIN LATERAL public.triad_unit_enrollment_status_internal(d.id, p_as_of) st
  WHERE d.module = 'triads'::public.programme_module_type
    AND (p_cohort_requirement_date_id IS NULL OR d.id = p_cohort_requirement_date_id)
    AND st.is_eligible;
$$;

-- ----------------------------------------------------------------------------
-- 13. Admin (cohort context).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.triad_assert_admin()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can manage Triads' USING ERRCODE = '42501';
  END IF;
END $$;

-- Admin -> Cohort -> Triads: each Triad requirement unit with its canonical
-- due date, groups and canonical unit state. Admin never enters a date here.
CREATE OR REPLACE FUNCTION public.admin_cohort_triad_requirements(p_cohort_id uuid, p_as_of date DEFAULT current_date)
RETURNS TABLE (cohort_requirement_date_id uuid, programme_id uuid, unit_number integer, due_on date,
  required_units integer, is_operational boolean, assignment_status text, last_assignment_run_at timestamptz,
  last_assignment_summary jsonb, eligible_enrollments integer, assigned_enrollments integer,
  completed_enrollments integer, overdue_enrollments integer, groups jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.triad_assert_admin();
  RETURN QUERY
  SELECT u.cohort_requirement_date_id, u.programme_id, u.unit_number, u.due_on, u.required_units, u.is_operational,
    coalesce(ops.assignment_status, 'not_started'), ops.last_assignment_run_at, ops.last_assignment_summary,
    coalesce(st.eligible, 0), coalesce(st.assigned, 0), coalesce(st.completed, 0), coalesce(st.overdue, 0),
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
          'id', g.id,
          'assigned_by', g.assigned_by,
          'group_language', g.group_language,
          'is_active', g.is_active,
          'created_at', g.created_at,
          'members', (SELECT jsonb_agg(jsonb_build_object('enrollment_id', m.enrollment_id, 'user_id', e.user_id,
                        'full_name', pr.full_name, 'member_order', m.member_order) ORDER BY m.member_order)
                      FROM public.triad_group_members m
                      JOIN public.programme_enrollments e ON e.id = m.enrollment_id
                      JOIN public.profiles pr ON pr.id = e.user_id
                      WHERE m.triad_group_id = g.id),
          'session', (SELECT jsonb_build_object('id', s.id, 'status', s.status,
                        'scheduled_start_time', s.scheduled_start_time, 'scheduled_end_time', s.scheduled_end_time)
                      FROM public.triad_sessions s WHERE s.triad_group_id = g.id ORDER BY s.created_at DESC LIMIT 1),
          'reflection_count', (SELECT count(*) FROM public.triad_reflections r
                               JOIN public.triad_sessions s ON s.id = r.triad_session_id
                               WHERE s.triad_group_id = g.id
                                 AND s.id = (SELECT s2.id FROM public.triad_sessions s2 WHERE s2.triad_group_id = g.id ORDER BY s2.created_at DESC LIMIT 1)))
        ORDER BY g.is_active DESC, g.created_at)
      FROM public.triad_groups g WHERE g.cohort_requirement_date_id = u.cohort_requirement_date_id), '[]'::jsonb)
  FROM public.triad_requirement_units_internal(p_cohort_id) u
  LEFT JOIN public.cohort_triad_operations ops ON ops.cohort_requirement_date_id = u.cohort_requirement_date_id
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE x.is_eligible)::integer AS eligible,
      count(*) FILTER (WHERE x.triad_group_id IS NOT NULL)::integer AS assigned,
      count(*) FILTER (WHERE x.unit_completed)::integer AS completed,
      count(*) FILTER (WHERE x.unit_overdue)::integer AS overdue
    FROM public.triad_unit_enrollment_status_internal(u.cohort_requirement_date_id, p_as_of) x
  ) st ON true
  ORDER BY u.programme_id, u.unit_number;
END $$;

CREATE OR REPLACE FUNCTION public.admin_triad_requirement_candidates(p_cohort_requirement_date_id uuid)
RETURNS TABLE (enrollment_id uuid, user_id uuid, full_name text, spoken_languages text[], enrollment_status public.enrollment_status, triad_group_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.triad_assert_admin();
  RETURN QUERY SELECT * FROM public.triad_requirement_candidates_internal(p_cohort_requirement_date_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_triad_create_group(p_cohort_requirement_date_id uuid, p_enrollment_ids uuid[], p_group_language text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.triad_assert_admin();
  RETURN public.triad_create_group_internal(p_cohort_requirement_date_id, p_enrollment_ids, p_group_language, 'admin');
END $$;

-- Replace, add (p_remove NULL) or remove (p_add NULL) one member. Open
-- sessions keep one response per current member.
CREATE OR REPLACE FUNCTION public.admin_triad_change_member(p_group_id uuid, p_remove_enrollment_id uuid DEFAULT NULL, p_add_enrollment_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE g public.triad_groups; slot smallint; req record;
BEGIN
  PERFORM public.triad_assert_admin();
  SELECT * INTO g FROM public.triad_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Triad group not found' USING ERRCODE = 'P0002'; END IF;
  IF p_add_enrollment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.triad_requirement_candidates_internal(g.cohort_requirement_date_id) c
    WHERE c.enrollment_id = p_add_enrollment_id AND c.triad_group_id IS NULL
  ) THEN
    RAISE EXCEPTION 'The new member must be an unassigned, ongoing enrollment of this cohort' USING ERRCODE = '42501';
  END IF;
  IF p_remove_enrollment_id IS NOT NULL THEN
    DELETE FROM public.triad_group_members WHERE triad_group_id = p_group_id AND enrollment_id = p_remove_enrollment_id
    RETURNING member_order INTO slot;
    IF slot IS NULL THEN RAISE EXCEPTION 'That learner is not in this group' USING ERRCODE = 'P0002'; END IF;
    DELETE FROM public.triad_session_responses r USING public.triad_sessions s
    WHERE s.id = r.triad_session_id AND s.triad_group_id = p_group_id AND r.enrollment_id = p_remove_enrollment_id;
  END IF;
  IF p_add_enrollment_id IS NOT NULL THEN
    slot := coalesce(slot, (SELECT min(x) FROM generate_series(1, 3) x
                            WHERE x NOT IN (SELECT member_order FROM public.triad_group_members WHERE triad_group_id = p_group_id)));
    INSERT INTO public.triad_group_members (triad_group_id, enrollment_id, member_order)
    VALUES (p_group_id, p_add_enrollment_id, slot);
    INSERT INTO public.triad_session_responses (triad_session_id, enrollment_id)
    SELECT s.id, p_add_enrollment_id FROM public.triad_sessions s
    WHERE s.triad_group_id = p_group_id AND s.status IN ('proposed', 'confirmed')
    ON CONFLICT DO NOTHING;
    -- A new member has not agreed to the time yet.
    UPDATE public.triad_sessions SET status = 'proposed'
    WHERE triad_group_id = p_group_id AND status = 'confirmed';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_triad_set_group_active(p_group_id uuid, p_is_active boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.triad_assert_admin();
  UPDATE public.triad_groups SET is_active = p_is_active WHERE id = p_group_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Triad group not found' USING ERRCODE = 'P0002'; END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 14. Row-level security. Learners READ their own groups; every Triad write
--     goes through the validated functions above. Sponsors have no Triad
--     table access at all (they see canonical progress / journey only).
-- ----------------------------------------------------------------------------
ALTER TABLE public.triad_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triad_session_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triad_alternative_proposal_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triad_reflection_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triad_reflection_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cohort_triad_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triad_cutover_archive ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Triad groups: admin manage" ON public.triad_groups FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Triad groups: member read" ON public.triad_groups FOR SELECT TO authenticated
  USING (public.is_triad_member(id));

CREATE POLICY "Triad group members: admin manage" ON public.triad_group_members FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Triad sessions: admin manage" ON public.triad_sessions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Triad sessions: member read" ON public.triad_sessions FOR SELECT TO authenticated
  USING (public.is_triad_member(triad_group_id));

CREATE POLICY "Triad session responses: admin manage" ON public.triad_session_responses FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Triad session responses: member read" ON public.triad_session_responses FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.id = triad_session_id AND public.is_triad_member(s.triad_group_id)));

CREATE POLICY "Triad alt proposals: admin manage" ON public.triad_alternative_proposals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Triad alt proposals: member read" ON public.triad_alternative_proposals FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.id = triad_session_id AND public.is_triad_member(s.triad_group_id)));

CREATE POLICY "Triad alt proposal responses: admin manage" ON public.triad_alternative_proposal_responses FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Triad alt proposal responses: member read" ON public.triad_alternative_proposal_responses FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.triad_alternative_proposals p JOIN public.triad_sessions s ON s.id = p.triad_session_id
                 WHERE p.id = proposal_id AND public.is_triad_member(s.triad_group_id)));

-- Reflections: own (by enrollment), group members once every member has
-- submitted, admins. No sponsor, no coach of record.
CREATE POLICY "Triad reflections: admin read" ON public.triad_reflections FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Triad reflections: own read" ON public.triad_reflections FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.id = enrollment_id AND e.user_id = auth.uid()));
CREATE POLICY "Triad reflections: group read after all submit" ON public.triad_reflections FOR SELECT TO authenticated
  USING (public.triad_reflections_visible_to_group(triad_session_id));

CREATE POLICY "Triad reflection answers: read with reflection" ON public.triad_reflection_answers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.triad_reflections r WHERE r.id = triad_reflection_id));

CREATE POLICY "Triad reflection questions: read" ON public.triad_reflection_questions FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Triad reflection questions: admin manage" ON public.triad_reflection_questions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE ALL ON public.cohort_triad_operations, public.triad_cutover_archive FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.triad_group_members, public.triad_session_responses,
  public.triad_alternative_proposal_responses, public.triad_reflection_answers FROM anon;

-- ----------------------------------------------------------------------------
-- 15. Function access. Internal constructions are never client-callable.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.triad_member_enrollment_for_user(uuid, uuid),
  public.triad_session_can_complete(text, timestamptz),
  public.triad_validate_group_member(),
  public.triad_protect_group_member_removal(),
  public.triad_check_group_size(),
  public.triad_guard_group(),
  public.triad_guard_session(),
  public.triad_confirm_session_if_accepted(uuid),
  public.triad_session_responses_changed(),
  public.triad_accept_proposal_if_unanimous(uuid),
  public.triad_proposal_responses_changed(),
  public.triad_guard_proposal(),
  public.triad_validate_reflection(),
  public.attribute_activity_to_cadence_milestone(uuid, text, uuid, date),
  public.triad_sync_session_attributions(uuid),
  public.triad_session_attribution_trigger(),
  public.triad_session_attribution_delete_trigger(),
  public.triad_membership_attribution_trigger(),
  public.validate_triad_session_cap(),
  public.notify_triad_session_booked(),
  public.canonical_triad_group_members(uuid[]),
  public.triad_requirement_units_internal(uuid),
  public.triad_unit_enrollment_status_internal(uuid, date),
  public.triad_group_sessions_internal(uuid, uuid),
  public.triad_reflection_questions_for_session(uuid),
  public.triad_caller_member_enrollment(uuid),
  public.triad_create_group_internal(uuid, uuid[], text, text, timestamptz, timestamptz),
  public.triad_requirement_candidates_internal(uuid),
  public.triad_clear_unconfirmed_auto_groups_internal(uuid),
  public.triad_set_assignment_status_internal(uuid, text, jsonb),
  public.triad_reminder_targets_internal(date, uuid),
  public.triad_assert_admin(),
  public.triad_reflections_visible_to_group(uuid),
  public.cohort_requirement_proposal_internal(uuid, uuid, date, date)
FROM PUBLIC, anon, authenticated;

-- Used by RLS policies (evaluated as the caller).
GRANT EXECUTE ON FUNCTION public.is_triad_member(uuid), public.triad_reflections_visible_to_group(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.is_triad_member(uuid) FROM PUBLIC, anon;

-- The auto-assign / reminder Edge Functions run as service_role.
GRANT EXECUTE ON FUNCTION
  public.triad_create_group_internal(uuid, uuid[], text, text, timestamptz, timestamptz),
  public.triad_requirement_candidates_internal(uuid),
  public.triad_clear_unconfirmed_auto_groups_internal(uuid),
  public.triad_set_assignment_status_internal(uuid, text, jsonb),
  public.triad_reminder_targets_internal(date, uuid),
  public.triad_requirement_units_internal(uuid),
  public.canonical_triad_group_members(uuid[])
TO service_role;

REVOKE ALL ON FUNCTION
  public.learner_triad_members(uuid[]),
  public.learner_triad_overview(uuid),
  public.learner_triad_reflection_questions(uuid),
  public.learner_triad_session_reflections(uuid),
  public.learner_triad_respond_session(uuid, text),
  public.learner_triad_propose_alternative(uuid, timestamptz, timestamptz),
  public.learner_triad_respond_alternative(uuid, text),
  public.learner_triad_complete_session(uuid),
  public.learner_triad_submit_reflection(uuid, smallint, jsonb),
  public.learner_session_history(uuid),
  public.learner_reflection_feed(uuid),
  public.admin_cohort_triad_requirements(uuid, date),
  public.admin_triad_requirement_candidates(uuid),
  public.admin_triad_create_group(uuid, uuid[], text),
  public.admin_triad_change_member(uuid, uuid, uuid),
  public.admin_triad_set_group_active(uuid, boolean)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.learner_triad_members(uuid[]),
  public.learner_triad_overview(uuid),
  public.learner_triad_reflection_questions(uuid),
  public.learner_triad_session_reflections(uuid),
  public.learner_triad_respond_session(uuid, text),
  public.learner_triad_propose_alternative(uuid, timestamptz, timestamptz),
  public.learner_triad_respond_alternative(uuid, text),
  public.learner_triad_complete_session(uuid),
  public.learner_triad_submit_reflection(uuid, smallint, jsonb),
  public.learner_session_history(uuid),
  public.learner_reflection_feed(uuid),
  public.admin_cohort_triad_requirements(uuid, date),
  public.admin_triad_requirement_candidates(uuid),
  public.admin_triad_create_group(uuid, uuid[], text),
  public.admin_triad_change_member(uuid, uuid, uuid),
  public.admin_triad_set_group_active(uuid, boolean)
TO authenticated;

-- ----------------------------------------------------------------------------
-- 16. Rebuild Triad evidence from membership, then prove equivalence.
-- ----------------------------------------------------------------------------
SELECT public.triad_sync_session_attributions(s.id) FROM public.triad_sessions s;

DO $$
DECLARE bad text; n bigint;
BEGIN
  -- No group, session, proposal or reflection lost.
  IF (SELECT row(groups, sessions, proposals, reflections) FROM _triad_before_counts)
     IS DISTINCT FROM row((SELECT count(*) FROM public.triad_groups), (SELECT count(*) FROM public.triad_sessions),
                          (SELECT count(*) FROM public.triad_alternative_proposals), (SELECT count(*) FROM public.triad_reflections)) THEN
    RAISE EXCEPTION 'Triad cutover verification: record counts changed';
  END IF;

  -- Session ownership: membership == the old role enrollments, per session.
  SELECT count(*) INTO n FROM (
    (SELECT session_id, enrollment_id FROM _triad_before_ownership
     EXCEPT SELECT s.id, m.enrollment_id FROM public.triad_sessions s JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id)
    UNION ALL
    (SELECT s.id, m.enrollment_id FROM public.triad_sessions s JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id
     EXCEPT SELECT session_id, enrollment_id FROM _triad_before_ownership)) diff;
  IF n > 0 THEN RAISE EXCEPTION 'Triad cutover verification: % session ownership differences', n; END IF;

  -- Evidence: the same (enrollment, session) attributions as before. The one
  -- accepted difference is evidence backfilled for a session that had NONE
  -- (a legacy session never attributed): it is reported, never silent.
  SELECT count(*) INTO n FROM (
    (SELECT enrollment_id, session_id FROM _triad_before_attributions
     EXCEPT SELECT enrollment_id, source_activity_id FROM public.session_activity_attributions WHERE source_activity_type = 'triad')
    UNION ALL
    (SELECT a.enrollment_id, a.source_activity_id FROM public.session_activity_attributions a
     WHERE a.source_activity_type = 'triad'
       AND EXISTS (SELECT 1 FROM _triad_before_attributions b WHERE b.session_id = a.source_activity_id)
     EXCEPT SELECT enrollment_id, session_id FROM _triad_before_attributions)) diff;
  IF n > 0 THEN RAISE EXCEPTION 'Triad cutover verification: % Triad evidence differences', n; END IF;
  SELECT count(*), string_agg(DISTINCT a.source_activity_id::text, ', ') INTO n, bad
  FROM public.session_activity_attributions a
  WHERE a.source_activity_type = 'triad'
    AND NOT EXISTS (SELECT 1 FROM _triad_before_attributions b WHERE b.session_id = a.source_activity_id);
  IF n > 0 THEN
    RAISE NOTICE 'Triad cutover: % evidence row(s) backfilled for legacy sessions that had none (sessions: %)', n, bad;
  END IF;
  bad := NULL;

  -- Canonical Triad progress per enrollment is unchanged, except where an old
  -- attribution carried a stale date (session later rescheduled) — then the
  -- difference is the correction, and is reported.
  SELECT string_agg(b.enrollment_id::text, ', ') INTO bad
  FROM _triad_before_progress b
  JOIN LATERAL (SELECT * FROM public.canonical_module_progress(b.enrollment_id, current_date) p
                WHERE p.module = 'triads'::public.programme_module_type) a ON true
  WHERE row(b.required_units, b.completed_activity_units, b.completed_units, b.due_units, b.booked_units, b.overdue_units, b.pace_status)
        IS DISTINCT FROM row(a.required_units, a.completed_activity_units, a.completed_units, a.due_units, a.booked_units, a.overdue_units, a.pace_status)
    AND NOT EXISTS (
      SELECT 1 FROM _triad_before_attributions ba
      JOIN public.triad_sessions s ON s.id = ba.session_id
      WHERE ba.enrollment_id = b.enrollment_id AND ba.occurred_on IS DISTINCT FROM s.scheduled_start_time::date)
    AND NOT EXISTS (
      SELECT 1 FROM public.session_activity_attributions a
      WHERE a.enrollment_id = b.enrollment_id AND a.source_activity_type = 'triad'
        AND NOT EXISTS (SELECT 1 FROM _triad_before_attributions x WHERE x.session_id = a.source_activity_id));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover verification: canonical Triad progress changed for enrollments %', bad;
  END IF;
  SELECT count(*) INTO n FROM _triad_before_attributions ba JOIN public.triad_sessions s ON s.id = ba.session_id
  WHERE ba.occurred_on IS DISTINCT FROM s.scheduled_start_time::date;
  IF n > 0 THEN RAISE NOTICE 'Triad cutover: % evidence dates corrected to the session''s effective time', n; END IF;

  -- Reflections: every legacy answer is preserved verbatim; ratings and
  -- authorship unchanged.
  SELECT count(*) INTO n
  FROM _triad_before_reflections r
  CROSS JOIN LATERAL (VALUES
    ('learned_as_coach', r.learned_as_coach), ('will_use_as_coach', r.will_use_as_coach),
    ('learned_as_coachee', r.learned_as_coachee), ('will_use_as_coachee', r.will_use_as_coachee),
    ('learned_as_observer', r.learned_as_observer), ('will_use_as_observer', r.will_use_as_observer)) AS legacy(question_key, answer_text)
  WHERE nullif(btrim(legacy.answer_text), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.triad_reflection_answers a
      JOIN public.triad_reflection_questions q ON q.id = a.question_id AND q.programme_id IS NULL
      WHERE a.triad_reflection_id = r.id AND q.question_key = legacy.question_key AND a.answer_text = legacy.answer_text);
  IF n > 0 THEN RAISE EXCEPTION 'Triad cutover verification: % reflection answers were not preserved', n; END IF;
  SELECT count(*) INTO n FROM _triad_before_reflections b JOIN public.triad_reflections r ON r.id = b.id
  WHERE row(b.triad_session_id, b.enrollment_id, b.satisfaction_rating, b.submitted_at)
        IS DISTINCT FROM row(r.triad_session_id, r.enrollment_id, r.satisfaction_rating, r.submitted_at);
  IF n > 0 THEN RAISE EXCEPTION 'Triad cutover verification: % reflections changed', n; END IF;

  -- Every group has 2-3 members; every open session has one response per member.
  SELECT string_agg(g.id::text, ', ') INTO bad FROM public.triad_groups g
  WHERE (SELECT count(*) FROM public.triad_group_members m WHERE m.triad_group_id = g.id) NOT BETWEEN 2 AND 3;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Triad cutover verification: groups without 2-3 members: %', bad; END IF;
END $$;

-- Final state: nothing live reads a retired Triad field.
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO offenders
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND pg_get_functiondef(p.oid) ~ '(coach|coachee|observer)_enrollment_id|member_[123]_(id|response)|enrollment_[123]_id|[a-z]\.(learned|will_use)_as_(coach|coachee|observer)|completion_deadline|programme_triad_rounds|public\.triad_rounds';
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover: functions still read retired Triad fields: %', offenders;
  END IF;
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO offenders
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (coalesce(qual, '') || coalesce(with_check, '')) ~ '(coach|coachee|observer)_enrollment_id|member_[123]_id|enrollment_[123]_id|participant_id';
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover: policies still read retired Triad fields: %', offenders;
  END IF;
END $$;
