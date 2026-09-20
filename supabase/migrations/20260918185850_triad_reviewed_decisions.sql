-- ============================================================================
-- TRIAD CUTOVER — REVIEWED DECISIONS (between 20260918185800 and 20260918185900).
--
-- REAL/UNKNOWN Triad records that conflict with the canonical model, decided
-- by the product owner (2026-09-19). 20260918185900 archives every decided
-- group in full (group row incl. legacy slot membership, sessions incl.
-- legacy responses, reflections, proposals, evidence) and removes it.
--
-- fc234f05-c98a-465e-8122-9f32e35ecf33 — ARCHIVE + DELETE.
--   TASC currently requires no Triads (it is configured later through normal
--   programme configuration); one proposed session with no time; no member
--   responses; no reflections; one member enrollment has no cohort. Fixing
--   enrollment data only to preserve an invalid group would violate the
--   source of truth, so the enrollments and TASC stay unchanged.
--
-- Each decision is guarded: if the group has gained any history since the
-- review (a session with a time or beyond proposed, a response, a
-- reflection, an alternative, a goal check-in), the deployment stops.
-- ============================================================================

DO $$
DECLARE g uuid := 'fc234f05-c98a-465e-8122-9f32e35ecf33';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.triad_groups WHERE id = g) THEN
    RAISE NOTICE 'Triad reviewed decisions: group % no longer exists; nothing to decide', g;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.triad_sessions s
             WHERE s.triad_group_id = g
               AND (s.status <> 'proposed' OR coalesce(s.proposed_start_time, s.start_time) IS NOT NULL
                    OR coalesce(s.member_1_response, 'pending') <> 'pending'
                    OR coalesce(s.member_2_response, 'pending') <> 'pending'
                    OR coalesce(s.member_3_response, 'pending') <> 'pending'))
     OR (SELECT count(*) FROM public.triad_sessions s WHERE s.triad_group_id = g) <> 1
     OR EXISTS (SELECT 1 FROM public.triad_sessions s JOIN public.triad_reflections r ON r.triad_session_id = s.id WHERE s.triad_group_id = g)
     OR EXISTS (SELECT 1 FROM public.triad_sessions s JOIN public.triad_alternative_proposals p ON p.triad_session_id = s.id WHERE s.triad_group_id = g)
     OR EXISTS (SELECT 1 FROM public.triad_sessions s JOIN public.goal_checkins gc
                  ON gc.source_activity_type = 'triad' AND gc.source_activity_id = s.id WHERE s.triad_group_id = g) THEN
    RAISE EXCEPTION 'Triad reviewed decisions: group % changed since the review (it now has history); re-review before deleting it', g;
  END IF;

  INSERT INTO public.triad_cutover_review_decisions (triad_group_id, decision, reason, reviewed_by, migration_id)
  VALUES (g, 'delete',
    'TASC requires no Triads; one proposed session with no time; no responses; no reflections; member enrollment a9e6e762-850a-4541-bf05-73415f1e4a6c has no cohort. Enrollment data and TASC are not changed to preserve an invalid group.',
    'product owner (2026-09-19)', '20260918185850_triad_reviewed_decisions')
  ON CONFLICT (triad_group_id) DO NOTHING;
END $$;
