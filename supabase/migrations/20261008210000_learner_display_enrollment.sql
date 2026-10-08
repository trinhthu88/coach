-- ===========================================================================
-- What a learner is SHOWN, apart from what they may DO (PR #20 review)
--
-- learner_current_enrollment() (20261008200000) decides actions: the
-- enrollment for which enrollment_is_ongoing holds. Used for "shown" as well,
-- it left a learner whose programme ended or is paused with "no active
-- programme" on every page -- including a Final Assessment result released
-- after the end, which the release email links to.
--
-- learner_display_enrollment() decides what the learner's pages show:
--   the current enrollment            -> is_current true,  display_state 'current'
--   else the latest enrollment        -> is_current false, display_state
--        (start_date DESC NULLS LAST,     'paused'   when its status is paused,
--         created_at DESC, id)            'upcoming' when it is active and its
--                                                    start (else its cohort's)
--                                                    is still ahead,
--                                         'ended'    otherwise
--   no enrollment                     -> no row
-- enrollment_status is active | completed | paused | at_risk: there is no
-- withdrawn value, so no enrollment is left out. A non-current enrollment is
-- shown read-only; the server keeps refusing its actions.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.learner_display_enrollment()
 RETURNS TABLE(enrollment_id uuid, is_current boolean, display_state text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  v_current := public.current_enrollment_internal(auth.uid());
  IF v_current IS NOT NULL THEN
    RETURN QUERY SELECT v_current, true, 'current'::text;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT e.id, false,
         CASE
           WHEN e.status = 'paused'::public.enrollment_status THEN 'paused'
           WHEN e.status = 'active'::public.enrollment_status
                AND public.programme_today() < coalesce(e.start_date, c.start_date, '-infinity'::date) THEN 'upcoming'
           ELSE 'ended'
         END
  FROM public.programme_enrollments e
  LEFT JOIN public.cohorts c ON c.id = e.cohort_id
  WHERE e.user_id = auth.uid()
  ORDER BY e.start_date DESC NULLS LAST, e.created_at DESC, e.id
  LIMIT 1;
END;
$function$;
REVOKE ALL ON FUNCTION public.learner_display_enrollment() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_display_enrollment() TO authenticated, service_role;
