
-- 1) Storage: restrict UPDATE on session-attachments to uploader or admin
DROP POLICY IF EXISTS "Session attachments: uploader or admin update" ON storage.objects;
CREATE POLICY "Session attachments: uploader or admin update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'session-attachments'
  AND (
    owner = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
)
WITH CHECK (
  bucket_id = 'session-attachments'
  AND (
    owner = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
);

-- 2) Tighten shares_session_with to only count active session relationships
CREATE OR REPLACE FUNCTION public.shares_session_with(_viewer uuid, _target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE ((s.coach_id = _viewer AND s.coachee_id = _target)
        OR (s.coachee_id = _viewer AND s.coach_id = _target))
      AND s.status IN ('confirmed'::public.session_status, 'completed'::public.session_status)
  ) OR EXISTS (
    SELECT 1 FROM public.peer_sessions ps
    WHERE ((ps.peer_coach_id = _viewer AND ps.peer_coachee_id = _target)
        OR (ps.peer_coachee_id = _viewer AND ps.peer_coach_id = _target))
      AND ps.status IN ('confirmed'::public.session_status, 'completed'::public.session_status)
  );
$function$;
