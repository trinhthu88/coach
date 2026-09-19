import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MY_TRIADS_KEY, MY_TRIAD_STATUS_KEY } from "./useMyTriads";

/**
 * Triad session actions. Every write goes through a validated server
 * function (membership, lifecycle and time are enforced there) — completion
 * is programme evidence, so it is never protected only by button visibility.
 */
export function useTriadSession() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [MY_TRIADS_KEY] });
    queryClient.invalidateQueries({ queryKey: [MY_TRIAD_STATUS_KEY] });
    // A Triad status/time change moves session history, canonical progress
    // and the journey.
    queryClient.invalidateQueries({ queryKey: ["enrollment-sessions-view"] });
    queryClient.invalidateQueries({ queryKey: ["learner-canonical-progress"] });
    queryClient.invalidateQueries({ queryKey: ["triads-card"] });
  };

  // The group's next session (the first, or the next after the previous one
  // was completed / cancelled): the proposer has accepted it.
  const scheduleSession = useMutation({
    mutationFn: async ({ groupId, startTime, endTime }: { groupId: string; startTime: string; endTime: string }) => {
      const { error } = await supabase.rpc("learner_triad_schedule_session", { p_group_id: groupId, p_start: startTime, p_end: endTime });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const acceptSession = useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase.rpc("learner_triad_respond_session", { p_session_id: sessionId, p_response: "accepted" });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const proposeAlternative = useMutation({
    mutationFn: async ({ sessionId, startTime, endTime }: { sessionId: string; startTime: string; endTime: string }) => {
      const { error } = await supabase.rpc("learner_triad_propose_alternative", { p_session_id: sessionId, p_start: startTime, p_end: endTime });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const acceptAlternative = useMutation({
    mutationFn: async (proposalId: string) => {
      const { error } = await supabase.rpc("learner_triad_respond_alternative", { p_proposal_id: proposalId, p_response: "accepted" });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const markCompleted = useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase.rpc("learner_triad_complete_session", { p_session_id: sessionId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    scheduleSession: scheduleSession.mutateAsync,
    acceptSession: acceptSession.mutateAsync,
    proposeAlternative: proposeAlternative.mutateAsync,
    acceptAlternative: acceptAlternative.mutateAsync,
    markCompleted: markCompleted.mutateAsync,
    isPending:
      scheduleSession.isPending ||
      acceptSession.isPending || proposeAlternative.isPending || acceptAlternative.isPending || markCompleted.isPending,
  };
}
