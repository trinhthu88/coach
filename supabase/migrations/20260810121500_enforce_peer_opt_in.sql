-- Phase 2: enforce relationship 3 (coach-to-coach peer coaching) opt-in at the RLS level.
--
-- Confirmed before writing this: the only INSERT policy on `public.peer_sessions` is
-- "Peer sessions: peer-coachee create own" (peer_coachee_id = auth.uid() AND
-- has_role(auth.uid(),'coach')). It never checks that the target peer_coach_id has
-- opted in to peer coaching (coach_profiles.peer_coaching_opt_in). Unlike relationships
-- 1 and 2, this relationship is intentionally an open pool — any opted-in coach should
-- be bookable by any other opted-in coach — so this migration adds only the opt-in
-- check, not an allowlist/pair check.

DROP POLICY IF EXISTS "Peer sessions: peer-coachee create own" ON public.peer_sessions;

CREATE POLICY "Peer sessions: peer-coachee create own"
  ON public.peer_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    peer_coachee_id = auth.uid()
    AND public.has_role(auth.uid(), 'coach'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.coach_profiles cp
      WHERE cp.id = peer_sessions.peer_coach_id AND cp.peer_coaching_opt_in = true
    )
  );
