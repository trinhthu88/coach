-- Generic, enrollment-scoped, session-linked learning reflection
-- (Coaching redesign, deployment 1).
--
-- Section 18 requires reflection evidence owned by an enrollment AND tied to
-- the activity that produced it. Neither existing structure does both:
--
--   coachee_reflections   enrollment_id, but no activity link -- a free
--                         journal, explicitly not canonical completion evidence
--   triad_reflections     session-linked, but Triad-specific columns
--                         (learned_as_coach / as_coachee / as_observer)
--   reflection_submissions enrollment-scoped, but tied to programme_reflections
--                         (week-numbered programme content), not to a session
--
-- So the smallest generic design is introduced here rather than a
-- Coaching-only table. It follows the attribution convention already used by
-- goal_checkins, enrollment_actions and session_activity_attributions
-- (source_activity_type text + source_activity_id uuid), so the same table
-- serves coaching, peer_coaching, mentoring and triads.
--
-- No learner_id column: the enrollment already identifies the learner, and a
-- second identity field is exactly the duplication section 18 forbids.

CREATE TABLE public.session_learning_reflections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.programme_enrollments(id) ON DELETE CASCADE,
  source_activity_type text NOT NULL
    CHECK (source_activity_type IN ('coaching', 'peer_coaching', 'mentoring', 'triads')),
  source_activity_id uuid NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One reflection per learner per activity. Editing rewrites the row rather
  -- than accumulating drafts, so "is the reflection gate satisfied" is a
  -- single-row existence test.
  CONSTRAINT session_learning_reflections_unique
    UNIQUE (enrollment_id, source_activity_type, source_activity_id)
);

COMMENT ON TABLE public.session_learning_reflections IS
  'Canonical post-session learner reflection, scoped to an enrollment and the '
  'activity that produced it. Mandatory evidence for Coaching unit completion.';

CREATE INDEX session_learning_reflections_activity_idx
  ON public.session_learning_reflections (source_activity_type, source_activity_id);
CREATE INDEX session_learning_reflections_enrollment_idx
  ON public.session_learning_reflections (enrollment_id);

ALTER TABLE public.session_learning_reflections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Session learning reflections: admin manage"
  ON public.session_learning_reflections
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- The learner owns their reflection: they may read and write only rows on
-- their own enrollment.
CREATE POLICY "Session learning reflections: learner manage own"
  ON public.session_learning_reflections
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.id = session_learning_reflections.enrollment_id AND e.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.programme_enrollments e
    WHERE e.id = session_learning_reflections.enrollment_id AND e.user_id = auth.uid()
  ));

-- The Coach of the session may read the reflection for that session. This is
-- the relationship-scoped visibility of section 27; a Sponsor never gets a
-- policy here, so the narrative is unreachable to them by construction.
CREATE POLICY "Session learning reflections: session coach view"
  ON public.session_learning_reflections
  FOR SELECT TO authenticated
  USING (
    source_activity_type = 'coaching'
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_learning_reflections.source_activity_id
        AND s.coach_id = auth.uid()
    )
  );

REVOKE ALL ON public.session_learning_reflections FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_learning_reflections TO authenticated;

CREATE TRIGGER session_learning_reflections_set_updated_at
  BEFORE UPDATE ON public.session_learning_reflections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The reflection must belong to the same enrollment the session does, so a
-- learner cannot satisfy Enrollment B's gate with a reflection written against
-- Enrollment A's session (section 5).
CREATE OR REPLACE FUNCTION public.validate_session_learning_reflection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_session_enrollment uuid;
BEGIN
  IF NEW.source_activity_type = 'coaching' THEN
    SELECT s.enrollment_id INTO v_session_enrollment
    FROM public.sessions s WHERE s.id = NEW.source_activity_id;

    IF v_session_enrollment IS NULL THEN
      RAISE EXCEPTION 'Coaching session % does not exist or has no enrollment', NEW.source_activity_id
        USING ERRCODE = '23503';
    END IF;

    IF v_session_enrollment IS DISTINCT FROM NEW.enrollment_id THEN
      RAISE EXCEPTION 'Reflection enrollment % does not match session enrollment %',
        NEW.enrollment_id, v_session_enrollment USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER session_learning_reflections_validate
  BEFORE INSERT OR UPDATE ON public.session_learning_reflections
  FOR EACH ROW EXECUTE FUNCTION public.validate_session_learning_reflection();
