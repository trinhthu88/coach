-- Learner navigation reads the same module set as canonical progress.
--
-- Two readers disagreed about which modules an enrollment has:
--
--   canonical progress   sponsor_canonical_module_schedule() -> enabled
--   (dashboard, admin,   programme_modules of the enrollment's programme
--    sponsor)
--   learner navigation   get_enrollment_programme_modules() -> rows in
--   (sidebar, module     enrollment_module_snapshots ONLY (the programme
--    route guards)       fallback was dropped in 20260922100000)
--
-- An enrollment inserted without generate_enrollment_schedule() (the demo seed
-- does this) has no snapshot, and a module added to a programme after its
-- enrollments were snapshotted (scripts/seed-training-content.sql adds
-- Training this way) is never snapshotted: generate_enrollment_schedule()
-- treats the first snapshot as immutable. In both cases the learner is
-- measured against a module whose navigation item, route and page they cannot
-- reach -- e.g. Training & Learning counted in "% complete" but missing from
-- the sidebar.
--
-- The enrolled programme's enabled modules are now the single answer to
-- "which modules does this learner have". The snapshot still supplies the
-- enrollment's frozen config where one exists (enrollment_module_config()
-- prefers it), so nothing a learner was promised changes.
--
-- Direction. The nav gates Coaching and Mentoring on config.receive, which
-- the Programme Builder never writes. A module the learner is REQUIRED to
-- complete is by definition one they receive, so a required module with
-- units implies receive = true unless the programme explicitly says false.

CREATE OR REPLACE FUNCTION public.get_enrollment_programme_modules(p_enrollment_id uuid)
RETURNS TABLE (module public.programme_module_type, enabled boolean, config jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH modules AS (
    SELECT pm.module,
      coalesce(public.enrollment_module_config(e.id, pm.module), '{}'::jsonb)
        - 'distribution_mode' AS config
    FROM public.programme_enrollments e
    JOIN public.programme_modules pm
      ON pm.programme_id = e.programme_id
     AND pm.enabled
    WHERE e.id = p_enrollment_id
      AND (e.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
  )
  SELECT m.module, true,
    CASE
      WHEN NOT (m.config ? 'receive')
       AND coalesce((m.config->>'required')::boolean, false)
       AND coalesce(public.programme_config_integer(m.config, 'required_units'), 0) > 0
        THEN m.config || jsonb_build_object('receive', true)
      ELSE m.config
    END
  FROM modules m
  ORDER BY m.module;
$$;

REVOKE ALL ON FUNCTION public.get_enrollment_programme_modules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_enrollment_programme_modules(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_enrollment_programme_modules(uuid) IS
  'Learner-facing module set: the enrolled programme''s enabled modules -- the '
  'same set canonical progress measures. Config prefers the enrollment snapshot.';
