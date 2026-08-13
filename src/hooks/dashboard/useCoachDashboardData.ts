import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Database } from "@/integrations/supabase/types";

export type CoachSession = Pick<
  Database["public"]["Tables"]["sessions"]["Row"],
  "id" | "topic" | "start_time" | "duration_minutes" | "status" | "coach_notes" | "meeting_url" | "coachee_id"
>;

export type PeerSession = Pick<
  Database["public"]["Tables"]["peer_sessions"]["Row"],
  "id" | "topic" | "start_time" | "duration_minutes" | "status" | "peer_coach_id" | "peer_coachee_id"
>;

type ProfileLite = { full_name: string; avatar_url: string | null; email: string };

interface CoachDashboardData {
  sessions: CoachSession[];
  peerSessions: PeerSession[];
  profilesById: Record<string, ProfileLite>;
  peerOptIn: boolean;
  coachProfile: { rating_avg: number; sessions_completed: number } | null;
}

interface UseCoachDashboardDataResult extends CoachDashboardData {
  loading: boolean;
  actingId: string | null;
  approve: (s: CoachSession) => Promise<void>;
  decline: (s: CoachSession) => Promise<void>;
}

const emptyData: CoachDashboardData = {
  sessions: [],
  peerSessions: [],
  profilesById: {},
  peerOptIn: false,
  coachProfile: null,
};

async function fetchCoachDashboardData(userId: string): Promise<CoachDashboardData> {
  const [{ data: sess }, { data: peer }, { data: cp }] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, topic, start_time, duration_minutes, status, coach_notes, meeting_url, coachee_id")
      .eq("coach_id", userId)
      .order("start_time", { ascending: false }),
    supabase
      .from("peer_sessions")
      .select("id, topic, start_time, duration_minutes, status, peer_coach_id, peer_coachee_id")
      .or(`peer_coach_id.eq.${userId},peer_coachee_id.eq.${userId}`)
      .order("start_time", { ascending: false }),
    supabase
      .from("coach_profiles")
      .select("rating_avg, sessions_completed, peer_coaching_opt_in")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  const list = sess || [];
  const peerList = peer || [];

  const ids = Array.from(
    new Set([
      ...list.map((s) => s.coachee_id),
      ...peerList.map((s) => s.peer_coach_id),
      ...peerList.map((s) => s.peer_coachee_id),
    ])
  );
  let profilesById: Record<string, ProfileLite> = {};
  if (ids.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url, email")
      .in("id", ids);
    profilesById = Object.fromEntries(
      (profs || []).map((p) => [p.id, { full_name: p.full_name, avatar_url: p.avatar_url, email: p.email }])
    );
  }

  return {
    sessions: list,
    peerSessions: peerList,
    profilesById,
    peerOptIn: !!cp?.peer_coaching_opt_in,
    coachProfile: cp ? { rating_avg: cp.rating_avg, sessions_completed: cp.sessions_completed } : null,
  };
}

export function useCoachDashboardData(userId: string): UseCoachDashboardDataResult {
  const queryClient = useQueryClient();
  const [actingId, setActingId] = useState<string | null>(null);
  const queryKey = ["coach-dashboard", userId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchCoachDashboardData(userId),
    enabled: !!userId,
    staleTime: 30_000,
  });

  const approveMutation = useMutation({
    mutationFn: async (s: CoachSession) => {
      const { error } = await supabase.functions.invoke("confirm-session", {
        body: { session_id: s.id, is_peer: false },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Session confirmed. Zoom meeting is ready.");
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed"),
  });

  const declineMutation = useMutation({
    mutationFn: async (s: CoachSession) => {
      const { error } = await supabase.functions.invoke("cancel-session", {
        body: { session_id: s.id, is_peer: false },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Request declined");
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed"),
  });

  const approve = async (s: CoachSession) => {
    setActingId(s.id);
    await approveMutation.mutateAsync(s).catch(() => {});
    setActingId(null);
  };

  const decline = async (s: CoachSession) => {
    setActingId(s.id);
    await declineMutation.mutateAsync(s).catch(() => {});
    setActingId(null);
  };

  return {
    ...(data ?? emptyData),
    loading: isLoading,
    actingId,
    approve,
    decline,
  };
}
