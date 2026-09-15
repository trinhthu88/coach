-- Dead code removal. See 20260915100000_reconcile_sponsor_organisation_population.sql:
-- this migration re-created the same never-viable
-- public.sponsor_organisation_summary_legacy(), which depends on
-- public.sponsor_metric_rows(uuid, date) — a function that was never defined
-- anywhere in this history. The CREATE FUNCTION always failed at apply time,
-- so this migration could never have succeeded against any database. It has
-- no callers; superseded by public.sponsor_organisation_summary().
SELECT 1;
