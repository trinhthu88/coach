-- Private bucket for mentee-submitted preparation files, mirroring the
-- session-attachments bucket pattern (20260429212714_*.sql,
-- 20260818120000_*.sql). Path convention: {session_id}/{filename}.
--
-- Unlike session-attachments (any participant can upload/delete), prep
-- files are single-owner: only the mentee may INSERT/DELETE (the mentee is
-- the one who owns/replaces their own prep submission); both participants
-- and admin may read. A filename-suffix check backstops the client-side
-- .docx/.pdf restriction at the DB level.

INSERT INTO storage.buckets (id, name, public)
VALUES ('mentoring-prep-files', 'mentoring-prep-files', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Mentoring prep files: participants read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'mentoring-prep-files'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.mentoring_sessions ms
      WHERE ms.id::text = (storage.foldername(name))[1]
        AND (ms.mentor_id = auth.uid() OR ms.mentee_id = auth.uid())
    )
  )
);

CREATE POLICY "Mentoring prep files: mentee upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'mentoring-prep-files'
  AND (lower(right(name, 5)) = '.docx' OR lower(right(name, 4)) = '.pdf')
  AND EXISTS (
    SELECT 1 FROM public.mentoring_sessions ms
    WHERE ms.id::text = (storage.foldername(name))[1]
      AND ms.mentee_id = auth.uid()
  )
);

CREATE POLICY "Mentoring prep files: mentee or admin delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'mentoring-prep-files'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.mentoring_sessions ms
      WHERE ms.id::text = (storage.foldername(name))[1]
        AND ms.mentee_id = auth.uid()
    )
  )
);
