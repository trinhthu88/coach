-- P1-8: all demo data lives in the repository (supabase/seed-demo.sql).
--
-- Production carries an out-of-band demo generator -- public.demo_* tables and
-- functions (demo_resource_registry, demo_operations, demo_apply_batch_*,
-- demo_seed_triads, demo_assert_batch_4_*, demo_delete_batch_4_owned_resources,
-- ...) -- defined nowhere in this repository (see
-- docs/architecture/source-of-truth-audit-2026-09-20.md, finding F). Its
-- inserts bypass the canonical chain (no cohort_requirement_id, no peer
-- participation attribution). This migration removes that capability:
--
--   1. Every public.demo_* FUNCTION is dropped (the insertion capability).
--      Without CASCADE: if anything still depends on one, the migration fails
--      loudly instead of silently removing the dependant.
--   2. Every public.demo_* TABLE is moved -- not dropped -- into a locked
--      demo_archive schema (no client grants), so the rows the generator
--      created in production stay identifiable for a deliberate cleanup.
--
-- Local / fresh databases have no demo_* objects: this is a no-op there.
-- Repository objects that merely mention demo resets (e.g.
-- triad_demo_reset_allows) do not start with 'demo_' and are untouched.

DO $retire_demo_generator$
DECLARE
  f record;
  t record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'demo\_%'
  LOOP
    EXECUTE format('DROP FUNCTION %s', f.sig);
    RAISE NOTICE 'Retired out-of-repo demo function %', f.sig::text;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname LIKE 'demo\_%' AND c.relkind IN ('r', 'p', 'v', 'm')
  ) THEN
    CREATE SCHEMA IF NOT EXISTS demo_archive;
    REVOKE ALL ON SCHEMA demo_archive FROM PUBLIC, anon, authenticated;
    FOR t IN
      SELECT c.relname, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname LIKE 'demo\_%' AND c.relkind IN ('r', 'p', 'v', 'm')
    LOOP
      EXECUTE format('ALTER %s public.%I SET SCHEMA demo_archive',
        CASE t.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END, t.relname);
      EXECUTE format('REVOKE ALL ON demo_archive.%I FROM PUBLIC, anon, authenticated', t.relname);
      RAISE NOTICE 'Archived out-of-repo demo relation % into demo_archive', t.relname;
    END LOOP;
  END IF;
END
$retire_demo_generator$;
