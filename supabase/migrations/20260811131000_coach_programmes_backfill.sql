-- Seed the default "Free" coach programme using today's global defaults, then
-- auto-enroll every existing coach. Coaches who currently have a per-coach override
-- row in coach_session_limits (coach_user_id IS NOT NULL, as opposed to the single
-- coach_user_id IS NULL global-default row) get their own coach-specific programme
-- that preserves their existing monthly_limit/peer_monthly_limit values, and are
-- enrolled into that instead of Free.
--
-- client_coaching_limit and peer_given_limit are NULL (unlimited) on every programme
-- created here, including the per-coach custom ones, because nothing enforced those
-- two dimensions before this migration — there is no prior value to preserve.

DO $$
DECLARE
  free_id uuid;
  r RECORD;
  new_prog_id uuid;
BEGIN
  INSERT INTO public.coach_programmes
    (name, description, color, is_active,
     client_coaching_limit, mentee_sessions_limit, peer_given_limit, peer_received_limit)
  VALUES
    ('Free',
     'Default coach programme — mirrors the pre-existing global coach_session_limits defaults.',
     'cobalt', true,
     NULL, 4, NULL, 4)
  ON CONFLICT (name) DO NOTHING;

  SELECT id INTO free_id FROM public.coach_programmes WHERE name = 'Free';

  FOR r IN
    SELECT csl.coach_user_id, csl.monthly_limit, csl.peer_monthly_limit, p.full_name
    FROM public.coach_session_limits csl
    LEFT JOIN public.profiles p ON p.id = csl.coach_user_id
    WHERE csl.coach_user_id IS NOT NULL
  LOOP
    INSERT INTO public.coach_programmes
      (name, description, color, is_active,
       client_coaching_limit, mentee_sessions_limit, peer_given_limit, peer_received_limit)
    VALUES (
      'Custom — ' || COALESCE(r.full_name, 'Coach') || ' (' || left(r.coach_user_id::text, 8) || ')',
      'Migrated from this coach''s individual coach_session_limits override row.',
      'gold', true,
      NULL, r.monthly_limit, NULL, r.peer_monthly_limit
    )
    RETURNING id INTO new_prog_id;

    INSERT INTO public.coach_programme_enrollments (coach_id, coach_programme_id, start_date, status)
    VALUES (r.coach_user_id, new_prog_id, CURRENT_DATE, 'active'::public.enrollment_status)
    ON CONFLICT (coach_id) DO NOTHING;
  END LOOP;

  -- Every remaining coach (role = 'coach', no personal override row, not yet enrolled
  -- by the loop above) goes into the default Free programme.
  INSERT INTO public.coach_programme_enrollments (coach_id, coach_programme_id, start_date, status)
  SELECT ur.user_id, free_id, CURRENT_DATE, 'active'::public.enrollment_status
  FROM public.user_roles ur
  WHERE ur.role = 'coach'::public.app_role
    AND NOT EXISTS (
      SELECT 1 FROM public.coach_programme_enrollments cpe WHERE cpe.coach_id = ur.user_id
    )
  ON CONFLICT (coach_id) DO NOTHING;
END $$;
