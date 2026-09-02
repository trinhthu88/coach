-- Phase 1 (training material delivery): private bucket for training-week
-- PDFs, mirroring the mentoring-prep-files bucket pattern
-- (20260818140600_mentoring_prep_files_storage.sql). Path convention:
-- {training_week_id}/{filename} — admin-owned (only admin uploads/deletes),
-- readable by admin and by anyone who can currently see that training_week.

INSERT INTO storage.buckets (id, name, public)
VALUES ('training-pdfs', 'training-pdfs', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Training PDFs: admin manage"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'training-pdfs' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'training-pdfs' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Training PDFs: enrolled users read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'training-pdfs'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.training_weeks tw
      JOIN public.programme_enrollments pe ON pe.programme_id = tw.programme_id
      WHERE tw.id::text = (storage.foldername(name))[1]
        AND tw.is_visible = true
        AND (tw.unlock_date IS NULL OR tw.unlock_date <= CURRENT_DATE)
        AND pe.user_id = auth.uid()
        AND pe.status = 'active'
    )
  )
);
