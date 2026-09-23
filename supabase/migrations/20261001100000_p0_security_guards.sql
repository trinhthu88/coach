-- ===========================================================================
-- P0 security guards (RULES_AUDIT.md, findings P1 / P2 and the cascade wipes)
--
--   1. A sponsor cannot move their own sponsor_profiles row to another
--      organisation (which would hand them that organisation's leaders), and
--      get_sponsor_org() is no longer callable by clients.
--   2. Training evidence timestamps are the server's: a learner decides THAT
--      a week / submission / prompt is done, never WHEN. The read-time
--      availability window and programme-end freeze (20260930100000) can no
--      longer be defeated with a client-chosen date.
--   3. Destructive deletes that silently wiped completion history are refused:
--      a training week with learner evidence, a cohort with enrollments, and a
--      person who coached / was coached / mentored / was mentored in a session.
--
-- No fulfilment rule changes here; see RULES_AUDIT.md for P1 onwards.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Who is writing: an end user through the API, or trusted tooling?
-- ---------------------------------------------------------------------------
-- PostgREST runs every end-user request as the `authenticated` / `anon`
-- database role. Migrations, seeds, the service role and SECURITY DEFINER
-- internals run as another role. The JWT role claim is deliberately NOT used:
-- trusted SQL (tests, seeds) sets it to impersonate a user while still writing
-- as the table owner.
--
-- current_user is the CALLER only in a SECURITY INVOKER context, so every
-- function that relies on this must itself be SECURITY INVOKER.
CREATE OR REPLACE FUNCTION public.request_is_end_user()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT current_user IN ('authenticated', 'anon');
$$;

COMMENT ON FUNCTION public.request_is_end_user() IS
  'true when the current statement runs as an API end user (database role authenticated/anon); false for migrations, seeds, the service role and trusted internals. Only meaningful from SECURITY INVOKER code.';

-- ---------------------------------------------------------------------------
-- 1. Sponsor organisation is Admin-owned
-- ---------------------------------------------------------------------------
-- "Sponsor profiles: own update" (20260908140000) lets a sponsor edit their
-- own row for title / department / phone. It has no column restriction, so
-- organization_id was editable too -- and sponsor_visible_enrollments() follows
-- it. Only an Admin (or trusted tooling) may change it.
CREATE OR REPLACE FUNCTION public.prevent_sponsor_org_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     AND public.request_is_end_user()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role)
  THEN
    RAISE EXCEPTION 'Only an admin can change a sponsor''s organisation'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_sponsor_org_change ON public.sponsor_profiles;
CREATE TRIGGER guard_sponsor_org_change
  BEFORE UPDATE ON public.sponsor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_sponsor_org_change();

-- get_sponsor_org(uuid) answered "which organisation is this sponsor in" for
-- ANY user id, to anyone (EXECUTE was granted to PUBLIC, so anon too). Its one
-- client-side caller is the organisations policy below; that policy now reads
-- the caller's own sponsor_profiles row instead, so EXECUTE can go.
DROP POLICY IF EXISTS "Organizations: sponsor view own" ON public.organizations;
CREATE POLICY "Organizations: sponsor view own" ON public.organizations
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid() AND sp.organization_id = organizations.id
  ));

REVOKE EXECUTE ON FUNCTION public.get_sponsor_org(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Server-owned Training evidence timestamps
-- ---------------------------------------------------------------------------
-- The client still says WHETHER something happened (a non-null completed_at /
-- responded_at; any submission row), because the same row also records
-- non-completion events: a week VIEW is an upsert of viewed_at, a prompt OPEN
-- an upsert of opened_at. Setting the timestamp on every insert would turn a
-- view into a completion.
--
--   first time set   -> now(), whatever value was sent
--   already set      -> kept (a completion or submission is not re-dated by a
--                       later edit, a re-upsert, or a reviewer's update)
--   cleared (NULL)   -> allowed for the nullable ones (un-marking); it can only
--                       ever be set again to now()
--
-- Applies to end users only: migrations, seeds, tests and the service role
-- may still write historical evidence.
CREATE OR REPLACE FUNCTION public.enforce_training_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.request_is_end_user() THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'training_progress' THEN
    IF NEW.completed_at IS NOT NULL THEN
      NEW.completed_at := CASE WHEN TG_OP = 'UPDATE' AND OLD.completed_at IS NOT NULL
                               THEN OLD.completed_at ELSE now() END;
    END IF;
  ELSIF TG_TABLE_NAME = 'daily_prompt_responses' THEN
    IF NEW.responded_at IS NOT NULL THEN
      NEW.responded_at := CASE WHEN TG_OP = 'UPDATE' AND OLD.responded_at IS NOT NULL
                               THEN OLD.responded_at ELSE now() END;
    END IF;
  ELSIF TG_TABLE_NAME IN ('assignment_submissions', 'reflection_submissions') THEN
    -- submitted_at is NOT NULL: the row itself is the submission.
    NEW.submitted_at := CASE WHEN TG_OP = 'UPDATE' THEN OLD.submitted_at ELSE now() END;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_training_timestamp() IS
  'Training evidence timestamps are set by the server for end-user writes: first set = now(), then fixed. See 20261001100000.';

DROP TRIGGER IF EXISTS enforce_ts_training_progress ON public.training_progress;
CREATE TRIGGER enforce_ts_training_progress
  BEFORE INSERT OR UPDATE ON public.training_progress
  FOR EACH ROW EXECUTE FUNCTION public.enforce_training_timestamp();

DROP TRIGGER IF EXISTS enforce_ts_assignment_submissions ON public.assignment_submissions;
CREATE TRIGGER enforce_ts_assignment_submissions
  BEFORE INSERT OR UPDATE ON public.assignment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_training_timestamp();

DROP TRIGGER IF EXISTS enforce_ts_reflection_submissions ON public.reflection_submissions;
CREATE TRIGGER enforce_ts_reflection_submissions
  BEFORE INSERT OR UPDATE ON public.reflection_submissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_training_timestamp();

DROP TRIGGER IF EXISTS enforce_ts_daily_prompt_responses ON public.daily_prompt_responses;
CREATE TRIGGER enforce_ts_daily_prompt_responses
  BEFORE INSERT OR UPDATE ON public.daily_prompt_responses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_training_timestamp();

-- ---------------------------------------------------------------------------
-- 3. Refuse deletes that silently wipe completion history
-- ---------------------------------------------------------------------------
-- 3a. A training week with learner evidence. training_progress, assignments ->
-- assignment_submissions and daily_prompts -> daily_prompt_responses all
-- CASCADE from the week. SECURITY DEFINER so the check sees every learner's
-- rows regardless of the deleting user's RLS.
CREATE OR REPLACE FUNCTION public.guard_training_week_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.training_progress tp WHERE tp.training_week_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.assignments a
                JOIN public.assignment_submissions s ON s.assignment_id = a.id
                WHERE a.training_week_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.daily_prompts dp
                JOIN public.daily_prompt_responses r ON r.daily_prompt_id = dp.id
                WHERE dp.training_week_id = OLD.id)
  THEN
    RAISE EXCEPTION 'Cannot delete a training week that has learner evidence'
      USING ERRCODE = '23503',
            HINT = 'Hide the week (is_visible = false) instead of deleting it.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS guard_week_delete ON public.training_weeks;
CREATE TRIGGER guard_week_delete
  BEFORE DELETE ON public.training_weeks
  FOR EACH ROW EXECUTE FUNCTION public.guard_training_week_delete();

-- 3b. A cohort with enrollments. programme_enrollments.cohort_id is ON DELETE
-- SET NULL, and every canonical reader inner-joins the cohort, so such a
-- delete silently left learners with no progress at all.
CREATE OR REPLACE FUNCTION public.guard_cohort_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.programme_enrollments e WHERE e.cohort_id = OLD.id) THEN
    RAISE EXCEPTION 'Cannot delete a cohort that has enrollments'
      USING ERRCODE = '23503',
            HINT = 'Move or end its enrollments first.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS guard_cohort_delete ON public.cohorts;
CREATE TRIGGER guard_cohort_delete
  BEFORE DELETE ON public.cohorts
  FOR EACH ROW EXECUTE FUNCTION public.guard_cohort_delete();

-- 3c. The people on a Coaching or Mentoring session. These referenced
-- profiles(id) ON DELETE CASCADE, so deleting a coach or mentor deleted every
-- learner's session with them (and deleting a learner, their coach's record
-- of it). RESTRICT keeps the target and column; only the delete rule changes.
ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_coach_id_fkey,
  ADD CONSTRAINT sessions_coach_id_fkey
    FOREIGN KEY (coach_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_coachee_id_fkey,
  ADD CONSTRAINT sessions_coachee_id_fkey
    FOREIGN KEY (coachee_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.mentoring_sessions
  DROP CONSTRAINT IF EXISTS mentoring_sessions_mentor_id_fkey,
  ADD CONSTRAINT mentoring_sessions_mentor_id_fkey
    FOREIGN KEY (mentor_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.mentoring_sessions
  DROP CONSTRAINT IF EXISTS mentoring_sessions_mentee_id_fkey,
  ADD CONSTRAINT mentoring_sessions_mentee_id_fkey
    FOREIGN KEY (mentee_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;
