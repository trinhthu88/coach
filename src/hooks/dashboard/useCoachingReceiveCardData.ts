import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Json } from "@/integrations/supabase/types";
import { AppRole } from "@/context/AuthContext";

interface CoachingReceiveData {
  nextSession: {
    id: string;
    topic: string;
    start_time: string;
    coach: { full_name: string; avatar_url: string | null } | null;
  } | null;
  goalProgressPct: number;
  actionItemsOpen: number;
  sessionsUsed: number;
  sessionLimit: number | null; // null = no cap tracked (e.g. coach-as-coachee)
  upcomingCount: number;
}

const empty: CoachingReceiveData = {
  nextSession: null,
  goalProgressPct: 0,
  actionItemsOpen: 0,
  sessionsUsed: 0,
  sessionLimit: null,
  upcomingCount: 0,
};

async function fetchData(userId: string, role: AppRole): Promise<CoachingReceiveData> {
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, topic, start_time, status, coach_id, action_items")
    .eq("coachee_id", userId)
    .order("start_time", { ascending: false });
  const list = sessions || [];

  const now = new Date();
  const upcoming = list
    .filter((s) => s.status === "confirmed" && new Date(s.start_time) >= now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const next = upcoming[0] ?? null;

  let coach: { full_name: string; avatar_url: string | null } | null = null;
  if (next) {
    const { data: p } = await supabase
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("id", next.coach_id)
      .maybeSingle();
    coach = p ?? null;
  }

  const actionItemsOpen = list.reduce((acc, s) => {
    const arr = Array.isArray(s.action_items) ? s.action_items : [];
    return acc + arr.filter((it: Json) => (typeof it === "string" ? true : !(it as { done?: boolean })?.done)).length;
  }, 0);

  const { data: milestones } = await supabase
    .from("coachee_milestones")
    .select("is_done")
    .eq("coachee_id", userId);
  const totalMs = milestones?.length ?? 0;
  const doneMs = milestones?.filter((m) => m.is_done).length ?? 0;
  const goalProgressPct = totalMs ? Math.round((doneMs / totalMs) * 100) : 0;

  let sessionsUsed = list.filter((s) => ["pending_coach_approval", "confirmed", "completed"].includes(s.status)).length;
  let sessionLimit: number | null = null;
  if (role === "coachee") {
    const { data: usage } = await supabase.rpc("get_coachee_session_usage", { _coachee_id: userId });
    if (usage && usage.length > 0) {
      sessionLimit = usage[0].monthly_limit ?? null;
      sessionsUsed = usage[0].used_this_month ?? sessionsUsed;
    }
  }

  return {
    nextSession: next ? { id: next.id, topic: next.topic, start_time: next.start_time, coach } : null,
    goalProgressPct,
    actionItemsOpen,
    sessionsUsed,
    sessionLimit,
    upcomingCount: upcoming.length,
  };
}

export function useCoachingReceiveCardData(userId: string | undefined, role: AppRole | null, enabled: boolean) {
  const { data, isLoading } = useQuery({
    queryKey: ["coaching-receive-card", userId],
    queryFn: () => fetchData(userId as string, role as AppRole),
    enabled: !!userId && !!role && enabled,
    staleTime: 30_000,
  });
  return { data: data ?? empty, loading: isLoading };
}
