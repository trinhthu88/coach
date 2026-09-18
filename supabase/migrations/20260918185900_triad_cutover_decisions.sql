-- Triad cutover — explicit remediation ledger (ships BEFORE the cutover).
--
-- 20260918190000_triad_canonical_cutover links every existing triad_group to
-- the cohort Triad requirement unit (cohort_requirement_dates row) it belongs
-- to. It only links what the stored data proves:
--   * the group's round number (triad_rounds.round_number / round_number) is
--     the requirement ordinal in the group's own cohort, or
--   * the group's cohort has exactly one Triad requirement unit.
-- Anything else is AMBIGUOUS and the cutover fails rather than guess.
--
-- An ambiguous group is resolved by a reviewed decision recorded here (in a
-- migration placed between this file and the cutover), exactly like
-- enrollment_ownership_retirements:
--   decision = 'link'                -> link to cohort_requirement_date_id
--   decision = 'historical_unlinked' -> keep the group as history only (its
--                                       sessions stay evidence; it is not an
--                                       operational group for any requirement)
-- The ledger is internal: never client-readable.

CREATE TABLE IF NOT EXISTS public.triad_cutover_group_decisions (
  triad_group_id uuid PRIMARY KEY,
  decision text NOT NULL CHECK (decision IN ('link', 'historical_unlinked')),
  cohort_requirement_date_id uuid REFERENCES public.cohort_requirement_dates(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_at timestamptz NOT NULL DEFAULT now(),
  migration_id text NOT NULL,
  CHECK ((decision = 'link') = (cohort_requirement_date_id IS NOT NULL))
);

COMMENT ON TABLE public.triad_cutover_group_decisions IS
  'Reviewed decisions for historical Triad groups whose cohort requirement unit cannot be derived from stored data. Internal.';

ALTER TABLE public.triad_cutover_group_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.triad_cutover_group_decisions FROM PUBLIC, anon, authenticated;
