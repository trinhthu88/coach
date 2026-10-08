-- Per-coach Google Calendar OAuth credentials. Tokens and OAuth state are only
-- readable by the Edge Functions' service role; authenticated clients never
-- receive refresh tokens or state records.
CREATE TABLE public.google_calendar_connections (
  coach_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  google_email text NOT NULL,
  refresh_token_ciphertext text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.google_calendar_connections FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.google_calendar_connections TO service_role;

CREATE TABLE public.google_calendar_oauth_states (
  state_hash text PRIMARY KEY,
  coach_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  return_origin text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX google_calendar_oauth_states_expires_at_idx
  ON public.google_calendar_oauth_states (expires_at);

ALTER TABLE public.google_calendar_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.google_calendar_oauth_states FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.google_calendar_oauth_states TO service_role;
