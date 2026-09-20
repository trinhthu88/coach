import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DevelopmentSessionItem, DevelopmentSessionType } from "./developmentSessionTypes";

const TYPE_BY_SESSION_TYPE: Record<string, DevelopmentSessionType> = {
  coaching: "coaching",
  peer_coaching: "peer_coaching",
  mentoring: "mentoring",
  triad: "triad",
};

/**
 * The learner's session history for one enrollment — every coaching, peer
 * practice, mentoring and triad record, read through learner_session_history
 * (one server-side projection over the canonical session tables). This is
 * history/scheduling, not requirement calculation: each row keeps its real
 * lifecycle status, and `isProgrammeEvidence` is taken from the same
 * session_activity_attributions rows canonical module progress counts, so a
 * learner can see e.g. four peer sessions while Peer coaching shows 2/2.
 *
 * Previously this read `peer_sessions` (the coach-to-coach table) for peer
 * practice, so a coachee's coachee_peer_sessions never appeared, and triad
 * scope was rebuilt client-side.
 */
async function fetchEnrollmentSessions(enrollmentId: string): Promise<DevelopmentSessionItem[]> {
  const { data, error } = await supabase.rpc("learner_session_history", { p_enrollment_id: enrollmentId });
  if (error) {
    console.error("Learner session history failed to load", { enrollmentId, error });
    throw error;
  }
  return (data ?? [])
    .filter((row) => TYPE_BY_SESSION_TYPE[row.session_type])
    .map((row) => {
      const type = TYPE_BY_SESSION_TYPE[row.session_type];
      const names = row.counterpart_names ?? [];
      return {
        id: row.session_key,
        enrollmentId,
        type,
        title: row.title ?? "",
        startTime: row.start_time,
        status: row.status,
        counterpartName: type === "triad" ? null : names[0] ?? null,
        counterpartNames: names,
        sourceId: row.source_id,
        sourceType: row.source_table,
        // Triad members rotate roles; only the other session types have one.
        participantRole: type === "triad" ? null : row.participant_role,
        isProgrammeEvidence: row.is_programme_evidence,
        requirementUnitNumber: row.requirement_unit_number ?? null,
      };
    });
}

export function useEnrollmentSessions(enrollmentId: string | undefined, userId: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["enrollment-sessions-view", enrollmentId ?? null, userId ?? null],
    queryFn: () => fetchEnrollmentSessions(enrollmentId as string),
    enabled: !!enrollmentId && !!userId,
    staleTime: 30_000,
  });

  return {
    sessions: data ?? [],
    loading: !!enrollmentId && !!userId && isLoading,
    error: error ? (error instanceof Error ? error.message : String((error as { message?: unknown }).message ?? error)) : null,
  };
}
