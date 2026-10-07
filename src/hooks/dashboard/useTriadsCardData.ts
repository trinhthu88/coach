import { useQuery } from "@tanstack/react-query";
import { fetchMyTriads, type TriadResponse, type TriadSessionStatus } from "@/hooks/triads/useMyTriads";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { fetchLearnerNextSessions, pickModule } from "@/lib/nextSessions";

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

/**
 * Dashboard summary. The next session is the server's
 * (learner_next_session_by_module, 20261007001100); the learner's own answer
 * to a proposal and the reflections owed come from the one learner Triad read
 * model.
 */
async function fetchTriadsData(enrollmentId: string | null): Promise<TriadsData> {
  const [groups, nextRows] = await Promise.all([
    fetchMyTriads(null),
    enrollmentId ? fetchLearnerNextSessions(enrollmentId) : Promise.resolve([]),
  ]);
  const completedSessions = groups.flatMap((g) => g.sessions).filter((s) => s.status === "completed");
  const next = pickModule(nextRows, "triads");
  const nextSession = next ? groups.flatMap((g) => g.sessions).find((s) => s.id === next.source_id) : undefined;
  return {
    nextSession: next
      ? {
          id: next.source_id,
          status: (next.status as TriadSessionStatus),
          scheduledStartTime: next.next_session_at,
          myResponse: nextSession?.myResponse ?? null,
        }
      : null,
    pendingReflections: completedSessions.filter((s) => !s.reflectionSubmitted).length,
    upcomingCount: next?.upcoming_count ?? 0,
  };
}

export function useTriadsCardData(userId: string | undefined, enabled: boolean) {
  const enrollmentContext = useEnrollmentContext(userId);
  const enrollmentId = enrollmentContext.selectedEnrollment?.id ?? null;
  const { data, isLoading } = useQuery({
    queryKey: ["triads-card", userId, enrollmentId],
    queryFn: () => fetchTriadsData(enrollmentId),
    enabled: !!userId && enabled && !enrollmentContext.loading,
    staleTime: 30_000,
  });
  return { data: data ?? empty, loading: isLoading || enrollmentContext.loading };
}
