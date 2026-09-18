import { useQuery } from "@tanstack/react-query";
import { fetchMyTriads, type TriadResponse, type TriadSessionStatus } from "@/hooks/triads/useMyTriads";

interface TriadsData {
  nextSession: {
    id: string;
    status: TriadSessionStatus;
    scheduledStartTime: string | null;
    myResponse: TriadResponse | null;
  } | null;
  pendingReflections: number;
  upcomingCount: number;
}

const empty: TriadsData = { nextSession: null, pendingReflections: 0, upcomingCount: 0 };

/** Dashboard summary, projected from the one learner Triad read model. */
async function fetchTriadsData(): Promise<TriadsData> {
  const groups = await fetchMyTriads(null);
  const sessions = groups.filter((g) => g.isActive).flatMap((g) => g.sessions);
  if (sessions.length === 0) return empty;

  const now = Date.now();
  const upcoming = sessions
    .filter((s) => (s.status === "proposed" || s.status === "confirmed") && s.scheduledStartTime && new Date(s.scheduledStartTime).getTime() >= now)
    .sort((a, b) => +new Date(a.scheduledStartTime!) - +new Date(b.scheduledStartTime!));
  const next = upcoming[0];

  return {
    nextSession: next ? { id: next.id, status: next.status, scheduledStartTime: next.scheduledStartTime, myResponse: next.myResponse } : null,
    pendingReflections: sessions.filter((s) => s.status === "completed" && !s.reflectionSubmitted).length,
    upcomingCount: upcoming.length,
  };
}

export function useTriadsCardData(userId: string | undefined, enabled: boolean) {
  const { data, isLoading } = useQuery({
    queryKey: ["triads-card", userId],
    queryFn: fetchTriadsData,
    enabled: !!userId && enabled,
    staleTime: 30_000,
  });
  return { data: data ?? empty, loading: isLoading };
}
