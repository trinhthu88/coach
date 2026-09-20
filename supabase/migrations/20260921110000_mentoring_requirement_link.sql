-- Mentoring requirement attribution (Mentoring canonical cutover, phase 1).
--
-- Mentoring already had cohort deadlines: cohort_requirement_dates is generic
-- over module and holds 'mentoring' rows, and every Journey renders Mentoring
-- checkpoints from them. What it did not have was any link from a session to
-- the requirement it fulfils. Mentoring rows reached the canonical activity
-- spine through session_activity_attributions with requirement_due_on = NULL,
-- and in canonical_module_progress a NULL requirement_due_on passes the
-- due-date filter unconditionally:
--
--   count(...) FILTER (WHERE ... AND (a.requirement_due_on IS NULL
--                                     OR a.requirement_due_on <= p_as_of))
--
-- so an early Mentoring 3 silently satisfied an overdue Mentoring 1. That is
-- the defect the Triad model was rebuilt to remove ("an early Triad 2 never
-- hides an overdue Triad 1") and that Coaching inherited the fix for. This
-- brings Mentoring onto the same footing.
--
-- Completion rule, deliberately NOT Coaching's: a Mentoring requirement is
-- fulfilled by a COMPLETED Mentoring session attributed to it. There are no
-- evidence gates. Mentee reflection, mentor notes, mentor feedback, goal
-- check-ins and actions are after-session evidence, surfaced separately and
-- never redefining whether the meeting happened.
--
-- Deployment safety follows the Triad cutover: progress is snapshotted before
-- anything changes, the backfill is deterministic, and the migration aborts if
-- any real (non-demo) learner's Mentoring progress would move.

-- ---------------------------------------------------------------------------
-- 1. Requirement + cohort columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.mentoring_sessions
  ADD COLUMN cohort_requirement_id uuid REFERENCES public.cohort_requirement_dates(id) ON DELETE RESTRICT,
  -- Denormalised for integrity and cheap cohort-scoped reads. Never accepted
  -- from a caller: the trigger below overwrites it from the enrollment, so it
  -- cannot become a second, independent cohort identity.
  ADD COLUMN cohort_id uuid REFERENCES public.cohorts(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.mentoring_sessions.cohort_requirement_id IS
  'The cohort Mentoring requirement (cohort_requirement_dates) this session '
  'fulfils. Server-assigned and validated; never trusted from the client.';
COMMENT ON COLUMN public.mentoring_sessions.cohort_id IS
  'Mirror of programme_enrollments.cohort_id for mentoring_sessions.enrollment_id. '
  'Server-assigned; never accepted from a caller.';

CREATE INDEX mentoring_sessions_cohort_requirement_idx
  ON public.mentoring_sessions (cohort_requirement_id) WHERE cohort_requirement_id IS NOT NULL;
CREATE INDEX mentoring_sessions_cohort_idx
  ON public.mentoring_sessions (cohort_id) WHERE cohort_id IS NOT NULL;

-- One LEARNER may hold at most one live session per Mentoring requirement.
--
-- Scoped to (enrollment, requirement), not the requirement alone. A
-- cohort_requirement_dates row is UNIQUE (cohort_id, programme_id, module,
-- ordinal) -- it is "Mentoring N OF THE COHORT", shared by every learner in it.
-- Keying this on cohort_requirement_id by itself would make one requirement a
-- cohort-wide booking lock, which is exactly the defect corrected for Coaching
-- in 20260921100000.
CREATE UNIQUE INDEX mentoring_sessions_one_live_session_per_requirement
  ON public.mentoring_sessions (enrollment_id, cohort_requirement_id)
  WHERE cohort_requirement_id IS NOT NULL
    AND status IN ('pending_coach_approval', 'confirmed');

-- ---------------------------------------------------------------------------
-- 2. Cross-table validation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_mentoring_session_requirement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_enrollment_cohort uuid;
  v_req record;
BEGIN
  IF NEW.enrollment_id IS NULL THEN
    RETURN NEW;  -- validate_enrollment_activity already rejects this.
  END IF;

  SELECT e.cohort_id INTO v_enrollment_cohort
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
      )
    ORDER BY d.ordinal
    LIMIT 1;
  END IF;

  IF NEW.cohort_requirement_id IS NOT NULL THEN
    SELECT d.id, d.cohort_id, d.module INTO v_req
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
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER mentoring_sessions_validate_requirement
  BEFORE INSERT OR UPDATE ON public.mentoring_sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_mentoring_session_requirement();

-- ---------------------------------------------------------------------------
-- 3. Snapshot progress BEFORE anything changes
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE _mr_before_progress ON COMMIT DROP AS
SELECT e.id AS enrollment_id, p.required_units, p.completed_units,
       p.due_units, p.overdue_units
FROM public.programme_enrollments e
JOIN LATERAL (SELECT * FROM public.canonical_module_progress(e.id, current_date) x
              WHERE x.module = 'mentoring'::public.programme_module_type) p ON true;

-- ---------------------------------------------------------------------------
-- 4. Deterministic backfill (section 33: evidence, not invention)
-- ---------------------------------------------------------------------------
--
-- Within one enrollment, the Nth live-or-completed Mentoring session in
-- chronological order fulfils the Nth Mentoring requirement of its cohort.
-- That is the only ordering the data supports, and it is the same rule the
-- learner experiences: requirements are worked through in order.
--
-- Sessions beyond the requirement count keep cohort_requirement_id NULL and
-- become raw activity, exactly as an extra Triad session under one requirement
-- does. Cancelled and rescheduled sessions are never attributed. Attribution
-- is never invented for an enrollment whose cohort schedules no Mentoring.

WITH reqs AS (
  SELECT e.id AS enrollment_id, d.id AS requirement_id,
         row_number() OVER (PARTITION BY e.id ORDER BY d.ordinal) AS rn
  FROM public.programme_enrollments e
  JOIN public.cohort_requirement_dates d
    ON d.cohort_id = e.cohort_id
   AND d.programme_id = e.programme_id
   AND d.module = 'mentoring'::public.programme_module_type
), sess AS (
  SELECT s.id, s.enrollment_id,
         row_number() OVER (PARTITION BY s.enrollment_id ORDER BY s.start_time, s.id) AS rn
  FROM public.mentoring_sessions s
  WHERE s.enrollment_id IS NOT NULL
    AND s.status IN ('pending_coach_approval', 'confirmed', 'completed')
)
UPDATE public.mentoring_sessions m
   SET cohort_requirement_id = r.requirement_id
  FROM sess sx
  JOIN reqs r ON r.enrollment_id = sx.enrollment_id AND r.rn = sx.rn
 WHERE m.id = sx.id;

-- Every remaining row still gets its derived cohort_id, so the column is
-- complete even where attribution is deliberately absent.
UPDATE public.mentoring_sessions m
   SET cohort_id = e.cohort_id
  FROM public.programme_enrollments e
 WHERE e.id = m.enrollment_id
   AND m.cohort_id IS DISTINCT FROM e.cohort_id;

-- Read-only report of what could not be attributed.
CREATE OR REPLACE FUNCTION public.mentoring_sessions_without_requirement()
RETURNS TABLE (
  session_id uuid,
  enrollment_id uuid,
  cohort_id uuid,
  status text,
  start_time timestamptz,
  reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT s.id, s.enrollment_id, s.cohort_id, s.status::text, s.start_time,
    CASE
      WHEN s.enrollment_id IS NULL THEN 'no enrollment'
      WHEN s.cohort_id IS NULL THEN 'enrollment has no cohort'
      WHEN s.status NOT IN ('pending_coach_approval', 'confirmed', 'completed')
        THEN 'not a live or completed session'
      WHEN NOT EXISTS (
        SELECT 1 FROM public.cohort_requirement_dates d
        WHERE d.cohort_id = s.cohort_id AND d.module = 'mentoring'::public.programme_module_type
      ) THEN 'cohort has no mentoring requirements'
      ELSE 'more sessions than requirements (extra activity)'
    END
  FROM public.mentoring_sessions s
  WHERE s.cohort_requirement_id IS NULL;
$$;

REVOKE ALL ON FUNCTION public.mentoring_sessions_without_requirement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mentoring_sessions_without_requirement() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Per-requirement fulfilment
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.canonical_mentoring_requirement_fulfilment(p_enrollment_id uuid)
RETURNS TABLE (
  requirement_id uuid,
  ordinal integer,
  due_on date,
  fulfilled_on date,
  booked_on date,
  session_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH enrollment AS (
    SELECT e.id, e.cohort_id, e.programme_id
    FROM public.programme_enrollments e WHERE e.id = p_enrollment_id
  ), requirements AS (
    SELECT d.id, d.ordinal, d.due_on
    FROM public.cohort_requirement_dates d
    JOIN enrollment e ON e.cohort_id = d.cohort_id AND e.programme_id = d.programme_id
    WHERE d.module = 'mentoring'::public.programme_module_type
  ), per_requirement AS (
    SELECT r.id AS requirement_id, r.ordinal, r.due_on,
      -- The single live-or-completed session by which THIS enrollment owns
      -- this requirement. The partial unique index guarantees at most one live
      -- session per learner per requirement; a completed one is terminal.
      (SELECT s.id FROM public.mentoring_sessions s
        WHERE s.cohort_requirement_id = r.id
          AND s.enrollment_id = p_enrollment_id
          AND s.status IN ('pending_coach_approval', 'confirmed', 'completed')
        ORDER BY CASE s.status WHEN 'completed' THEN 0 ELSE 1 END, s.start_time
        LIMIT 1) AS session_id
    FROM requirements r
  )
  SELECT pr.requirement_id, pr.ordinal, pr.due_on,
    -- A Mentoring requirement is fulfilled by a completed session. The
    -- preparation document, mentor feedback and mentee reflection are
    -- after-session evidence and gate nothing.
    CASE WHEN s.status = 'completed' THEN (s.start_time AT TIME ZONE 'UTC')::date END AS fulfilled_on,
    CASE WHEN s.id IS NOT NULL AND s.status <> 'completed'
         THEN (s.start_time AT TIME ZONE 'UTC')::date END AS booked_on,
    pr.session_id
  FROM per_requirement pr
  LEFT JOIN public.mentoring_sessions s ON s.id = pr.session_id
  ORDER BY pr.ordinal;
$$;

REVOKE ALL ON FUNCTION public.canonical_mentoring_requirement_fulfilment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canonical_mentoring_requirement_fulfilment(uuid) TO authenticated;

COMMENT ON FUNCTION public.canonical_mentoring_requirement_fulfilment(uuid) IS
  'THE Mentoring completion rule: one row per cohort Mentoring requirement of '
  'the enrollment; a completed session attributed to a requirement fulfils '
  'THAT requirement, once. Evidence never gates it.';

-- The next Mentoring requirement with no session yet.
CREATE OR REPLACE FUNCTION public.next_mentoring_requirement(p_enrollment_id uuid)
RETURNS TABLE (requirement_id uuid, ordinal integer, due_on date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT f.requirement_id, f.ordinal, f.due_on
  FROM public.canonical_mentoring_requirement_fulfilment(p_enrollment_id) f
  WHERE f.session_id IS NULL
  ORDER BY f.ordinal
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.next_mentoring_requirement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_mentoring_requirement(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Wire Mentoring into the canonical activity spine
-- ---------------------------------------------------------------------------
--
-- Mentoring stops emitting one row per session attribution (which carried no
-- requirement due date) and starts emitting one row per cohort Mentoring
-- requirement, exactly as Coaching and Triads do. Every other branch is
-- unchanged from 20260920130000.

CREATE OR REPLACE FUNCTION public.sponsor_canonical_activity(p_enrollment_id uuid)
RETURNS TABLE(module programme_module_type, occurred_on date, status text, requirement_due_on date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Coaching: one row per cohort Coaching requirement.
  SELECT 'coaching'::public.programme_module_type,
    coalesce(f.fulfilled_on, f.booked_on),
    CASE WHEN f.fulfilled_on IS NOT NULL THEN 'completed' ELSE 'confirmed' END,
    f.due_on
  FROM public.canonical_coaching_requirement_fulfilment(p_enrollment_id) f
  WHERE coalesce(f.fulfilled_on, f.booked_on) IS NOT NULL

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
  -- Mentoring: one row per cohort Mentoring requirement (fulfilled, else
  -- booked), never one per session.
  SELECT 'mentoring'::public.programme_module_type,
    coalesce(f.fulfilled_on, f.booked_on),
    CASE WHEN f.fulfilled_on IS NOT NULL THEN 'completed' ELSE 'confirmed' END,
    f.due_on
  FROM public.canonical_mentoring_requirement_fulfilment(p_enrollment_id) f
  WHERE coalesce(f.fulfilled_on, f.booked_on) IS NOT NULL

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

-- ---------------------------------------------------------------------------
-- 7. Verification. Anything unexpected stops the deployment.
-- ---------------------------------------------------------------------------

DO $$
DECLARE bad text; n bigint; demo_enrollments uuid[] := ARRAY[]::uuid[];
BEGIN
  -- Every attributed session points at a Mentoring requirement of its own
  -- cohort, and at most one live session per learner per requirement.
  SELECT string_agg(s.id::text, ', ') INTO bad
  FROM public.mentoring_sessions s
  JOIN public.cohort_requirement_dates d ON d.id = s.cohort_requirement_id
  WHERE d.module <> 'mentoring'::public.programme_module_type
     OR d.cohort_id IS DISTINCT FROM s.cohort_id;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Mentoring requirement link: sessions attributed outside their cohort: %', bad;
  END IF;

  SELECT string_agg(x.enrollment_id::text, ', ') INTO bad FROM (
    SELECT s.enrollment_id FROM public.mentoring_sessions s
    WHERE s.cohort_requirement_id IS NOT NULL
      AND s.status IN ('pending_coach_approval', 'confirmed')
    GROUP BY s.enrollment_id, s.cohort_requirement_id HAVING count(*) > 1) x;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Mentoring requirement link: several live sessions for one requirement: %', bad;
  END IF;

  -- No session may be attributed twice.
  SELECT count(*) INTO n FROM (
    SELECT s.enrollment_id, s.cohort_requirement_id
    FROM public.mentoring_sessions s
    WHERE s.cohort_requirement_id IS NOT NULL AND s.status = 'completed'
    GROUP BY s.enrollment_id, s.cohort_requirement_id HAVING count(*) > 1) y;
  IF n > 0 THEN
    RAISE EXCEPTION 'Mentoring requirement link: % requirements hold more than one completed session', n;
  END IF;

  IF to_regclass('public.demo_resource_registry') IS NOT NULL THEN
    EXECUTE $q$SELECT coalesce(array_agg(resource_id), ARRAY[]::uuid[]) FROM public.demo_resource_registry
               WHERE resource_type = 'enrollment'$q$ INTO demo_enrollments;
  END IF;

  -- Progress of real (non-demo) learners must not change. A learner whose
  -- cohort schedules no Mentoring, or fewer requirements than they have
  -- completed sessions, would lose units here -- that is a data problem to
  -- resolve deliberately, not something to absorb silently.
  SELECT string_agg(b.enrollment_id::text, ', ') INTO bad
  FROM _mr_before_progress b
  JOIN LATERAL (SELECT * FROM public.canonical_module_progress(b.enrollment_id, current_date) p
                WHERE p.module = 'mentoring'::public.programme_module_type) a ON true
  WHERE row(b.required_units, b.completed_units)
        IS DISTINCT FROM row(a.required_units, a.completed_units)
    AND b.enrollment_id <> ALL (demo_enrollments);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Mentoring requirement link: Mentoring progress changed for real enrollments %', bad
      USING HINT = 'Run mentoring_sessions_without_requirement() and give these cohorts their Mentoring requirement dates before deploying.';
  END IF;
END $$;
