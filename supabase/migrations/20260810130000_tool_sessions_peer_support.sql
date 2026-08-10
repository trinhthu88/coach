-- Allow tool_sessions (Wheel of Life / GROW worksheet fills) to attach to either
-- a regular client-coaching session (public.sessions) or a peer coaching session
-- (public.peer_sessions). Previously session_id was NOT NULL and only referenced
-- public.sessions, so SessionDetail.tsx had to hard-disable the toolbox for peer
-- sessions (showToolbox = !isPeer && ...) since there was nowhere to store a fill.
--
-- Confirmed before writing this: tool_sessions was defined once (never altered
-- since), has 0 rows on the remote project, and can_message_session is the only
-- existing "is this user allowed to touch this session" helper — mirrored here
-- for peer_sessions.

-- 1) session_id becomes optional
ALTER TABLE public.tool_sessions ALTER COLUMN session_id DROP NOT NULL;

-- 2) new optional peer_session_id
ALTER TABLE public.tool_sessions
  ADD COLUMN peer_session_id uuid REFERENCES public.peer_sessions(id) ON DELETE CASCADE;

-- 3) exactly one of the two parents must be set
ALTER TABLE public.tool_sessions
  ADD CONSTRAINT tool_sessions_one_parent
  CHECK (((session_id IS NOT NULL)::int + (peer_session_id IS NOT NULL)::int) = 1);

-- 4) replace the single unique index with one partial unique index per parent
--    (a plain multi-column unique index doesn't dedupe correctly once one of the
--    two columns is always NULL — NULLs are never considered equal in Postgres).
DROP INDEX IF EXISTS public.tool_sessions_unique_fill;

CREATE UNIQUE INDEX tool_sessions_unique_fill_session
  ON public.tool_sessions (session_id, tool_type, filled_by)
  WHERE session_id IS NOT NULL;

CREATE UNIQUE INDEX tool_sessions_unique_fill_peer_session
  ON public.tool_sessions (peer_session_id, tool_type, filled_by)
  WHERE peer_session_id IS NOT NULL;

-- 5) peer_sessions counterpart of can_message_session
CREATE OR REPLACE FUNCTION public.can_message_peer_session(_peer_session_id uuid, _user_id uuid)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.peer_sessions ps
    WHERE ps.id = _peer_session_id
      AND (ps.peer_coach_id = _user_id OR ps.peer_coachee_id = _user_id)
      AND ps.status IN ('confirmed','completed')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_message_peer_session(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_message_peer_session(uuid, uuid) TO authenticated;

-- 6) RLS: participant policies now accept either parent; admin-manage is untouched.
DROP POLICY IF EXISTS "Tools: participants view session tools" ON public.tool_sessions;
CREATE POLICY "Tools: participants view session tools"
  ON public.tool_sessions FOR SELECT TO authenticated
  USING (
    (session_id IS NOT NULL AND can_message_session(session_id, auth.uid()))
    OR (peer_session_id IS NOT NULL AND can_message_peer_session(peer_session_id, auth.uid()))
  );

DROP POLICY IF EXISTS "Tools: participants insert own" ON public.tool_sessions;
CREATE POLICY "Tools: participants insert own"
  ON public.tool_sessions FOR INSERT TO authenticated
  WITH CHECK (
    filled_by = auth.uid()
    AND (
      (session_id IS NOT NULL AND can_message_session(session_id, auth.uid()))
      OR (peer_session_id IS NOT NULL AND can_message_peer_session(peer_session_id, auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Tools: participants update own" ON public.tool_sessions;
CREATE POLICY "Tools: participants update own"
  ON public.tool_sessions FOR UPDATE TO authenticated
  USING (
    filled_by = auth.uid()
    AND (
      (session_id IS NOT NULL AND can_message_session(session_id, auth.uid()))
      OR (peer_session_id IS NOT NULL AND can_message_peer_session(peer_session_id, auth.uid()))
    )
  )
  WITH CHECK (
    filled_by = auth.uid()
    AND (
      (session_id IS NOT NULL AND can_message_session(session_id, auth.uid()))
      OR (peer_session_id IS NOT NULL AND can_message_peer_session(peer_session_id, auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Tools: participants delete own" ON public.tool_sessions;
CREATE POLICY "Tools: participants delete own"
  ON public.tool_sessions FOR DELETE TO authenticated
  USING (
    filled_by = auth.uid()
    AND (
      (session_id IS NOT NULL AND can_message_session(session_id, auth.uid()))
      OR (peer_session_id IS NOT NULL AND can_message_peer_session(peer_session_id, auth.uid()))
    )
  );
