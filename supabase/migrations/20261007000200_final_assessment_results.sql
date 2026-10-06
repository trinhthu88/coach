-- ===========================================================================
-- Final Assessment results everywhere (Prompt A6)
--
-- Learner My Journey, Admin enrollment detail and Sponsor leader detail all
-- read canonical_final_assessment_result through their role wrapper
-- (learner_final_assessment, admin_final_assessment_result,
-- sponsor_final_assessment_status, 20261007000100). This migration only
-- changes the Sponsor wrapper: a leader whose programme has no Final
-- Assessment now returns NO row (the leader page shows no Final Assessment
-- card) instead of a misleading 'not_submitted'. Status + Pass / Not pass
-- only; Resubmit shows as Under review (rule 11).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.sponsor_final_assessment_status(p_enrollment_id uuid)
 RETURNS TABLE(status text, result text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    CASE r.state
      WHEN 'not_submitted' THEN 'not_submitted'
      WHEN 'completed' THEN CASE WHEN r.final_result IS NOT NULL THEN 'completed' ELSE 'under_review' END
      ELSE 'under_review'
    END,
    r.final_result
  FROM public.sponsor_visible_enrollments() v
  CROSS JOIN LATERAL public.canonical_final_assessment_result(v.enrollment_id) r
  WHERE v.enrollment_id = p_enrollment_id
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.sponsor_final_assessment_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_final_assessment_status(uuid) TO authenticated, service_role;
