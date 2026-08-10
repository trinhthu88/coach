-- Phase 1: enforce relationship-curated pairing at the RLS level for `sessions` INSERT.
--
-- Confirmed before writing this: the only INSERT policy that has ever existed on
-- `public.sessions` is "Sessions: coachee create own" (coachee_id = auth.uid() AND
-- has_role(auth.uid(),'coachee')). There has never been an INSERT policy covering a
-- coach-role user booking themselves as coachee_id (the coach-as-coachee / mentoring
-- flow). Under RLS default-deny, that means CoachFindCoach.tsx -> BookSession.tsx's
-- direct `supabase.from("sessions").insert(...)` call for that flow is rejected by
-- Postgres today (42501) for every coach, every time — this relationship is currently
-- broken, not just unenforced. This migration both tightens relationship 1 and adds
-- the missing policy for relationship 2.

-- 1) Coachee -> coach: also require the pair to exist in coachee_coach_allowlist.
DROP POLICY IF EXISTS "Sessions: coachee create own" ON public.sessions;

CREATE POLICY "Sessions: coachee create own"
  ON public.sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    coachee_id = auth.uid()
    AND public.has_role(auth.uid(), 'coachee'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.coachee_coach_allowlist a
      WHERE a.coachee_id = auth.uid() AND a.coach_id = sessions.coach_id
    )
  );

-- 2) Coach-as-coachee: a coach may book a session with a mentor coach only if that
--    pair exists in coach_as_coachee_allowlist.
CREATE POLICY "Sessions: coach create as coachee"
  ON public.sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    coachee_id = auth.uid()
    AND public.has_role(auth.uid(), 'coach'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.coach_as_coachee_allowlist al
      WHERE al.coach_user_id = auth.uid() AND al.selectable_coach_id = sessions.coach_id
    )
  );
