-- Phase 0 (programme-module unification), part 2: collapse coachee_id
-- (programme_enrollments) and coach_id (coach_programme_enrollments) into
-- one user_id column on programme_enrollments, so a single enrollment
-- table serves both roles. coach_programmes / coach_programme_enrollments
-- are NOT dropped here — they stay in place, unused, until every reference
-- is migrated and verified (see 20260903100300 for the sponsor functions
-- half of that migration).

-- Step 2a: Add user_id column
ALTER TABLE public.programme_enrollments
  ADD COLUMN user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Step 2b: Backfill from coachee_id
UPDATE public.programme_enrollments SET user_id = coachee_id WHERE user_id IS NULL;

-- Step 2c: Make user_id NOT NULL
ALTER TABLE public.programme_enrollments ALTER COLUMN user_id SET NOT NULL;

-- coachee_id is being kept around (not dropped) for backward compatibility,
-- but going forward every write goes through user_id only — relax coachee_id
-- so new rows don't need it populated. (Not made a GENERATED column mirroring
-- user_id: Postgres generated columns can't carry a UNIQUE/FK of their own,
-- and every downstream reader is updated to user_id in this migration series
-- anyway, so a mirror isn't needed.)
ALTER TABLE public.programme_enrollments ALTER COLUMN coachee_id DROP NOT NULL;

-- Step 2d: Drop old unique index (keyed on coachee_id, added in
-- 20260830150000_fix_enrollment_cardinality.sql), create new partial
-- unique keyed on user_id.
DROP INDEX IF EXISTS ux_programme_enrollments_one_active;
CREATE UNIQUE INDEX ux_programme_enrollments_one_active
  ON public.programme_enrollments (user_id) WHERE status = 'active';

-- Step 2e: Update RLS policies
DROP POLICY IF EXISTS "Enrollments: coachee view own" ON public.programme_enrollments;
CREATE POLICY "Enrollments: user view own" ON public.programme_enrollments
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Enrollments: coach view client" ON public.programme_enrollments;
CREATE POLICY "Enrollments: coach view client" ON public.programme_enrollments
  FOR SELECT TO authenticated USING (
    public.coach_has_client(auth.uid(), user_id)
  );

DROP POLICY IF EXISTS "Enrollments: sponsor view org" ON public.programme_enrollments;
CREATE POLICY "Enrollments: sponsor view org" ON public.programme_enrollments
  FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = public.get_sponsor_org(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_programme_enrollments_user ON public.programme_enrollments(user_id);

-- Step 2f: Keep coachee_id as-is (not generated/dropped) so existing
-- sponsor_* functions don't break until they're updated in
-- 20260903100300_update_sponsor_functions_user_id.sql. Do NOT drop
-- coachee_id yet.

-- Step 2g: programme_modules' "enrolled users view" policy (created in the
-- previous migration) was keyed on coachee_id because user_id didn't exist
-- yet at that point. Recreate it against user_id now that it does.
DROP POLICY IF EXISTS "Programme modules: enrolled users view" ON public.programme_modules;
CREATE POLICY "Programme modules: enrolled users view" ON public.programme_modules
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.programme_enrollments pe
      WHERE pe.programme_id = programme_modules.programme_id
        AND pe.user_id = auth.uid()
        AND pe.status = 'active'
    )
  );
