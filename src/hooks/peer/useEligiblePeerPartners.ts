import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const ELIGIBLE_PEER_PARTNERS_KEY = "eligible-peer-partners";

export interface EligiblePeerPartner {
  userId: string;
  /** The partner's OWN enrollment -- the one their half of a session counts against. */
  enrollmentId: string;
  displayName: string;
  cohortId: string;
  cohortName: string;
  programmeName: string | null;
  /** True for the learner's own cohort, false for a cohort explicitly granted to it. */
  isOwnCohort: boolean;
}

/**
 * Who this ENROLLMENT may book peer practice with.
 *
 * The one source is eligible_peer_partners(), which resolves own cohort plus
 * every cohort granted to it by peer_cohort_permissions. This page used to
 * select straight from `profiles` on peer_coaching_opt_in, which is a global
 * flag: it listed every opted-in learner in the system, including learners of
 * cohorts -- and organisations -- this one was never connected to, and it had
 * no way to say whether a candidate was still actively enrolled.
 *
 * Asking per ENROLLMENT rather than per user is the point: a learner holding a
 * closed enrollment in one cohort and a live one in another gets the live
 * one's partners, never the closed one's.
 */
export function useEligiblePeerPartners(enrollmentId: string | undefined) {
  return useQuery({
    queryKey: [ELIGIBLE_PEER_PARTNERS_KEY, enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async (): Promise<EligiblePeerPartner[]> => {
      const { data, error } = await supabase.rpc("eligible_peer_partners", {
        p_enrollment_id: enrollmentId!,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        userId: row.user_id,
        enrollmentId: row.enrollment_id,
        displayName: row.display_name,
        cohortId: row.cohort_id,
        cohortName: row.cohort_name,
        programmeName: row.programme_name,
        isOwnCohort: row.is_own_cohort,
      }));
    },
  });
}
