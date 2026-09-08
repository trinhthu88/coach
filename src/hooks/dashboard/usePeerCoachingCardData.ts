import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppRole } from "@/context/AuthContext";

interface PeerCoachingData {
  nextSession: {
    id: string;
    topic: string;
    start_time: string;
    counterpart: string | null;
    direction: "give" | "receive";
  } | null;
  pendingCount: number;
  upcomingCount: number;
  completedCount: number;
  competencySnapshot: { label: string; score: number }[] | null;
}

const empty: PeerCoachingData = {
  nextSession: null,
  pendingCount: 0,
  upcomingCount: 0,
  completedCount: 0,
  competencySnapshot: null,
};

const COMPETENCY_KEYS = [
  "ethical_practice",
  "coaching_mindset",
  "maintains_agreements",
  "trust_safety",
  "maintains_presence",
  "listens_actively",
  "evokes_awareness",
  "facilitates_growth",
] as const;

async function fetchCoachPeer(userId: string): Promise<PeerCoachingData> {
  // Sessions and competency feedback are independent — fetch them together.
  // The counterpart profile lookup genuinely depends on the sessions result
  // (needs the upcoming session's counterpart id), so it stays a second wave.
  const [{ data }, { data: fb }] = await Promise.all([
    supabase
      .from("peer_sessions")
      .select("id, topic, start_time, status, peer_coach_id, peer_coachee_id")
      .or(`peer_coach_id.eq.${userId},peer_coachee_id.eq.${userId}`)
      .order("start_time", { ascending: false }),
    supabase
      .from("peer_session_competency_feedback")
      .select("*")
      .eq("peer_coach_id", userId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  const list = data || [];
  const now = new Date();
  const allUpcoming = list
    .filter((s) => s.status === "confirmed" && new Date(s.start_time) >= now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const upcoming = allUpcoming[0];
  const pendingCount = list.filter((s) => s.status === "pending_coach_approval" && s.peer_coach_id === userId).length;

  let counterpart: string | null = null;
  let direction: "give" | "receive" = "give";
  if (upcoming) {
    direction = upcoming.peer_coach_id === userId ? "give" : "receive";
    const counterpartId = direction === "give" ? upcoming.peer_coachee_id : upcoming.peer_coach_id;
    const { data: p } = await supabase.from("profiles").select("full_name").eq("id", counterpartId).maybeSingle();
    counterpart = p?.full_name ?? null;
  }

  let competencySnapshot: { label: string; score: number }[] | null = null;
  if (fb && fb.length > 0) {
    competencySnapshot = COMPETENCY_KEYS.map((key) => {
      const vals = fb.map((f) => f[key]).filter((v): v is number => v != null);
      const avg = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : 0;
      return { label: key, score: avg };
    }).filter((c) => c.score > 0);
  }

  return {
    nextSession: upcoming
      ? { id: upcoming.id, topic: upcoming.topic, start_time: upcoming.start_time, counterpart, direction }
      : null,
    pendingCount,
    upcomingCount: allUpcoming.length,
    completedCount: list.filter((s) => s.status === "completed").length,
    competencySnapshot,
  };
}

async function fetchCoacheePeer(userId: string): Promise<PeerCoachingData> {
  const { data } = await supabase
    .from("coachee_peer_sessions")
    .select("id, topic, start_time, status, peer_provider_id, peer_receiver_id")
    .or(`peer_provider_id.eq.${userId},peer_receiver_id.eq.${userId}`)
    .order("start_time", { ascending: false });
  const list = data || [];
  const now = new Date();
  const allUpcoming = list
    .filter((s) => s.status === "confirmed" && new Date(s.start_time) >= now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const upcoming = allUpcoming[0];
  const pendingCount = list.filter(
    (s) => s.status === "pending_coach_approval" && s.peer_provider_id === userId
  ).length;

  let counterpart: string | null = null;
  let direction: "give" | "receive" = "give";
  if (upcoming) {
    direction = upcoming.peer_provider_id === userId ? "give" : "receive";
    const counterpartId = direction === "give" ? upcoming.peer_receiver_id : upcoming.peer_provider_id;
    const { data: p } = await supabase.from("profiles").select("full_name").eq("id", counterpartId).maybeSingle();
    counterpart = p?.full_name ?? null;
  }

  return {
    nextSession: upcoming
      ? { id: upcoming.id, topic: upcoming.topic, start_time: upcoming.start_time, counterpart, direction }
      : null,
    pendingCount,
    upcomingCount: allUpcoming.length,
    completedCount: list.filter((s) => s.status === "completed").length,
    competencySnapshot: null,
  };
}

export function usePeerCoachingCardData(userId: string | undefined, role: AppRole | null, enabled: boolean) {
  const { data, isLoading } = useQuery({
    queryKey: ["peer-coaching-card", userId, role],
    queryFn: () => (role === "coach" ? fetchCoachPeer(userId as string) : fetchCoacheePeer(userId as string)),
    enabled: !!userId && !!role && enabled,
    staleTime: 30_000,
  });
  return { data: data ?? empty, loading: isLoading };
}
