-- Coaching legacy retirement -- DEPLOYMENT 2. NOT APPLIED.
--
-- Held for separate approval after the deployment 1 Coaching architecture has
-- operated successfully in production, exactly as the Triad cutover held
-- 20260919190000_triad_retire_legacy.sql.
--
-- This file lives OUTSIDE supabase/migrations/ on purpose: `supabase db push`
-- cannot pick it up. Do not move it into the ordinary migration path as part
-- of a routine deploy.
--
-- Preconditions before this may run (verify, do not assume):
--   * deployment 1 (20260920100000 .. 20260920140000) live and verified;
--   * no frontend build references coach_session_feedback.quality_rating or
--     .engagement_level;
--   * no programme Coaching path reads coachee_coach_allowlist,
--     coach_as_coachee_allowlist, session_limits or coach_session_limits;
--   * scripts/coaching-canonical-verification.sql passes.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Section 24: retire Coach quality and engagement rating
-- ---------------------------------------------------------------------------
--
-- These asked the Coach to grade the learner. They are removed from the
-- product: not displayed, not collected, never an input to progress. The
-- escalation mechanism (flag_for_admin / flag_notes) is kept, and the Coach's
-- ordinary session note continues to live in coach_session_private_notes, so
-- there is exactly one Coach note system.
--
-- The values are archived before the columns are dropped; they are historical
-- observations about real people and are not silently destroyed.

CREATE TABLE IF NOT EXISTS public.coach_session_feedback_retired_ratings (
  session_id uuid PRIMARY KEY,
  coach_id uuid,
  quality_rating smallint,
  engagement_level text,
  archived_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.coach_session_feedback_retired_ratings IS
  'Archive of coach_session_feedback.quality_rating / engagement_level, '
  'retired 2026 by the Coaching redesign. Historical record only: nothing '
  'reads this at runtime and it must never feed progress.';

INSERT INTO public.coach_session_feedback_retired_ratings
  (session_id, coach_id, quality_rating, engagement_level)
SELECT f.session_id, f.coach_id, f.quality_rating, f.engagement_level
FROM public.coach_session_feedback f
WHERE f.quality_rating IS NOT NULL OR f.engagement_level IS NOT NULL
ON CONFLICT (session_id) DO NOTHING;

ALTER TABLE public.coach_session_feedback
  DROP COLUMN IF EXISTS quality_rating,
  DROP COLUMN IF EXISTS engagement_level;

COMMENT ON TABLE public.coach_session_feedback IS
  'Coach escalation for a session (flag_for_admin / flag_notes). Quality and '
  'engagement ratings were retired by the Coaching redesign. Coach session '
  'notes belong in coach_session_private_notes.';

-- ---------------------------------------------------------------------------
-- 2. Section 4: forbid the learner-level allowlists as programme Coaching authority
-- ---------------------------------------------------------------------------
--
-- The tables are NOT dropped. RULES.md section 3 documents live non-programme
-- relationships that still depend on them (coach-as-coachee, peer practice),
-- and section 39 forbids deleting data merely because a new architecture
-- supersedes it. What is removed is their authority over PROGRAMME Coaching.
--
-- The INSERT policy that required a coachee_coach_allowlist match for a
-- programme Coaching session is replaced by the cohort Coach pool, which
-- validate_coaching_session_requirement() and book_coaching_session() already
-- enforce.

DROP POLICY IF EXISTS "Sessions: coachee create own" ON public.sessions;

CREATE POLICY "Sessions: coachee create own"
  ON public.sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    coachee_id = auth.uid()
    AND public.has_role(auth.uid(), 'coachee'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.programme_enrollments e
      CROSS JOIN LATERAL public.cohort_coaching_coach_pool(e.cohort_id) p
      WHERE e.id = sessions.enrollment_id
        AND e.user_id = auth.uid()
        AND p.coach_id = sessions.coach_id
    )
  );

COMMENT ON TABLE public.coachee_coach_allowlist IS
  'HISTORICAL COMPATIBILITY ONLY for programme Coaching as of the 2026 '
  'Coaching redesign: programme Coaching eligibility is cohort_coach_assignments. '
  'Still authoritative for the non-programme relationships in RULES.md section 3.';

-- ---------------------------------------------------------------------------
-- 3. Section 41: session_limits must not gate programme Coaching
-- ---------------------------------------------------------------------------
--
-- Programme Coaching quantity comes from programme_modules.required_units via
-- the cohort requirement dates, not from a per-person lifetime cap. The cap
-- tables stay for the non-programme flows that still use them.

COMMENT ON TABLE public.session_limits IS
  'HISTORICAL COMPATIBILITY ONLY for programme Coaching as of the 2026 '
  'Coaching redesign: programme Coaching quantity is the cohort requirement '
  'count, not a per-person lifetime cap.';
COMMENT ON TABLE public.coach_session_limits IS
  'HISTORICAL COMPATIBILITY ONLY for programme Coaching as of the 2026 '
  'Coaching redesign. See session_limits.';

COMMIT;
