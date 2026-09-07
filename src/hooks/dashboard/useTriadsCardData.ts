import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface TriadsData {
  nextSession: {
    id: string;
    status: string;
    proposed_start_time: string | null;
    myResponse: "pending" | "accepted" | "declined" | null;
  } | null;
  pendingReflections: number;
  upcomingCount: number;
}

const empty: TriadsData = { nextSession: null, pendingReflections: 0, upcomingCount: 0 };

async function fetchTriadsData(userId: string): Promise<TriadsData> {
  const { data: groups } = await supabase
    .from("triad_groups")
    .select("id, member_1_id, member_2_id, member_3_id")
    .or(`member_1_id.eq.${userId},member_2_id.eq.${userId},member_3_id.eq.${userId}`)
    .eq("is_active", true);
  const groupIds = (groups || []).map((g) => g.id);
  if (groupIds.length === 0) return empty;

  const groupById = Object.fromEntries((groups || []).map((g) => [g.id, g]));

  const { data: sessions } = await supabase
    .from("triad_sessions")
    .select(
      "id, status, triad_group_id, proposed_start_time, member_1_response, member_2_response, member_3_response"
    )
    .in("triad_group_id", groupIds)
    .order("proposed_start_time", { ascending: false });
  const list = sessions || [];

  const now = new Date();
  const allUpcoming = list
    .filter(
      (s) =>
        (s.status === "proposed" || s.status === "confirmed") &&
        s.proposed_start_time &&
        new Date(s.proposed_start_time) >= now
    )
    .sort((a, b) => +new Date(a.proposed_start_time!) - +new Date(b.proposed_start_time!));
  const upcoming = allUpcoming[0];

  let myResponse: "pending" | "accepted" | "declined" | null = null;
  if (upcoming) {
    const g = groupById[upcoming.triad_group_id];
    if (g?.member_1_id === userId) myResponse = upcoming.member_1_response as typeof myResponse;
    else if (g?.member_2_id === userId) myResponse = upcoming.member_2_response as typeof myResponse;
    else if (g?.member_3_id === userId) myResponse = upcoming.member_3_response as typeof myResponse;
  }

  const completedIds = list.filter((s) => s.status === "completed").map((s) => s.id);
  let pendingReflections = 0;
  if (completedIds.length > 0) {
    const { data: reflections } = await supabase
      .from("triad_reflections")
      .select("triad_session_id")
      .eq("participant_id", userId)
      .in("triad_session_id", completedIds);
    const reflected = new Set((reflections || []).map((r) => r.triad_session_id));
    pendingReflections = completedIds.filter((id) => !reflected.has(id)).length;
  }

  return {
    nextSession: upcoming
      ? {
          id: upcoming.id,
          status: upcoming.status,
          proposed_start_time: upcoming.proposed_start_time,
          myResponse,
        }
      : null,
    pendingReflections,
    upcomingCount: allUpcoming.length,
  };
}

export function useTriadsCardData(userId: string | undefined, enabled: boolean) {
  const { data, isLoading } = useQuery({
    queryKey: ["triads-card", userId],
    queryFn: () => fetchTriadsData(userId as string),
    enabled: !!userId && enabled,
    staleTime: 30_000,
  });
  return { data: data ?? empty, loading: isLoading };
}
