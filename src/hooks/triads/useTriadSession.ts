import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import type { TriadGroupMembers } from "./useMyTriads";

function slotFor(group: TriadGroupMembers, userId: string): 1 | 2 | 3 | null {
  if (group.member_1_id === userId) return 1;
  if (group.member_2_id === userId) return 2;
  if (group.member_3_id === userId) return 3;
  return null;
}

const RESPONSE_COLUMNS = { 1: "member_1_response", 2: "member_2_response", 3: "member_3_response" } as const;

export interface TriadAlternativeProposalRow {
  id: string;
  triad_session_id: string;
  proposed_by: string;
  proposed_start_time: string;
  proposed_end_time: string;
  status: "pending" | "accepted" | "superseded";
  member_1_response: "pending" | "accepted" | "declined";
  member_2_response: "pending" | "accepted" | "declined";
  member_3_response: "pending" | "accepted" | "declined" | null;
}

export function useTriadAlternativeProposals(sessionId: string | undefined) {
  const query = useQuery({
    queryKey: ["triad-alt-proposals", sessionId],
    queryFn: async (): Promise<TriadAlternativeProposalRow[]> => {
      const { data, error } = await supabase
        .from("triad_alternative_proposals")
        .select("*")
        .eq("triad_session_id", sessionId as string)
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!sessionId,
  });
  return { proposals: query.data ?? [], loading: query.isLoading };
}

/** Mutations for the propose/accept booking flow on a triad session. */
export function useTriadSession() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const invalidate = (sessionId?: string) => {
    queryClient.invalidateQueries({ queryKey: ["my-triads"] });
    if (sessionId) queryClient.invalidateQueries({ queryKey: ["triad-alt-proposals", sessionId] });
  };

  const acceptSession = useMutation({
    mutationFn: async ({ sessionId, group }: { sessionId: string; group: TriadGroupMembers }) => {
      const slot = slotFor(group, user!.id);
      if (!slot) throw new Error("Not a member of this triad");
      const { error } = await supabase
        .from("triad_sessions")
        .update({ [RESPONSE_COLUMNS[slot]]: "accepted" })
        .eq("id", sessionId);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => invalidate(vars.sessionId),
  });

  const proposeAlternative = useMutation({
    mutationFn: async ({
      sessionId,
      group,
      startTime,
      endTime,
    }: {
      sessionId: string;
      group: TriadGroupMembers;
      startTime: string;
      endTime: string;
    }) => {
      const slot = slotFor(group, user!.id);
      if (!slot) throw new Error("Not a member of this triad");
      const { error } = await supabase.from("triad_alternative_proposals").insert({
        triad_session_id: sessionId,
        proposed_by: user!.id,
        proposed_start_time: startTime,
        proposed_end_time: endTime,
        member_1_response: slot === 1 ? "accepted" : "pending",
        member_2_response: slot === 2 ? "accepted" : "pending",
        member_3_response: group.member_3_id ? (slot === 3 ? "accepted" : "pending") : null,
      });
      if (error) throw error;
    },
    onSuccess: (_r, vars) => invalidate(vars.sessionId),
  });

  const acceptAlternative = useMutation({
    mutationFn: async ({ proposalId, group }: { proposalId: string; sessionId: string; group: TriadGroupMembers }) => {
      const slot = slotFor(group, user!.id);
      if (!slot) throw new Error("Not a member of this triad");
      const { error } = await supabase
        .from("triad_alternative_proposals")
        .update({ [RESPONSE_COLUMNS[slot]]: "accepted" })
        .eq("id", proposalId);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => invalidate(vars.sessionId),
  });

  const markCompleted = useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase.from("triad_sessions").update({ status: "completed" }).eq("id", sessionId);
      if (error) throw error;
    },
    onSuccess: (_r, sessionId) => invalidate(sessionId),
  });

  return {
    acceptSession: acceptSession.mutateAsync,
    proposeAlternative: proposeAlternative.mutateAsync,
    acceptAlternative: acceptAlternative.mutateAsync,
    markCompleted: markCompleted.mutateAsync,
    isPending:
      acceptSession.isPending || proposeAlternative.isPending || acceptAlternative.isPending || markCompleted.isPending,
  };
}
