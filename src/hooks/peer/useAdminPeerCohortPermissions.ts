import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ELIGIBLE_PEER_PARTNERS_KEY } from "./useEligiblePeerPartners";

export const ADMIN_PEER_COHORT_PERMISSIONS_KEY = "admin-peer-cohort-permissions";

export interface PeerCohortCandidate {
  cohortId: string;
  name: string;
  /** Learners of THIS cohort may select learners of the candidate. */
  allowedOutbound: boolean;
  /** Learners of the candidate may select learners of this cohort. */
  allowedInbound: boolean;
}

/**
 * Admin view of a cohort's Peer configuration.
 *
 * Division of ownership, the same as Coaching and Mentoring:
 *   Programme  how many Peer units are required
 *   Cohort     the completion deadline (CohortRequirementSchedule)
 *   Cohort     WHO may practise together -- this hook
 *
 * Candidates are the other cohorts of the SAME programme, because that is what
 * makes two cohorts' Peer work comparable. The database enforces this too
 * (validate_peer_cohort_permission), so this list is a convenience, not the
 * control: a grant to an unrelated cohort is refused however it is written.
 *
 * Outbound and inbound are tracked separately because the grant is directional.
 * A --> B lets A's learners go looking in B; it does not let B's learners go
 * looking in A. Reciprocity is two rows and is never implied.
 */
export function useAdminPeerCohortPermissions(cohortId: string | undefined) {
  return useQuery({
    queryKey: [ADMIN_PEER_COHORT_PERMISSIONS_KEY, cohortId],
    enabled: !!cohortId,
    queryFn: async (): Promise<PeerCohortCandidate[]> => {
      const { data: cohort, error: cErr } = await supabase
        .from("cohorts")
        .select("id, programme_id")
        .eq("id", cohortId!)
        .maybeSingle();
      if (cErr) throw cErr;
      // A cohort with no programme has no comparable peers at all.
      if (!cohort?.programme_id) return [];

      const [{ data: siblings, error: sErr }, { data: grants, error: gErr }] = await Promise.all([
        supabase
          .from("cohorts")
          .select("id, name")
          .eq("programme_id", cohort.programme_id)
          .neq("id", cohortId!)
          .order("name"),
        supabase
          .from("peer_cohort_permissions")
          .select("source_cohort_id, allowed_peer_cohort_id")
          .or(`source_cohort_id.eq.${cohortId},allowed_peer_cohort_id.eq.${cohortId}`),
      ]);
      if (sErr) throw sErr;
      if (gErr) throw gErr;

      const outbound = new Set(
        (grants ?? []).filter((g) => g.source_cohort_id === cohortId).map((g) => g.allowed_peer_cohort_id)
      );
      const inbound = new Set(
        (grants ?? []).filter((g) => g.allowed_peer_cohort_id === cohortId).map((g) => g.source_cohort_id)
      );

      return (siblings ?? []).map((c) => ({
        cohortId: c.id,
        name: c.name,
        allowedOutbound: outbound.has(c.id),
        allowedInbound: inbound.has(c.id),
      }));
    },
  });
}

/**
 * Grant or withdraw one direction of Peer access, optionally both at once.
 *
 * Withdrawal is a delete rather than a deactivation, and that is safe here
 * because a grant is not a historical record of anything: sessions already
 * booked keep their own participant rows, requirements and progress, and the
 * booking trigger only consults the grant when a session is CREATED. Removing
 * a grant stops future selection; it never reaches back into what happened.
 */
export function useSetPeerCohortPermission(cohortId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      otherCohortId,
      allowed,
      bothWays,
    }: {
      otherCohortId: string;
      allowed: boolean;
      bothWays: boolean;
    }) => {
      const createdBy = (await supabase.auth.getUser()).data.user?.id ?? null;
      // Each direction is its own row, written explicitly. Nothing infers the
      // reverse grant from the forward one.
      const pairs: { source_cohort_id: string; allowed_peer_cohort_id: string }[] = [
        { source_cohort_id: cohortId!, allowed_peer_cohort_id: otherCohortId },
      ];
      if (bothWays) {
        pairs.push({ source_cohort_id: otherCohortId, allowed_peer_cohort_id: cohortId! });
      }

      if (allowed) {
        const { error } = await supabase
          .from("peer_cohort_permissions")
          .upsert(
            pairs.map((p) => ({ ...p, created_by: createdBy })),
            { onConflict: "source_cohort_id,allowed_peer_cohort_id", ignoreDuplicates: true }
          );
        if (error) throw error;
        return;
      }

      for (const p of pairs) {
        const { error } = await supabase
          .from("peer_cohort_permissions")
          .delete()
          .eq("source_cohort_id", p.source_cohort_id)
          .eq("allowed_peer_cohort_id", p.allowed_peer_cohort_id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ADMIN_PEER_COHORT_PERMISSIONS_KEY, cohortId] });
      // The grant decides who a learner may book, so every reader of the
      // resolved partner list has to be refreshed too.
      queryClient.invalidateQueries({ queryKey: [ELIGIBLE_PEER_PARTNERS_KEY] });
    },
  });
}
