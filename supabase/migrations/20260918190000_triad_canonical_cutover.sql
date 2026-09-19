-- ============================================================================
-- TRIAD CANONICAL CUTOVER (data model + source of truth). DEPLOYMENT 1.
--
-- One authoritative source per Triad fact:
--   required Triad sessions ..... programme_modules (triads, config.required_units)
--   cumulative due dates ........ cohort_requirement_dates (module 'triads',
--                                 ordinal N, units = 1): "N completed Triad
--                                 sessions by this date". A date identifies
--                                 no group and no session.
--   group ....................... triad_groups.cohort_id (a group belongs to a
--                                 COHORT, never to a requirement unit)
--   membership .................. triad_group_members.enrollment_id (final
--                                 once the group has a session)
--   actual session .............. triad_sessions (scheduled_start/end_time,
--                                 status proposed -> confirmed -> completed |
--                                 cancelled)
--   acceptance .................. triad_session_responses
--   candidate times ............. triad_alternative_proposals + responses
--   completion evidence ......... session x historical group membership ->
--                                 session_activity_attributions (never a
--                                 requirement unit)
--   completion / due / overdue .. canonical_module_progress, projected for
--                                 Triads by canonical_triad_completion:
--                                 distinct completed sessions (activity date
--                                 = scheduled start) capped at required,
--                                 against cumulative due dates
--   reflection .................. triad_reflections (session x enrollment)
--                                 + triad_reflection_answers x questions
--   goal rating / comment ....... goal_checkins (unchanged, never copied)
--
-- Every learner rotates through Coach / Coachee / Observer, so the legacy
-- session role columns were never ownership. There is no Triad "round":
-- triad_rounds / programme_triad_rounds are archived and retired, and nothing
-- replaces them.
--
-- Storage is additive: legacy columns / tables keep their data (no client
-- access, never written) until 20260918199000_triad_retire_legacy
-- (DEPLOYMENT 2, supabase/deployment-2/). The migration runs as one
-- transaction and FAILS on any legacy inconsistency or on any unexplained
-- difference between the pre- and post-cutover facts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Pre-cutover snapshot of the facts that must survive unchanged
--    (taken after 20260918185900 removed conflicting DEMO/SEED rows).
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

CREATE TEMP TABLE _triad_before_sessions ON COMMIT DROP AS
SELECT s.id, s.triad_group_id, s.status, coalesce(s.proposed_start_time, s.start_time) AS start_time
FROM public.triad_sessions s;

CREATE TEMP TABLE _triad_before_counts ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.triad_groups) AS groups,
  (SELECT count(*) FROM public.triad_sessions) AS sessions,
  (SELECT count(*) FROM public.triad_alternative_proposals) AS proposals,
  (SELECT count(*) FROM public.triad_reflections) AS reflections;

-- ----------------------------------------------------------------------------
-- 1. Validate the legacy data. Anything inconsistent stops the cutover
--    (20260918185900 has already removed conflicting DEMO/SEED rows and
--    stopped on REAL/UNKNOWN ones).
-- ----------------------------------------------------------------------------
DO $$
DECLARE bad text;
BEGIN
  -- Every group: a cohort, 2-3 slot enrollments that are its slot learners,
  -- all enrolled in the group's cohort and programme.
  SELECT string_agg(g.id::text, ', ') INTO bad
  FROM public.triad_groups g
  WHERE g.cohort_id IS NULL
     OR g.enrollment_1_id IS NULL OR g.enrollment_2_id IS NULL
     OR EXISTS (
       SELECT 1
       FROM (VALUES (g.member_1_id, g.enrollment_1_id), (g.member_2_id, g.enrollment_2_id), (g.member_3_id, g.enrollment_3_id)) slot(user_id, enrollment_id)
       LEFT JOIN public.programme_enrollments e ON e.id = slot.enrollment_id
       WHERE (slot.user_id IS NULL) <> (slot.enrollment_id IS NULL)
          OR (slot.enrollment_id IS NOT NULL AND (
                e.id IS NULL OR e.user_id <> slot.user_id
                OR e.cohort_id IS DISTINCT FROM g.cohort_id
                OR e.programme_id IS DISTINCT FROM g.programme_id)));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover: groups inconsistent with their cohort / enrollments (groups: %)', bad;
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

  -- A completed session has a time (its activity date).
  SELECT string_agg(s.id::text, ', ') INTO bad
  FROM public.triad_sessions s
  WHERE s.status = 'completed' AND coalesce(s.proposed_start_time, s.start_time) IS NULL;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover: completed sessions without a session time (sessions: %)', bad;
  END IF;

  -- Every non-retired reflection is authored by an enrollment of the
  -- session's group, on a completed session; one per session and enrollment.
  SELECT string_agg(r.id::text, ', ') INTO bad
  FROM public.triad_reflections r
  JOIN public.triad_sessions s ON s.id = r.triad_session_id
  JOIN public.triad_groups g ON g.id = s.triad_group_id
  WHERE r.enrollment_id IS NOT NULL
    AND (r.enrollment_id NOT IN (g.enrollment_1_id, g.enrollment_2_id)
         AND r.enrollment_id IS DISTINCT FROM g.enrollment_3_id
         OR s.status <> 'completed');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover: reflections outside the session group or on an open session (reflections: %)', bad;
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

  -- At most one open (proposed / confirmed) session per group.
  SELECT string_agg(s.triad_group_id::text, ', ') INTO bad
  FROM public.triad_sessions s
  WHERE s.status IN ('proposed', 'confirmed')
  GROUP BY s.triad_group_id
  HAVING count(*) > 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover: groups with more than one open session (groups: %)', bad;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. One cohort Triad requirement date per required session: row N is the
--    cumulative deadline "N Triad sessions completed by this date". A
--    multi-unit Triad row (only the 'flexible' policy produced them) is
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
  -- One cumulative Triad deadline per required session: a multi-unit item becomes that many
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
-- 3. Groups belong to a cohort; normalized, enrollment-based membership.
-- ----------------------------------------------------------------------------
ALTER TABLE public.triad_groups
  ALTER COLUMN cohort_id SET NOT NULL,
  ADD COLUMN closed_at timestamptz;
CREATE INDEX IF NOT EXISTS triad_groups_cohort_idx ON public.triad_groups(cohort_id, is_active);
COMMENT ON COLUMN public.triad_groups.cohort_id IS
  'THE Triad group scope: the cohort whose enrollments practise together across all of the cohort''s required Triad sessions. A group belongs to no requirement unit.';
COMMENT ON COLUMN public.triad_groups.closed_at IS
  'When the group was closed (is_active = false). Closed groups keep their sessions and membership as history.';

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
  'THE Triad membership source: which learner enrollments practise together. Learner, programme and cohort are derived through the enrollment. member_order is display order only — not a role. Final once the group has a session.';

-- ----------------------------------------------------------------------------
-- 4. Session time, acceptance, proposals, reflections.
-- ----------------------------------------------------------------------------

-- The session's current effective time. Before agreement it is the proposed
-- time; once agreed it is the session time, and the Triad activity date.
-- Candidate replacement times live only in triad_alternative_proposals.
ALTER TABLE public.triad_sessions
  ADD COLUMN scheduled_start_time timestamptz,
  ADD COLUMN scheduled_end_time timestamptz;
ALTER TABLE public.triad_sessions
  ADD CONSTRAINT triad_sessions_scheduled_range
  CHECK (scheduled_start_time IS NULL OR scheduled_end_time IS NULL OR scheduled_end_time > scheduled_start_time) NOT VALID;
COMMENT ON COLUMN public.triad_sessions.scheduled_start_time IS
  'Current effective session start (proposed until every member accepts, then the agreed time). THE Triad session time and activity date.';
COMMENT ON COLUMN public.triad_sessions.status IS
  'Session lifecycle: proposed -> confirmed -> completed, or cancelled. completed and cancelled are final. Proposal state lives on triad_alternative_proposals.status.';

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
  'Candidate replacement times for a Triad session. status: pending -> accepted | superseded | withdrawn. Never the session time until accepted.';

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

ALTER TABLE public.triad_alternative_proposals DROP CONSTRAINT IF EXISTS triad_alternative_proposals_status_check;
ALTER TABLE public.triad_alternative_proposals
  ADD CONSTRAINT triad_alternative_proposals_status_check CHECK (status IN ('pending', 'accepted', 'superseded', 'withdrawn'));

-- ----------------------------------------------------------------------------
-- 5. Retire the legacy triggers / policies / helpers that read slot, role or
--    round columns. The replacements (below) read membership only.
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

-- There is no Triad round. DEPRECATED (dropped by 20260918199000, deployment
-- 2): no client or runtime access from here on, and no group follows a round.
REVOKE ALL ON public.triad_rounds, public.programme_triad_rounds FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.triad_rounds IS 'DEPRECATED — there is no Triad round (programme = quantity, cohort = cumulative dates, group = participants). Archived; dropped in 20260918199000 (deployment 2).';
COMMENT ON TABLE public.programme_triad_rounds IS 'DEPRECATED — never consumed. Archived; dropped in 20260918199000 (deployment 2).';
-- A deleted round must never cascade into groups (and their history).
ALTER TABLE public.triad_groups DROP CONSTRAINT IF EXISTS triad_groups_triad_round_id_fkey;

-- Legacy slot / role / round / answer columns are no longer written.
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
  ALTER COLUMN proposed_by DROP NOT NULL,
  ALTER COLUMN member_1_response DROP NOT NULL,
  ALTER COLUMN member_2_response DROP NOT NULL;
ALTER TABLE public.triad_sessions
  ALTER COLUMN member_1_response DROP NOT NULL,
  ALTER COLUMN member_2_response DROP NOT NULL;
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

-- 6b. One active group per enrollment. Legacy "round" groups could hold the
--     same learners concurrently; a group is now cohort-level, so for an
--     enrollment in several active groups the most recent stays active and
--     the older ones are closed (sessions and membership stay as history).
CREATE TEMP TABLE _triad_closed_groups ON COMMIT DROP AS
SELECT DISTINCT older.id AS triad_group_id
FROM public.triad_group_members m
JOIN public.triad_groups older ON older.id = m.triad_group_id AND older.is_active
WHERE EXISTS (
  SELECT 1 FROM public.triad_group_members m2
  JOIN public.triad_groups newer ON newer.id = m2.triad_group_id AND newer.is_active
  WHERE m2.enrollment_id = m.enrollment_id AND newer.id <> older.id
    AND (newer.created_at, newer.id) > (older.created_at, older.id));
UPDATE public.triad_groups g SET is_active = false, closed_at = now()
FROM _triad_closed_groups c WHERE c.triad_group_id = g.id;
UPDATE public.triad_groups SET closed_at = coalesce(updated_at, created_at) WHERE NOT is_active AND closed_at IS NULL;

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

-- At most one open session per group: a group schedules its next session
-- once the current one is completed or cancelled.
CREATE UNIQUE INDEX triad_sessions_one_open_per_group
  ON public.triad_sessions(triad_group_id) WHERE status IN ('proposed', 'confirmed');

-- 6f. Evidence belongs to sessions, never to a requirement unit: legacy
--     cadence-milestone links on Triad evidence are removed.
UPDATE public.session_activity_attributions SET milestone_id = NULL
WHERE source_activity_type = 'triad' AND milestone_id IS NOT NULL;

-- 6g. Archive the retired round structures (audit only; nothing maps to them).
INSERT INTO public.triad_cutover_archive (object_name, record_id, payload, migration_id)
SELECT 'triad_rounds', tr.id, to_jsonb(tr), '20260918190000_triad_canonical_cutover'
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
-- STABLE (not IMMUTABLE): it reads now().
CREATE OR REPLACE FUNCTION public.triad_session_can_complete(p_status text, p_scheduled_start timestamptz)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT p_status = 'confirmed' AND p_scheduled_start IS NOT NULL AND p_scheduled_start <= now();
$$;

-- Does the enrollment's programme require Triads? (programme = quantity)
CREATE OR REPLACE FUNCTION public.triad_required_units_for_programme(p_programme_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((
    SELECT CASE WHEN coalesce((pm.config->>'required')::boolean, false)
      THEN coalesce(public.programme_config_integer(pm.config, 'required_units'), 0) ELSE 0 END
    FROM public.programme_modules pm
    WHERE pm.programme_id = p_programme_id AND pm.module = 'triads'::public.programme_module_type AND pm.enabled
  ), 0);
$$;

-- Membership: cohort-scoped, one programme per group, one active group per
-- enrollment, and FINAL once the group has any session (historical sessions
-- always keep their participants; regrouping closes the group and creates a
-- new one).
CREATE OR REPLACE FUNCTION public.triad_validate_group_member()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  g public.triad_groups;
  e public.programme_enrollments;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Triad membership rows are not edited: remove and add a member instead' USING ERRCODE = '42501';
  END IF;
  -- An existing (group, enrollment) row: the unique constraint decides
  -- (ON CONFLICT DO NOTHING, or a duplicate-key error). Nothing new is added.
  IF EXISTS (SELECT 1 FROM public.triad_group_members x
             WHERE x.triad_group_id = NEW.triad_group_id AND x.enrollment_id = NEW.enrollment_id) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO g FROM public.triad_groups WHERE id = NEW.triad_group_id FOR UPDATE;
  SELECT * INTO e FROM public.programme_enrollments WHERE id = NEW.enrollment_id;
  -- Serialise membership changes per enrollment (one active group).
  PERFORM pg_advisory_xact_lock(hashtextextended('triad_member:' || NEW.enrollment_id::text, 0));

  IF EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.triad_group_id = g.id) THEN
    RAISE EXCEPTION 'Membership of a Triad group with sessions is final: close it and create a new group' USING ERRCODE = '42501';
  END IF;
  IF NOT g.is_active THEN
    RAISE EXCEPTION 'A closed Triad group cannot change membership' USING ERRCODE = '42501';
  END IF;
  IF e.cohort_id IS DISTINCT FROM g.cohort_id THEN
    RAISE EXCEPTION 'Triad members must be enrolled in the group''s cohort' USING ERRCODE = '42501';
  END IF;
  IF public.triad_required_units_for_programme(e.programme_id) = 0 THEN
    RAISE EXCEPTION 'This learner''s programme requires no Triads' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.triad_group_members o
    JOIN public.programme_enrollments oe ON oe.id = o.enrollment_id
    WHERE o.triad_group_id = NEW.triad_group_id AND o.id <> NEW.id
      AND (oe.user_id = e.user_id OR oe.programme_id IS DISTINCT FROM e.programme_id)
  ) THEN
    RAISE EXCEPTION 'A Triad group holds different learners of one programme' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.triad_group_members o
    JOIN public.triad_groups og ON og.id = o.triad_group_id
    WHERE o.enrollment_id = NEW.enrollment_id AND og.id <> g.id AND og.is_active
  ) THEN
    RAISE EXCEPTION 'This learner is already in an active Triad group' USING ERRCODE = '23505';
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
     AND EXISTS (SELECT 1 FROM public.triad_sessions s WHERE s.triad_group_id = OLD.triad_group_id) THEN
    RAISE EXCEPTION 'Membership of a Triad group with sessions is final: close it and create a new group' USING ERRCODE = '42501';
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

-- The one privileged correction path for Triad history: the demo reset
-- (demo_delete_batch_4_owned_resources) may remove rows registered as demo
-- resources while it runs (transaction-local clariva.demo_reset = on). There
-- is no other way to delete completed sessions or groups with history.
CREATE OR REPLACE FUNCTION public.triad_demo_reset_allows(p_resource_type text, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE allowed boolean := false;
BEGIN
  IF coalesce(current_setting('clariva.demo_reset', true), '') <> 'on'
     OR to_regclass('public.demo_resource_registry') IS NULL THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.demo_resource_registry WHERE resource_type = $1 AND resource_id = $2)'
    INTO allowed USING p_resource_type, p_id;
  RETURN coalesce(allowed, false);
END $$;

-- Groups: the cohort is fixed; closing records closed_at; reopening is
-- refused while a member is in another active group; a group with history
-- (completed sessions, reflections, goal check-ins) is never deleted.
CREATE OR REPLACE FUNCTION public.triad_guard_group()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
  IF TG_OP = 'INSERT' THEN
    NEW.closed_at := CASE WHEN NEW.is_active THEN NULL ELSE coalesce(NEW.closed_at, now()) END;
    RETURN NEW;
  END IF;
  IF NEW.cohort_id IS DISTINCT FROM OLD.cohort_id THEN
    RAISE EXCEPTION 'A Triad group''s cohort cannot change' USING ERRCODE = '42501';
  END IF;
  IF NOT NEW.is_active AND OLD.is_active THEN
    NEW.closed_at := now();
  ELSIF NEW.is_active AND NOT OLD.is_active THEN
    IF EXISTS (
      SELECT 1 FROM public.triad_group_members m
      JOIN public.triad_group_members o ON o.enrollment_id = m.enrollment_id AND o.triad_group_id <> m.triad_group_id
      JOIN public.triad_groups og ON og.id = o.triad_group_id
      WHERE m.triad_group_id = NEW.id AND og.is_active
    ) THEN
      RAISE EXCEPTION 'A member is already in another active Triad group' USING ERRCODE = '23505';
    END IF;
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER triad_groups_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.triad_groups
  FOR EACH ROW EXECUTE FUNCTION public.triad_guard_group();

-- Session lifecycle, enforced server-side for every writer:
--   proposed -> confirmed (has a time) -> completed (time started)
--   proposed | confirmed -> cancelled
--   completed and cancelled are final (status and time).
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
    IF NOT FOUND OR NOT g.is_active THEN
      RAISE EXCEPTION 'New Triad sessions belong to an active Triad group' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'confirmed' AND NEW.scheduled_start_time IS NULL THEN
      RAISE EXCEPTION 'A Triad session needs a time before it is confirmed' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'completed' AND NOT public.triad_session_can_complete('confirmed', NEW.scheduled_start_time) THEN
      RAISE EXCEPTION 'A Triad session can only be completed after its scheduled time' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'cancelled' THEN
      RAISE EXCEPTION 'A Triad session is created proposed, confirmed or completed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.triad_group_id IS DISTINCT FROM OLD.triad_group_id THEN
    RAISE EXCEPTION 'A Triad session cannot move to another group' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('completed', 'cancelled') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.scheduled_start_time IS DISTINCT FROM OLD.scheduled_start_time
       OR NEW.scheduled_end_time IS DISTINCT FROM OLD.scheduled_end_time THEN
      RAISE EXCEPTION 'A % Triad session is final', OLD.status USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'proposed' AND NEW.status IN ('confirmed', 'cancelled'))
         OR (OLD.status = 'confirmed' AND NEW.status IN ('completed', 'cancelled'))) THEN
      RAISE EXCEPTION 'A Triad session cannot go from % to %', OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'confirmed' AND NEW.scheduled_start_time IS NULL THEN
      RAISE EXCEPTION 'A Triad session needs a time before it is confirmed' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'completed' AND NOT public.triad_session_can_complete(OLD.status, NEW.scheduled_start_time) THEN
      RAISE EXCEPTION 'A Triad session can only be completed once it is confirmed and its time has started' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER triad_sessions_guard
  BEFORE INSERT OR UPDATE ON public.triad_sessions
  FOR EACH ROW EXECUTE FUNCTION public.triad_guard_session();

-- A completed session, or one with reflections / goal check-ins, is history:
-- no writer deletes it (children cascade from triad_sessions).
CREATE OR REPLACE FUNCTION public.triad_guard_session_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.triad_demo_reset_allows('triad_session', OLD.id) THEN
    RETURN OLD;
  END IF;
  IF OLD.status = 'completed'
     OR EXISTS (SELECT 1 FROM public.triad_reflections r WHERE r.triad_session_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.goal_checkins gc WHERE gc.source_activity_type = 'triad' AND gc.source_activity_id = OLD.id) THEN
    RAISE EXCEPTION 'A completed Triad session or one with reflections is history and cannot be deleted' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER triad_sessions_guard_delete
  BEFORE DELETE ON public.triad_sessions
  FOR EACH ROW EXECUTE FUNCTION public.triad_guard_session_delete();

-- Responses (session and alternative) belong to members of the session's
-- historical group.
CREATE OR REPLACE FUNCTION public.triad_validate_response()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE sid uuid;
BEGIN
  IF TG_TABLE_NAME = 'triad_session_responses' THEN
    sid := NEW.triad_session_id;
  ELSE
    SELECT p.triad_session_id INTO sid FROM public.triad_alternative_proposals p WHERE p.id = NEW.proposal_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.triad_sessions s
    JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id AND m.enrollment_id = NEW.enrollment_id
    WHERE s.id = sid
  ) THEN
    RAISE EXCEPTION 'Triad responses belong to members of the session''s group' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER triad_session_responses_validate
  BEFORE INSERT OR UPDATE ON public.triad_session_responses
  FOR EACH ROW EXECUTE FUNCTION public.triad_validate_response();
CREATE TRIGGER triad_alternative_proposal_responses_validate
  BEFORE INSERT OR UPDATE ON public.triad_alternative_proposal_responses
  FOR EACH ROW EXECUTE FUNCTION public.triad_validate_response();

-- Acceptance: a proposed session with a time is confirmed once every member
-- has accepted it.
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
  IF TG_OP = 'UPDATE' AND OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'An accepted, superseded or withdrawn alternative is history' USING ERRCODE = '42501';
  END IF;
  IF NEW.proposed_end_time <= NEW.proposed_start_time THEN
    RAISE EXCEPTION 'An alternative must end after it starts' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM public.triad_sessions s
    JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id AND m.enrollment_id = NEW.proposed_by_enrollment_id
    WHERE s.id = NEW.triad_session_id
  ) THEN
    RAISE EXCEPTION 'An alternative is proposed by a member of the session''s group' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER triad_alternative_proposals_guard
  BEFORE INSERT OR UPDATE ON public.triad_alternative_proposals
  FOR EACH ROW EXECUTE FUNCTION public.triad_guard_proposal();

-- A reflection belongs to one member enrollment of a completed session, and
-- is final once submitted.
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
-- 8. Completion evidence: session evidence only, one writer, driven by the
--    session's historical group membership:
--      triad_session -> triad_group -> triad_group_members -> enrollment.
--    Every member of a live (proposed / confirmed / completed) session with a
--    time has one attribution, dated on the session's scheduled start. It is
--    never linked to a requirement unit (milestone_id stays NULL); canonical
--    progress counts completed sessions and compares them with the cohort's
--    cumulative dates.
-- ----------------------------------------------------------------------------

-- Triad evidence is written only by triad_sync_session_attributions.
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
    RAISE EXCEPTION 'Triad evidence is session evidence written by triad_sync_session_attributions' USING ERRCODE='P0001';
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

-- THE Triad evidence maintainer: one attribution per member enrollment of a
-- live session with a time, dated on the scheduled start. Re-run whenever the
-- time, status or membership changes, so evidence never keeps a stale date,
-- owner or a cancelled session.
CREATE OR REPLACE FUNCTION public.triad_sync_session_attributions(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE s public.triad_sessions; occurred date;
BEGIN
  SELECT * INTO s FROM public.triad_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    DELETE FROM public.session_activity_attributions
    WHERE source_activity_type = 'triad' AND source_activity_id = p_session_id;
    RETURN;
  END IF;
  IF public.is_historical_ownership_retired('triad', p_session_id) THEN RETURN; END IF;
  occurred := CASE WHEN s.status <> 'cancelled' THEN s.scheduled_start_time::date END;

  DELETE FROM public.session_activity_attributions a
  WHERE a.source_activity_type = 'triad' AND a.source_activity_id = p_session_id
    AND (occurred IS NULL OR a.occurred_on IS DISTINCT FROM occurred
         OR NOT EXISTS (SELECT 1 FROM public.triad_group_members m
                        WHERE m.triad_group_id = s.triad_group_id AND m.enrollment_id = a.enrollment_id));
  IF occurred IS NULL THEN RETURN; END IF;

  INSERT INTO public.session_activity_attributions
    (enrollment_id, module, source_activity_type, source_activity_id, occurred_on, milestone_id)
  SELECT m.enrollment_id, 'triads'::public.programme_module_type, 'triad', p_session_id, occurred, NULL
  FROM public.triad_group_members m
  WHERE m.triad_group_id = s.triad_group_id
  ON CONFLICT (source_activity_type, source_activity_id, enrollment_id) DO NOTHING;
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
  AFTER INSERT OR UPDATE OF scheduled_start_time, status ON public.triad_sessions
  FOR EACH ROW EXECUTE FUNCTION public.triad_session_attribution_trigger();

-- A deleted session is no evidence.
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
-- 9. Canonical Triad completion.
--
--    Activity: one row per (enrollment, Triad session) from the session
--    evidence, with the session's current status. Only an existing session
--    counts (a missing session is never "completed").
--
--    canonical_module_progress (unchanged, shared by every module) then
--    computes, for Triads:
--      completed_activity_units = distinct completed sessions dated <= as_of
--      completed_units          = LEAST(that, programme required units)
--      due_units                = cohort Triad dates <= as_of (one per unit)
--      overdue_units            = GREATEST(due - LEAST(completed, due), 0)
--    and journeys compare the same cumulative counts at every checkpoint.
--    canonical_triad_completion is the Triad projection every Admin, Learner,
--    reminder and Sponsor surface reads.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sponsor_canonical_activity(p_enrollment_id uuid)
 RETURNS TABLE(module programme_module_type, occurred_on date, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed')
  FROM public.session_activity_attributions a
  LEFT JOIN public.sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'coaching'

  UNION ALL
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed')
  FROM public.session_activity_attributions a
  LEFT JOIN public.peer_sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'peer_coaching'

  UNION ALL
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed')
  FROM public.session_activity_attributions a
  LEFT JOIN public.coachee_peer_sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'peer_coaching'
    AND NOT EXISTS (
      SELECT 1 FROM public.peer_sessions existing_peer
      WHERE existing_peer.id = a.source_activity_id
    )

  UNION ALL
  SELECT a.module, a.occurred_on, coalesce(s.status::text, 'completed')
  FROM public.session_activity_attributions a
  LEFT JOIN public.mentoring_sessions s ON s.id = a.source_activity_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'mentoring'

  UNION ALL
  -- Triads: one row per session of the enrollment's (historical) groups,
  -- dated on the session's scheduled start. Never per requirement unit.
  SELECT a.module, a.occurred_on, s.status
  FROM public.session_activity_attributions a
  JOIN public.triad_sessions s ON s.id = a.source_activity_id
  JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id AND m.enrollment_id = a.enrollment_id
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type = 'triad'

  UNION ALL
  SELECT a.module, a.occurred_on, 'completed'
  FROM public.session_activity_attributions a
  WHERE a.enrollment_id = p_enrollment_id
    AND a.source_activity_type IN ('quiz', 'daily_prompt')

  UNION ALL
  SELECT 'training'::public.programme_module_type,
    i.completed_on,
    'completed'
  FROM public.canonical_training_learning_items(p_enrollment_id, current_date) i
  WHERE i.completed_units > 0
    AND i.completed_on IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_triad_completion(p_enrollment_id uuid, p_as_of date DEFAULT current_date)
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
  ), activity AS (
    SELECT count(*) FILTER (WHERE a.status = 'completed')::integer AS all_completed,
      count(*) FILTER (WHERE a.status = 'completed' AND a.occurred_on <= p_as_of)::integer AS completed_as_of
    FROM public.sponsor_canonical_activity(p_enrollment_id) a
    WHERE a.module = 'triads'::public.programme_module_type
  ), dates AS (
    SELECT d.ordinal, d.due_on, d.training_week_id
    FROM e JOIN public.cohort_requirement_dates d
      ON d.cohort_id = e.cohort_id AND d.programme_id = e.programme_id AND d.module = 'triads'::public.programme_module_type
  )
  SELECT e.id, e.programme_id, e.cohort_id,
    coalesce(p.required_units, 0),
    a.all_completed,
    coalesce(p.completed_activity_units, a.completed_as_of),
    coalesce(p.completed_units, 0),
    coalesce(p.due_units, 0),
    coalesce(p.overdue_units, 0),
    coalesce(p.booked_units, 0),
    coalesce(p.pace_status, 'not_required'),
    (SELECT d.due_on FROM dates d WHERE d.ordinal > coalesce(p.completed_units, 0) ORDER BY d.ordinal LIMIT 1),
    coalesce((SELECT jsonb_agg(jsonb_build_object(
        'milestone', d.ordinal,
        'due_on', d.due_on,
        'training_week_id', d.training_week_id,
        'is_due', d.due_on <= p_as_of,
        -- cumulative: "d.ordinal sessions completed by now", never a session
        -- assigned to this date
        'satisfied', coalesce(p.completed_units, 0) >= d.ordinal)
      ORDER BY d.ordinal)
      FROM dates d WHERE d.ordinal <= coalesce(p.required_units, 0)), '[]'::jsonb)
  FROM e
  CROSS JOIN activity a
  LEFT JOIN progress p ON true;
$$;
COMMENT ON FUNCTION public.canonical_triad_completion(uuid, date) IS
  'THE Triad completion projection (from canonical_module_progress): distinct completed sessions of the enrollment''s historical groups, capped at the programme''s required units, against the cohort''s cumulative due dates. Internal.';


-- ----------------------------------------------------------------------------
-- 10. Learner projections read membership, sessions and normalized answers.
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

-- A Triad session belongs to no round / week: the history carries neither.
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
    -- session (roles rotate, so there is no per-session role). A session
    -- belongs to no requirement unit: no round, no week.
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
      jsonb_strip_nulls(jsonb_build_object('answers', ans.answers,
        'session_start_time', ts.scheduled_start_time, 'triad_group_id', ts.triad_group_id)),
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
-- 11. Canonical Triad constructions shared by Admin, Learner, reminders and
--     auto-assignment. None of them owns a date or a completion rule: dates
--     are cohort_requirement_dates, completion is canonical_triad_completion.
-- ----------------------------------------------------------------------------

-- A group's sessions (numbered in time order), responses, open alternatives
-- and the viewer's own reflection state. p_viewer_enrollment_id NULL = Admin.
CREATE OR REPLACE FUNCTION public.triad_group_sessions_internal(p_group_id uuid, p_viewer_enrollment_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'session_number', s.session_number,
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
      'reflection_count', (SELECT count(*) FROM public.triad_reflections tr WHERE tr.triad_session_id = s.id),
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
    ORDER BY s.session_number), '[]'::jsonb)
  FROM (
    SELECT ts.*, row_number() OVER (ORDER BY coalesce(ts.scheduled_start_time, ts.created_at), ts.created_at, ts.id)::integer AS session_number
    FROM public.triad_sessions ts WHERE ts.triad_group_id = p_group_id
  ) s;
$$;

-- One row per enrollment of a cohort in a programme that requires Triads:
-- eligibility, current active group and the canonical completion.
CREATE OR REPLACE FUNCTION public.triad_cohort_learners_internal(p_cohort_id uuid, p_as_of date DEFAULT current_date)
RETURNS TABLE (enrollment_id uuid, user_id uuid, full_name text, spoken_languages text[], programme_id uuid,
  enrollment_status public.enrollment_status, is_eligible boolean, active_group_id uuid,
  required_units integer, raw_completed_sessions integer, completed_units integer, due_units integer,
  overdue_units integer, next_due_on date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.user_id, pr.full_name, coalesce(pr.spoken_languages, ARRAY[]::text[]), e.programme_id,
    e.status, e.status IN ('active', 'at_risk', 'paused'),
    (SELECT g.id FROM public.triad_group_members m JOIN public.triad_groups g ON g.id = m.triad_group_id
     WHERE m.enrollment_id = e.id AND g.is_active LIMIT 1),
    c.required_units, c.raw_completed_sessions, c.completed_units, c.due_units, c.overdue_units, c.next_due_on
  FROM public.programme_enrollments e
  JOIN public.profiles pr ON pr.id = e.user_id
  CROSS JOIN LATERAL public.canonical_triad_completion(e.id, p_as_of) c
  WHERE e.cohort_id = p_cohort_id
    AND public.triad_required_units_for_programme(e.programme_id) > 0
  ORDER BY pr.full_name, e.id;
$$;

-- Learner (and coach-as-learner) self-view: every Triad group of the
-- caller's enrollment (or of all the caller's enrollments when NULL) —
-- the active group and closed historical ones.
DROP FUNCTION IF EXISTS public.learner_triad_overview(uuid);
CREATE FUNCTION public.learner_triad_overview(p_enrollment_id uuid DEFAULT NULL)
RETURNS TABLE (enrollment_id uuid, triad_group_id uuid, cohort_id uuid, group_language text, is_active boolean,
  closed_at timestamptz, created_at timestamptz, member_count integer, my_member_slot integer, sessions jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.enrollment_id, g.id, g.cohort_id, g.group_language, g.is_active, g.closed_at, g.created_at,
    (SELECT count(*)::integer FROM public.triad_group_members x WHERE x.triad_group_id = g.id),
    m.member_order::integer,
    public.triad_group_sessions_internal(g.id, m.enrollment_id)
  FROM public.programme_enrollments e
  JOIN public.triad_group_members m ON m.enrollment_id = e.id
  JOIN public.triad_groups g ON g.id = m.triad_group_id
  WHERE e.user_id = auth.uid()
    AND auth.uid() IS NOT NULL
    AND (p_enrollment_id IS NULL OR e.id = p_enrollment_id)
  ORDER BY g.is_active DESC, g.created_at DESC;
$$;

-- The learner's own canonical Triad status (same projection Admin and Sponsor read).
CREATE OR REPLACE FUNCTION public.learner_triad_status(p_enrollment_id uuid)
RETURNS TABLE (enrollment_id uuid, required_units integer, raw_completed_sessions integer, completed_units integer,
  due_units integer, overdue_units integer, booked_units integer, pace_status text, next_due_on date, schedule jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.enrollment_id, c.required_units, c.raw_completed_sessions, c.completed_units, c.due_units,
    c.overdue_units, c.booked_units, c.pace_status, c.next_due_on, c.schedule
  FROM public.programme_enrollments e
  CROSS JOIN LATERAL public.canonical_triad_completion(e.id, current_date) c
  WHERE e.id = p_enrollment_id AND e.user_id = auth.uid() AND auth.uid() IS NOT NULL;
$$;


-- ----------------------------------------------------------------------------
-- 12. Reflections (questions, visibility) and learner write paths.
-- ----------------------------------------------------------------------------
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
--     Learner write paths (the only way a learner changes Triad state).
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

-- A member of an active group proposes the group's next session (the first
-- one, or the next after the previous session was completed / cancelled).
-- The proposer has accepted it; the session confirms once everyone accepts.
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
-- 13. Cohort-scoped assignment (Admin manual + Admin-run auto-assign).
--     Always: one cohort -> that cohort's eligible enrollments. A group is
--     for the cohort's whole Triad requirement, never for one unit.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.triad_create_group_internal(
  p_cohort_id uuid, p_enrollment_ids uuid[], p_group_language text,
  p_assigned_by text, p_start timestamptz DEFAULT NULL, p_end timestamptz DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  group_id uuid;
  session_id uuid;
  n integer := coalesce(array_length(p_enrollment_ids, 1), 0);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cohorts WHERE id = p_cohort_id) THEN
    RAISE EXCEPTION 'Cohort not found' USING ERRCODE = 'P0002';
  END IF;
  IF n NOT BETWEEN 2 AND 3 OR (SELECT count(DISTINCT x) FROM unnest(p_enrollment_ids) x) <> n THEN
    RAISE EXCEPTION 'A Triad group needs 2 or 3 different learners' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_enrollment_ids) x
    LEFT JOIN public.programme_enrollments e ON e.id = x
    WHERE e.id IS NULL OR e.cohort_id IS DISTINCT FROM p_cohort_id
       OR e.status NOT IN ('active', 'at_risk', 'paused')
  ) THEN
    RAISE EXCEPTION 'Triad members must be ongoing enrollments of this cohort' USING ERRCODE = '42501';
  END IF;
  IF p_assigned_by NOT IN ('auto', 'admin') OR p_group_language NOT IN ('vi', 'en') THEN
    RAISE EXCEPTION 'Invalid assignment source or language' USING ERRCODE = '22023';
  END IF;
  IF (p_start IS NULL) <> (p_end IS NULL) OR p_end <= p_start THEN
    RAISE EXCEPTION 'A proposed time needs a start before its end' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.triad_groups (cohort_id, assigned_by, group_language)
  VALUES (p_cohort_id, p_assigned_by, p_group_language)
  RETURNING id INTO group_id;
  INSERT INTO public.triad_group_members (triad_group_id, enrollment_id, member_order)
  SELECT group_id, x.enrollment_id, x.ord FROM unnest(p_enrollment_ids) WITH ORDINALITY AS x(enrollment_id, ord);
  -- The system may propose a common available time as the first session.
  IF p_start IS NOT NULL THEN
    INSERT INTO public.triad_sessions (triad_group_id, scheduled_start_time, scheduled_end_time, status)
    VALUES (group_id, p_start, p_end, 'proposed')
    RETURNING id INTO session_id;
    INSERT INTO public.triad_session_responses (triad_session_id, enrollment_id)
    SELECT session_id, m.enrollment_id FROM public.triad_group_members m WHERE m.triad_group_id = group_id;
  END IF;
  RETURN group_id;
END $$;

-- Auto-assignment pool: eligible ongoing enrollments of THIS cohort that are
-- not in an active Triad group, with spoken languages.
CREATE OR REPLACE FUNCTION public.triad_cohort_candidates_internal(p_cohort_id uuid)
RETURNS TABLE (enrollment_id uuid, user_id uuid, full_name text, spoken_languages text[], programme_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT l.enrollment_id, l.user_id, l.full_name, l.spoken_languages, l.programme_id
  FROM public.triad_cohort_learners_internal(p_cohort_id, current_date) l
  WHERE l.is_eligible AND l.active_group_id IS NULL
  ORDER BY l.full_name;
$$;

-- Re-running auto-assignment replaces only its own groups that nobody has
-- acted on yet (no session, or only a proposed one nobody responded to).
CREATE OR REPLACE FUNCTION public.triad_clear_unconfirmed_auto_groups_internal(p_cohort_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE cleared integer;
BEGIN
  DELETE FROM public.triad_groups g
  WHERE g.cohort_id = p_cohort_id
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

-- Reminder targets: per cohort Triad due date (cumulative milestone N) and
-- eligible enrollment — met when the enrollment's canonical completed
-- sessions reach N, overdue when the date has passed and they do not.
CREATE OR REPLACE FUNCTION public.triad_reminder_targets_internal(p_as_of date DEFAULT current_date, p_cohort_id uuid DEFAULT NULL)
RETURNS TABLE (cohort_id uuid, programme_id uuid, milestone_number integer, due_on date, days_until_due integer,
  enrollment_id uuid, user_id uuid, triad_group_id uuid, open_session_status text, completed_units integer,
  milestone_met boolean, milestone_overdue boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.cohort_id, d.programme_id, d.ordinal, d.due_on, (d.due_on - p_as_of)::integer,
    l.enrollment_id, l.user_id, l.active_group_id,
    (SELECT s.status FROM public.triad_sessions s
     WHERE s.triad_group_id = l.active_group_id AND s.status IN ('proposed', 'confirmed') LIMIT 1),
    l.completed_units,
    l.completed_units >= d.ordinal,
    d.due_on <= p_as_of AND l.completed_units < d.ordinal
  FROM public.cohort_requirement_dates d
  CROSS JOIN LATERAL public.triad_cohort_learners_internal(d.cohort_id, p_as_of) l
  WHERE d.module = 'triads'::public.programme_module_type
    AND (p_cohort_id IS NULL OR d.cohort_id = p_cohort_id)
    AND l.programme_id = d.programme_id
    AND d.ordinal <= l.required_units
    AND l.is_eligible;
$$;

-- ----------------------------------------------------------------------------
-- 14. Admin (Admin -> Cohort -> Triads).
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

-- The requirement: per programme scheduled in the cohort, the programme's
-- required Triad count and the cohort's cumulative Triad due dates. Read-only
-- here (dates are edited in the Cohort Requirement Schedule). Loaded on its
-- own, so a group/session failure never turns the requirement into 0.
CREATE OR REPLACE FUNCTION public.admin_cohort_triad_requirement(p_cohort_id uuid)
RETURNS TABLE (programme_id uuid, programme_name text, required_units integer, schedule jsonb, schedule_state text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.triad_assert_admin();
  IF NOT EXISTS (SELECT 1 FROM public.cohorts WHERE id = p_cohort_id) THEN
    RAISE EXCEPTION 'Cohort not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT sp.programme_id, p.name,
    public.triad_required_units_for_programme(sp.programme_id),
    coalesce((SELECT jsonb_agg(jsonb_build_object('milestone', d.ordinal, 'due_on', d.due_on) ORDER BY d.ordinal)
              FROM public.cohort_requirement_dates d
              WHERE d.cohort_id = p_cohort_id AND d.programme_id = sp.programme_id AND d.module = 'triads'::public.programme_module_type),
             '[]'::jsonb),
    coalesce((SELECT st.state FROM public.cohort_programme_schedule_state(p_cohort_id, sp.programme_id) st
              WHERE st.module = 'triads'::public.programme_module_type), 'not_required')
  FROM public.cohort_scheduled_programmes(p_cohort_id) sp
  JOIN public.programmes p ON p.id = sp.programme_id
  ORDER BY p.name;
END $$;

-- Operational data: every group of the cohort (active first) with members
-- and numbered sessions.
CREATE OR REPLACE FUNCTION public.admin_cohort_triad_groups(p_cohort_id uuid)
RETURNS TABLE (triad_group_id uuid, assigned_by text, group_language text, is_active boolean, created_at timestamptz,
  closed_at timestamptz, members jsonb, sessions jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.triad_assert_admin();
  RETURN QUERY
  SELECT g.id, g.assigned_by, g.group_language, g.is_active, g.created_at, g.closed_at,
    coalesce((SELECT jsonb_agg(jsonb_build_object('enrollment_id', m.enrollment_id, 'user_id', e.user_id,
                'full_name', pr.full_name, 'member_order', m.member_order) ORDER BY m.member_order)
              FROM public.triad_group_members m
              JOIN public.programme_enrollments e ON e.id = m.enrollment_id
              JOIN public.profiles pr ON pr.id = e.user_id
              WHERE m.triad_group_id = g.id), '[]'::jsonb),
    public.triad_group_sessions_internal(g.id, NULL)
  FROM public.triad_groups g
  WHERE g.cohort_id = p_cohort_id
  ORDER BY g.is_active DESC, g.created_at;
END $$;

-- Every learner of the cohort (in a programme that requires Triads) with the
-- canonical completion — the same numbers Learner and Sponsor see.
CREATE OR REPLACE FUNCTION public.admin_cohort_triad_learners(p_cohort_id uuid, p_as_of date DEFAULT current_date)
RETURNS TABLE (enrollment_id uuid, user_id uuid, full_name text, spoken_languages text[], programme_id uuid,
  enrollment_status public.enrollment_status, is_eligible boolean, active_group_id uuid,
  required_units integer, raw_completed_sessions integer, completed_units integer, due_units integer,
  overdue_units integer, next_due_on date)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.triad_assert_admin();
  RETURN QUERY SELECT * FROM public.triad_cohort_learners_internal(p_cohort_id, p_as_of);
END $$;

CREATE OR REPLACE FUNCTION public.admin_triad_create_group(p_cohort_id uuid, p_enrollment_ids uuid[], p_group_language text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.triad_assert_admin();
  RETURN public.triad_create_group_internal(p_cohort_id, p_enrollment_ids, p_group_language, 'admin');
END $$;

-- Before the group's first session only: replace, add (p_remove NULL) or
-- remove (p_add NULL) one member. After that, regroup = close + create.
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
    SELECT 1 FROM public.triad_cohort_candidates_internal(g.cohort_id) c WHERE c.enrollment_id = p_add_enrollment_id
  ) THEN
    RAISE EXCEPTION 'The new member must be an ungrouped, ongoing enrollment of this cohort' USING ERRCODE = '42501';
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

-- Close (regroup) or reopen a group. Closing keeps its sessions and members as
-- history; an open session of a closed group is cancelled.
CREATE OR REPLACE FUNCTION public.admin_triad_set_group_active(p_group_id uuid, p_is_active boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.triad_assert_admin();
  IF NOT p_is_active THEN
    UPDATE public.triad_sessions SET status = 'cancelled'
    WHERE triad_group_id = p_group_id AND status IN ('proposed', 'confirmed');
  END IF;
  UPDATE public.triad_groups SET is_active = p_is_active WHERE id = p_group_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Triad group not found' USING ERRCODE = 'P0002'; END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 15. Row-level security. Learners READ their own groups; every Triad write
--     goes through the validated functions above (or Admin, still through
--     the guard triggers). Sponsors have no Triad table access at all: they
--     see canonical progress / journey only.
-- ----------------------------------------------------------------------------
ALTER TABLE public.triad_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triad_session_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triad_alternative_proposal_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triad_reflection_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triad_reflection_answers ENABLE ROW LEVEL SECURITY;

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

REVOKE INSERT, UPDATE, DELETE ON public.triad_group_members, public.triad_session_responses,
  public.triad_alternative_proposal_responses, public.triad_reflection_answers FROM anon;

-- ----------------------------------------------------------------------------
-- 16. Function access. Internal constructions are never client-callable.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.triad_member_enrollment_for_user(uuid, uuid),
  public.triad_session_can_complete(text, timestamptz),
  public.triad_required_units_for_programme(uuid),
  public.triad_validate_group_member(),
  public.triad_protect_group_member_removal(),
  public.triad_check_group_size(),
  public.triad_guard_group(),
  public.triad_guard_session(),
  public.triad_guard_session_delete(),
  public.triad_demo_reset_allows(text, uuid),
  public.triad_validate_response(),
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
  public.sponsor_canonical_activity(uuid),
  public.canonical_triad_completion(uuid, date),
  public.canonical_triad_group_members(uuid[]),
  public.triad_group_sessions_internal(uuid, uuid),
  public.triad_cohort_learners_internal(uuid, date),
  public.triad_reflection_questions_for_session(uuid),
  public.triad_caller_member_enrollment(uuid),
  public.triad_create_group_internal(uuid, uuid[], text, text, timestamptz, timestamptz),
  public.triad_cohort_candidates_internal(uuid),
  public.triad_clear_unconfirmed_auto_groups_internal(uuid),
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
  public.sponsor_canonical_activity(uuid),
  public.canonical_triad_completion(uuid, date),
  public.triad_create_group_internal(uuid, uuid[], text, text, timestamptz, timestamptz),
  public.triad_cohort_candidates_internal(uuid),
  public.triad_cohort_learners_internal(uuid, date),
  public.triad_clear_unconfirmed_auto_groups_internal(uuid),
  public.triad_reminder_targets_internal(date, uuid),
  public.canonical_triad_group_members(uuid[])
TO service_role;

REVOKE ALL ON FUNCTION
  public.learner_triad_members(uuid[]),
  public.learner_triad_overview(uuid),
  public.learner_triad_status(uuid),
  public.learner_triad_reflection_questions(uuid),
  public.learner_triad_session_reflections(uuid),
  public.learner_triad_schedule_session(uuid, timestamptz, timestamptz),
  public.learner_triad_respond_session(uuid, text),
  public.learner_triad_propose_alternative(uuid, timestamptz, timestamptz),
  public.learner_triad_respond_alternative(uuid, text),
  public.learner_triad_complete_session(uuid),
  public.learner_triad_submit_reflection(uuid, smallint, jsonb),
  public.learner_session_history(uuid),
  public.learner_reflection_feed(uuid),
  public.admin_cohort_triad_requirement(uuid),
  public.admin_cohort_triad_groups(uuid),
  public.admin_cohort_triad_learners(uuid, date),
  public.admin_triad_create_group(uuid, uuid[], text),
  public.admin_triad_change_member(uuid, uuid, uuid),
  public.admin_triad_set_group_active(uuid, boolean)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.learner_triad_members(uuid[]),
  public.learner_triad_overview(uuid),
  public.learner_triad_status(uuid),
  public.learner_triad_reflection_questions(uuid),
  public.learner_triad_session_reflections(uuid),
  public.learner_triad_schedule_session(uuid, timestamptz, timestamptz),
  public.learner_triad_respond_session(uuid, text),
  public.learner_triad_propose_alternative(uuid, timestamptz, timestamptz),
  public.learner_triad_respond_alternative(uuid, text),
  public.learner_triad_complete_session(uuid),
  public.learner_triad_submit_reflection(uuid, smallint, jsonb),
  public.learner_session_history(uuid),
  public.learner_reflection_feed(uuid),
  public.admin_cohort_triad_requirement(uuid),
  public.admin_cohort_triad_groups(uuid),
  public.admin_cohort_triad_learners(uuid, date),
  public.admin_triad_create_group(uuid, uuid[], text),
  public.admin_triad_change_member(uuid, uuid, uuid),
  public.admin_triad_set_group_active(uuid, boolean)
TO authenticated;

-- ----------------------------------------------------------------------------
-- 17. Rebuild Triad evidence from membership, then prove equivalence with the
--     legitimate legacy data. The completion rule itself (distinct completed
--     sessions, capped, against cumulative dates) is the rule production
--     already applies, so canonical progress may only change where evidence
--     was stale (a date that no longer matches the session) or missing.
-- ----------------------------------------------------------------------------
DO $$ BEGIN PERFORM public.triad_sync_session_attributions(s.id) FROM public.triad_sessions s; END $$;

DO $$
DECLARE bad text; n bigint;
BEGIN
  -- No group, session, proposal or reflection lost.
  IF (SELECT row(groups, sessions, proposals, reflections) FROM _triad_before_counts)
     IS DISTINCT FROM row((SELECT count(*) FROM public.triad_groups), (SELECT count(*) FROM public.triad_sessions),
                          (SELECT count(*) FROM public.triad_alternative_proposals), (SELECT count(*) FROM public.triad_reflections)) THEN
    RAISE EXCEPTION 'Triad cutover verification: record counts changed';
  END IF;

  -- Sessions: same group, status and time.
  SELECT count(*) INTO n FROM _triad_before_sessions b JOIN public.triad_sessions s ON s.id = b.id
  WHERE row(b.triad_group_id, b.status, b.start_time) IS DISTINCT FROM row(s.triad_group_id, s.status, s.scheduled_start_time);
  IF n > 0 THEN RAISE EXCEPTION 'Triad cutover verification: % sessions changed group, status or time', n; END IF;

  -- Session ownership: historical membership == the old role enrollments.
  SELECT count(*) INTO n FROM (
    (SELECT session_id, enrollment_id FROM _triad_before_ownership
     EXCEPT SELECT s.id, m.enrollment_id FROM public.triad_sessions s JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id)
    UNION ALL
    (SELECT s.id, m.enrollment_id FROM public.triad_sessions s JOIN public.triad_group_members m ON m.triad_group_id = s.triad_group_id
     EXCEPT SELECT session_id, enrollment_id FROM _triad_before_ownership)) diff;
  IF n > 0 THEN RAISE EXCEPTION 'Triad cutover verification: % session ownership differences', n; END IF;

  -- Evidence: the same (enrollment, session) pairs as before, except
  --   * evidence backfilled for a live session that had none (reported), and
  --   * evidence of a cancelled session or a session without a time (removed:
  --     never completion, never booked; reported).
  SELECT count(*) INTO n FROM (
    SELECT b.enrollment_id, b.session_id FROM _triad_before_attributions b
    JOIN public.triad_sessions s ON s.id = b.session_id
    WHERE s.status <> 'cancelled' AND s.scheduled_start_time IS NOT NULL
    EXCEPT SELECT enrollment_id, source_activity_id FROM public.session_activity_attributions WHERE source_activity_type = 'triad') diff;
  IF n > 0 THEN RAISE EXCEPTION 'Triad cutover verification: % Triad evidence rows lost', n; END IF;
  SELECT count(*) INTO n FROM (
    SELECT a.enrollment_id, a.source_activity_id FROM public.session_activity_attributions a
    WHERE a.source_activity_type = 'triad'
      AND EXISTS (SELECT 1 FROM _triad_before_attributions b WHERE b.session_id = a.source_activity_id)
    EXCEPT SELECT enrollment_id, session_id FROM _triad_before_attributions) diff;
  IF n > 0 THEN RAISE EXCEPTION 'Triad cutover verification: % Triad evidence rows gained on attributed sessions', n; END IF;
  SELECT count(*), string_agg(DISTINCT a.source_activity_id::text, ', ') INTO n, bad
  FROM public.session_activity_attributions a
  WHERE a.source_activity_type = 'triad'
    AND NOT EXISTS (SELECT 1 FROM _triad_before_attributions b WHERE b.session_id = a.source_activity_id);
  IF n > 0 THEN
    RAISE NOTICE 'Triad cutover: % evidence row(s) backfilled for legacy sessions that had none (sessions: %)', n, bad;
  END IF;
  bad := NULL;

  -- Canonical Triad progress per enrollment is unchanged, except where the
  -- enrollment's evidence was corrected (stale date / backfilled / removed
  -- for a cancelled or timeless session) — reported.
  SELECT string_agg(b.enrollment_id::text, ', ') INTO bad
  FROM _triad_before_progress b
  JOIN LATERAL (SELECT * FROM public.canonical_module_progress(b.enrollment_id, current_date) p
                WHERE p.module = 'triads'::public.programme_module_type) a ON true
  WHERE row(b.required_units, b.completed_activity_units, b.completed_units, b.due_units, b.booked_units, b.overdue_units, b.pace_status)
        IS DISTINCT FROM row(a.required_units, a.completed_activity_units, a.completed_units, a.due_units, a.booked_units, a.overdue_units, a.pace_status)
    AND NOT EXISTS (
      SELECT 1 FROM _triad_before_attributions ba
      JOIN public.triad_sessions s ON s.id = ba.session_id
      WHERE ba.enrollment_id = b.enrollment_id
        AND (ba.occurred_on IS DISTINCT FROM s.scheduled_start_time::date OR s.status = 'cancelled'))
    AND NOT EXISTS (
      SELECT 1 FROM public.session_activity_attributions a
      WHERE a.enrollment_id = b.enrollment_id AND a.source_activity_type = 'triad'
        AND NOT EXISTS (SELECT 1 FROM _triad_before_attributions x WHERE x.session_id = a.source_activity_id));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Triad cutover verification: canonical Triad progress changed for enrollments %', bad;
  END IF;
  SELECT count(*) INTO n FROM _triad_before_attributions ba JOIN public.triad_sessions s ON s.id = ba.session_id
  WHERE ba.occurred_on IS DISTINCT FROM s.scheduled_start_time::date;
  IF n > 0 THEN RAISE NOTICE 'Triad cutover: % evidence dates corrected to the session''s scheduled start', n; END IF;

  -- canonical_triad_completion is exactly canonical_module_progress for Triads.
  SELECT count(*) INTO n
  FROM public.programme_enrollments e
  JOIN LATERAL (SELECT * FROM public.canonical_module_progress(e.id, current_date) p WHERE p.module = 'triads'::public.programme_module_type) p ON true
  CROSS JOIN LATERAL public.canonical_triad_completion(e.id, current_date) c
  WHERE row(c.required_units, c.completed_by_as_of, c.completed_units, c.due_units, c.overdue_units, c.booked_units, c.pace_status)
        IS DISTINCT FROM row(p.required_units, p.completed_activity_units, p.completed_units, p.due_units, p.overdue_units, p.booked_units, p.pace_status);
  IF n > 0 THEN RAISE EXCEPTION 'Triad cutover verification: % Triad completion projections differ from canonical progress', n; END IF;

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

  -- Groups: 2-3 members, all in the group's cohort; one active group per enrollment.
  SELECT string_agg(g.id::text, ', ') INTO bad FROM public.triad_groups g
  WHERE (SELECT count(*) FROM public.triad_group_members m WHERE m.triad_group_id = g.id) NOT BETWEEN 2 AND 3
     OR EXISTS (SELECT 1 FROM public.triad_group_members m JOIN public.programme_enrollments e ON e.id = m.enrollment_id
                WHERE m.triad_group_id = g.id AND e.cohort_id IS DISTINCT FROM g.cohort_id);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Triad cutover verification: invalid groups: %', bad; END IF;
  SELECT string_agg(m.enrollment_id::text, ', ') INTO bad FROM (
    SELECT m.enrollment_id FROM public.triad_group_members m JOIN public.triad_groups g ON g.id = m.triad_group_id
    WHERE g.is_active GROUP BY m.enrollment_id HAVING count(*) > 1) m;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Triad cutover verification: enrollments in several active groups: %', bad; END IF;
  SELECT count(*) INTO n FROM _triad_closed_groups;
  IF n > 0 THEN
    RAISE NOTICE 'Triad cutover: % older legacy group(s) closed so each enrollment has one active group: %', n,
      (SELECT string_agg(triad_group_id::text, ', ') FROM _triad_closed_groups);
  END IF;
END $$;

-- Final state: nothing live reads a retired Triad field or a requirement-unit
-- ownership of groups / sessions.
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO offenders
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND p.proname NOT IN ('triad_is_seed_identifier')
    AND pg_get_functiondef(p.oid) ~ '(coach|coachee|observer)_enrollment_id|member_[123]_(id|response)|enrollment_[123]_id|[a-z]\.(learned|will_use)_as_(coach|coachee|observer)|completion_deadline|programme_triad_rounds|public\.triad_rounds|triad_round_id|cohort_requirement_date_id|cohort_triad_operations';
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
