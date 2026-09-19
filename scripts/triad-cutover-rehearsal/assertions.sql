-- Assertions after deployment 1 ran on fixture.sql (same transaction).
DO $$
DECLARE v text; n integer;
  FUNCTION_ERR text;
BEGIN
  -- I: the accidental duplicate is removed (archived); the legitimate session stays.
  IF NOT EXISTS (SELECT 1 FROM public.triad_cutover_archive WHERE object_name = 'cleanup.triad_sessions' AND record_id = '29000000-2222-4222-8222-0000000000d2')
     OR EXISTS (SELECT 1 FROM public.triad_sessions WHERE id = '29000000-2222-4222-8222-0000000000d2')
     OR NOT EXISTS (SELECT 1 FROM public.triad_sessions WHERE id = '29000000-2222-4222-8222-0000000000d1') THEN
    RAISE EXCEPTION 'I: duplicate demo session not cleaned correctly';
  END IF;
  SELECT row(raw_completed_sessions, completed_units)::text INTO v FROM public.canonical_triad_completion('e9000000-0000-0000-0000-000000000001');
  IF v <> '(1,1)' THEN RAISE EXCEPTION 'I: demo learner after cleanup expected (1,1), got %', v; END IF;

  -- DEMO/SEED conflicting group removed and archived with its future reflection.
  IF EXISTS (SELECT 1 FROM public.triad_groups WHERE id = 'f9000000-0000-0000-0000-00000000a001')
     OR NOT EXISTS (SELECT 1 FROM public.triad_cutover_archive WHERE object_name = 'cleanup.triad_groups' AND record_id = 'f9000000-0000-0000-0000-00000000a001')
     OR NOT EXISTS (SELECT 1 FROM public.triad_cutover_archive WHERE object_name = 'cleanup.triad_reflections' AND record_id = 'f9000000-0000-0000-0000-00000000a021') THEN
    RAISE EXCEPTION 'DEMO/SEED TASC-like group not removed / archived';
  END IF;

  -- REAL data preserved: groups, members, sessions, statuses, times, reflections.
  SELECT count(*) INTO n FROM public.triad_groups WHERE id IN ('19000000-1111-4111-8111-0000000000a0', '19000000-1111-4111-8111-0000000000a1', '19000000-1111-4111-8111-0000000000b0');
  IF n <> 3 THEN RAISE EXCEPTION 'real groups lost (% of 3)', n; END IF;
  SELECT string_agg(enrollment_id::text, ',' ORDER BY member_order) INTO v FROM public.triad_group_members WHERE triad_group_id = '19000000-1111-4111-8111-0000000000a1';
  IF v <> 'e9000000-0000-0000-0000-000000000004,e9000000-0000-0000-0000-000000000005,e9000000-0000-0000-0000-000000000006' THEN
    RAISE EXCEPTION 'GR membership not the legacy slot enrollments: %', v;
  END IF;
  IF (SELECT status FROM public.triad_sessions WHERE id = '29000000-2222-4222-8222-0000000000a2') <> 'confirmed' THEN
    RAISE EXCEPTION 'confirmed session status changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.triad_reflection_answers a JOIN public.triad_reflection_questions q ON q.id = a.question_id
                 WHERE a.triad_reflection_id = '39000000-3333-4333-8333-0000000000a1' AND q.question_key = 'learned_as_coach' AND a.answer_text = 'Silence helps') THEN
    RAISE EXCEPTION 'legacy reflection answer not preserved';
  END IF;

  -- One active group per enrollment: the older legacy group is closed, its session stays history.
  IF (SELECT is_active FROM public.triad_groups WHERE id = '19000000-1111-4111-8111-0000000000a0')
     OR NOT (SELECT is_active FROM public.triad_groups WHERE id = '19000000-1111-4111-8111-0000000000a1') THEN
    RAISE EXCEPTION 'older legacy group should be closed, newer active';
  END IF;

  -- G: old group session + new group session -> 2/2; others 1/2.
  SELECT string_agg(e || '=' || c.completed_units || '/' || c.required_units, ' ' ORDER BY e) INTO v
  FROM unnest(ARRAY['e9000000-0000-0000-0000-000000000004', 'e9000000-0000-0000-0000-000000000005', 'e9000000-0000-0000-0000-000000000007']::uuid[]) e
  CROSS JOIN LATERAL public.canonical_triad_completion(e) c;
  IF v <> 'e9000000-0000-0000-0000-000000000004=2/2 e9000000-0000-0000-0000-000000000005=1/2 e9000000-0000-0000-0000-000000000007=1/2' THEN
    RAISE EXCEPTION 'G: completion across a group change wrong: %', v;
  END IF;
  -- H: two genuine sessions at the same time both count.
  SELECT row(raw_completed_sessions, completed_units)::text INTO v FROM public.canonical_triad_completion('e9000000-0000-0000-0000-000000000008');
  IF v <> '(2,2)' THEN RAISE EXCEPTION 'H: genuine same-time sessions expected (2,2), got %', v; END IF;

  -- Evidence is session evidence only.
  IF EXISTS (SELECT 1 FROM public.session_activity_attributions WHERE source_activity_type = 'triad' AND milestone_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Triad evidence still linked to a requirement milestone';
  END IF;
  RAISE NOTICE 'Triad cutover rehearsal: all assertions passed';
END $$;
