import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchCoachNextSessions, fetchLearnerNextSessions, pickModule } from "@/lib/nextSessions";

interface MentoringGiveData {
  upcoming: { id: string; topic: string; start_time: string; mentee: string | null }[];
  upcomingCount: number;
  menteeCount: number;
  sessionsDelivered: number;
}

const emptyGive: MentoringGiveData = { upcoming: [], upcomingCount: 0, menteeCount: 0, sessionsDelivered: 0 };

/**
 * The MENTOR's own delivery workspace: how many sessions they have run and for
 * how many mentees. This is deliberately person-level and not enrollment
 * scoped -- it is provider analytics about the mentor, not a learner's
 * programme progress, and the two must not be conflated (section 15).
 */
async function fetchGive(_userId: string): Promise<MentoringGiveData> {
  // The Mentor's delivery side (coach_next_session_by_module, 20261007001100):
  // the next session they run, and the counts, from the server.
  const row = pickModule(await fetchCoachNextSessions(), "mentoring");
  if (!row) return emptyGive;
  return {
    upcoming: row.source_id && row.start_time
      ? [{ id: row.source_id, topic: row.title ?? "", start_time: row.start_time, mentee: row.learner_name }]
      : [],
    upcomingCount: row.upcoming_count,
    menteeCount: row.learner_count,
    sessionsDelivered: row.delivered_count,
  };
}

export function useMentoringGiveCardData(userId: string | undefined, enabled: boolean) {
  const { data, isLoading } = useQuery({
    queryKey: ["mentoring-give-card", userId],
    queryFn: () => fetchGive(userId as string),
    enabled: !!userId && enabled,
    staleTime: 30_000,
  });
  return { data: data ?? emptyGive, loading: isLoading };
}

interface MentoringReceiveData {
  nextSession: {
    id: string;
    topic: string;
    start_time: string;
    mentor: { full_name: string; avatar_url: string | null } | null;
    prepFileUploaded: boolean;
  } | null;
  upcomingCount: number;
  /**
   * Canonical Mentoring programme progress. Never counted from the session
   * rows below: only a session with status 'completed', attributed to THIS
   * enrollment, is a completed Mentoring unit. null = no Mentoring module for
   * this enrollment; a failed canonical read throws (error state, never 0).
   */
  requiredUnits: number | null;
  completedUnits: number | null;
  bookedUnits: number | null;
  overdueUnits: number | null;
}

const emptyReceive: MentoringReceiveData = {
  nextSession: null,
  upcomingCount: 0,
  requiredUnits: null,
  completedUnits: null,
  bookedUnits: null,
  overdueUnits: null,
};

/**
 * The learner's Mentoring card, scoped to the SELECTED enrollment.
 *
 * It previously filtered on mentee_id alone, so a session belonging to a
 * historical enrollment appeared against the current programme -- the exact
 * cross-enrollment leakage the canonical model forbids.
 */
async function fetchReceive(enrollmentId: string): Promise<MentoringReceiveData> {
  const [nextRows, { data: progressRows, error: progressError }] = await Promise.all([
    fetchLearnerNextSessions(enrollmentId),
    supabase.rpc("learner_module_progress", {
      p_enrollment_id: enrollmentId,
    }),
  ]);
  if (progressError) throw progressError;
  const mentoring = (progressRows ?? []).find((r) => r.module === "mentoring") ?? null;
  const progress = {
    requiredUnits: mentoring ? mentoring.required_units : null,
    completedUnits: mentoring ? mentoring.completed_units : null,
    bookedUnits: mentoring ? mentoring.booked_units : null,
    overdueUnits: mentoring ? mentoring.overdue_units : null,
  };
  // The next session is the server's (learner_next_session_by_module).
  const next = pickModule(nextRows, "mentoring");
  if (!next) return { ...emptyReceive, ...progress, upcomingCount: 0 };
  return {
    nextSession: {
      id: next.source_id,
      topic: next.title ?? "",
      start_time: next.next_session_at,
      mentor: next.counterpart_names?.[0] ? { full_name: next.counterpart_names[0], avatar_url: null } : null,
      prepFileUploaded: !!next.prep_file_submitted,
    },
    upcomingCount: next.upcoming_count,
    ...progress,
  };
}

export function useMentoringReceiveCardData(enrollmentId: string | undefined, enabled: boolean) {
  const { data, isLoading } = useQuery({
    queryKey: ["mentoring-receive-card", enrollmentId],
    queryFn: () => fetchReceive(enrollmentId as string),
    enabled: !!enrollmentId && enabled,
    staleTime: 30_000,
  });
  return { data: data ?? emptyReceive, loading: isLoading };
}
