CREATE POLICY "Messages: participants mark read"
  ON public.session_messages
  FOR UPDATE TO authenticated
  USING (can_message_session(session_id, auth.uid()))
  WITH CHECK (can_message_session(session_id, auth.uid()));
