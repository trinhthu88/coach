import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchLearnerNextSessions, pickModule } from "@/lib/nextSessions";
import { AppRole } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";

interface CoachingReceiveData {
  nextSession: {
    id: string;
    topic: string;
    start_time: string;
    coach: { full_name: string; avatar_url: string | null } | null;
  } | null;
  actionItemsOpen: number;
  upcomingCount: number;
  /**
   * Canonical programme progress (learner_module_progress), never derived
   * from the raw session rows above: a completed session = a fulfilled
   * requirement unit, counted by the canonical engine. null = the programme
   * has no Coaching module for this enrollment. A failed read throws, so the
   * card shows an error state -- never a silent 0.
   */
  requiredUnits: number | null;
  completedUnits: number | null;
  bookedUnits: number | null;
  overdueUnits: number | null;
  postSessionPending: number;
}

const empty: CoachingReceiveData = {
  nextSession: null,
  actionItemsOpen: 0,
  upcomingCount: 0,
  requiredUnits: null,
  completedUnits: null,
  bookedUnits: null,
  overdueUnits: null,
  postSessionPending: 0,
};

async function fetchData(_userId: string, _role: AppRole, enrollmentId: string): Promise<CoachingReceiveData> {
  // The next session is the server's (learner_next_session_by_module,
  // 20261007001100); progress, the post-session checklist and the open
  // follow-up actions are their own canonical reads. Nothing is filtered or
  // sorted here.
  const [nextRows, progressResult, checklistResult, openActions] = await Promise.all([
    fetchLearnerNextSessions(enrollmentId),
    supabase.rpc("learner_module_progress", { p_enrollment_id: enrollmentId }),
    supabase.rpc("coaching_post_session_checklist", { p_enrollment_id: enrollmentId }),
    supabase
      .from("enrollment_actions")
      .select("id", { count: "exact", head: true })
      .eq("enrollment_id", enrollmentId)
      .eq("source_activity_type", "coaching")
      .neq("status", "completed"),
  ]);
  if (progressResult.error) throw progressResult.error;
  const next = pickModule(nextRows, "coaching");
  const coachingProgress = (progressResult.data ?? []).find((r) => r.module === "coaching") ?? null;
  const postSessionPending = (checklistResult.data ?? []).filter((c) => !c.evidence_complete).length;
  return {
    nextSession: next
      ? {
          id: next.source_id,
          topic: next.title ?? "",
          start_time: next.next_session_at,
          coach: next.counterpart_names?.[0] ? { full_name: next.counterpart_names[0], avatar_url: null } : null,
        }
      : null,
    actionItemsOpen: openActions.count ?? 0,
    upcomingCount: next?.upcoming_count ?? 0,
    requiredUnits: coachingProgress ? coachingProgress.required_units : null,
    completedUnits: coachingProgress ? coachingProgress.completed_units : null,
    bookedUnits: coachingProgress ? coachingProgress.booked_units : null,
    overdueUnits: coachingProgress ? coachingProgress.overdue_units : null,
    postSessionPending,
  };
}

export function useCoachingReceiveCardData(userId: string | undefined, role: AppRole | null, enabled: boolean) {
  const enrollmentContext = useEnrollmentContext(userId);
  const enrollmentId = enrollmentContext.selectedEnrollment?.id;
  const { data, isLoading, error } = useQuery({
    queryKey: ["coaching-receive-card", userId, enrollmentId ?? null],
    queryFn: () => fetchData(userId as string, role as AppRole, enrollmentId as string),
    enabled: !!userId && !!role && !!enrollmentId && enabled,
    staleTime: 30_000,
  });
  return {
    data: data ?? empty,
    loading: enrollmentContext.loading || isLoading,
    /** The canonical progress read failed: render an error state, never zeros. */
    error: !!error,
    enrollmentId: enrollmentId ?? null,
  };
}
