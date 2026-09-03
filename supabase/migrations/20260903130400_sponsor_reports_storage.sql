-- Phase 3 (programme management completion): private bucket for the
-- server-generated sponsor PDF report (generate-report-pdf edge function).
-- Mirrors the mentoring-prep-files / training-pdfs bucket pattern, but
-- unlike those, the edge function is the only reader/writer (it uses the
-- service-role key, which bypasses RLS entirely) — a signed URL is what's
-- actually handed back to the sponsor, not a direct table/storage grant.
-- These policies exist for dashboard/support visibility only, not as the
-- access-control boundary. Path convention: {sponsor_user_id}/{filename}.pdf
-- — the edge function also uses this prefix to best-effort delete a given
-- sponsor's own files older than 24h each time it generates a new one,
-- since Storage has no built-in object TTL.

INSERT INTO storage.buckets (id, name, public)
VALUES ('sponsor-reports', 'sponsor-reports', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Sponsor reports: admin manage"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'sponsor-reports' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'sponsor-reports' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Sponsor reports: owner read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'sponsor-reports'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
