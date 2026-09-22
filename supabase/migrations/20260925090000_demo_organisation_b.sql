-- ===========================================================================
-- Organisation B exists before any organisation is inferred from a cohort.
-- ===========================================================================
--
-- 20260925100000_sponsor_visibility_by_enrollment_org repairs enrollments that
-- carry no organisation by copying their COHORT's organisation. That repair is
-- correct only where the cohort really holds one organisation. Two cohorts do
-- not: supabase/seed-demo.sql deliberately shares Emerging Leaders Cohort B and
-- TASC Essential Cohort D between two organisations, so that each Sponsor sees
-- only its own learners in a cohort another organisation also uses -- the case
-- that proves visibility follows programme_enrollments.organization_id and
-- never cohorts.organization_id.
--
-- Applied to a database whose demo enrollments predate the organisation column
-- (production: 20 of 21 enrollments have organization_id IS NULL), the cohort
-- repair would put Organisation B's learners into Organisation A and hand A's
-- Sponsor four enrollments it must not see. The flattening would be silent:
-- every later integrity check passes, because one organisation per cohort is a
-- legal state.
--
-- This migration therefore states the organisation the demo design already
-- specifies BEFORE the repair runs. Each enrollment is named by id (the ids
-- seed-demo.sql assigns), never by cohort, so nothing is inferred here either.
-- Afterwards the cohort repair finds these rows already organised and leaves
-- them alone, and it stays a repair for genuinely single-organisation cohorts.
--
-- Not a reseed: no account, enrollment, session or goal is created. On a
-- database seeded from supabase/seed-demo.sql the rows already carry these
-- values and every statement below is a no-op.
-- ===========================================================================

INSERT INTO public.organizations (id, name)
VALUES ('d0000000-0000-4000-8000-00000000bbbb', 'Clariva Demo Organization B')
ON CONFLICT (id) DO NOTHING;

-- The enrollments seed-demo.sql places in Organisation B: learner4-6 in
-- Emerging Leaders Cohort B, tasc4-5 in TASC Essential Cohort D. Only rows
-- that exist are touched; only an organisation-less row is filled in, so an
-- organisation an Admin has already chosen is never overwritten.
UPDATE public.programme_enrollments e
   SET organization_id = 'd0000000-0000-4000-8000-00000000bbbb'
 WHERE e.organization_id IS NULL
   AND e.id IN (
     'd0000000-0000-4000-8000-0000000e0b04',
     'd0000000-0000-4000-8000-0000000e0b05',
     'd0000000-0000-4000-8000-0000000e0b06',
     'd0000000-0000-4000-8000-0000000e0d04',
     'd0000000-0000-4000-8000-0000000e0d05'
   );

DO $verify$
DECLARE
  v_unorganised integer;
BEGIN
  -- None of the five may still be waiting for a cohort to decide its
  -- organisation: that is exactly what the next migration would infer wrongly.
  -- An organisation an Admin has since chosen for one of them is left as it is.
  SELECT count(*) INTO v_unorganised
  FROM public.programme_enrollments e
  WHERE e.id IN (
      'd0000000-0000-4000-8000-0000000e0b04',
      'd0000000-0000-4000-8000-0000000e0b05',
      'd0000000-0000-4000-8000-0000000e0b06',
      'd0000000-0000-4000-8000-0000000e0d04',
      'd0000000-0000-4000-8000-0000000e0d05')
    AND e.organization_id IS NULL;
  IF v_unorganised > 0 THEN
    RAISE EXCEPTION 'demo organisation B: % enrollment(s) still have no organisation', v_unorganised;
  END IF;
END
$verify$;
