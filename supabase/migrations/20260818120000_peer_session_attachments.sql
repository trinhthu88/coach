
-- Allow session_attachments to also belong to peer_sessions, so peer
-- coaching sessions support file uploads the same way regular coaching
-- sessions do.

ALTER TABLE public.session_attachments
  ALTER COLUMN session_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS peer_session_id uuid REFERENCES public.peer_sessions(id) ON DELETE CASCADE;

ALTER TABLE public.session_attachments
  ADD CONSTRAINT session_attachments_one_parent_chk
  CHECK (
    (session_id IS NOT NULL AND peer_session_id IS NULL)
    OR (session_id IS NULL AND peer_session_id IS NOT NULL)
  );

DROP POLICY IF EXISTS "Attachments: participants view" ON public.session_attachments;
CREATE POLICY "Attachments: participants view" ON public.session_attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_attachments.session_id
        AND (s.coach_id = auth.uid() OR s.coachee_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.peer_sessions ps
      WHERE ps.id = session_attachments.peer_session_id
        AND (ps.peer_coach_id = auth.uid() OR ps.peer_coachee_id = auth.uid())
    )
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Attachments: participants upload" ON public.session_attachments;
CREATE POLICY "Attachments: participants upload" ON public.session_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.sessions s
        WHERE s.id = session_attachments.session_id
          AND (s.coach_id = auth.uid() OR s.coachee_id = auth.uid())
      )
      OR EXISTS (
        SELECT 1 FROM public.peer_sessions ps
        WHERE ps.id = session_attachments.peer_session_id
          AND (ps.peer_coach_id = auth.uid() OR ps.peer_coachee_id = auth.uid())
      )
    )
  );

-- Storage: path convention is {session_or_peer_session_id}/{uuid}-{filename}
-- for both regular and peer sessions, so RLS must accept either table.

DROP POLICY IF EXISTS "Session attachments: participants read" ON storage.objects;
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
    OR EXISTS (
      SELECT 1 FROM public.peer_sessions ps
      WHERE ps.id::text = (storage.foldername(name))[1]
        AND (ps.peer_coach_id = auth.uid() OR ps.peer_coachee_id = auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "Session attachments: participants upload" ON storage.objects;
CREATE POLICY "Session attachments: participants upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'session-attachments'
  AND (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id::text = (storage.foldername(name))[1]
        AND (s.coach_id = auth.uid() OR s.coachee_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.peer_sessions ps
      WHERE ps.id::text = (storage.foldername(name))[1]
        AND (ps.peer_coach_id = auth.uid() OR ps.peer_coachee_id = auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "Session attachments: participants delete" ON storage.objects;
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
    OR EXISTS (
      SELECT 1 FROM public.peer_sessions ps
      WHERE ps.id::text = (storage.foldername(name))[1]
        AND (ps.peer_coach_id = auth.uid() OR ps.peer_coachee_id = auth.uid())
    )
  )
);
