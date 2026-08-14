-- bulk_invite_batches.created_by had no ON DELETE behavior (defaults to RESTRICT),
-- which meant an admin who has ever run a bulk import could never be deleted without
-- first deleting their batches. Batches are an audit record and should outlive the
-- admin who created them — relax the FK to SET NULL instead.
ALTER TABLE public.bulk_invite_batches
  DROP CONSTRAINT IF EXISTS bulk_invite_batches_created_by_fkey;

ALTER TABLE public.bulk_invite_batches
  ADD CONSTRAINT bulk_invite_batches_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
