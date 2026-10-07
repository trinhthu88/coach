import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppRole } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { fetchCoachNextSessions, fetchLearnerNextSessions, pickModule } from "@/lib/nextSessions";

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
  /** Operational stat (raw completed peer sessions). Never programme completion: that is canonical_module_progress. */
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

async function fetchCoachPeer(userId: string, enrollmentId: string | null): Promise<PeerCoachingData> {
  // Coach-pool practice, both ways: the practice this Coach gives
  // (coach_next_session_by_module) and receives as a learner
  // (learner_next_session_by_module, practice row). The next one is the earlier.
  const [given, received, { data: fb }] = await Promise.all([
    fetchCoachNextSessions().then((rows) => pickModule(rows, "peer_coaching", true)),
    enrollmentId ? fetchLearnerNextSessions(enrollmentId).then((rows) => pickModule(rows, "peer_coaching", true)) : Promise.resolve(null),
    supabase
      .from("peer_session_competency_feedback")
      .select("*")
      .eq("peer_coach_id", userId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  const giveNext = given?.source_id && given.start_time
    ? { id: given.source_id, topic: given.title ?? "", start_time: given.start_time, counterpart: given.learner_name, direction: "give" as const }
    : null;
  const receiveNext = received
    ? { id: received.source_id, topic: received.title ?? "", start_time: received.next_session_at,
        counterpart: received.counterpart_names?.[0] ?? null, direction: "receive" as const }
    : null;
  const nextSession = [giveNext, receiveNext]
    .filter((x): x is NonNullable<typeof giveNext> => x != null)
    .sort((x, y) => +new Date(x.start_time) - +new Date(y.start_time))[0] ?? null;

  let competencySnapshot: { label: string; score: number }[] | null = null;
  if (fb && fb.length > 0) {
    competencySnapshot = COMPETENCY_KEYS.map((key) => {
      const vals = fb.map((f) => f[key]).filter((v): v is number => v != null);
      const avg = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : 0;
      return { label: key, score: avg };
    }).filter((c) => c.score > 0);
  }
  return {
    nextSession,
    pendingCount: given?.pending_count ?? 0,
    upcomingCount: (given?.upcoming_count ?? 0) + (received?.upcoming_count ?? 0),
    completedCount: given?.delivered_count ?? 0,
    competencySnapshot,
  };
}

async function fetchCoacheePeer(userId: string, enrollmentId: string | null): Promise<PeerCoachingData> {
  // The next dyad session is the server's (learner_next_session_by_module);
  // requests waiting for this learner's answer are read as rows.
  const [next, { count: pendingCount }] = await Promise.all([
    enrollmentId ? fetchLearnerNextSessions(enrollmentId).then((rows) => pickModule(rows, "peer_coaching")) : Promise.resolve(null),
    supabase
      .from("coachee_peer_sessions")
      .select("id", { count: "exact", head: true })
      .eq("peer_provider_id", userId)
      .eq("status", "pending_coach_approval"),
  ]);
  return {
    nextSession: next
      ? { id: next.source_id, topic: next.title ?? "", start_time: next.next_session_at,
          counterpart: next.counterpart_names?.[0] ?? null, direction: "receive" }
      : null,
    pendingCount: pendingCount ?? 0,
    upcomingCount: next?.upcoming_count ?? 0,
    // Operational context only; programme completion is canonical_module_progress.
    completedCount: 0,
    competencySnapshot: null,
  };
}

export function usePeerCoachingCardData(userId: string | undefined, role: AppRole | null, enabled: boolean) {
  const enrollmentContext = useEnrollmentContext(userId);
  const enrollmentId = enrollmentContext.selectedEnrollment?.id ?? null;
  const { data, isLoading } = useQuery({
    queryKey: ["peer-coaching-card", userId, role, enrollmentId],
    queryFn: () => (role === "coach" ? fetchCoachPeer(userId as string, enrollmentId) : fetchCoacheePeer(userId as string, enrollmentId)),
    enabled: !!userId && !!role && enabled && !enrollmentContext.loading,
    staleTime: 30_000,
  });
  return { data: data ?? empty, loading: isLoading || enrollmentContext.loading };
}
