
INSERT INTO storage.buckets (id, name, public)
VALUES ('session-attachments', 'session-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Path convention: {session_id}/{uuid}-{filename}
CREATE POLICY "Session attachments: participants read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'session-attachments'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id::text = (storage.foldername(name))[1]
        AND (s.coach_id = auth.uid() OR s.coachee_id = auth.uid())
    )
  )
);

CREATE POLICY "Session attachments: participants upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'session-attachments'
  AND EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id::text = (storage.foldername(name))[1]
      AND (s.coach_id = auth.uid() OR s.coachee_id = auth.uid())
  )
);

CREATE POLICY "Session attachments: participants delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'session-attachments'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id::text = (storage.foldername(name))[1]
        AND (s.coach_id = auth.uid() OR s.coachee_id = auth.uid())
    )
  )
);
