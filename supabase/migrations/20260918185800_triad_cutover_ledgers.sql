-- ============================================================================
-- TRIAD CUTOVER LEDGERS (ships before 20260918185900_triad_legacy_data_cleanup).
--
-- Created on their own so that a reviewed decision about a REAL/UNKNOWN
-- Triad record can be shipped in a migration between this file and the
-- cleanup that reads it.
-- ============================================================================

-- Audit archive for every Triad row this cleanup, the cutover or the later
-- legacy retirement removes. Internal; answers no business question.
CREATE TABLE public.triad_cutover_archive (
  object_name text NOT NULL,
  record_id uuid NOT NULL,
  payload jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  migration_id text NOT NULL,
  PRIMARY KEY (object_name, record_id)
);
COMMENT ON TABLE public.triad_cutover_archive IS
  'Read-only audit archive of removed / retired Triad rows and legacy columns. Internal; answers no current business question.';
ALTER TABLE public.triad_cutover_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.triad_cutover_archive FROM PUBLIC, anon, authenticated;

-- Reviewed decisions for REAL/UNKNOWN conflicting groups. The only decision
-- is removal; a group that should be kept is corrected instead (so that it no
-- longer conflicts). Populated only by a reviewed migration placed between
-- 20260918185800 and 20260918185900; empty by default.
CREATE TABLE public.triad_cutover_review_decisions (
  triad_group_id uuid PRIMARY KEY,
  decision text NOT NULL CHECK (decision = 'delete'),
  reason text NOT NULL,
  reviewed_by text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  migration_id text NOT NULL
);
COMMENT ON TABLE public.triad_cutover_review_decisions IS
  'Reviewed removal decisions for REAL/UNKNOWN Triad groups that conflict with the canonical model. Internal.';
ALTER TABLE public.triad_cutover_review_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.triad_cutover_review_decisions FROM PUBLIC, anon, authenticated;

