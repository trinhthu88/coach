-- FULL MIGRATION LEDGER AUDIT (READ-ONLY). Step 0 of the Triad
-- requirement-group correction; re-run unchanged as step 3 after B3.
--
--   psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/ledger/full-ledger-audit.sql
--
-- Compares every repository migration against every row of the production
-- ledger (supabase_migrations.schema_migrations) and classifies each one:
--
--   applied             ledger holds the repository version
--   applied_as_renamed  ledger holds a KNOWN raw-path version instead (B3)
--   pending             not in the ledger, schema not live  -> safe to apply
--   PENDING_BUT_LIVE    not in the ledger but the schema IS live. `supabase
--                       db push` would REPLAY SQL that is already in
--                       production. Reconcile the ledger; never replay.
--   pending_unprobed    not in the ledger, no liveness probe defined
--
-- Nothing is written: one statement, inside a READ ONLY transaction, so any
-- accidental write aborts rather than taking effect. It therefore uses no
-- temp tables and no DO blocks (both are barred in a read-only transaction).
--
-- Every liveness probe is a CATALOG-ONLY expression (to_regclass, pg_proc,
-- pg_attribute). A probe must never name a possibly-missing table directly:
-- PostgreSQL resolves such a reference at parse time and would abort the
-- whole audit under ON_ERROR_STOP=1.
--
-- The repo manifest below is generated from supabase/migrations/ and kept in
-- sync by src/test/fullLedgerAudit.test.ts. Regenerate with:
--   bash scripts/ledger/regenerate-audit-manifest.sh

BEGIN TRANSACTION READ ONLY;

WITH repo(version, name) AS (VALUES
-- BEGIN REPO MANIFEST (generated — do not edit by hand)
  ('20260429193745', 'e21d37ae-33cc-48c3-ae31-d0080559210a'),
  ('20260429193811', 'f047953a-07fe-4861-8b30-3108859b2772'),
  ('20260429193831', 'baa3659e-496d-409a-9f85-2cdd9f7cd6ca'),
  ('20260429200449', '2c0be3f0-6d5c-47fb-bdfe-67523a26e078'),
  ('20260429210100', 'ee0c605e-d487-4975-8832-22e5a306ffba'),
  ('20260429210119', 'b0d207e6-8af1-456f-a7cf-35fcea2c696b'),
  ('20260429212627', '2efa6436-81fe-4cb1-bc7b-59f64e99d470'),
  ('20260429212650', '4375320c-2649-43ea-abdc-ef797543e005'),
  ('20260429212714', '16208ada-7341-480e-a96d-8bce2039b800'),
  ('20260430092124', '87e0b976-02eb-454f-8c68-55850c6fc3e6'),
  ('20260430100320', '28c3ad01-b3d0-49ba-82c9-0f0119ed90e1'),
  ('20260430100615', '92a5d357-8203-498b-a473-8931bda60e11'),
  ('20260430110754', '1bea9ac8-e19d-40ad-853d-df2e4a26a507'),
  ('20260430115945', '0366d639-aedd-4340-b5ac-35dc33cf10cb'),
  ('20260430130143', 'bb8ce17a-a56a-472a-9670-3c5a6b3357ac'),
  ('20260430143232', 'd5315a49-285e-48d4-ae83-a466f8abde09'),
  ('20260430144449', 'f6785c9d-d8bc-4654-b97a-28122e5a0492'),
  ('20260430145056', 'b2d2a808-6268-4a3a-a7c8-03ffc0a79235'),
  ('20260430154641', 'c64f5bc2-82bb-4fbe-b92b-a05b49d3ebff'),
  ('20260430171032', '639b7f02-8319-4b5e-8f8a-6d9dd8e631c4'),
  ('20260430172516', '9c6dc92e-63d1-4b6c-bae9-df6bdfe0821b'),
  ('20260430181819', '04730754-1f87-4cb4-b87d-1f533bce083d'),
  ('20260430183307', 'b37d2fca-e290-4964-833d-f7a65cbaf2d2'),
  ('20260430195858', '2e45e8ae-30bb-441c-a1aa-82137b46574c'),
  ('20260430201457', 'b22758a8-92eb-4d44-912b-4661186d1e1e'),
  ('20260501105315', 'd628b159-b57e-4487-ae90-0efe3ee3f5e5'),
  ('20260501140432', '99b606a7-16a9-4758-b830-5a31942089d5'),
  ('20260501185440', '5c98a33c-2e77-40f2-95f2-a53a6de762ad'),
  ('20260501190702', 'b0bc0db9-89be-403d-a182-d3ce120d351b'),
  ('20260501191113', 'c5d7fbcc-36e3-4d7d-99cf-62e19b277e54'),
  ('20260501205544', 'bfd6d289-aee5-44eb-b41e-3bdc539c3202'),
  ('20260501213615', '4de91e3d-c91f-4a63-a199-9b0302676050'),
  ('20260807203836', '8f56ec94-f5d6-4a0d-b86b-ef2f7cc760df'),
  ('20260807211209', '7c72efbe-2cb0-48e1-a591-564a695cf74f'),
  ('20260810120000', 'enforce_session_allowlists'),
  ('20260810121500', 'enforce_peer_opt_in'),
  ('20260810123000', 'fix_peer_usage_lifetime'),
  ('20260810130000', 'tool_sessions_peer_support'),
  ('20260810140000', 'prevent_double_booking_slot_race'),
  ('20260810150000', 'can_book_session_rpc'),
  ('20260811100000', 'add_sponsor_role'),
  ('20260811100100', 'sponsor_schema'),
  ('20260811110000', 'sponsor_aggregate_functions'),
  ('20260811111500', 'fix_duplicate_global_session_limits'),
  ('20260811120000', 'fix_duplicate_programmes'),
  ('20260811130000', 'coach_programmes_schema'),
  ('20260811131000', 'coach_programmes_backfill'),
  ('20260811132000', 'coach_programmes_enforcement'),
  ('20260812170000', 'allow_reapply_after_deletion'),
  ('20260814080000', 'coach_invite_limits'),
  ('20260814090000', 'coach_invite_slot_usage_rpc'),
  ('20260814100000', 'bulk_invite_batches'),
  ('20260814110000', 'bulk_invite_batches_created_by_set_null'),
  ('20260816090000', 'coachee_allowlist_source'),
  ('20260816120000', 'onboarding_completed_at'),
  ('20260817090000', 'preferred_language'),
  ('20260818120000', 'peer_session_attachments'),
  ('20260818130000', 'user_module_access'),
  ('20260818130100', 'has_module_access_rpc'),
  ('20260818140000', 'availability_slot_type_add_mentoring'),
  ('20260818140100', 'mentor_profiles'),
  ('20260818140200', 'mentoring_allowlist'),
  ('20260818140300', 'can_book_mentoring_session_rpc'),
  ('20260818140400', 'mentoring_sessions'),
  ('20260818140500', 'mentoring_feedback'),
  ('20260818140600', 'mentoring_prep_files_storage'),
  ('20260818150000', 'mentoring_get_my_mentors'),
  ('20260830120000', 'mentoring_session_limits_schema'),
  ('20260830120100', 'can_book_mentoring_session_limits'),
  ('20260830130000', 'mentoring_profiles_visibility'),
  ('20260830130100', 'mentoring_coach_profiles_visibility'),
  ('20260830140000', 'coachee_peer_coaching_schema'),
  ('20260830150000', 'fix_enrollment_cardinality'),
  ('20260903100000', 'programme_modules'),
  ('20260903100100', 'unify_enrollments'),
  ('20260903100200', 'user_programme_modules_rpc'),
  ('20260903100300', 'update_sponsor_functions_user_id'),
  ('20260903110000', 'training_weeks'),
  ('20260903110100', 'skill_card_elements'),
  ('20260903110200', 'training_progress'),
  ('20260903110250', 'training_pdfs_storage'),
  ('20260903110260', 'get_my_training_weeks_rpc'),
  ('20260903110300', 'notifications'),
  ('20260903120000', 'assignments'),
  ('20260903120100', 'quiz_questions'),
  ('20260903120200', 'assignment_submissions'),
  ('20260903120300', 'daily_prompts'),
  ('20260903120400', 'daily_prompt_responses'),
  ('20260903120500', 'get_todays_prompt_rpc'),
  ('20260903130000', 'triad_groups'),
  ('20260903130100', 'triad_sessions'),
  ('20260903130200', 'triad_reflections'),
  ('20260903130300', 'triad_session_booked_notify'),
  ('20260903130400', 'sponsor_reports_storage'),
  ('20260903140000', 'sponsor_programme_aggregates'),
  ('20260903150000', 'enforce_must_change_password'),
  ('20260904100000', 'quiz_submission_integrity'),
  ('20260904400000', 'profile_spoken_languages'),
  ('20260905100000', 'training_weeks_video_url'),
  ('20260905100100', 'drop_skill_card_elements'),
  ('20260905100200', 'programme_reflections'),
  ('20260905100300', 'migrate_reflection_data'),
  ('20260905100400', 'remove_prompt_confidence'),
  ('20260905100500', 'flexible_daily_prompts'),
  ('20260905100600', 'remove_sponsor_top_reflections'),
  ('20260905100700', 'sponsor_engagement_no_confidence'),
  ('20260905200000', 'sponsor_reflection_completion'),
  ('20260905200100', 'skill_card_visibility'),
  ('20260905200200', 'training_weeks_rpc_skill_card_visible'),
  ('20260906120000', 'triad_redesign'),
  ('20260906130000', 'fix_triad_session_booked_notify'),
  ('20260907120000', 'seed_tasc_essential_course'),
  ('20260907140000', 'sponsor_contact_admin_alerts'),
  ('20260907150000', 'coach_session_feedback'),
  ('20260907160000', 'dashboard_summary_rpc'),
  ('20260908090000', 'seed_tasc_practice_growth_data'),
  ('20260908100000', 'cohort_organization_id'),
  ('20260908110000', 'sponsor_visibility_cohort_fallback'),
  ('20260908130000', 'extend_organizations'),
  ('20260908140000', 'sponsor_settings_schema'),
  ('20260908150000', 'sponsor_dashboard_v2_rpcs'),
  ('20260908160000', 'seed_erickson_vn_cohort'),
  ('20260909043650', 'sponsor_rpc_cohort_filter'),
  ('20260910100000', 'cohort_week_overrides'),
  ('20260910110000', 'triad_cohort_scope'),
  ('20260910120000', 'fix_sponsor_programme_engagement'),
  ('20260910130000', 'auto_progress_pct'),
  ('20260910140000', 'fix_on_track_semantics'),
  ('20260910150000', 'enrollment_scoped_core'),
  ('20260910161000', 'enrollment_activity_ownership'),
  ('20260910170000', 'enrollment_schedule_progress'),
  ('20260910170500', 'enrollment_training_reader'),
  ('20260910171000', 'enrollment_goal_checkins'),
  ('20260910172000', 'enrollment_actions_cutover'),
  ('20260910173000', 'enrollment_sponsor_reporting'),
  ('20260910174000', 'enrollment_schedule_backfill'),
  ('20260910174100', 'admin_enrollment_transition'),
  ('20260911120000', 'sponsor_organisation_summary'),
  ('20260911130000', 'enrollment_aware_booking'),
  ('20260911140000', 'retire_legacy_reporting_rpcs'),
  ('20260911141000', 'admin_enrollment_progress'),
  ('20260911150000', 'final_privacy_and_peer_booking'),
  ('20260911160000', 'enrollment_scoped_coaching_usage'),
  ('20260911170000', 'fix_schedule_and_checkin_replay'),
  ('20260911180000', 'resolve_clear_enrollment_backfill'),
  ('20260911190000', 'retire_unresolved_historical_ownership'),
  ('20260911200000', 'final_enrollment_scoped_enforcement'),
  ('20260914071301', 'repair_auth_user_nullable_fields'),
  ('20260914071400', 'p0_session_remediation'),
  ('20260914071401', 'admin_current_enrollment_resolver'),
  ('20260914071402', 'selected_enrollment_readers'),
  ('20260914071403', 'canonical_coach_eligibility'),
  ('20260914071404', 'authoritative_module_limits'),
  ('20260914071405', 'activity_cadence_attribution'),
  ('20260914071406', 'sponsor_report_requests'),
  ('20260914071407', 'admin_atomic_coach_update'),
  ('20260914100000', 'fix_activity_trigger_record_fields'),
  ('20260914110000', 'skip_reflection_activity_attribution'),
  ('20260914120000', 'fix_assignment_trigger_field_guard'),
  ('20260914130000', 'separate_progress_cadence_status'),
  ('20260914140000', 'scope_progress_activity_unions'),
  ('20260914150000', 'bound_booked_progress_units'),
  ('20260915100000', 'reconcile_sponsor_organisation_population'),
  ('20260915110000', 'reconcile_sponsor_visible_cohort_population'),
  ('20260915120000', 'reconcile_sponsor_zero_required_units'),
  ('20260915130000', 'backfill_clariva_demo_activity_attributions'),
  ('20260915150000', 'sponsor_cohort_dates'),
  ('20260915155000', 'sponsor_programme_progress_source'),
  ('20260915160000', 'sponsor_module_reconciliation'),
  ('20260915170000', 'sponsor_organisation_canonical_requirements'),
  ('20260915180000', 'completed_cohort_status_lifecycle'),
  ('20260915190000', 'fix_sponsor_peer_coaching_double_count'),
  ('20260916100000', 'sponsor_canonical_contract'),
  ('20260916110000', 'sponsor_journey_reconciliation'),
  ('20260916112000', 'sponsor_journey_checkpoint_as_of'),
  ('20260916113000', 'evenly_schedule_baseline'),
  ('20260916140000', 'sponsor_canonical_admin_activity_spine'),
  ('20260916141000', 'restore_sponsor_journey_execute'),
  ('20260917100000', 'sponsor_leader_detail_contract'),
  ('20260917110000', 'sponsor_leader_experience_contract'),
  ('20260917120000', 'sponsor_cohort_calendar_truth'),
  ('20260917130000', 'sponsor_final_canonical_contract'),
  ('20260917140000', 'learner_canonical_self_view'),
  ('20260917150000', 'sponsor_cohort_progress_rollup_performance'),
  ('20260917160000', 'sponsor_requirement_capped_progress'),
  ('20260917170000', 'sponsor_leader_next_booking'),
  ('20260917171000', 'sponsor_leader_next_booking_fast'),
  ('20260917172000', 'sponsor_leader_experience_fast_path'),
  ('20260917173000', 'sponsor_leader_experience_direct_path'),
  ('20260917180000', 'canonical_training_learning_progress'),
  ('20260917181000', 'backfill_training_child_selection'),
  ('20260917190000', 'coachee_reflections_enrollment_scope'),
  ('20260918090000', 'sponsor_canonical_calendar_followup'),
  ('20260918120000', 'canonical_enrollment_engagement'),
  ('20260918130000', 'learner_session_history_and_reflection_feed'),
  ('20260918140000', 'learner_triad_members'),
  ('20260918160000', 'cohort_requirement_schedule'),
  ('20260918170000', 'single_source_of_truth'),
  ('20260918180000', 'retire_legacy_sponsor_sources'),
  ('20260918185800', 'triad_cutover_ledgers'),
  ('20260918185850', 'triad_reviewed_decisions'),
  ('20260918185900', 'triad_legacy_data_cleanup'),
  ('20260918189000', 'demo_generator_triad_model'),
  ('20260918190000', 'triad_canonical_cutover'),
  ('20260918195000', 'canonical_engagement_signals'),
  ('20260919120000', 'triad_requirement_groups')
-- END REPO MANIFEST
),

-- Ten repository migrations reached production under different version
-- numbers; their schema equivalence to a fresh repo replay was audited on
-- 2026-09-19. See scripts/ledger/b3_migration_version_reconciliation.sql.
renamed(prod_version, repo_version) AS (VALUES
  ('20260917152126', '20260917160000'),
  ('20260917153800', '20260917170000'),
  ('20260917154057', '20260917171000'),
  ('20260917154321', '20260917172000'),
  ('20260917154647', '20260917173000'),
  ('20260917163735', '20260917180000'),
  ('20260917164325', '20260917181000'),
  ('20260918134552', '20260917190000'),
  ('20260918134617', '20260918130000'),
  ('20260918141631', '20260918140000')
),

-- Liveness probes for the Triad correction chain. 20260918185850 inserts
-- review-decision rows and creates no object, so it has no catalog probe.
--
-- Two probes read 'absent' on a database that is AHEAD of production, which
-- is expected and not a fault of the probe:
--   * 20260918185900 probes triad_is_seed_identifier(), which DEPLOYMENT 2
--     drops. Production has not had deployment 2, so it reads 'live' there.
--   * 20260918189000 probes the demo_* generator, which exists only on
--     hosted production, so it reads 'absent' on every local database.
-- Neither affects classification while the ledger row is present; the probes
-- exist to catch the PENDING_BUT_LIVE case, where the row is missing.
live(version, is_live) AS (VALUES
  ('20260918185800', to_regclass('public.triad_cutover_archive') IS NOT NULL
                 AND to_regclass('public.triad_cutover_review_decisions') IS NOT NULL),
  ('20260918185900', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname = 'public' AND p.proname = 'triad_is_seed_identifier')),
  ('20260918189000', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname = 'public' AND p.proname LIKE 'demo_apply_batch%')),
  ('20260918190000', to_regclass('public.triad_group_members') IS NOT NULL),
  ('20260918195000', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname = 'public' AND p.proname = 'canonical_enrollment_inactivity_internal')),
  ('20260919120000', EXISTS (SELECT 1 FROM pg_attribute a
                             WHERE a.attrelid = to_regclass('public.triad_groups')
                               AND a.attname = 'cohort_requirement_date_id' AND NOT a.attisdropped)
                 AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname = 'public' AND p.proname = 'admin_triad_requirement_candidates'))
),

prod AS (SELECT version, name FROM supabase_migrations.schema_migrations),

audit AS (
  SELECT r.version AS repo_version, r.name,
         COALESCE((SELECT p.version FROM prod p WHERE p.version = r.version),
                  (SELECT p.version FROM prod p JOIN renamed n ON n.prod_version = p.version
                    WHERE n.repo_version = r.version)) AS production_version,
         (SELECT l.is_live FROM live l WHERE l.version = r.version) AS is_live
  FROM repo r
),

classified AS (
  SELECT repo_version, name, production_version, is_live,
    CASE WHEN production_version = repo_version THEN 'applied'
         WHEN production_version IS NOT NULL    THEN 'applied_as_renamed'
         WHEN is_live IS TRUE                   THEN 'PENDING_BUT_LIVE'
         WHEN is_live IS FALSE                  THEN 'pending'
         ELSE 'pending_unprobed' END AS status,
    CASE WHEN is_live IS TRUE THEN 'live'
         WHEN is_live IS FALSE THEN 'absent'
         ELSE 'not_probed' END AS schema_equivalence,
    CASE WHEN production_version = repo_version THEN 'none'
         WHEN production_version IS NOT NULL    THEN 'b3_reconcile (ledger rename only)'
         WHEN is_live IS TRUE                   THEN 'INVESTIGATE: do not replay; reconcile ledger'
         WHEN is_live IS FALSE                  THEN 'apply'
         ELSE 'apply (schema not probed)' END AS action
  FROM audit
),

report AS (
  SELECT 1 AS sort_section, repo_version AS sort_key,
         'A. Triad correction chain' AS section,
         repo_version, COALESCE(production_version, '-') AS production_version,
         status, schema_equivalence, action, name AS note
  FROM classified
  WHERE repo_version IN ('20260918185800','20260918185850','20260918185900',
                         '20260918189000','20260918190000','20260918195000','20260919120000')

  UNION ALL
  SELECT 2, status, 'B. Summary by status', '', '', status, '',
         count(*)::text || ' migration(s)', ''
  FROM classified GROUP BY status

  UNION ALL
  SELECT 3, repo_version, 'C. BLOCKING: pending but schema already live',
         repo_version, COALESCE(production_version, '-'), status, schema_equivalence, action, name
  FROM classified WHERE status = 'PENDING_BUT_LIVE'

  UNION ALL
  SELECT 4, repo_version, 'D. Awaiting B3 ledger reconciliation',
         repo_version, COALESCE(production_version, '-'), status, schema_equivalence, action, name
  FROM classified WHERE status = 'applied_as_renamed'

  UNION ALL
  SELECT 5, repo_version, 'E. Not recorded as applied (full pending set)',
         repo_version, COALESCE(production_version, '-'), status, schema_equivalence, action, name
  FROM classified WHERE status <> 'applied'

  UNION ALL
  SELECT 6, s.version, 'F. Ledger rows with no repo equivalent',
         '-', s.version, 'ledger_only', 'not_probed',
         CASE WHEN n.prod_version IS NOT NULL
              THEN 'known raw-path (B3 maps it to ' || n.repo_version || ')'
              ELSE 'UNKNOWN: no repository migration defines this version' END,
         s.name
  FROM supabase_migrations.schema_migrations s
  LEFT JOIN repo r ON r.version = s.version
  LEFT JOIN renamed n ON n.prod_version = s.version
  WHERE r.version IS NULL

  UNION ALL
  SELECT 7, k, 'G. Counts', '', '', k, '', v::text, ''
  FROM (VALUES
    ('repo_migrations',   (SELECT count(*) FROM repo)),
    ('ledger_rows',       (SELECT count(*) FROM prod)),
    ('exact_matches',     (SELECT count(*) FROM classified WHERE status = 'applied')),
    ('applied_as_renamed',(SELECT count(*) FROM classified WHERE status = 'applied_as_renamed')),
    ('pending_but_live',  (SELECT count(*) FROM classified WHERE status = 'PENDING_BUT_LIVE')),
    ('pending',           (SELECT count(*) FROM classified WHERE status IN ('pending','pending_unprobed')))
  ) AS c(k, v)
)
SELECT section, repo_version, production_version, status, schema_equivalence, action, note
FROM report ORDER BY sort_section, sort_key;

ROLLBACK;
