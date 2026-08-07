CREATE TABLE public.tool_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  tool_type text NOT NULL,
  filled_by uuid NOT NULL,
  responses jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tool_sessions_unique_fill
  ON public.tool_sessions (session_id, tool_type, filled_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tool_sessions TO authenticated;
GRANT ALL ON public.tool_sessions TO service_role;

ALTER TABLE public.tool_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tools: admin manage"
  ON public.tool_sessions FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Tools: participants view session tools"
  ON public.tool_sessions FOR SELECT TO authenticated
  USING (can_message_session(session_id, auth.uid()));

CREATE POLICY "Tools: participants insert own"
  ON public.tool_sessions FOR INSERT TO authenticated
  WITH CHECK (filled_by = auth.uid() AND can_message_session(session_id, auth.uid()));

CREATE POLICY "Tools: participants update own"
  ON public.tool_sessions FOR UPDATE TO authenticated
  USING (filled_by = auth.uid() AND can_message_session(session_id, auth.uid()))
  WITH CHECK (filled_by = auth.uid() AND can_message_session(session_id, auth.uid()));

CREATE POLICY "Tools: participants delete own"
  ON public.tool_sessions FOR DELETE TO authenticated
  USING (filled_by = auth.uid() AND can_message_session(session_id, auth.uid()));

CREATE TRIGGER trg_tool_sessions_updated
  BEFORE UPDATE ON public.tool_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();