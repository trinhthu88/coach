-- Admin bulk-add users with welcome + magic link: batch tracking tables.
--
-- These make a large import resumable — a crashed/reloaded browser can re-fetch a
-- batch's row statuses by batch_id and only resubmit rows still 'pending'/'failed',
-- instead of re-inviting everyone in the file.

CREATE TABLE IF NOT EXISTS public.bulk_invite_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  total_rows integer
);

CREATE TABLE IF NOT EXISTS public.bulk_invite_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.bulk_invite_batches(id),
  row_index integer,
  email text,
  full_name text,
  role text CHECK (role IN ('coach', 'coachee')),
  assign_coach_id uuid REFERENCES public.coach_profiles(id) NULL,
  session_limit integer NULL,
  status text CHECK (status IN ('pending', 'invited', 'failed', 'skipped')) DEFAULT 'pending',
  error_message text NULL,
  created_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bulk_invite_rows_batch ON public.bulk_invite_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_bulk_invite_rows_email ON public.bulk_invite_rows(email);

ALTER TABLE public.bulk_invite_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_invite_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Bulk invite batches: admin manage" ON public.bulk_invite_batches;
CREATE POLICY "Bulk invite batches: admin manage"
  ON public.bulk_invite_batches
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Bulk invite rows: admin manage" ON public.bulk_invite_rows;
CREATE POLICY "Bulk invite rows: admin manage"
  ON public.bulk_invite_rows
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
