-- ============================================================
-- TRIAD REDESIGN — full replacement of the Phase 3 (v1) shape.
--
-- v1 (20260903130000/130100/130200) was self-scheduled: any of the 3 fixed
-- members picked a date/time directly and it was immediately "confirmed",
-- with per-session rotating coach/coachee/observer roles. This migration
-- replaces that with: admin-defined triad_rounds (deadline-driven), an
-- auto-assign algorithm grouping by language + coachee_availability overlap,
-- dyads (2-person groups) when a pool isn't divisible by 3, and a
-- propose/accept(+alternative-proposal) booking flow instead of direct
-- self-scheduling. Reflections (triad_reflections) are UNCHANGED — same 6
-- fixed questions + satisfaction rating already matched the new spec.
--
-- Existing rows in triad_groups/triad_sessions are preserved and backfilled
-- (see the UPDATE statements below) rather than dropped, since real triads
-- may already be mid-flight.
-- ============================================================

-- ============================================================
-- 1. triad_rounds — new table
-- ============================================================
CREATE TABLE public.triad_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES public.programmes(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  title TEXT NOT NULL,
  title_vi TEXT,
  training_week_id UUID REFERENCES public.training_weeks(id),
  completion_deadline DATE NOT NULL,
  auto_assign_date DATE NOT NULL,
  auto_assign_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (auto_assign_status IN ('pending', 'running', 'completed', 'failed')),
  is_visible BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (programme_id, round_number)
);

ALTER TABLE public.triad_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Triad rounds: admin full" ON public.triad_rounds
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Triad rounds: participant read" ON public.triad_rounds
  FOR SELECT TO authenticated
  USING (
    is_visible = true
    AND public.has_programme_module('triads'::programme_module_type)
    AND EXISTS (
      SELECT 1 FROM public.programme_enrollments pe
      WHERE pe.user_id = auth.uid()
        AND pe.programme_id = triad_rounds.programme_id
        AND pe.status = 'active'
    )
  );

CREATE TRIGGER trg_triad_rounds_updated BEFORE UPDATE ON public.triad_rounds
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_triad_rounds_programme ON public.triad_rounds(programme_id);

-- ============================================================
-- 2. triad_groups — extend for rounds + dyads + auto-assign
-- ============================================================
ALTER TABLE public.triad_groups
  ADD COLUMN triad_round_id UUID REFERENCES public.triad_rounds(id) ON DELETE CASCADE,
  ADD COLUMN assigned_by TEXT NOT NULL DEFAULT 'admin' CHECK (assigned_by IN ('auto', 'admin')),
  ADD COLUMN group_language TEXT NOT NULL DEFAULT 'vi';

-- cohort_id was a required grouping axis in v1; rounds now carry
-- programme_id directly and auto-assign doesn't select by cohort, so it
-- becomes optional (still settable for admin-created groups that want it).
ALTER TABLE public.triad_groups ALTER COLUMN cohort_id DROP NOT NULL;

-- Dyads: member_3_id becomes optional. Drop and recreate the
-- distinctness check to tolerate NULL.
ALTER TABLE public.triad_groups DROP CONSTRAINT triad_members_distinct;
ALTER TABLE public.triad_groups ALTER COLUMN member_3_id DROP NOT NULL;
ALTER TABLE public.triad_groups ADD CONSTRAINT triad_members_distinct CHECK (
  member_1_id != member_2_id
  AND (member_3_id IS NULL OR member_1_id != member_3_id)
  AND (member_3_id IS NULL OR member_2_id != member_3_id)
);

CREATE INDEX idx_triad_groups_round ON public.triad_groups(triad_round_id);

-- Existing v1 groups were always admin-curated triples — mark them
-- accordingly (assigned_by already defaults to 'admin' for new rows via
-- the DEFAULT above, this is just explicit for pre-existing rows).
UPDATE public.triad_groups SET assigned_by = 'admin' WHERE assigned_by IS NULL;

DROP POLICY IF EXISTS "Triad groups: members view own" ON public.triad_groups;
CREATE POLICY "Triad groups: member read" ON public.triad_groups
  FOR SELECT TO authenticated
  USING (
    (member_1_id = auth.uid() OR member_2_id = auth.uid() OR member_3_id = auth.uid())
    AND is_active = true
    AND public.has_programme_module('triads'::programme_module_type)
  );

-- ============================================================
-- 3. Helper: is the caller a member of this triad group?
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_triad_member(group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.triad_groups
    WHERE id = group_id
      AND (member_1_id = auth.uid() OR member_2_id = auth.uid() OR member_3_id = auth.uid())
  );
$$;

-- ============================================================
-- 4. triad_sessions — replace rotating-role booking with propose/accept
-- ============================================================
ALTER TABLE public.triad_sessions
  ADD COLUMN proposed_start_time TIMESTAMPTZ,
  ADD COLUMN proposed_end_time TIMESTAMPTZ,
  ADD COLUMN proposed_by TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN member_1_response TEXT NOT NULL DEFAULT 'pending'
    CHECK (member_1_response IN ('pending', 'accepted', 'declined')),
  ADD COLUMN member_2_response TEXT NOT NULL DEFAULT 'pending'
    CHECK (member_2_response IN ('pending', 'accepted', 'declined')),
  -- Nullable (unlike member_1/2): NULL means "this group is a dyad, no
  -- 3rd member" — the auto-confirm trigger treats a NULL 3rd response the
  -- same as an already-accepted one. A NOT NULL 'pending' default (as a
  -- literal reading of the dyad case would suggest) would make dyads
  -- unconfirmable, since the trigger would always find a non-accepted
  -- member_3_response.
  ADD COLUMN member_3_response TEXT
    CHECK (member_3_response IN ('pending', 'accepted', 'declined') OR member_3_response IS NULL);

-- Backfill from v1 columns: any existing row was self-scheduled and
-- immediately usable, i.e. everyone present had implicitly "accepted".
UPDATE public.triad_sessions ts SET
  proposed_start_time = ts.start_time,
  proposed_end_time = ts.start_time + make_interval(mins => ts.duration_minutes),
  proposed_by = 'system',
  member_1_response = CASE WHEN ts.status IN ('confirmed', 'completed') THEN 'accepted' ELSE 'pending' END,
  member_2_response = CASE WHEN ts.status IN ('confirmed', 'completed') THEN 'accepted' ELSE 'pending' END,
  member_3_response = CASE
    WHEN tg.member_3_id IS NULL THEN NULL
    WHEN ts.status IN ('confirmed', 'completed') THEN 'accepted'
    ELSE 'pending'
  END
FROM public.triad_groups tg
WHERE tg.id = ts.triad_group_id;

-- status was a shared enum (session_status) with values that don't include
-- 'proposed'; the new flow needs its own small text vocabulary.
ALTER TABLE public.triad_sessions ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.triad_sessions ALTER COLUMN status TYPE TEXT USING (
  CASE status::text
    WHEN 'pending_coach_approval' THEN 'proposed'
    WHEN 'rescheduled' THEN 'proposed'
    ELSE status::text
  END
);
ALTER TABLE public.triad_sessions ALTER COLUMN status SET DEFAULT 'proposed';
ALTER TABLE public.triad_sessions ADD CONSTRAINT triad_sessions_status_check
  CHECK (status IN ('proposed', 'confirmed', 'completed', 'cancelled'));

ALTER TABLE public.triad_sessions DROP CONSTRAINT triad_session_roles_distinct;
ALTER TABLE public.triad_sessions DROP COLUMN coach_role_id;
ALTER TABLE public.triad_sessions DROP COLUMN coachee_role_id;
ALTER TABLE public.triad_sessions DROP COLUMN observer_role_id;
ALTER TABLE public.triad_sessions DROP COLUMN session_date;
ALTER TABLE public.triad_sessions DROP COLUMN duration_minutes;
ALTER TABLE public.triad_sessions DROP COLUMN training_week_id;

DROP POLICY IF EXISTS "Triad sessions: members view own" ON public.triad_sessions;
DROP POLICY IF EXISTS "Triad sessions: members update own" ON public.triad_sessions;
DROP POLICY IF EXISTS "Triad sessions: members create" ON public.triad_sessions;

CREATE POLICY "Triad sessions: member read" ON public.triad_sessions
  FOR SELECT TO authenticated
  USING (
    public.is_triad_member(triad_group_id)
    AND public.has_programme_module('triads'::programme_module_type)
  );

CREATE POLICY "Triad sessions: member update response" ON public.triad_sessions
  FOR UPDATE TO authenticated
  USING (public.is_triad_member(triad_group_id) AND public.has_programme_module('triads'::programme_module_type))
  WITH CHECK (public.is_triad_member(triad_group_id) AND public.has_programme_module('triads'::programme_module_type));

-- ============================================================
-- 5. Auto-confirm trigger — flips status to 'confirmed' once every
--    present member has accepted
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_confirm_triad_session()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.member_1_response = 'accepted'
     AND NEW.member_2_response = 'accepted'
     AND (NEW.member_3_response = 'accepted' OR NEW.member_3_response IS NULL)
  THEN
    NEW.status := 'confirmed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_confirm_triad
  BEFORE UPDATE ON public.triad_sessions
  FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_triad_session();

-- ============================================================
-- 6. triad_alternative_proposals — new table
-- ============================================================
CREATE TABLE public.triad_alternative_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triad_session_id UUID NOT NULL REFERENCES public.triad_sessions(id) ON DELETE CASCADE,
  proposed_by UUID NOT NULL REFERENCES public.profiles(id),
  proposed_start_time TIMESTAMPTZ NOT NULL,
  proposed_end_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'superseded')),
  member_1_response TEXT NOT NULL DEFAULT 'pending'
    CHECK (member_1_response IN ('pending', 'accepted', 'declined')),
  member_2_response TEXT NOT NULL DEFAULT 'pending'
    CHECK (member_2_response IN ('pending', 'accepted', 'declined')),
  member_3_response TEXT
    CHECK (member_3_response IN ('pending', 'accepted', 'declined') OR member_3_response IS NULL),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.triad_alternative_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Triad alt proposals: admin full" ON public.triad_alternative_proposals
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Triad alt proposals: member read" ON public.triad_alternative_proposals
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.triad_sessions ts
      WHERE ts.id = triad_alternative_proposals.triad_session_id
        AND public.is_triad_member(ts.triad_group_id)
    )
  );

CREATE POLICY "Triad alt proposals: member insert" ON public.triad_alternative_proposals
  FOR INSERT TO authenticated
  WITH CHECK (
    proposed_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.triad_sessions ts
      WHERE ts.id = triad_alternative_proposals.triad_session_id
        AND public.is_triad_member(ts.triad_group_id)
    )
  );

CREATE POLICY "Triad alt proposals: member update" ON public.triad_alternative_proposals
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.triad_sessions ts
      WHERE ts.id = triad_alternative_proposals.triad_session_id
        AND public.is_triad_member(ts.triad_group_id)
    )
  );

CREATE INDEX idx_triad_alt_proposals_session ON public.triad_alternative_proposals(triad_session_id);

-- When all present members accept an alternative, promote it onto the
-- parent session and supersede any other pending alternatives.
CREATE OR REPLACE FUNCTION public.auto_accept_alternative_proposal()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.member_1_response = 'accepted'
     AND NEW.member_2_response = 'accepted'
     AND (NEW.member_3_response = 'accepted' OR NEW.member_3_response IS NULL)
  THEN
    NEW.status := 'accepted';

    UPDATE public.triad_sessions
    SET proposed_start_time = NEW.proposed_start_time,
        proposed_end_time = NEW.proposed_end_time,
        proposed_by = NEW.proposed_by::text,
        status = 'confirmed',
        member_1_response = 'accepted',
        member_2_response = 'accepted',
        member_3_response = CASE WHEN member_3_response IS NULL THEN NULL ELSE 'accepted' END
    WHERE id = NEW.triad_session_id;

    UPDATE public.triad_alternative_proposals
    SET status = 'superseded'
    WHERE triad_session_id = NEW.triad_session_id
      AND id != NEW.id
      AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_accept_alt_proposal
  BEFORE UPDATE ON public.triad_alternative_proposals
  FOR EACH ROW EXECUTE FUNCTION public.auto_accept_alternative_proposal();

-- ============================================================
-- 7. triad_reflections — RLS tightened to match the spec:
--    - no UPDATE/DELETE (locked after submit)
--    - cross-member visibility gated on ALL members having submitted
--    (Table shape itself is unchanged — already matched the fixed
--    6-question + satisfaction-rating design.)
-- ============================================================
DROP POLICY IF EXISTS "Triad reflections: user manage own" ON public.triad_reflections;
DROP POLICY IF EXISTS "Triad reflections: triad members view" ON public.triad_reflections;

CREATE POLICY "Triad reflections: own insert" ON public.triad_reflections
  FOR INSERT TO authenticated
  WITH CHECK (
    participant_id = auth.uid()
    AND public.has_programme_module('triads'::programme_module_type)
  );

CREATE POLICY "Triad reflections: own read" ON public.triad_reflections
  FOR SELECT TO authenticated
  USING (participant_id = auth.uid());

CREATE POLICY "Triad reflections: group read after all submit" ON public.triad_reflections
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.triad_sessions ts
      WHERE ts.id = triad_reflections.triad_session_id
        AND public.is_triad_member(ts.triad_group_id)
    )
    AND (
      SELECT COUNT(*) FROM public.triad_reflections tr2
      WHERE tr2.triad_session_id = triad_reflections.triad_session_id
    ) >= (
      SELECT CASE WHEN tg.member_3_id IS NULL THEN 2 ELSE 3 END
      FROM public.triad_groups tg
      JOIN public.triad_sessions ts2 ON ts2.triad_group_id = tg.id
      WHERE ts2.id = triad_reflections.triad_session_id
    )
  );
