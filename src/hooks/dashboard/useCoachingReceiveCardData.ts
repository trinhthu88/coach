import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppRole } from "@/context/AuthContext";
import { withEnrollmentActions } from "@/lib/enrollmentActions";
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

async function fetchData(userId: string, role: AppRole, enrollmentId: string): Promise<CoachingReceiveData> {
  // Sessions, milestones, and the usage RPC don't depend on one another —
  // fire them together instead of one-at-a-time so the round trips overlap
  // instead of stacking (each hop costs real latency; see 2026-09-08
  // dashboard-load-latency investigation). Only the coach profile lookup
  // genuinely depends on a prior result (next session's coach_id).
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, topic, start_time, status, coach_id, enrollment_id")
    .eq("coachee_id", userId)
    .eq("enrollment_id", enrollmentId)
    .order("start_time", { ascending: false });
  // Programme progress comes from the canonical reader every role shares.
  // get_coachee_session_usage_for_enrollment() counts raw sessions and is an
  // operational usage figure, not programme completion -- it is deliberately
  // no longer consulted here.
  const [progressResult, checklistResult] = await Promise.all([
    supabase.rpc("learner_module_progress", {
      p_enrollment_id: enrollmentId,
      p_as_of: new Date().toISOString().slice(0, 10),
    }),
    supabase.rpc("coaching_post_session_checklist", { p_enrollment_id: enrollmentId }),
  ]);
  const list = await withEnrollmentActions(sessions || [], "coaching");

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
    const arr = s.enrollment_actions ?? [];
    return acc + arr.filter((it) => !it.done).length;
  }, 0);

  if (progressResult.error) throw progressResult.error;
  const coachingProgress = (progressResult.data ?? []).find((r) => r.module === "coaching") ?? null;
  const postSessionPending = (checklistResult.data ?? []).filter((c) => !c.evidence_complete).length;

  return {
    nextSession: next ? { id: next.id, topic: next.topic, start_time: next.start_time, coach } : null,
    actionItemsOpen,
    upcomingCount: upcoming.length,
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
