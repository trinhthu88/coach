begin;
select plan(19);

select has_function(
  'public',
  'transition_session_status',
  array['uuid','text','text','text'],
  'all session kinds use one server transition function'
);
select has_function(
  'public',
  'update_session_notes',
  array['uuid','text','text','text'],
  'participant note updates use a scoped mutation function'
);
select has_function(
  'public',
  'resolve_current_enrollment',
  array['uuid'],
  'Admin surfaces have one deterministic current enrollment resolver'
);
select has_function(
  'public',
  'is_coach_eligible',
  array['uuid'],
  'Coach eligibility has one fail-closed database rule'
);
select has_function(
  'public',
  'admin_update_coach_configuration',
  array['uuid','text','text','uuid[]','uuid','uuid','uuid','uuid'],
  'Admin Coach edits are transactional across profile, allowlist, and enrollment'
);
select has_function(
  'public',
  'attribute_activity_to_cadence_milestone',
  array['uuid','text','uuid','date'],
  'new activity receives exact enrollment-scoped cadence attribution'
);
select has_table(
  'public',
  'session_activity_attributions',
  'activity attribution is stored as auditable data'
);
select has_table(
  'public',
  'sponsor_report_requests',
  'Sponsor report is a request workflow, not an automatic report'
);
select has_function(
  'public',
  'sponsor_submit_report_request',
  array['uuid','text'],
  'Sponsors submit report requests through a server-authorized function'
);
select has_function(
  'public',
  'admin_update_report_request',
  array['uuid','text','text'],
  'Admins manually update report request status'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.transition_session_status(uuid,text,text,text)',
    'EXECUTE'
  ),
  'authenticated users can invoke the transition function'
);
select ok(
  NOT has_function_privilege(
    'anon',
    'public.transition_session_status(uuid,text,text,text)',
    'EXECUTE'
  ),
  'anonymous users cannot invoke session transitions'
);
select has_trigger(
  'public',
  'sessions',
  'sessions_protected_fields',
  'direct session protected-field changes are rejected'
);
select has_trigger(
  'public',
  'peer_sessions',
  'peer_sessions_protected_fields',
  'direct peer protected-field changes are rejected'
);
select has_trigger(
  'public',
  'coachee_peer_sessions',
  'coachee_peer_sessions_protected_fields',
  'PSS protected-field changes are rejected'
);
select has_view(
  'public',
  'enrollment_scope_backfill_audit',
  'enrollment scope backfill choices remain auditable'
);
select has_function(
  'public',
  'is_historical_ownership_retired',
  array['text','uuid'],
  'unresolved and retired legacy activity remains explicitly excluded'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_update_report_request(uuid,text,text)',
    'EXECUTE'
  ) AND pg_get_functiondef(
    'public.admin_update_report_request(uuid,text,text)'::regprocedure
  ) ~ 'has_role',
  'report status RPC remains callable but protects admin-only mutation'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.sponsor_submit_report_request(uuid,text)',
    'EXECUTE'
  ),
  'authenticated Sponsors can submit report requests'
);

select * from finish();
rollback;