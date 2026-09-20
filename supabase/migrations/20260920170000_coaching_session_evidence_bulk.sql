-- Bulk Coaching evidence reader (Coaching redesign, deployment 1).
--
-- coaching_session_evidence() answers for one session, which is right for a
-- session detail page but wrong for a list: the Admin Sessions table would
-- have to issue one round trip per row to show whether each held session has
-- become a completed programme unit.
--
-- This is the same computation over a set of sessions. It is deliberately a
-- thin wrapper rather than a second implementation -- duplicating the gate
-- logic here is exactly the parallel source of truth the redesign removes.

CREATE OR REPLACE FUNCTION public.coaching_session_evidence_bulk(p_session_ids uuid[])
RETURNS TABLE (
  session_id uuid,
  enrollment_id uuid,
  session_completed boolean,
  has_reflection boolean,
  has_goal_checkin boolean,
  has_action boolean,
  has_satisfaction boolean,
  goal_checkin_required boolean,
  unit_complete boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT e.*
  FROM unnest(coalesce(p_session_ids, ARRAY[]::uuid[])) AS s(id)
  CROSS JOIN LATERAL public.coaching_session_evidence(s.id) e;
$$;

REVOKE ALL ON FUNCTION public.coaching_session_evidence_bulk(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coaching_session_evidence_bulk(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.coaching_session_evidence_bulk(uuid[]) IS
  'coaching_session_evidence() over a set of sessions, for list views. Thin '
  'wrapper: the evidence rules live in one place only.';
