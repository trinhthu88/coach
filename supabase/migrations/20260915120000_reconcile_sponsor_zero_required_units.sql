-- Dead code removal. See 20260915100000_reconcile_sponsor_organisation_population.sql:
-- this migration patched public.sponsor_organisation_summary_legacy(), which
-- could never exist (it depends on public.sponsor_metric_rows(uuid, date),
-- never defined anywhere). pg_get_functiondef() on a nonexistent function
-- always failed at apply time, so this migration could never have succeeded
-- against any database. It has no callers; superseded by
-- public.sponsor_organisation_summary().
SELECT 1;
