-- ============================================
-- Messages between coach and coachee for a confirmed session
-- ============================================
CREATE TABLE public.session_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX idx_session_messages_session_created ON public.session_messages(session_id, created_at);

ALTER TABLE public.session_messages ENABLE ROW LEVEL SECURITY;

-- Helper: is the user a participant of this session AND is the session in a state where chat is allowed?
CREATE OR REPLACE FUNCTION public.can_message_session(_session_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = _session_id
      AND (s.coach_id = _user_id OR s.coachee_id = _user_id)
      AND s.status IN ('confirmed','completed')
  );
$$;

CREATE POLICY "Messages: participants view"
ON public.session_messages
FOR SELECT
TO authenticated
USING (
  public.can_message_session(session_id, auth.uid())
  OR public.has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Messages: participants send"
ON public.session_messages
FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND public.can_message_session(session_id, auth.uid())
);

CREATE POLICY "Messages: sender delete own"
ON public.session_messages
FOR DELETE
TO authenticated
USING (sender_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

-- Realtime
ALTER TABLE public.session_messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.session_messages;

-- ============================================
-- Bulk weekly availability RPC
-- Inserts slots for `weeks` weeks starting from `start_date`,
-- using a JSON template: [{ "weekday": 1, "start": "09:00", "end": "10:00" }, ...]
-- weekday: 0=Sunday .. 6=Saturday (matches JS getDay)
-- Skips conflicts (relies on no-overlap is best-effort; we just insert).
-- ============================================
CREATE OR REPLACE FUNCTION public.bulk_create_availability(
  _coach_id UUID,
  _start_date DATE,
  _weeks INT,
  _template JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INT := 0;
  wk INT;
  rec JSONB;
  d DATE;
  target_dow INT;
  delta INT;
BEGIN
  -- Only the coach themselves or an admin can bulk-create
  IF NOT (auth.uid() = _coach_id AND has_role(auth.uid(), 'coach'::app_role))
     AND NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _weeks < 1 OR _weeks > 12 THEN
    RAISE EXCEPTION 'Weeks must be between 1 and 12';
  END IF;

  FOR wk IN 0.._weeks - 1 LOOP
    FOR rec IN SELECT * FROM jsonb_array_elements(_template) LOOP
      target_dow := (rec->>'weekday')::int;
      -- find the date in week `wk` matching target_dow
      delta := (target_dow - EXTRACT(DOW FROM _start_date)::int + 7) % 7;
      d := _start_date + (wk * 7 + delta);
      INSERT INTO public.coach_availability (coach_id, slot_date, start_time, end_time)
      VALUES (
        _coach_id,
        d,
        (rec->>'start')::time,
        (rec->>'end')::time
      );
      inserted_count := inserted_count + 1;
    END LOOP;
  END LOOP;

  RETURN inserted_count;
END;
$$;