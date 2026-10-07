BEGIN;
SELECT plan(8);

INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES (
  'b2000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'google-calendar-resilience@example.test',
  'x',
  now()
);

INSERT INTO public.google_calendar_connections
  (coach_id, google_email, refresh_token_ciphertext)
VALUES (
  'b2000000-0000-4000-8000-000000000001',
  'google-calendar-resilience@example.test',
  'v1:test-ciphertext'
);

SELECT ok(
  has_function_privilege('service_role', 'public.record_google_calendar_failure(uuid)', 'EXECUTE'),
  'only the service role can record Google Calendar failures'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.record_google_calendar_failure(uuid)', 'EXECUTE'),
  'authenticated users cannot call the failure counter'
);
SELECT is(
  (SELECT consecutive_error_count
   FROM public.record_google_calendar_failure('b2000000-0000-4000-8000-000000000001')),
  1,
  'the first failure increments the counter'
);
SELECT is(
  (SELECT needs_reconnect FROM public.google_calendar_connections
   WHERE coach_id = 'b2000000-0000-4000-8000-000000000001'),
  false,
  'the first failure does not require reconnect'
);
SELECT is(
  (SELECT consecutive_error_count
   FROM public.record_google_calendar_failure('b2000000-0000-4000-8000-000000000001')),
  2,
  'the second failure increments the counter'
);
SELECT is(
  (SELECT needs_reconnect FROM public.google_calendar_connections
   WHERE coach_id = 'b2000000-0000-4000-8000-000000000001'),
  false,
  'the second failure does not yet require reconnect'
);
SELECT is(
  (SELECT consecutive_error_count
   FROM public.record_google_calendar_failure('b2000000-0000-4000-8000-000000000001')),
  3,
  'the third failure increments the counter'
);
SELECT is(
  (SELECT needs_reconnect FROM public.google_calendar_connections
   WHERE coach_id = 'b2000000-0000-4000-8000-000000000001'),
  true,
  'the third consecutive failure requires reconnect'
);

SELECT * FROM finish();
ROLLBACK;
